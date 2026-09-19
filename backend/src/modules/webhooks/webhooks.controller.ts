import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret = this.configService.getOrThrow<string>(
      'OPENWA_WEBHOOK_SECRET',
    );
  }

  @Post('openwa')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'OpenWA webhook receiver',
    description:
      'Receives webhook events from the OpenWA API. Validates HMAC-SHA256 signature before processing.',
  })
  @ApiExcludeEndpoint()
  async handleOpenwaWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    // OpenWA sends the signature in `X-OpenWA-Signature`.
    // See openwa/src/modules/webhook/webhook.service.ts:162.
    @Headers('x-openwa-signature') signature: string,
  ): Promise<{ received: boolean }> {
    this.logger.log('Received OpenWA webhook');

    try {
      const rawBody = req.rawBody;
      if (!rawBody) {
        this.logger.warn(
          'Webhook received without raw body — ensure raw body parsing is enabled in main.ts',
        );
        throw new UnauthorizedException(
          'Unable to verify webhook signature: raw body unavailable',
        );
      }

      this.verifySignature(rawBody, signature);

      await this.webhooksService.processEvent(body);

      return { received: true };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(
        `Webhook processing error: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return { received: true };
    }
  }

  private verifySignature(
    rawBody: Buffer,
    signature: string | undefined,
  ): void {
    if (!signature) {
      this.logger.warn('Webhook received without signature header');
      throw new UnauthorizedException('Missing webhook signature');
    }

    // OpenWA formats the value as `sha256=<hex>`
    // (openwa/src/modules/webhook/webhook.service.ts:431). Strip the prefix
    // before hex-decoding — otherwise Buffer.from stops at the non-hex 's'
    // and produces a zero-length buffer, rejecting every event.
    const provided = signature.trim().replace(/^sha256=/i, '');

    const expectedSignature = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (!/^[a-f0-9]+$/i.test(provided)) {
      this.logger.warn('Webhook signature is not valid hex');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const sigBuffer = Buffer.from(provided, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      this.logger.warn('Webhook signature verification failed');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.logger.debug('Webhook signature verified successfully');
  }
}

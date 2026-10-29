import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import { WebhooksService } from './webhooks.service';
import { translateCloudWebhook } from './whatsapp-cloud.translate';

/**
 * Receiver for Meta's WhatsApp Cloud API webhooks.
 *
 * Configure in the Meta app dashboard under WhatsApp → Configuration:
 *   Callback URL  https://<portal>/api/webhooks/whatsapp-cloud
 *   Verify token  the value shown in Settings → WhatsApp
 *   Fields        messages
 */
@ApiExcludeController()
@Public()
// Meta delivers in bursts from a handful of IPs; the global per-IP limit would drop
// receipts during a campaign.
@SkipThrottle()
@Controller('webhooks/whatsapp-cloud')
export class WhatsappCloudWebhookController {
  private readonly logger = new Logger(WhatsappCloudWebhookController.name);

  constructor(
    private readonly cloud: WhatsappCloudService,
    private readonly webhooksService: WebhooksService,
  ) {}

  /** Meta's one-time handshake when the callback URL is saved in the dashboard. */
  @Get()
  @Header('Content-Type', 'text/plain')
  async verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): Promise<string> {
    const cfg = await this.cloud.getConfig();
    const expected = cfg?.verifyToken;
    if (mode === 'subscribe' && expected && token && safeEqual(token, expected)) {
      this.logger.log('WhatsApp Cloud API webhook verified by Meta');
      return challenge ?? '';
    }
    this.logger.warn('WhatsApp Cloud API webhook verification failed: verify token mismatch');
    throw new ForbiddenException('Verify token mismatch');
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<{ received: boolean }> {
    const cfg = await this.cloud.getConfig();
    if (!cfg?.appSecret) {
      // Without the app secret the payload cannot be authenticated, and an
      // unauthenticated inbound path would let anyone fabricate replies and leads.
      this.logger.error(
        'Rejected a WhatsApp Cloud API webhook: no app secret is configured. ' +
          'Add it in Settings → WhatsApp so replies and delivery receipts can be accepted.',
      );
      throw new UnauthorizedException('Webhook signing secret not configured');
    }
    if (!req.rawBody) throw new UnauthorizedException('Raw body unavailable');

    const provided = (signature ?? '').trim().replace(/^sha256=/i, '');
    const expected = createHmac('sha256', cfg.appSecret).update(req.rawBody).digest('hex');
    if (!/^[a-f0-9]+$/i.test(provided) || !safeEqual(provided.toLowerCase(), expected)) {
      this.logger.warn('WhatsApp Cloud API webhook signature verification failed');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Always answer 200 once authenticated: Meta retries for days on errors, and the
    // queue below already retries our own processing failures.
    try {
      for (const evt of translateCloudWebhook(body)) {
        await this.webhooksService.processEvent(evt, {
          // A status can arrive before the send path has stored the message id it
          // refers to. A short delay lets that row land so the receipt can correlate.
          delayMs: evt.event === 'message.received' ? 0 : 3000,
        });
      }
    } catch (err) {
      this.logger.error(`WhatsApp Cloud API webhook processing error: ${(err as Error).message}`);
    }
    return { received: true };
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

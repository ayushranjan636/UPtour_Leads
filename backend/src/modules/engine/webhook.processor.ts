import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WebhooksService } from '../webhooks/webhooks.service';

interface WebhookJobData {
  event: string;
  data: any;
}

@Processor('webhook-process')
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly webhooksService: WebhooksService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { event, data } = job.data;
    this.logger.log(
      `Processing webhook job ${job.id} — event=${event}`,
    );

    try {
      // Single dispatch path shared with the inline fallback, so queued and
      // inline handling can never drift apart.
      await this.webhooksService.handleEventInline(event, data);

      this.logger.log(
        `Webhook job ${job.id} (event=${event}) processed successfully`,
      );
    } catch (error) {
      this.logger.error(
        `Webhook job ${job.id} (event=${event}) failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}

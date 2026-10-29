import { Module } from '@nestjs/common';
import { OpenwaModule } from '../openwa/openwa.module';
import { WhatsappCloudController } from './whatsapp-cloud.controller';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WhatsappSenderService } from './whatsapp-sender.service';

/**
 * Meta's official WhatsApp Cloud API, plus the sender that routes every outbound
 * message to whichever transport (session gateway or Cloud API) is active.
 *
 * The public webhook receiver lives in WebhooksModule, next to the session gateway's
 * receiver, so both feed the same inbound pipeline.
 */
@Module({
  imports: [OpenwaModule],
  controllers: [WhatsappCloudController],
  providers: [WhatsappCloudService, WhatsappSenderService],
  exports: [WhatsappCloudService, WhatsappSenderService],
})
export class WhatsappCloudModule {}

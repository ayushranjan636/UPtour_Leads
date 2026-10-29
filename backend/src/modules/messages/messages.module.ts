import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from '../../entities/message.entity';
import { Contact } from '../../entities/contact.entity';
import { AiAnalysis } from '../../entities/ai-analysis.entity';
import { WhatsappCloudModule } from '../whatsapp-cloud/whatsapp-cloud.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Contact, AiAnalysis]),
    WhatsappCloudModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}

import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message, MessageDirection, MessageStatus } from '../../entities/message.entity';
import { Contact } from '../../entities/contact.entity';
import { AiAnalysis } from '../../entities/ai-analysis.entity';
import { OpenwaService } from '../openwa/openwa.service';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
    @InjectRepository(AiAnalysis)
    private readonly aiAnalysisRepository: Repository<AiAnalysis>,
    private readonly openwaService: OpenwaService,
  ) {}

  async getConversation(
    contactId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponseDto<Message & { ai_analyses?: AiAnalysis[] }>> {
    try {
      const contact = await this.contactRepository.findOne({ where: { id: contactId } });

      if (!contact) {
        throw new NotFoundException(`Contact with ID "${contactId}" not found`);
      }

      const [messages, total] = await this.messageRepository.findAndCount({
        where: { contact_id: contactId },
        order: { created_at: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
        relations: ['template', 'campaign_contact'],
      });

      const messageIds = messages.map((m) => m.id);

      let analysesMap: Record<string, AiAnalysis[]> = {};
      if (messageIds.length > 0) {
        const analyses = await this.aiAnalysisRepository
          .createQueryBuilder('ai')
          .where('ai.message_id IN (:...messageIds)', { messageIds })
          .getMany();

        analysesMap = analyses.reduce(
          (acc, analysis) => {
            if (!acc[analysis.message_id]) {
              acc[analysis.message_id] = [];
            }
            acc[analysis.message_id].push(analysis);
            return acc;
          },
          {} as Record<string, AiAnalysis[]>,
        );
      }

      const messagesWithAnalyses = messages.map((message) => ({
        ...message,
        ai_analyses: analysesMap[message.id] || [],
      }));

      return new PaginatedResponseDto(messagesWithAnalyses, total, page, limit);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to get conversation for contact ${contactId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException('Failed to get conversation');
    }
  }

  async sendManual(
    contactId: string,
    body: string,
    userId: string,
    sessionId?: string,
  ): Promise<Message> {
    try {
      const contact = await this.contactRepository.findOne({ where: { id: contactId } });

      if (!contact) {
        throw new NotFoundException(`Contact with ID "${contactId}" not found`);
      }

      if (!contact.whatsapp_chat_id && !contact.whatsapp_number) {
        throw new NotFoundException(
          `Contact "${contact.name}" has no WhatsApp number or chat ID configured`,
        );
      }

      const chatId = contact.whatsapp_chat_id || `${contact.whatsapp_number}@c.us`;
      const resolvedSessionId = sessionId || 'default';

      const message = this.messageRepository.create({
        contact_id: contactId,
        direction: MessageDirection.OUTGOING,
        type: 'text',
        body,
        openwa_session_id: resolvedSessionId,
        status: MessageStatus.QUEUED,
      });

      const savedMessage = await this.messageRepository.save(message);

      try {
        const result = await this.openwaService.sendText(resolvedSessionId, chatId, body);

        savedMessage.openwa_message_id = result?.id || result?.messageId || null;
        savedMessage.status = MessageStatus.SENT;
        savedMessage.sent_at = new Date();

        await this.messageRepository.save(savedMessage);
        this.logger.log(`Manual message sent to contact ${contactId} by user ${userId}`);
      } catch (sendError) {
        savedMessage.status = MessageStatus.FAILED;
        savedMessage.failed_reason = (sendError as Error).message;
        await this.messageRepository.save(savedMessage);

        this.logger.error(
          `Failed to send message to contact ${contactId}: ${(sendError as Error).message}`,
          (sendError as Error).stack,
        );
      }

      return savedMessage;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to send manual message to contact ${contactId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException('Failed to send message');
    }
  }
}

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message, MessageDirection, MessageStatus } from '../../entities/message.entity';
import { Contact } from '../../entities/contact.entity';
import { AiAnalysis } from '../../entities/ai-analysis.entity';
import { OpenwaService, toChatId } from '../openwa/openwa.service';
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
    const contact = await this.contactRepository.findOne({ where: { id: contactId } });

    if (!contact) {
      throw new NotFoundException(`Contact with ID "${contactId}" not found`);
    }

    if (!contact.whatsapp_chat_id && !contact.whatsapp_number) {
      throw new NotFoundException(
        `Contact "${contact.name}" has no WhatsApp number or chat ID configured`,
      );
    }

    // Compliance guard. The campaign pipeline has always checked this, but the
    // manual path did not — so the one route a human drives was the only one that
    // could message someone who had opted out.
    if (contact.is_opted_out) {
      throw new BadRequestException(
        `${contact.name} has opted out of messages and cannot be contacted.`,
      );
    }
    if (contact.is_suppressed) {
      throw new BadRequestException(
        `${contact.name} is suppressed${contact.suppressed_reason ? ` (${contact.suppressed_reason})` : ''} and cannot be contacted.`,
      );
    }

    const chatId = toChatId(contact.whatsapp_number, contact.whatsapp_chat_id);
    // Resolves to the real session UUID; throws a clear 503 when WhatsApp is not
    // connected, rather than letting the gateway fail cryptically mid-send.
    const resolvedSessionId = await this.openwaService.resolveSessionId(sessionId);
    await this.openwaService.assertSendable(resolvedSessionId);

    const savedMessage = await this.messageRepository.save(
      this.messageRepository.create({
        contact_id: contactId,
        direction: MessageDirection.OUTGOING,
        type: 'text',
        body,
        openwa_session_id: resolvedSessionId,
        status: MessageStatus.QUEUED,
      }),
    );

    try {
      const result = await this.openwaService.sendText(resolvedSessionId, chatId, body);

      // messageId first: OpenWA returns { messageId }, and reading `.id` first
      // stored null, which broke message.ack webhook correlation.
      savedMessage.openwa_message_id = result?.messageId ?? result?.id ?? null;
      savedMessage.status = MessageStatus.SENT;
      savedMessage.sent_at = new Date();

      await this.messageRepository.save(savedMessage);
      this.logger.log(`Manual message sent to contact ${contactId} by user ${userId}`);
      return savedMessage;
    } catch (sendError) {
      const reason = (sendError as Error).message;
      savedMessage.status = MessageStatus.FAILED;
      savedMessage.failed_reason = reason;
      await this.messageRepository.save(savedMessage);

      this.logger.error(
        `Failed to send message to contact ${contactId}: ${reason}`,
        (sendError as Error).stack,
      );

      // The session may have dropped; force re-resolution on the next attempt.
      this.openwaService.invalidateSessionCache();

      // Rethrow. This previously swallowed the error and returned the failed row,
      // so the API answered 201 Created and the UI showed a normal sent tick —
      // there was no way to tell a delivered message from a dead gateway.
      if (sendError instanceof HttpException) throw sendError;
      throw new ServiceUnavailableException(`WhatsApp message could not be sent: ${reason}`);
    }
  }
}

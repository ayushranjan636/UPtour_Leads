import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';

@Injectable()
export class OpenwaService {
  private readonly logger = new Logger(OpenwaService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    const baseURL = this.configService.getOrThrow<string>('OPENWA_BASE_URL');
    const apiKey = this.configService.getOrThrow<string>('OPENWA_API_KEY');

    this.client = axios.create({
      baseURL,
      headers: { 'X-API-Key': apiKey },
      timeout: 30_000,
    });
  }

  async getSessions(): Promise<any[]> {
    this.logger.log('Fetching all OpenWA sessions');
    try {
      const { data } = await this.client.get('/sessions');
      return data;
    } catch (error) {
      this.handleAxiosError(error, 'Failed to fetch sessions');
    }
  }

  async getSessionStatus(sessionId: string): Promise<any> {
    this.logger.log(`Fetching status for session: ${sessionId}`);
    try {
      const { data } = await this.client.get(
        `/sessions/${sessionId}/status`,
      );
      return data;
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to fetch status for session ${sessionId}`,
      );
    }
  }

  async sendText(
    sessionId: string,
    chatId: string,
    text: string,
  ): Promise<any> {
    this.logger.log(
      `Sending text to ${chatId} via session ${sessionId}`,
    );
    try {
      const { data } = await this.client.post(
        `/sessions/${sessionId}/messages/send-text`,
        { chatId, text },
      );
      return data;
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to send text to ${chatId}`,
      );
    }
  }

  async sendImage(
    sessionId: string,
    chatId: string,
    imageUrl: string,
    caption?: string,
  ): Promise<any> {
    this.logger.log(
      `Sending image to ${chatId} via session ${sessionId}`,
    );
    try {
      const { data } = await this.client.post(
        `/sessions/${sessionId}/messages/send-image`,
        { chatId, url: imageUrl, caption },
      );
      return data;
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to send image to ${chatId}`,
      );
    }
  }

  async sendDocument(
    sessionId: string,
    chatId: string,
    documentUrl: string,
    filename: string,
    caption?: string,
  ): Promise<any> {
    this.logger.log(
      `Sending document "${filename}" to ${chatId} via session ${sessionId}`,
    );
    try {
      const { data } = await this.client.post(
        `/sessions/${sessionId}/messages/send-document`,
        { chatId, url: documentUrl, filename, caption },
      );
      return data;
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to send document to ${chatId}`,
      );
    }
  }

  async sendVideo(
    sessionId: string,
    chatId: string,
    videoUrl: string,
    caption?: string,
  ): Promise<any> {
    this.logger.log(
      `Sending video to ${chatId} via session ${sessionId}`,
    );
    try {
      const { data } = await this.client.post(
        `/sessions/${sessionId}/messages/send-video`,
        { chatId, url: videoUrl, caption },
      );
      return data;
    } catch (error) {
      this.handleAxiosError(
        error,
        `Failed to send video to ${chatId}`,
      );
    }
  }

  async checkNumber(
    sessionId: string,
    number: string,
  ): Promise<boolean> {
    this.logger.log(
      `Checking if ${number} is on WhatsApp via session ${sessionId}`,
    );
    try {
      const { data } = await this.client.get(
        `/sessions/${sessionId}/contacts/check/${number}`,
      );
      // OpenWA returns { number, exists, whatsappId }.
      // See openwa/src/modules/contact/contact.controller.ts:50-54.
      // Reading a non-existent `numberExists` made this always false, which
      // suppressed every contact and stopped all sending.
      return !!(data?.exists ?? data?.numberExists);
    } catch (error) {
      this.logger.warn(
        `Number check failed for ${number}: ${(error as Error).message}`,
      );
      // Fail open: a verification outage must not suppress real contacts.
      return true;
    }
  }

  async getHealth(): Promise<any> {
    this.logger.log('Checking OpenWA health');
    try {
      const { data } = await this.client.get('/health/ready');
      return data;
    } catch (error) {
      this.handleAxiosError(error, 'OpenWA health check failed');
    }
  }

  private handleAxiosError(error: unknown, context: string): never {
    if (error instanceof AxiosError) {
      const status =
        error.response?.status ?? HttpStatus.BAD_GATEWAY;
      const message =
        error.response?.data?.message ??
        error.message ??
        'Unknown OpenWA API error';
      this.logger.error(
        `${context}: [${status}] ${message}`,
        error.stack,
      );
      throw new HttpException(
        { statusCode: status, message: `${context}: ${message}` },
        status,
      );
    }

    this.logger.error(`${context}: ${(error as Error).message}`, (error as Error).stack);
    throw new HttpException(
      { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: context },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

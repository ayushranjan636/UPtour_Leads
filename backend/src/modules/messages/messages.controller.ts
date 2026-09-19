import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

class SendMessageDto {
  @ApiProperty({ description: 'Contact UUID to send the message to' })
  @IsUUID()
  @IsNotEmpty()
  contactId: string;

  @ApiProperty({ description: 'Message text body', example: 'Hello! We have an exciting offer for you.' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ description: 'OpenWA session ID (defaults to "default")' })
  @IsOptional()
  @IsString()
  sessionId?: string;
}

@ApiTags('Messages')
@ApiBearerAuth()
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('conversation/:contactId')
  @ApiOperation({
    summary: 'Get conversation with a contact',
    description: 'Retrieve a paginated conversation history with a contact, including AI analyses for each message.',
  })
  @ApiParam({ name: 'contactId', description: 'Contact UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Paginated conversation messages with AI analyses' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Contact not found' })
  async getConversation(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query() query: PaginationDto,
  ) {
    return this.messagesService.getConversation(contactId, query.page, query.limit);
  }

  @Post('send')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send a manual message',
    description: 'Send a manual WhatsApp message to a contact. The message is queued, sent via OpenWA, and its status is tracked.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Message created and sent (or failed)' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Contact not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input data' })
  async sendManual(
    @Body() dto: SendMessageDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.messagesService.sendManual(dto.contactId, dto.body, userId, dto.sessionId);
  }
}

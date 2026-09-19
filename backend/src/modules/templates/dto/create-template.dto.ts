import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsEnum,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageTemplateType } from '../../../entities/message-template.entity';

export class CreateTemplateDto {
  @ApiPropertyOptional({ description: 'Campaign UUID this template belongs to' })
  @IsOptional()
  @IsUUID()
  campaign_id?: string;

  @ApiProperty({ description: 'Template name', example: 'Initial Outreach' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    enum: MessageTemplateType,
    description: 'Template media type',
    default: MessageTemplateType.TEXT,
  })
  @IsOptional()
  @IsEnum(MessageTemplateType)
  type?: MessageTemplateType;

  @ApiProperty({
    description: 'Template body text with optional variable placeholders like {{contact.name}}',
    example: 'Hi {{contact.name}}, we have great travel packages for {{company.country}}!',
  })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ description: 'URL of the media file to attach' })
  @IsOptional()
  @IsString()
  media_url?: string;

  @ApiPropertyOptional({ description: 'Filename for media attachment' })
  @IsOptional()
  @IsString()
  media_filename?: string;

  @ApiPropertyOptional({ description: 'Order in the sequence', default: 0 })
  @IsOptional()
  @IsInt()
  sequence_order?: number;

  @ApiPropertyOptional({ description: 'Trigger condition for this template', default: 'initial' })
  @IsOptional()
  @IsString()
  trigger_condition?: string;
}

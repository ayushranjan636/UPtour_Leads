import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsEnum,
  IsUUID,
  IsArray,
  ArrayMaxSize,
  MaxLength,
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

  @ApiPropertyOptional({
    description:
      'Approved Meta template name, used instead of `body` when the WhatsApp Cloud API is active',
    example: 'heritage_tour_intro',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cloud_template_name?: string | null;

  @ApiPropertyOptional({ description: 'Meta template language code', example: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(15)
  cloud_template_language?: string | null;

  @ApiPropertyOptional({
    description: 'Values for {{1}}, {{2}}… in order; merge fields like {{contact_name}} are allowed',
    example: ['{{contact_name}}', '{{company_name}}'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  cloud_template_params?: string[] | null;
}

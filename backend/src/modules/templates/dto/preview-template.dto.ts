import { IsString, IsNotEmpty, IsOptional, IsUUID, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageTemplateType } from '../../../entities/message-template.entity';

export class PreviewTemplateDto {
  @ApiPropertyOptional({ description: 'Template ID to preview (if previewing an existing template)' })
  @IsOptional()
  @IsUUID()
  template_id?: string;

  @ApiPropertyOptional({
    description: 'Template body text with placeholders (used if template_id is not provided)',
    example: 'Hi {{contact.name}}, we offer great packages for {{company.country}}!',
  })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiPropertyOptional({ enum: MessageTemplateType, default: MessageTemplateType.TEXT })
  @IsOptional()
  @IsEnum(MessageTemplateType)
  type?: MessageTemplateType;

  @ApiPropertyOptional({ description: 'Media URL (for image/document/video templates)' })
  @IsOptional()
  @IsString()
  media_url?: string;

  @ApiPropertyOptional({
    description: 'Sample contact data for placeholder substitution',
    example: { name: 'John Smith', designation: 'Travel Manager', whatsapp_number: '+819012345678' },
  })
  @IsOptional()
  sample_contact?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Sample company data for placeholder substitution',
    example: { name: 'Tokyo Travel Agency', country: 'Japan', city: 'Tokyo' },
  })
  @IsOptional()
  sample_company?: Record<string, any>;
}

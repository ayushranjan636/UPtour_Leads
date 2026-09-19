import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEmail,
  IsArray,
} from 'class-validator';

export class CreateContactDto {
  @ApiProperty({ description: 'Contact name', example: 'Rajesh Kumar' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'WhatsApp number (will be normalized to E.164)',
    example: '+919876543210',
  })
  @IsString()
  @IsNotEmpty()
  whatsapp_number: string;

  @ApiPropertyOptional({
    description: 'Associated company ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  company_id?: string;

  @ApiPropertyOptional({
    description: 'Job designation',
    example: 'Sales Manager',
  })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional({
    description: 'Phone number (may differ from WhatsApp)',
    example: '+919876543211',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Email address',
    example: 'rajesh@wanderlusttours.in',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Where this contact was sourced from',
    example: 'google_maps',
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({
    description: 'Tags for categorization',
    example: ['decision-maker', 'priority'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Additional notes',
    example: 'Prefers morning calls',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

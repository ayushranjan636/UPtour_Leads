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
    description:
      'Associated company ID. Prefer `company_name` when entering a contact by hand — ' +
      'a UUID is not something an operator has to hand.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  company_id?: string;

  @ApiPropertyOptional({
    description:
      'Company / agency name. Matched against existing companies case-insensitively ' +
      'and created if new, so manual entry does not need a company record first.',
    example: 'Wanderlust Tours',
  })
  @IsOptional()
  @IsString()
  company_name?: string;

  /*
   * Location is stored on the company, not the contact — it is a property of the
   * business. Accepting it here lets one form capture everything, and it is what makes
   * a manually-added contact reachable by the same Country/State/City filters and
   * campaign audiences as a scraped one. Without it, hand-entered contacts were
   * invisible to every location filter.
   */
  @ApiPropertyOptional({ description: 'Country', example: 'India' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    description: 'State / province / prefecture, when known',
    example: 'Uttar Pradesh',
  })
  @IsOptional()
  @IsString()
  state_region?: string;

  @ApiPropertyOptional({ description: 'City, when known', example: 'Agra' })
  @IsOptional()
  @IsString()
  city?: string;

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

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  IsArray,
  IsInt,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LeadStatus } from '../../../entities/lead.entity';

export class CreateLeadDto {
  @ApiProperty({
    description: 'Contact ID for this lead',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsUUID()
  @IsNotEmpty()
  contact_id: string;

  @ApiPropertyOptional({
    description: 'Associated company ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  company_id?: string;

  @ApiPropertyOptional({
    description: 'Campaign that generated this lead',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  campaign_id?: string;

  @ApiPropertyOptional({
    description: 'Lead status',
    enum: LeadStatus,
    example: LeadStatus.NEW,
  })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({
    description: 'User ID this lead is assigned to',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @ApiPropertyOptional({
    description: 'Source of the lead',
    example: 'whatsapp_campaign',
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({
    description: 'Product the lead is interested in',
    example: 'Golden Triangle Tour',
  })
  @IsOptional()
  @IsString()
  product_interest?: string;

  @ApiPropertyOptional({
    description: 'Destinations the lead is interested in',
    example: ['Agra', 'Varanasi', 'Lucknow'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  destinations?: string[];

  @ApiPropertyOptional({
    description: 'Preferred travel period',
    example: 'October 2026',
  })
  @IsOptional()
  @IsString()
  travel_period?: string;

  @ApiPropertyOptional({
    description: 'Group size',
    example: '15-20 pax',
  })
  @IsOptional()
  @IsString()
  group_size?: string;

  @ApiPropertyOptional({
    description: 'Specific requirements from the lead',
    example: 'Need vegetarian meals and wheelchair accessible hotels',
  })
  @IsOptional()
  @IsString()
  requirements?: string;

  @ApiPropertyOptional({
    description: 'Additional notes',
    example: 'Very responsive, follows up quickly',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'AI-computed lead score (0–100)',
    example: 75,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  lead_score?: number;

  @ApiPropertyOptional({
    description: 'Next follow-up date (ISO string)',
    example: '2026-10-15',
  })
  @IsOptional()
  @IsString()
  next_followup_date?: string;

  @ApiPropertyOptional({
    description: 'Estimated deal value',
    example: 150000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  estimated_value?: number;

  @ApiPropertyOptional({
    description: 'Currency code',
    example: 'INR',
  })
  @IsOptional()
  @IsString()
  currency?: string;
}

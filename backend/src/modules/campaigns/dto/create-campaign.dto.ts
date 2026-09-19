import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { resolveTimezone } from '../../../common/utils/timezone.util';

export class CreateCampaignDto {
  @ApiProperty({ description: 'Campaign name', example: 'Summer Outreach 2026' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Campaign description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Product being promoted', example: 'Bali Package' })
  @IsOptional()
  @IsString()
  product?: string;

  @ApiPropertyOptional({ description: 'Target country for the campaign', example: 'India' })
  @IsOptional()
  @IsString()
  target_country?: string;

  @ApiPropertyOptional({ description: 'Target region for the campaign', example: 'South Asia' })
  @IsOptional()
  @IsString()
  target_region?: string;

  @ApiPropertyOptional({ description: 'Target agency type', example: 'travel_agency' })
  @IsOptional()
  @IsString()
  target_agency_type?: string;

  @ApiPropertyOptional({ description: 'Daily message send limit', default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  daily_send_limit?: number;

  @ApiPropertyOptional({ description: 'Send window start time (HH:mm)', example: '09:00' })
  @IsOptional()
  @IsString()
  send_window_start?: string;

  @ApiPropertyOptional({ description: 'Send window end time (HH:mm)', example: '18:00' })
  @IsOptional()
  @IsString()
  send_window_end?: string;

  @ApiPropertyOptional({
    description:
      'IANA timezone for the send window. Friendly names like "India" are accepted and normalised.',
    example: 'Asia/Kolkata',
  })
  @IsOptional()
  @IsString()
  // Normalise at the edge so an invalid zone can never reach the scheduler.
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim()
      ? resolveTimezone(value)
      : value,
  )
  send_window_timezone?: string;

  @ApiPropertyOptional({ description: 'OpenWA session ID to use for sending' })
  @IsOptional()
  @IsString()
  openwa_session_id?: string;

  @ApiPropertyOptional({ description: 'Maximum follow-up messages', default: 2, minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  max_followups?: number;
}

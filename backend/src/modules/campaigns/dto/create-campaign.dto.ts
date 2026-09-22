import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
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

  @ApiPropertyOptional({
    description:
      'Messages per day for this campaign. Capped at 200: this sends through an ' +
      'unofficial WhatsApp client, where sustained high volume is the most reliable ' +
      'way to get a number restricted. Treat 30-50/day as normal, and only raise it ' +
      'once the number has a history of real two-way conversations.',
    default: 100,
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
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

  @ApiPropertyOptional({
    description:
      'The opening message sent to each contact. Stored as the campaign\'s first ' +
      'template (sequence_order 0). Supports merge fields — {{contact_name}}, ' +
      '{{company_name}}, {{city}}, {{state}}, {{country}}, {{product}} — and spintax ' +
      'such as {Hi|Hello|Hey}, which renders a different variant per recipient so no ' +
      'two messages are byte-identical.',
    example: '{Hi|Hello} {{contact_name}}, we design heritage tours across UP. {Interested|Worth a chat}?',
    maxLength: 4096,
  })
  @IsOptional()
  @IsString()
  // WhatsApp's own text limit; a longer body would be rejected at send time.
  @MaxLength(4096)
  first_message?: string;
}

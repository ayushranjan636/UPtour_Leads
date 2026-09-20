import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryContactDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by company country (case-insensitive)',
    example: 'India',
  })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    description: 'Filter by state / province / prefecture (case-insensitive)',
    example: 'Delhi',
  })
  @IsOptional()
  @IsString()
  state_region?: string;

  @ApiPropertyOptional({
    description: 'Filter by district / county (case-insensitive)',
    example: 'New Delhi',
  })
  @IsOptional()
  @IsString()
  district?: string;

  @ApiPropertyOptional({
    description: 'Filter by city (case-insensitive)',
    example: 'Mumbai',
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    description: 'Filter by business/agency type',
    example: 'travel_agency',
  })
  @IsOptional()
  @IsString()
  agency_type?: string;

  @ApiPropertyOptional({
    description: 'Only contacts whose WhatsApp number has been verified',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  whatsapp_verified?: boolean;

  @ApiPropertyOptional({
    description:
      'Exclude contacts that are opted out or suppressed. Use when building a ' +
      'campaign audience so the count matches who can actually be messaged.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  reachable_only?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by campaign ID (contacts enrolled in this campaign)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  campaign_id?: string;

  @ApiPropertyOptional({
    description: 'Exclude contacts already enrolled in this campaign',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  not_in_campaign_id?: string;

  @ApiPropertyOptional({
    description: 'Filter by opt-out status',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  is_opted_out?: boolean;

  @ApiPropertyOptional({
    description:
      'Search by contact name, WhatsApp number, or email (case-insensitive)',
    example: 'rajesh',
  })
  @IsOptional()
  @IsString()
  search?: string;
}

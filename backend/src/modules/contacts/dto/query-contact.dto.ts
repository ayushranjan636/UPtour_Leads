import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, IsBoolean, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Normalise a query value into a string array.
 *
 * Accepts `?city=Agra&city=Delhi` (array), `?city=Agra,Delhi` (comma-separated) and a
 * single value, because all three are natural to send from a UI or by hand and the
 * multi-select filters must behave identically for each.
 */
function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const out = raw.map((v) => String(v).trim()).filter((v) => v.length > 0);
  return out.length ? out : undefined;
}

/** As above, for UUID lists. */
function toUuidArray(value: unknown): string[] | undefined {
  return toStringArray(value);
}

export class QueryContactDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'Filter by one or more countries (case-insensitive). Repeat the parameter or '+
      'pass a comma-separated list.',
    example: ['India'],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  country?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by one or more states / provinces (case-insensitive). Repeat the parameter or '+
      'pass a comma-separated list.',
    example: ['Uttar Pradesh'],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  state_region?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by one or more districts (case-insensitive). Repeat the parameter or '+
      'pass a comma-separated list.',
    example: ['Agra'],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  district?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by one or more cities (case-insensitive). Repeat the parameter or '+
      'pass a comma-separated list.',
    example: ['Agra'],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  city?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by one or more business types (case-insensitive). Repeat the parameter or '+
      'pass a comma-separated list.',
    example: ['travel_agency'],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  agency_type?: string[];

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
    description:
      'Filter to contacts produced by these data-collection jobs (datasets). Repeat the ' +
      'parameter or pass a comma-separated list. Lets a campaign target exactly one ' +
      'scrape — "the Agra agencies I collected on Tuesday" — without re-deriving it from ' +
      'location filters.',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => toUuidArray(value))
  @IsArray()
  @IsUUID('4', { each: true })
  collection_job_ids?: string[];

  @ApiPropertyOptional({
    description:
      'Filter to contacts from these CSV imports. Same purpose as ' +
      '`collection_job_ids`, for manually imported lists.',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => toUuidArray(value))
  @IsArray()
  @IsUUID('4', { each: true })
  import_file_ids?: string[];

  @ApiPropertyOptional({
    description:
      'Filter by how the contact entered the system, e.g. `manual`, `google_maps`, ' +
      '`csv_import`, `whatsapp_inbound`. Multi-valued.',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  sources?: string[];

  @ApiPropertyOptional({
    description:
      'Filter to contacts in these groups (stored as tags). Multi-valued: selecting ' +
      'two groups returns contacts in either, so a campaign can target a saved group ' +
      'directly.',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  groups?: string[];

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

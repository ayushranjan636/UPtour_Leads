import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsInt,
  IsBoolean,
  IsUUID,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Accepts keywords either as a real array or as a comma-separated string,
 * because the UI collects them in a single free-text input.
 */
function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
  }
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export class CreateCollectionJobDto {
  @ApiProperty({
    description: 'Name of the collection job',
    example: 'Dubai Travel Agencies',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Target country', example: 'UAE' })
  @IsString()
  @IsNotEmpty()
  country: string;

  @ApiPropertyOptional({
    description: 'Target city. Leave empty to search the whole country.',
    example: 'Dubai',
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    description: 'Business category to search',
    example: 'travel agency',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description:
      'Keywords to refine search. Accepts an array or a comma-separated string.',
    example: ['luxury', 'honeymoon'],
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({
    description: 'Data source for collection',
    example: 'google_maps',
    default: 'google_maps',
  })
  @IsOptional()
  @IsString()
  data_source?: string;

  @ApiPropertyOptional({
    description: 'Maximum NEW contacts to collect per day',
    example: 100,
    default: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  daily_limit?: number;

  @ApiPropertyOptional({
    description: 'Automatically add collected contacts to this campaign',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  auto_add_to_campaign_id?: string;

  @ApiPropertyOptional({
    description: 'Automatically verify WhatsApp numbers',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  auto_verify_whatsapp?: boolean;
}

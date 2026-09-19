import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsUrl,
  IsEmail,
  Min,
  Max,
} from 'class-validator';

export class CreateCompanyDto {
  @ApiProperty({ description: 'Company name', example: 'Wanderlust Tours' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Country', example: 'India' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    description: 'State or region',
    example: 'Rajasthan',
  })
  @IsOptional()
  @IsString()
  state_region?: string;

  @ApiPropertyOptional({ description: 'City', example: 'Jaipur' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    description: 'Full address',
    example: '123 MI Road, Jaipur',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    description: 'Company website URL',
    example: 'https://wanderlusttours.in',
  })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({
    description: 'Type of travel agency',
    example: 'DMC',
  })
  @IsOptional()
  @IsString()
  agency_type?: string;

  @ApiPropertyOptional({
    description: 'Primary contact phone for the company',
    example: '+91 98100 00000',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Primary contact email for the company',
    example: 'sales@wanderlusttours.in',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Where this company was sourced from',
    example: 'google_maps',
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({
    description: 'URL of the source listing',
    example: 'https://maps.google.com/...',
  })
  @IsOptional()
  @IsString()
  source_url?: string;

  @ApiPropertyOptional({
    description: 'Google Places ID',
    example: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  })
  @IsOptional()
  @IsString()
  google_place_id?: string;

  @ApiPropertyOptional({
    description: 'Google rating (1-5)',
    example: 4.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({
    description: 'Tags for categorization',
    example: ['luxury', 'adventure'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Additional notes',
    example: 'Premium partner since 2023',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

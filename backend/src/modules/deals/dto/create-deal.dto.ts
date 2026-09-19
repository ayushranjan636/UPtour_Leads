import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DealStage } from '../../../entities/deal.entity';

export class CreateDealDto {
  @ApiProperty({
    description: 'Lead ID this deal is created from',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsUUID()
  @IsNotEmpty()
  lead_id: string;

  @ApiProperty({
    description: 'Deal name',
    example: 'Golden Triangle Tour – 20 pax – Oct 2026',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Product or tour package',
    example: 'Golden Triangle Tour',
  })
  @IsOptional()
  @IsString()
  product?: string;

  @ApiPropertyOptional({
    description: 'Estimated deal value',
    example: 350000,
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

  @ApiPropertyOptional({
    description: 'Deal stage',
    enum: DealStage,
    example: DealStage.PROPOSAL,
  })
  @IsOptional()
  @IsEnum(DealStage)
  stage?: DealStage;

  @ApiPropertyOptional({
    description: 'User ID this deal is assigned to',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @ApiPropertyOptional({
    description: 'Expected close date (ISO string)',
    example: '2026-11-30',
  })
  @IsOptional()
  @IsString()
  expected_close_date?: string;

  @ApiPropertyOptional({
    description: 'Additional notes',
    example: 'Client prefers 4-star hotels',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, IsEnum } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { LeadStatus } from '../../../entities/lead.entity';

export class QueryLeadDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by lead status',
    enum: LeadStatus,
    example: LeadStatus.INTERESTED,
  })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({
    description: 'Filter by assigned user ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @ApiPropertyOptional({
    description: 'Filter by campaign ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  campaign_id?: string;

  @ApiPropertyOptional({
    description:
      'Search by contact name or WhatsApp number (case-insensitive)',
    example: 'rajesh',
  })
  @IsOptional()
  @IsString()
  search?: string;
}

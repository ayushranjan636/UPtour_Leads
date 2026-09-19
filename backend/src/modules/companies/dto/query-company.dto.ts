import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryCompanyDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by country',
    example: 'India',
  })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    description: 'Filter by agency type',
    example: 'DMC',
  })
  @IsOptional()
  @IsString()
  agency_type?: string;

  @ApiPropertyOptional({
    description: 'Search by company name or city (case-insensitive)',
    example: 'wanderlust',
  })
  @IsOptional()
  @IsString()
  search?: string;
}

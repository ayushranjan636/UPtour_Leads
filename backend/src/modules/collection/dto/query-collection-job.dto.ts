import { IsOptional, IsEnum, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { CollectionJobStatus } from '../../../entities/collection-job.entity';

export class QueryCollectionJobDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by job status', enum: CollectionJobStatus })
  @IsOptional()
  @IsEnum(CollectionJobStatus)
  status?: CollectionJobStatus;

  @ApiPropertyOptional({ description: 'Filter by country', example: 'UAE' })
  @IsOptional()
  @IsString()
  country?: string;
}

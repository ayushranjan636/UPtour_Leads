import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CreateDealDto } from './create-deal.dto';

export class UpdateDealDto extends PartialType(CreateDealDto) {
  @ApiPropertyOptional({
    description: 'Reason for losing the deal (required when stage is set to "lost")',
    example: 'Went with a cheaper competitor',
  })
  @IsOptional()
  @IsString()
  lost_reason?: string;
}

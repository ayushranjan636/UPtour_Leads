import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SendDistributorService } from './send-distributor.service';

@ApiTags('Engine')
@ApiBearerAuth()
@Controller('engine')
export class EngineController {
  constructor(private readonly distributor: SendDistributorService) {}

  @Get('distribution-plan')
  @ApiOperation({
    summary: 'Preview how messages will be distributed over 24hrs for a given quantity',
    description:
      'Pass a daily_limit (10, 100, 500, etc.) and see exactly how messages ' +
      'will be spaced out across the send window. Use this to help users choose ' +
      'the right quantity.',
  })
  @ApiQuery({ name: 'daily_limit', type: Number, example: 100 })
  @ApiQuery({ name: 'window_start', required: false, example: '09:00' })
  @ApiQuery({ name: 'window_end', required: false, example: '18:00' })
  getDistributionPlan(
    @Query('daily_limit') dailyLimit: string,
    @Query('window_start') windowStart?: string,
    @Query('window_end') windowEnd?: string,
  ) {
    return this.distributor.getDistributionPlan(
      parseInt(dailyLimit, 10) || 100,
      windowStart || '09:00',
      windowEnd || '18:00',
    );
  }
}

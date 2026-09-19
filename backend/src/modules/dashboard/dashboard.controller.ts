import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiQuery,
} from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Get dashboard overview',
    description:
      'Retrieve high-level metrics including total contacts, messages sent/delivered/read, responses, leads, deals, active campaigns, and conversion rate.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Dashboard overview returned successfully',
  })
  async getOverview() {
    return this.dashboardService.getOverview();
  }

  @Get('campaigns')
  @ApiOperation({
    summary: 'Get campaign statistics',
    description:
      'Retrieve all campaigns with their aggregated stats (sent, delivered, read, replied, opted out, leads).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Campaign statistics returned successfully',
  })
  async getCampaignStats() {
    return this.dashboardService.getCampaignStats();
  }

  @Get('pipeline')
  @ApiOperation({
    summary: 'Get lead pipeline',
    description:
      'Retrieve lead counts grouped by status for pipeline visualization.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Pipeline data returned successfully',
  })
  async getPipeline() {
    return this.dashboardService.getPipeline();
  }

  @Get('campaign/:id/analytics')
  @ApiOperation({
    summary: 'Get detailed campaign analytics',
    description:
      'Returns funnel data (sent → delivered → read → replied → leads → deals), daily breakdown, top performing contacts, and AI analysis summary.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Campaign analytics returned successfully',
  })
  async getCampaignAnalytics(@Param('id', ParseUUIDPipe) id: string) {
    return this.dashboardService.getCampaignAnalytics(id);
  }

  @Get('funnel')
  @ApiOperation({
    summary: 'Get conversion funnel',
    description:
      'Returns pipeline conversion funnel across all campaigns or a specific one. ' +
      'Includes: total contacts → sent → delivered → read → replied → leads → deals → won.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Conversion funnel returned successfully',
  })
  @ApiQuery({ name: 'campaign_id', required: false, description: 'Filter by campaign ID' })
  async getConversionFunnel(@Query('campaign_id') campaignId?: string) {
    return this.dashboardService.getConversionFunnel(campaignId);
  }
}

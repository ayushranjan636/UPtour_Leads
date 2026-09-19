import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WorkflowTrackerService } from './workflow-tracker.service';

@Controller('workflow')
@ApiTags('Workflow Tracker')
export class WorkflowTrackerController {
  constructor(private readonly service: WorkflowTrackerService) {}

  @Get('contact/:contactId')
  @ApiOperation({ summary: 'Get contact journey' })
  getJourney(@Param('contactId') contactId: string) {
    return this.service.getContactJourney(contactId);
  }

  @Get('campaign/:campaignId/health')
  @ApiOperation({ summary: 'Get campaign pipeline health' })
  getHealth(@Param('campaignId') campaignId: string) {
    return this.service.getCampaignPipelineHealth(campaignId);
  }

  @Get('campaign/:campaignId/faults')
  @ApiOperation({ summary: 'Get campaign faults' })
  getFaults(@Param('campaignId') campaignId: string, @Query('limit') limit?: string) {
    return this.service.getCampaignFaults(campaignId, limit ? +limit : 50);
  }

  @Get('campaign/:campaignId/stuck')
  @ApiOperation({ summary: 'Detect stuck contacts' })
  getStuck(@Param('campaignId') campaignId: string, @Query('hours') hours?: string) {
    return this.service.detectStuckContacts(campaignId, hours ? +hours : 24);
  }
}

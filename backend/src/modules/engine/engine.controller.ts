import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SendDistributorService } from './send-distributor.service';
import { DistributionPlanQueryDto } from './dto/distribution-plan.dto';
import { listTriggerConditions, resolveTriggerCondition } from './trigger-conditions';

@ApiTags('Engine')
@ApiBearerAuth()
@Controller('engine')
export class EngineController {
  constructor(private readonly distributor: SendDistributorService) {}

  @Get('trigger-conditions')
  @ApiOperation({
    summary: 'Sequence trigger conditions the engine can actually act on',
    description:
      'The authoring UI reads this rather than hard-coding a list, so the options an ' +
      'operator is offered cannot drift from what the engine evaluates — a step that ' +
      'looks configured but silently never fires is the failure this prevents. Pass ' +
      '`check` to ask whether a specific stored value is understood, and what as.',
  })
  getTriggerConditions(@Query('check') check?: string) {
    const conditions = listTriggerConditions();
    if (check === undefined) return { conditions };

    const resolved = resolveTriggerCondition(check);
    return {
      conditions,
      check: {
        raw: resolved.raw,
        understood: resolved.matchedBy !== 'unrecognised',
        condition: resolved.condition,
        matched_by: resolved.matchedBy,
        description: resolved.description,
      },
    };
  }

  @Get('distribution-plan')
  @ApiOperation({
    summary: 'How a campaign’s messages will actually be distributed',
    description:
      'Pass a campaign_id to get the real plan: the daily limit, send window and the ' +
      'number of contacts still pending are all resolved server-side, so the plan is ' +
      'bounded by actual recipients and the hour-by-hour shape is a simulation of the ' +
      'sender’s own randomised pacing. Pass daily_limit instead for a hypothetical ' +
      'preview when helping a user choose a quantity.',
  })
  getDistributionPlan(@Query() query: DistributionPlanQueryDto) {
    // A campaign id is the honest path: the server owns the pending count, so the plan
    // cannot be talked into promising sends the engine will not make.
    if (query.campaign_id) {
      return this.distributor.getCampaignDistributionPlan(query.campaign_id);
    }

    return this.distributor.getDistributionPlan(
      query.daily_limit ?? 100,
      query.window_start || '09:00',
      query.window_end || '18:00',
    );
  }
}

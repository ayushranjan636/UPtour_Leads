import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query for `GET engine/distribution-plan`.
 *
 * Two ways to ask for a plan:
 *  - `campaign_id` — the real plan for a real campaign. The server resolves the
 *    daily limit, the send window and, crucially, how many contacts are still
 *    pending, so the plan describes actual recipients.
 *  - `daily_limit` (+ optional window) — a hypothetical "what would N/day look
 *    like" preview, used when choosing a quantity before an audience exists.
 *
 * The pending count is deliberately NOT accepted from the client: it decides how
 * many messages the plan promises, and a caller that guessed it wrong would turn
 * the plan back into the fiction this endpoint exists to remove.
 */
export class DistributionPlanQueryDto {
  @ApiPropertyOptional({
    description:
      'Campaign to plan for. When given, the daily limit, send window and pending ' +
      'recipient count are all read from the campaign and any other parameter is ignored.',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  campaign_id?: string;

  @ApiPropertyOptional({
    description:
      'Hypothetical daily quantity, for previewing a limit before a campaign exists. ' +
      'Ignored when `campaign_id` is given.',
    example: 100,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // A ceiling keeps a mistyped quantity from asking the simulation to place a
  // million messages; no WhatsApp session survives anything near this anyway.
  @Max(10000)
  daily_limit?: number;

  @ApiPropertyOptional({ description: 'Send window start, HH:mm', example: '09:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'window_start must be a 24-hour time such as 09:00',
  })
  window_start?: string;

  @ApiPropertyOptional({ description: 'Send window end, HH:mm', example: '18:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'window_end must be a 24-hour time such as 18:00',
  })
  window_end?: string;
}

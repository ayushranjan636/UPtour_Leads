import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { InboundAiService } from './inbound-ai.service';

export class SetAutoReplyDto {
  @ApiProperty({
    description:
      'Whether the assistant may reply to inbound WhatsApp messages on its own. ' +
      'Takes effect immediately, without a redeploy.',
    example: false,
  })
  @IsBoolean()
  enabled!: boolean;
}

/**
 * Runtime controls for the AI assistant.
 *
 * Auto-reply is the one setting an operator may need to change under pressure: if the
 * assistant answers a prospect badly, "edit .env and restart the server" is far too slow.
 * Exposing it as an endpoint is what makes a switch in the UI possible.
 */
@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(private readonly inboundAi: InboundAiService) {}

  @Get('auto-reply')
  @ApiOperation({
    summary: 'Whether AI auto-reply is currently on',
    description:
      'Reports the effective value and whether it comes from a runtime override or the ' +
      'deploy-time default, so the UI can show which one is in force.',
  })
  getAutoReply() {
    return this.inboundAi.getAutoReplySetting();
  }

  @Put('auto-reply')
  @ApiOperation({
    summary: 'Turn AI auto-reply on or off',
    description:
      'Applies immediately and persists until changed. Per-campaign switches and the ' +
      'opt-out, suppression and needs-human guards still apply when this is on.',
  })
  setAutoReply(@Body() dto: SetAutoReplyDto) {
    return this.inboundAi.setAutoReplyEnabled(dto.enabled);
  }
}

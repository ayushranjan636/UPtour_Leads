import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { InboundAiService } from './inbound-ai.service';
import { AiService } from './ai.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

export class SaveAiKeysDto {
  @IsOptional() @IsString() @MaxLength(500) openaiKey?: string;
  @IsOptional() @IsString() @MaxLength(80) openaiModel?: string;
  @IsOptional() @IsString() @MaxLength(500) geminiKey?: string;
  @IsOptional() @IsString() @MaxLength(80) geminiModel?: string;
}

export class TestAiProviderDto {
  @IsIn(['openai', 'gemini']) provider!: 'openai' | 'gemini';
}

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
@UseGuards(RolesGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly inboundAi: InboundAiService,
    private readonly ai: AiService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'Which AI keys are set (keys themselves are never returned)' })
  getProviders() {
    return this.ai.getKeyState();
  }

  @Put('providers')
  @Roles('admin')
  @ApiOperation({
    summary: 'Save Gemini / OpenAI keys',
    description: 'Takes effect immediately. A blank field keeps the saved value; "-" removes it.',
  })
  saveProviders(@Body() dto: SaveAiKeysDto) {
    return this.ai.saveKeys(dto);
  }

  @Post('providers/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a one-word prompt to prove a key works' })
  testProvider(@Body() dto: TestAiProviderDto) {
    return this.ai.testProvider(dto.provider);
  }

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

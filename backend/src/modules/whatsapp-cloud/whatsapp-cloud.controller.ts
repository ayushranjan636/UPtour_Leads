import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { OpenwaService } from '../openwa/openwa.service';
import { WhatsappCloudService, WhatsAppProvider } from './whatsapp-cloud.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

class SaveCloudConfigDto {
  @IsOptional() @IsString() @MaxLength(1000) accessToken?: string;
  @IsOptional() @IsString() @MaxLength(40) phoneNumberId?: string;
  @IsOptional() @IsString() @MaxLength(40) wabaId?: string;
  @IsOptional() @IsString() @MaxLength(200) appSecret?: string;
  @IsOptional() @IsString() @MaxLength(200) verifyToken?: string;
  @IsOptional() @IsString() @MaxLength(10) apiVersion?: string;
}

class SetProviderDto {
  @IsIn(['session', 'cloud']) provider: WhatsAppProvider;
}

@ApiTags('WhatsApp')
@ApiBearerAuth()
// Reads are open to any signed-in user; changing credentials or the provider is admin-only.
@UseGuards(RolesGuard)
@Controller('whatsapp')
export class WhatsappCloudController {
  constructor(
    private readonly cloud: WhatsappCloudService,
    private readonly openwa: OpenwaService,
  ) {}

  @Get('provider')
  @ApiOperation({
    summary: 'Which WhatsApp transport is active, with the state of both',
    description:
      '"session" is the QR-linked gateway, "cloud" is Meta\'s official WhatsApp Cloud API. ' +
      'The `active` block is what the dashboard indicator should show.',
  })
  async getProvider() {
    const [provider, cloud, session] = await Promise.all([
      this.cloud.getProvider(),
      this.cloud.getState(),
      this.openwa.getConnectionState().catch(() => null),
    ]);
    const active =
      provider === 'cloud'
        ? {
            provider,
            connected: cloud.connected,
            phone: cloud.phone,
            name: cloud.verifiedName,
            message: cloud.message,
          }
        : {
            provider,
            connected: !!session?.connected,
            phone: session?.phone ?? null,
            name: session?.sessionName ?? null,
            message: session?.message ?? 'WhatsApp gateway state unavailable.',
          };
    return { provider, active, cloud, session };
  }

  @Put('provider')
  @Roles('admin')
  @ApiOperation({ summary: 'Choose which transport sends WhatsApp messages' })
  async setProvider(@Body() dto: SetProviderDto) {
    return { provider: await this.cloud.setProvider(dto.provider) };
  }

  @Get('cloud')
  @ApiOperation({ summary: 'WhatsApp Cloud API connection state (secrets are never returned)' })
  getCloud() {
    return this.cloud.getState();
  }

  @Put('cloud')
  @Roles('admin')
  @ApiOperation({
    summary: 'Connect or update the WhatsApp Cloud API',
    description:
      'Validates the token against Meta before saving, then subscribes the app to the ' +
      'WhatsApp Business Account webhooks. Blank secret fields keep their stored value.',
  })
  saveCloud(@Body() dto: SaveCloudConfigDto) {
    return this.cloud.saveConfig(dto);
  }

  @Delete('cloud')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Forget the Cloud API credentials and fall back to the session gateway' })
  deleteCloud() {
    return this.cloud.disconnect();
  }

  @Get('cloud/templates')
  @ApiOperation({ summary: 'Message templates on the WhatsApp Business Account' })
  listTemplates() {
    return this.cloud.listTemplates();
  }
}

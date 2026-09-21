import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OpenwaService } from './openwa.service';

@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('whatsapp')
export class OpenwaController {
  constructor(private readonly openwaService: OpenwaService) {}

  @Get('sessions')
  @ApiOperation({
    summary: 'List all WhatsApp sessions',
    description: 'Returns all active OpenWA sessions.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Sessions retrieved successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Not authenticated',
  })
  async getSessions() {
    return this.openwaService.getSessions();
  }

  @Get('sessions/:id/status')
  @ApiOperation({
    summary: 'Get session status',
    description: 'Returns the current status of a specific WhatsApp session.',
  })
  @ApiParam({
    name: 'id',
    description: 'OpenWA session ID',
    example: 'default',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Session status retrieved successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Session not found',
  })
  async getSessionStatus(@Param('id') id: string) {
    return this.openwaService.getSessionStatus(id);
  }

  @Get('health')
  @ApiOperation({
    summary: 'Check OpenWA health',
    description: 'Returns the health/readiness status of the OpenWA API.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'OpenWA is healthy',
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    description: 'OpenWA is unreachable',
  })
  async getHealth() {
    return this.openwaService.getHealth();
  }

  @Get('connection')
  @ApiOperation({
    summary: 'WhatsApp connection state for the portal',
    description:
      'Single call that answers "can we send right now, and if not what should the ' +
      'operator do". Backs the dashboard indicator and its Connect button.',
  })
  async getConnection() {
    return this.openwaService.getConnectionState();
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Begin linking a WhatsApp number',
    description:
      'Ensures a session exists and is starting, then returns a QR code to scan. ' +
      'Safe to call repeatedly — it reuses the existing session rather than creating ' +
      'duplicates. Poll GET /whatsapp/connection until status is "ready".',
  })
  async connect() {
    return this.openwaService.beginConnect();
  }

  @Get('qr')
  @ApiOperation({
    summary: 'Current QR code for the pending session',
    description: 'Returns a data-URI PNG while the session is waiting to be scanned.',
  })
  async getQr() {
    return this.openwaService.getQrCode();
  }

  @Get('portal-link')
  @ApiOperation({
    summary: 'One-click link into the WhatsApp gateway dashboard',
    description:
      'Returns the gateway URL with a single-use handover fragment so an operator who ' +
      'is already signed in to this portal is not asked for an API key. The fragment is ' +
      'never sent to a server and the gateway strips it from the address bar on arrival.',
  })
  async getPortalLink() {
    return this.openwaService.getPortalLink();
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log the WhatsApp number out',
    description: 'Unlinks the device. A new QR scan is required to send again.',
  })
  async disconnect() {
    return this.openwaService.disconnect();
  }
}

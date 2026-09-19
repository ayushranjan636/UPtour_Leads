import {
  Controller,
  Get,
  HttpStatus,
  Param,
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
}

import { Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly svc: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: 'List all notifications (paginated)',
    description: 'Returns all notifications ordered by newest first.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getAll(
      parseInt(page || '1', 10),
      parseInt(limit || '20', 10),
    );
  }

  @Get('unread')
  @ApiOperation({
    summary: 'Get unread notification count and recent items',
    description: 'Returns the count of unread notifications and up to 20 most recent unread items.',
  })
  getUnread() {
    return this.svc.getUnread();
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead() {
    return this.svc.markAllRead();
  }
}

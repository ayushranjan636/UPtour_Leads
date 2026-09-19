import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
  ) {}

  /**
   * Create a new notification.
   * Called from processors and services across the app.
   */
  async create(
    type: string,
    title: string,
    message: string,
    metadata?: Record<string, any>,
  ): Promise<Notification> {
    const notification = this.notifRepo.create({
      type,
      title,
      message,
      metadata: metadata || null,
      is_read: false,
    });

    const saved = await this.notifRepo.save(notification);
    this.logger.log(`Notification created: [${type}] ${title}`);
    return saved;
  }

  /**
   * Mark a single notification as read.
   */
  async markRead(id: string): Promise<Notification> {
    const notif = await this.notifRepo.findOne({ where: { id } });
    if (!notif) throw new NotFoundException(`Notification ${id} not found`);

    notif.is_read = true;
    return this.notifRepo.save(notif);
  }

  /**
   * Mark all notifications as read.
   */
  async markAllRead(): Promise<{ updated: number }> {
    const result = await this.notifRepo.update({ is_read: false }, { is_read: true });
    return { updated: result.affected || 0 };
  }

  /**
   * Get unread notifications count and recent unread items.
   */
  async getUnread(): Promise<{
    count: number;
    recent: Notification[];
  }> {
    const [recent, count] = await this.notifRepo.findAndCount({
      where: { is_read: false },
      order: { created_at: 'DESC' },
      take: 20,
    });

    return { count, recent };
  }

  /**
   * Get all notifications (paginated).
   */
  async getAll(
    page = 1,
    limit = 20,
  ): Promise<{
    data: Notification[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const [data, total] = await this.notifRepo.findAndCount({
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}

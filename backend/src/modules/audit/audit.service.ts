import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async log(
    userId: string | null,
    action: string,
    entityType?: string,
    entityId?: string,
    details?: any,
    ipAddress?: string,
  ): Promise<void> {
    try {
      const auditLog = this.auditLogRepository.create({
        user_id: userId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        details,
        ip_address: ipAddress,
      });
      await this.auditLogRepository.save(auditLog);
    } catch (error) {
      this.logger.error(
        `Failed to save audit log: ${error.message}`,
        error.stack,
      );
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 50,
  ): Promise<PaginatedResponseDto<AuditLog>> {
    try {
      const [data, total] = await this.auditLogRepository.findAndCount({
        order: { created_at: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });

      return new PaginatedResponseDto<AuditLog>(data, total, page, limit);
    } catch (error) {
      this.logger.error('Error fetching audit logs', error.stack);
      return new PaginatedResponseDto<AuditLog>([], 0, page, limit);
    }
  }

  async findByEntity(
    entityType: string,
    entityId: string,
  ): Promise<AuditLog[]> {
    try {
      return await this.auditLogRepository.find({
        where: { entity_type: entityType, entity_id: entityId },
        order: { created_at: 'DESC' },
      });
    } catch (error) {
      this.logger.error(
        `Error fetching audit logs for ${entityType}/${entityId}`,
        error.stack,
      );
      return [];
    }
  }
}

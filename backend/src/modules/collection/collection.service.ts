import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import {
  CollectionJob,
  CollectionJobStatus,
} from '../../entities/collection-job.entity';
import { CollectionResult } from '../../entities/collection-result.entity';
import { CreateCollectionJobDto } from './dto/create-collection-job.dto';
import { UpdateCollectionJobDto } from './dto/update-collection-job.dto';
import { QueryCollectionJobDto } from './dto/query-collection-job.dto';

@Injectable()
export class CollectionService {
  constructor(
    @InjectRepository(CollectionJob)
    private readonly jobRepo: Repository<CollectionJob>,
    @InjectRepository(CollectionResult)
    private readonly resultRepo: Repository<CollectionResult>,
  ) {}

  /**
   * Returns a bare array (not a paginated envelope) because the Data Collector
   * UI renders jobs as a card grid and reads the response directly.
   */
  async findAll(query: QueryCollectionJobDto = {} as QueryCollectionJobDto) {
    const where: FindOptionsWhere<CollectionJob> = {};
    if (query.status) where.status = query.status;
    if (query.country) where.country = query.country;

    return this.jobRepo.find({
      where,
      order: { created_at: 'DESC' },
    });
  }

  async findById(id: string) {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Collection job not found');
    return job;
  }

  async create(dto: CreateCollectionJobDto, userId: string) {
    const job = this.jobRepo.create({
      ...dto,
      keywords: dto.keywords ?? [],
      data_source: dto.data_source ?? 'google_maps',
      daily_limit: dto.daily_limit ?? 100,
      status: CollectionJobStatus.ACTIVE,
      created_by: userId,
    });
    return this.jobRepo.save(job);
  }

  async update(id: string, dto: UpdateCollectionJobDto) {
    await this.findById(id);
    await this.jobRepo.update(id, dto as Partial<CollectionJob>);
    return this.findById(id);
  }

  async pause(id: string) {
    await this.findById(id);
    await this.jobRepo.update(id, { status: CollectionJobStatus.PAUSED });
    return this.findById(id);
  }

  /**
   * Resuming clears last_run_at so the hourly cron picks the job up immediately
   * rather than waiting until tomorrow.
   */
  async resume(id: string) {
    await this.findById(id);
    await this.jobRepo.update(id, {
      status: CollectionJobStatus.ACTIVE,
      last_run_at: null,
    });
    return this.findById(id);
  }

  async getResults(jobId: string, page = 1, limit = 50) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 200);

    const [data, total] = await this.resultRepo.findAndCount({
      where: { job_id: jobId },
      order: { created_at: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      data,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit) || 1,
    };
  }
}

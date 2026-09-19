import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { BaseService } from '../../common/base/base.service';
import { Company } from '../../entities/company.entity';
import { Contact } from '../../entities/contact.entity';
import { CreateCompanyDto } from './dto/create-company.dto';
import { QueryCompanyDto } from './dto/query-company.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';

@Injectable()
export class CompaniesService extends BaseService<Company> {
  protected readonly entityName = 'Company';
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    @InjectRepository(Company) protected readonly repo: Repository<Company>,
    @InjectRepository(Contact) private readonly contactRepo: Repository<Contact>,
    private readonly dataSource: DataSource,
  ) { super(); }

  async findFiltered(query: QueryCompanyDto): Promise<PaginatedResponseDto<Company>> {
    const { page = 1, limit = 20, country, agency_type, search } = query;
    const qb = this.repo.createQueryBuilder('company')
      .orderBy('company.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (country) qb.andWhere('company.country = :country', { country });
    if (agency_type) qb.andWhere('company.agency_type = :agency_type', { agency_type });
    if (search) qb.andWhere('(company.name ILIKE :s OR company.city ILIKE :s)', { s: `%${search}%` });

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponseDto(data, total, page, limit);
  }

  /** Merge duplicate companies — transaction-safe */
  async mergeDuplicates(primaryId: string, duplicateIds: string[]): Promise<Company> {
    if (!duplicateIds?.length) throw new BadRequestException('At least one duplicate ID required');
    if (duplicateIds.includes(primaryId)) throw new BadRequestException('Primary ID must not be in duplicates');

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const primary = await qr.manager.findOne(Company, { where: { id: primaryId } });
      if (!primary) throw new NotFoundException(`Primary company '${primaryId}' not found`);

      const dups = await qr.manager.find(Company, { where: { id: In(duplicateIds) } });
      if (dups.length !== duplicateIds.length) {
        const missing = duplicateIds.filter(id => !dups.find(d => d.id === id));
        throw new NotFoundException(`Companies not found: ${missing.join(', ')}`);
      }

      // Move all contacts to primary
      await qr.manager.createQueryBuilder().update(Contact)
        .set({ company_id: primaryId })
        .where('company_id IN (:...ids)', { ids: duplicateIds })
        .execute();

      // Delete duplicates
      await qr.manager.createQueryBuilder().delete().from(Company)
        .where('id IN (:...ids)', { ids: duplicateIds })
        .execute();

      await qr.commitTransaction();
      return this.findById(primaryId, ['contacts']);
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }
}

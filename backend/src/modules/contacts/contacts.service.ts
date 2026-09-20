// NEW contacts.service.ts — LEAN version
import { Injectable, BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BaseService } from '../../common/base/base.service';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { QueryContactDto } from './dto/query-contact.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { normalizePhone } from '../../common/utils/phone.util';
import { OpenwaService } from '../openwa/openwa.service';
import { RedisService } from '../../common/redis/redis.service';

@Injectable()
export class ContactsService extends BaseService<Contact> {
  protected readonly entityName = 'Contact';
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    @InjectRepository(Contact) protected readonly repo: Repository<Contact>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(CampaignContact) private readonly ccRepo: Repository<CampaignContact>,
    private readonly openwa: OpenwaService,
    private readonly redis: RedisService,
  ) { super(); }

  /** Custom findAll with advanced filtering */
  async findFiltered(query: QueryContactDto): Promise<PaginatedResponseDto<Contact>> {
    const { page = 1, limit = 20, country, campaign_id, is_opted_out, search } = query;
    const qb = this.repo.createQueryBuilder('contact')
      .leftJoinAndSelect('contact.company', 'company')
      .orderBy('contact.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (country) qb.andWhere('company.country = :country', { country });
    if (campaign_id) qb.innerJoin('contact.campaign_contacts', 'cc', 'cc.campaign_id = :campaign_id', { campaign_id });
    if (is_opted_out !== undefined) qb.andWhere('contact.is_opted_out = :is_opted_out', { is_opted_out });
    if (search) qb.andWhere('(contact.name ILIKE :s OR contact.whatsapp_number ILIKE :s OR contact.email ILIKE :s)', { s: `%${search}%` });

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponseDto(data, total, page, limit);
  }

  /** Override create with phone normalization + dedup */
  async createContact(dto: CreateContactDto): Promise<Contact> {
    const normalized = normalizePhone(dto.whatsapp_number);
    if (!normalized) throw new BadRequestException(`Invalid WhatsApp number: '${dto.whatsapp_number}'`);

    const existing = await this.repo.findOne({ where: { whatsapp_number: normalized } });
    if (existing) throw new ConflictException(`Contact with WhatsApp '${normalized}' already exists`);

    if (dto.company_id) {
      const company = await this.companyRepo.findOne({ where: { id: dto.company_id } });
      if (!company) throw new NotFoundException(`Company '${dto.company_id}' not found`);
    }

    return this.repo.save(this.repo.create({
      ...dto,
      whatsapp_number: normalized,
      phone: dto.phone ? normalizePhone(dto.phone) || dto.phone : undefined,
    }));
  }

  /** Override update with phone normalization */
  async updateContact(id: string, dto: UpdateContactDto): Promise<Contact> {
    const contact = await this.findById(id); // uses BaseService (cached)

    if (dto.whatsapp_number) {
      const normalized = normalizePhone(dto.whatsapp_number);
      if (!normalized) throw new BadRequestException(`Invalid WhatsApp number: '${dto.whatsapp_number}'`);
      const dup = await this.repo.findOne({ where: { whatsapp_number: normalized } });
      if (dup && dup.id !== id) throw new ConflictException(`WhatsApp '${normalized}' already in use`);
      dto.whatsapp_number = normalized;
    }

    if (dto.phone) dto.phone = normalizePhone(dto.phone) || dto.phone;

    if (dto.company_id) {
      const company = await this.companyRepo.findOne({ where: { id: dto.company_id } });
      if (!company) throw new NotFoundException(`Company '${dto.company_id}' not found`);
    }

    Object.assign(contact, dto);
    return this.repo.save(contact);
  }

  async optOut(id: string): Promise<Contact> {
    const contact = await this.findById(id);
    contact.is_opted_out = true;
    contact.opted_out_at = new Date();
    return this.repo.save(contact);
  }

  /**
   * Permanently delete a contact and the history that belongs to it.
   *
   * None of the five tables referencing `contacts` declare ON DELETE CASCADE, so a
   * plain repository delete raises a foreign-key violation for any contact that has
   * ever been messaged, campaigned, or scraped. Dependents are therefore removed
   * explicitly, innermost-first, inside one transaction so a failure part-way
   * through cannot leave the contact half-deleted.
   *
   * `collection_results` is deliberately NOT deleted: it is the raw
   * data-collection audit trail and its `contact_id` is nullable, so the row is
   * detached instead. Deleting a contact must not rewrite what a scrape returned.
   */
  async deleteContact(id: string): Promise<{ id: string; deleted: true }> {
    // 404s before opening a transaction if the contact does not exist.
    await this.findById(id);

    await this.repo.manager.transaction(async (tx) => {
      const campaignContactIds = (
        await tx.query('SELECT id FROM campaign_contacts WHERE contact_id = $1', [id])
      ).map((r: { id: string }) => r.id);

      const leadIds = (
        await tx.query('SELECT id FROM leads WHERE contact_id = $1', [id])
      ).map((r: { id: string }) => r.id);

      // deals -> leads
      if (leadIds.length > 0) {
        await tx.query('DELETE FROM deals WHERE lead_id = ANY($1::uuid[])', [leadIds]);
      }

      // ai_analyses refers to the contact, its messages AND its campaign_contacts,
      // so it must go before messages and campaign_contacts.
      await tx.query('DELETE FROM ai_analyses WHERE contact_id = $1', [id]);
      if (campaignContactIds.length > 0) {
        await tx.query('DELETE FROM ai_analyses WHERE campaign_contact_id = ANY($1::uuid[])', [
          campaignContactIds,
        ]);
        await tx.query('DELETE FROM followup_jobs WHERE campaign_contact_id = ANY($1::uuid[])', [
          campaignContactIds,
        ]);
      }

      await tx.query('DELETE FROM leads WHERE contact_id = $1', [id]);
      await tx.query('DELETE FROM messages WHERE contact_id = $1', [id]);
      await tx.query('DELETE FROM campaign_contacts WHERE contact_id = $1', [id]);

      // Preserve the scrape audit trail; just unlink it.
      await tx.query('UPDATE collection_results SET contact_id = NULL WHERE contact_id = $1', [id]);

      await tx.query('DELETE FROM contacts WHERE id = $1', [id]);
    });

    // BaseService caches reads by id; a stale entry would resurrect the contact.
    this.invalidate(id);
    this.logger.log(`Deleted contact ${id} and its campaign/message/lead history`);
    return { id, deleted: true };
  }

  async verifyWhatsApp(id: string): Promise<Contact> {
    const contact = await this.findById(id);
    contact.whatsapp_verified = true;
    return this.repo.save(contact);
  }

  /**
   * Verify multiple contacts' WhatsApp numbers in batch.
   * Uses Redis caching (24h TTL) to avoid redundant checks.
   * Suppresses contacts not on WhatsApp.
   */
  async verifyBatch(
    ids: string[],
    sessionId = 'default',
  ): Promise<{ verified: number; suppressed: number; failed: number; results: { id: string; phone: string; status: string }[] }> {
    const contacts = await this.repo.find({ where: { id: In(ids) } });
    let verified = 0;
    let suppressed = 0;
    let failed = 0;
    const results: { id: string; phone: string; status: string }[] = [];

    for (const contact of contacts) {
      const cacheKey = `wa:verified:${contact.whatsapp_number}`;

      // Check cache first
      const cached = await this.redis.get<boolean>(cacheKey);
      if (cached !== null) {
        if (cached) {
          verified++;
          results.push({ id: contact.id, phone: contact.whatsapp_number, status: 'verified' });
        } else {
          suppressed++;
          results.push({ id: contact.id, phone: contact.whatsapp_number, status: 'not_on_whatsapp' });
        }
        continue;
      }

      try {
        const rawNumber = contact.whatsapp_number.replace('+', '');
        const exists = await this.openwa.checkNumber(sessionId, rawNumber);

        await this.redis.set(cacheKey, exists, 86400);

        if (exists) {
          await this.repo.update(contact.id, { whatsapp_verified: true });
          verified++;
          results.push({ id: contact.id, phone: contact.whatsapp_number, status: 'verified' });
        } else {
          await this.repo.update(contact.id, {
            is_suppressed: true,
            suppressed_reason: 'not_on_whatsapp',
            whatsapp_verified: false,
          });
          suppressed++;
          results.push({ id: contact.id, phone: contact.whatsapp_number, status: 'not_on_whatsapp' });
        }
      } catch (err) {
        this.logger.warn(`Verification failed for ${contact.whatsapp_number}: ${err.message}`);
        failed++;
        results.push({ id: contact.id, phone: contact.whatsapp_number, status: 'error' });
      }
    }

    return { verified, suppressed, failed, results };
  }
}

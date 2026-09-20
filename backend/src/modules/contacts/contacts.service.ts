// NEW contacts.service.ts — LEAN version
import { Injectable, BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
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

  /**
   * Apply the shared contact filter set to a query builder.
   *
   * Extracted so the contacts list, the location facets and the campaign
   * audience-by-filter path all resolve an identical result set. If they diverged,
   * the count shown in the campaign review step would not match who actually gets
   * enrolled — the exact class of bug that makes a send flow untrustworthy.
   *
   * Assumes the caller has joined the company relation as `company`.
   */
  private applyContactFilters(
    qb: SelectQueryBuilder<Contact>,
    query: QueryContactDto,
  ): SelectQueryBuilder<Contact> {
    const {
      country,
      state_region,
      district,
      city,
      agency_type,
      whatsapp_verified,
      reachable_only,
      campaign_id,
      not_in_campaign_id,
      is_opted_out,
      search,
    } = query;

    // LOWER(...) rather than `=`: the collector writes whatever Google returned and
    // the CSV importer whatever the operator typed, so casing is not dependable.
    if (country) qb.andWhere('LOWER(company.country) = LOWER(:country)', { country });
    if (state_region) {
      qb.andWhere('LOWER(company.state_region) = LOWER(:state_region)', { state_region });
    }
    if (district) qb.andWhere('LOWER(company.district) = LOWER(:district)', { district });
    if (city) qb.andWhere('LOWER(company.city) = LOWER(:city)', { city });
    if (agency_type) {
      qb.andWhere('LOWER(company.agency_type) = LOWER(:agency_type)', { agency_type });
    }

    if (whatsapp_verified !== undefined) {
      qb.andWhere('contact.whatsapp_verified = :whatsapp_verified', { whatsapp_verified });
    }

    // Mirrors the distributor's own eligibility test (send-distributor.service.ts),
    // so an audience count reflects who is actually sendable.
    if (reachable_only) {
      qb.andWhere('contact.is_opted_out = false').andWhere('contact.is_suppressed = false');
    }

    if (campaign_id) {
      qb.innerJoin('contact.campaign_contacts', 'cc', 'cc.campaign_id = :campaign_id', {
        campaign_id,
      });
    }

    if (not_in_campaign_id) {
      qb.andWhere(
        `NOT EXISTS (
           SELECT 1 FROM campaign_contacts existing
           WHERE existing.contact_id = contact.id
             AND existing.campaign_id = :not_in_campaign_id
         )`,
        { not_in_campaign_id },
      );
    }

    if (is_opted_out !== undefined) qb.andWhere('contact.is_opted_out = :is_opted_out', { is_opted_out });

    if (search) {
      qb.andWhere(
        '(contact.name ILIKE :s OR contact.whatsapp_number ILIKE :s OR contact.email ILIKE :s OR company.name ILIKE :s)',
        { s: `%${search}%` },
      );
    }

    return qb;
  }

  /** Custom findAll with advanced filtering */
  async findFiltered(query: QueryContactDto): Promise<PaginatedResponseDto<Contact>> {
    const { page = 1, limit = 20 } = query;
    const qb = this.repo
      .createQueryBuilder('contact')
      .leftJoinAndSelect('contact.company', 'company')
      .orderBy('contact.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    this.applyContactFilters(qb, query);

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponseDto(data, total, page, limit);
  }

  /**
   * Count contacts matching a filter, without paging.
   *
   * Powers the live audience size in the campaign builder, where the operator needs
   * the real total rather than the length of the current page.
   */
  async countFiltered(query: QueryContactDto): Promise<number> {
    const qb = this.repo.createQueryBuilder('contact').leftJoin('contact.company', 'company');
    this.applyContactFilters(qb, query);
    return qb.getCount();
  }

  /**
   * Resolve every contact id matching a filter.
   *
   * Used to enrol an audience into a campaign server-side. The previous UI could only
   * add from the first 100 contacts it had fetched, so anything beyond that was
   * unreachable; this removes the ceiling.
   */
  async findIdsFiltered(query: QueryContactDto): Promise<string[]> {
    const qb = this.repo
      .createQueryBuilder('contact')
      .leftJoin('contact.company', 'company')
      .select('contact.id', 'id');
    this.applyContactFilters(qb, query);
    const rows = await qb.getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  /**
   * Distinct location values present in the data, for populating filter dropdowns.
   *
   * Driven by the database rather than a hardcoded list, which previously offered 8
   * countries regardless of what had actually been collected — so a scrape of a
   * 9th country produced contacts that could not be filtered at all.
   *
   * Each level is narrowed by the level above it so the UI can cascade
   * Country -> State -> District.
   */
  async locationFacets(filter: {
    country?: string;
    state_region?: string;
  }): Promise<{
    countries: string[];
    states: string[];
    districts: string[];
    cities: string[];
    agencyTypes: string[];
  }> {
    // Only values attached to a contact are useful: a company with no contacts can
    // never appear in a contact-filtered result.
    const distinct = async (column: string, scope: Record<string, string> = {}) => {
      const qb = this.repo
        .createQueryBuilder('contact')
        .innerJoin('contact.company', 'company')
        .select(`company.${column}`, 'value')
        .distinct(true)
        .andWhere(`company.${column} IS NOT NULL`)
        .andWhere(`company.${column} <> ''`)
        .orderBy('value', 'ASC');

      for (const [key, value] of Object.entries(scope)) {
        qb.andWhere(`LOWER(company.${key}) = LOWER(:${key})`, { [key]: value });
      }

      const rows = await qb.getRawMany<{ value: string }>();
      return rows.map((r) => r.value);
    };

    const countryScope = filter.country ? { country: filter.country } : {};
    const stateScope = filter.state_region
      ? { ...countryScope, state_region: filter.state_region }
      : countryScope;

    const [countries, states, districts, cities, agencyTypes] = await Promise.all([
      distinct('country'),
      distinct('state_region', countryScope),
      distinct('district', stateScope),
      distinct('city', stateScope),
      distinct('agency_type', countryScope),
    ]);

    return { countries, states, districts, cities, agencyTypes };
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

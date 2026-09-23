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
      collection_job_ids,
      import_file_ids,
      sources,
      groups,
      is_opted_out,
      search,
    } = query;

    /*
     * Multi-value location filters.
     *
     * LOWER(...) on both sides rather than `=`: the collector writes whatever Google
     * returned and the importer whatever the operator typed, so casing is not
     * dependable. `IN` with a lowered array means selecting several cities ORs them
     * together, while different levels still AND — "Agra or Varanasi, in Uttar Pradesh".
     */
    const inList = (column: string, values: string[] | undefined, param: string) => {
      if (!values?.length) return;
      qb.andWhere(`LOWER(${column}) IN (:...${param})`, {
        [param]: values.map((v) => v.toLowerCase()),
      });
    };

    inList('company.country', country, 'countries');
    inList('company.state_region', state_region, 'states');
    inList('company.district', district, 'districts');
    inList('company.city', city, 'cities');
    inList('company.agency_type', agency_type, 'agencyTypes');
    inList('contact.source', sources, 'sources');

    // Groups live in the `tags` text[]. `&&` is Postgres array-overlap: true when the
    // contact carries any of the selected labels, which is the OR semantics a
    // multi-select implies.
    if (groups?.length) {
      qb.andWhere('contact.tags && :groups', { groups });
    }

    if (whatsapp_verified !== undefined) {
      qb.andWhere('contact.whatsapp_verified = :whatsapp_verified', { whatsapp_verified });
    }

    // Mirrors the distributor's own eligibility test (send-distributor.service.ts),
    // so an audience count reflects who is actually sendable.
    if (reachable_only) {
      qb.andWhere('contact.is_opted_out = false').andWhere('contact.is_suppressed = false');
    }

    /*
     * Dataset filters. A "dataset" is the output of one collection job or CSV import.
     * Contacts carry `import_file_id` directly, but the job link lives in
     * `collection_results`, so that one needs an EXISTS subquery. Both are expressed as
     * a single OR group: selecting two datasets means "contacts from either", which is
     * what picking two checkboxes implies.
     */
    if (collection_job_ids?.length || import_file_ids?.length) {
      const clauses: string[] = [];
      const params: Record<string, unknown> = {};

      if (collection_job_ids?.length) {
        clauses.push(`EXISTS (
          SELECT 1 FROM collection_results cr
          WHERE cr.contact_id = contact.id
            AND cr.job_id IN (:...collectionJobIds)
        )`);
        params.collectionJobIds = collection_job_ids;
      }
      if (import_file_ids?.length) {
        clauses.push('contact.import_file_id IN (:...importFileIds)');
        params.importFileIds = import_file_ids;
      }

      qb.andWhere(`(${clauses.join(' OR ')})`, params);
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
  }> {    // Only values attached to a contact are useful: a company with no contacts can
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

  /**
   * List the datasets a campaign audience can be built from.
   *
   * A "dataset" is the output of one collection job or one CSV import. Exposing them as
   * a pickable list is what makes "run a campaign on just this scrape" a single choice
   * rather than an attempt to reconstruct the same set from location filters — which
   * would silently include contacts from other runs in the same city.
   *
   * Counts are of *reachable* contacts, so the number shown matches what would actually
   * be enrolled.
   */
  async listDatasets(): Promise<{
    collectionJobs: { id: string; name: string; contactCount: number; createdAt: Date }[];
    imports: { id: string; name: string; contactCount: number; createdAt: Date }[];
  }> {
    const jobs = await this.repo.manager.query(`
      SELECT j.id, j.name, j.created_at AS "createdAt",
             COUNT(DISTINCT c.id)::int AS "contactCount"
      FROM collection_jobs j
      LEFT JOIN collection_results cr ON cr.job_id = j.id
      LEFT JOIN contacts c ON c.id = cr.contact_id
        AND c.is_opted_out = false AND c.is_suppressed = false
      GROUP BY j.id, j.name, j.created_at
      HAVING COUNT(DISTINCT c.id) > 0
      ORDER BY j.created_at DESC
    `);

    const imports = await this.repo.manager.query(`
      SELECT f.id, COALESCE(f.original_filename, f.filename, 'Import') AS name,
             f.created_at AS "createdAt",
             COUNT(c.id)::int AS "contactCount"
      FROM import_files f
      LEFT JOIN contacts c ON c.import_file_id = f.id
        AND c.is_opted_out = false AND c.is_suppressed = false
      GROUP BY f.id, f.original_filename, f.filename, f.created_at
      HAVING COUNT(c.id) > 0
      ORDER BY f.created_at DESC
    `);

    return { collectionJobs: jobs, imports };
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

    // Resolve the company from its name + location, so a hand-entered contact ends up
    // with the same structured location a scraped one has and is therefore reachable by
    // the Country/State/City filters and campaign audiences.
    const companyId =
      dto.company_id ?? (await this.resolveCompany(dto));

    // company_name/country/state_region/city are company attributes, not contact
    // columns — strip them so TypeORM does not try to write them to `contacts`.
    const { company_name, country, state_region, city, ...contactFields } = dto;

    return this.repo.save(this.repo.create({
      ...contactFields,
      company_id: companyId,
      whatsapp_number: normalized,
      phone: dto.phone ? normalizePhone(dto.phone) || dto.phone : undefined,
    }));
  }

  /**
   * Find or create the company a manually-entered contact belongs to.
   *
   * Matching is case-insensitive on name within the same country, because an operator
   * typing "wanderlust tours" should not create a second record alongside "Wanderlust
   * Tours". Returns undefined when there is nothing to attach — a contact with no
   * company is still valid, it just cannot be filtered by location.
   *
   * An existing company's blank location fields are backfilled from this entry, so
   * adding a second contact with more detail improves the record rather than being
   * silently discarded. Existing non-blank values are never overwritten.
   */
  private async resolveCompany(dto: CreateContactDto): Promise<string | undefined> {
    const name = dto.company_name?.trim();
    if (!name) return undefined;

    const qb = this.companyRepo
      .createQueryBuilder('company')
      .where('LOWER(company.name) = LOWER(:name)', { name });
    if (dto.country?.trim()) {
      qb.andWhere('(company.country IS NULL OR LOWER(company.country) = LOWER(:country))', {
        country: dto.country.trim(),
      });
    }
    const existing = await qb.getOne();

    if (existing) {
      const patch: Partial<Company> = {};
      if (!existing.country && dto.country?.trim()) patch.country = dto.country.trim();
      if (!existing.state_region && dto.state_region?.trim()) {
        patch.state_region = dto.state_region.trim();
      }
      if (!existing.city && dto.city?.trim()) patch.city = dto.city.trim();
      if (Object.keys(patch).length) {
        await this.companyRepo.update(existing.id, patch);
        this.logger.log(`Backfilled location on company "${existing.name}"`);
      }
      return existing.id;
    }

    const created = await this.companyRepo.save(
      this.companyRepo.create({
        name,
        country: dto.country?.trim() || (null as any),
        state_region: dto.state_region?.trim() || (null as any),
        city: dto.city?.trim() || (null as any),
        source: 'manual',
      }),
    );
    this.logger.log(`Created company "${name}" for a manually-entered contact`);
    return created.id;
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
   * Delete many contacts in one request.
   *
   * Each row goes through `deleteContact`, so the same FK-ordered cleanup applies and a
   * single problem contact cannot leave the others half-deleted. Failures are reported
   * per id rather than aborting the batch — with 200 selected rows, "one of them was
   * already gone" should not undo the other 199.
   */
  async bulkDelete(ids: string[]): Promise<{ deleted: number; failed: { id: string; reason: string }[] }> {
    let deleted = 0;
    const failed: { id: string; reason: string }[] = [];

    for (const id of ids) {
      try {
        await this.deleteContact(id);
        deleted++;
      } catch (err) {
        failed.push({ id, reason: (err as Error).message });
      }
    }

    this.logger.log(`Bulk delete: ${deleted} removed, ${failed.length} failed`);
    return { deleted, failed };
  }

  /**
   * Add a group label to many contacts.
   *
   * Groups are stored in the existing `tags` array rather than a new table: a contact
   * can belong to several groups, the value is already indexed alongside the contact,
   * and campaign audiences can filter on it with the same machinery as datasets.
   *
   * Idempotent — re-grouping contacts that already carry the label is a no-op, so an
   * operator can safely re-apply a group to a wider selection.
   */
  async bulkAddGroup(ids: string[], group: string): Promise<{ updated: number; group: string }> {
    const label = group.trim();
    if (!label) throw new BadRequestException('Group name cannot be empty');

    const contacts = await this.repo.find({ where: { id: In(ids) } });
    let updated = 0;

    for (const contact of contacts) {
      const tags = contact.tags ?? [];
      // Case-insensitive check so "Agra Agencies" and "agra agencies" do not both stick.
      if (tags.some((t) => t.toLowerCase() === label.toLowerCase())) continue;
      contact.tags = [...tags, label];
      await this.repo.save(contact);
      this.invalidate(contact.id);
      updated++;
    }

    this.logger.log(`Bulk group "${label}": ${updated} of ${ids.length} contacts updated`);
    return { updated, group: label };
  }

  /** Remove a group label from many contacts. */
  async bulkRemoveGroup(ids: string[], group: string): Promise<{ updated: number }> {
    const label = group.trim().toLowerCase();
    const contacts = await this.repo.find({ where: { id: In(ids) } });
    let updated = 0;

    for (const contact of contacts) {
      const next = (contact.tags ?? []).filter((t) => t.toLowerCase() !== label);
      if (next.length === (contact.tags ?? []).length) continue;
      contact.tags = next;
      await this.repo.save(contact);
      this.invalidate(contact.id);
      updated++;
    }

    return { updated };
  }

  /** Distinct group labels in use, with reachable-contact counts. */
  async listGroups(): Promise<{ name: string; contactCount: number }[]> {
    const rows = await this.repo.manager.query(`
      SELECT tag AS name, COUNT(*)::int AS "contactCount"
      FROM contacts c, UNNEST(c.tags) AS tag
      WHERE c.is_opted_out = false AND c.is_suppressed = false
      GROUP BY tag
      ORDER BY tag ASC
    `);
    return rows;
  }

  /**
   * Verify multiple contacts' WhatsApp numbers in batch.
   * Uses Redis caching (24h TTL) to avoid redundant checks.
   * Suppresses contacts not on WhatsApp.
   */
  async verifyBatch(
    ids: string[],
    sessionId?: string,
  ): Promise<{ verified: number; suppressed: number; failed: number; results: { id: string; phone: string; status: string }[] }> {
    // Resolve the real session UUID. The previous default of 'default' is not a session
    // id — OpenWA answers 400 for it — so every uncached check errored and fell through
    // to "assume reachable", marking nothing as suppressed.
    const resolvedSessionId = await this.openwa.resolveSessionId(sessionId ?? null);
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
        const exists = await this.openwa.checkNumber(resolvedSessionId, rawNumber);

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

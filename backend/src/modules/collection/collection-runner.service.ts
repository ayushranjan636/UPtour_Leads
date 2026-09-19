import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import {
  CollectionJob,
  CollectionJobStatus,
} from '../../entities/collection-job.entity';
import {
  CollectionResult,
  CollectionResultStatus,
} from '../../entities/collection-result.entity';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import {
  CampaignContact,
  CampaignContactStatus,
} from '../../entities/campaign-contact.entity';
import { normalizePhone } from '../../common/utils/phone.util';
import {
  GooglePlacesProvider,
  PlaceResult,
  PlacesAuthError,
  PlacesQuotaExceededError,
} from './google-places.provider';

/**
 * COLLECTION RUNNER — real Google Maps Places scraping
 *
 * Flow per job (matches docs/02-flow-document.md §2):
 *   1. Build a list of search queries from country / city / category / keywords.
 *   2. Call Places Text Search (New), 20 results per page.
 *   3. Paginate with nextPageToken until the page runs out.
 *   4. Move to the next query variation when a query is exhausted.
 *   5. Stop when the job's daily_limit of NEW contacts is reached.
 *   6. Persist the cursor (query index + page token) so tomorrow's run resumes
 *      exactly where this one stopped instead of re-scraping page 1.
 *
 * Dedup happens on two keys:
 *   - google_place_id on companies (same listing seen again)
 *   - whatsapp_number on contacts  (same number from a different listing)
 *
 * Every raw place is written to collection_results for auditability, including
 * the ones rejected as duplicates or missing a phone number.
 */
@Injectable()
export class CollectionRunnerService {
  private readonly logger = new Logger(CollectionRunnerService.name);

  /** Guards against a slow run overlapping with the next cron tick. */
  private readonly running = new Set<string>();

  constructor(
    @InjectRepository(CollectionJob)
    private readonly jobRepo: Repository<CollectionJob>,
    @InjectRepository(CollectionResult)
    private readonly resultRepo: Repository<CollectionResult>,
    @InjectRepository(Contact) private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(CampaignContact)
    private readonly ccRepo: Repository<CampaignContact>,
    private readonly places: GooglePlacesProvider,
  ) {}

  /**
   * Hourly tick. Runs any active job that has not yet run today.
   * A job that already hit its daily limit today is skipped until tomorrow.
   */
  @Cron('0 * * * *')
  async runCollectionCycle(): Promise<void> {
    if (!this.places.isConfigured()) {
      this.logger.warn(
        'Skipping collection cycle — GOOGLE_MAPS_API_KEY is not configured.',
      );
      return;
    }

    const activeJobs = await this.jobRepo.find({
      where: { status: CollectionJobStatus.ACTIVE },
    });

    const today = this.dayKey(new Date());

    for (const job of activeJobs) {
      if (job.last_run_at && this.dayKey(job.last_run_at) === today) continue;

      try {
        await this.executeJob(job);
      } catch (err) {
        this.logger.error(
          `Collection job ${job.id} (${job.name}) failed: ${(err as Error).message}`,
        );
        // Quota is transient — keep the job active so it retries tomorrow.
        // Auth failures and real errors need an admin, so pause/fail the job.
        if (err instanceof PlacesQuotaExceededError) {
          await this.jobRepo.update(job.id, { last_run_at: new Date() });
        } else if (err instanceof PlacesAuthError) {
          await this.jobRepo.update(job.id, {
            status: CollectionJobStatus.PAUSED,
          });
        } else {
          await this.jobRepo.update(job.id, {
            status: CollectionJobStatus.FAILED,
          });
        }
      }
    }
  }

  /**
   * Execute a single collection job. Safe to call manually (Run Now).
   * Returns a summary so the API can report what happened.
   */
  async executeJob(job: CollectionJob): Promise<{
    imported: number;
    duplicates: number;
    invalid: number;
    scanned: number;
    requests: number;
    exhausted: boolean;
  }> {
    if (this.running.has(job.id)) {
      throw new Error(`Collection job ${job.name} is already running`);
    }
    this.running.add(job.id);

    const startedRequests = this.places.getRequestCount();

    try {
      const queries = this.buildQueries(job);
      const limit = job.daily_limit || 100;

      let queryIndex = Math.min(job.search_offset ?? 0, queries.length);
      let pageToken: string | null = job.pagination_token || null;

      let imported = 0;
      let duplicates = 0;
      let invalid = 0;
      let scanned = 0;

      this.logger.log(
        `Collection "${job.name}" starting — ${queries.length} queries, ` +
          `resuming at query ${queryIndex + 1}, limit ${limit} new contacts`,
      );

      while (imported < limit && queryIndex < queries.length) {
        const textQuery = queries[queryIndex];

        const { places, nextPageToken } = await this.places.searchText({
          textQuery,
          pageToken,
          pageSize: 20,
        });

        scanned += places.length;

        for (const place of places) {
          if (imported >= limit) break;

          const outcome = await this.ingestPlace(job, place);
          if (outcome === CollectionResultStatus.IMPORTED) imported++;
          else if (outcome === CollectionResultStatus.DUPLICATE) duplicates++;
          else invalid++;
        }

        if (nextPageToken) {
          pageToken = nextPageToken;
        } else {
          // This query is exhausted — advance to the next variation.
          queryIndex++;
          pageToken = null;
        }
      }

      const exhausted = queryIndex >= queries.length;

      await this.jobRepo.update(job.id, {
        last_run_at: new Date(),
        total_collected: (job.total_collected || 0) + imported,
        search_offset: queryIndex,
        pagination_token: pageToken ?? (null as any),
        // Once every query variation is used up there is nothing left to scrape.
        ...(exhausted ? { status: CollectionJobStatus.COMPLETED } : {}),
      });

      const requests = this.places.getRequestCount() - startedRequests;

      this.logger.log(
        `Collection "${job.name}" done — ${imported} imported, ${duplicates} duplicates, ` +
          `${invalid} invalid, ${scanned} scanned, ${requests} Places requests` +
          (exhausted ? ' (all queries exhausted → job completed)' : ''),
      );

      return { imported, duplicates, invalid, scanned, requests, exhausted };
    } finally {
      this.running.delete(job.id);
    }
  }

  /**
   * Persist one Google place: always record the raw result, then create the
   * company + contact if it is new and has a usable phone number.
   */
  private async ingestPlace(
    job: CollectionJob,
    place: PlaceResult,
  ): Promise<CollectionResultStatus> {
    const phone = place.phone
      ? normalizePhone(place.phone, this.regionHint(job.country))
      : null;

    const base = {
      job_id: job.id,
      run_date: new Date(),
      raw_data: place.raw,
      business_name: place.name,
      phone: phone ?? place.phone ?? (null as any),
      country: job.country,
      city: place.address ? this.cityFrom(place.address, job.city) : job.city,
      address: place.address ?? (null as any),
      website: place.website ?? (null as any),
      google_place_id: place.placeId,
    };

    // No valid phone number → useless for WhatsApp outreach.
    if (!phone) {
      await this.saveResult({
        ...base,
        status: CollectionResultStatus.INVALID,
      });
      return CollectionResultStatus.INVALID;
    }

    // Dedup: same Google listing, or same number from a different listing.
    const [existingCompany, existingContact] = await Promise.all([
      this.companyRepo.findOne({
        where: { google_place_id: place.placeId },
      }),
      this.contactRepo.findOne({ where: { whatsapp_number: phone } }),
    ]);

    if (existingCompany || existingContact) {
      await this.saveResult({
        ...base,
        status: CollectionResultStatus.DUPLICATE,
        company_id: existingCompany?.id ?? (null as any),
        contact_id: existingContact?.id ?? (null as any),
      });
      return CollectionResultStatus.DUPLICATE;
    }

    const company = await this.companyRepo.save(
      this.companyRepo.create({
        name: place.name || 'Unknown',
        country: job.country,
        city: base.city ?? (null as any),
        address: place.address ?? (null as any),
        website: place.website ?? (null as any),
        agency_type: place.primaryType ?? job.category ?? (null as any),
        source: 'google_maps',
        source_url: `https://www.google.com/maps/place/?q=place_id:${place.placeId}`,
        google_place_id: place.placeId,
        rating: place.rating ?? (null as any),
      }),
    );

    const contact = await this.contactRepo.save(
      this.contactRepo.create({
        company_id: company.id,
        // Google Places has no personal contact name — only the business.
        name: place.name || 'Unknown',
        phone,
        whatsapp_number: phone,
        source: 'google_maps',
      }),
    );

    await this.saveResult({
      ...base,
      status: CollectionResultStatus.IMPORTED,
      company_id: company.id,
      contact_id: contact.id,
    });

    if (job.auto_add_to_campaign_id) {
      await this.addToCampaign(job.auto_add_to_campaign_id, contact.id);
    }

    return CollectionResultStatus.IMPORTED;
  }

  private async saveResult(data: Partial<CollectionResult>): Promise<void> {
    try {
      await this.resultRepo.save(this.resultRepo.create(data));
    } catch (err) {
      // A result row failing must never abort the whole run.
      this.logger.warn(
        `Failed to store collection result for ${data.google_place_id}: ${(err as Error).message}`,
      );
    }
  }

  private async addToCampaign(
    campaignId: string,
    contactId: string,
  ): Promise<void> {
    try {
      const exists = await this.ccRepo.findOne({
        where: { campaign_id: campaignId, contact_id: contactId },
      });
      if (exists) return;

      await this.ccRepo.save(
        this.ccRepo.create({
          campaign_id: campaignId,
          contact_id: contactId,
          status: CampaignContactStatus.PENDING,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to auto-add contact ${contactId} to campaign ${campaignId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Build the ordered list of Text Search queries for a job.
   *
   * "travel agency in Bangkok, Thailand" is the base shape. Each keyword adds a
   * variation so a single job can reach well past the ~60 results a single query
   * returns. Order is stable so the saved search_offset cursor stays meaningful
   * across runs.
   */
  buildQueries(job: CollectionJob): string[] {
    const where = [job.city, job.country].filter(Boolean).join(', ');
    const category = (job.category || 'travel agency').trim();

    const terms = [category, ...(job.keywords ?? []).map((k) => k.trim())].filter(
      (t) => t.length > 0,
    );

    // De-duplicate case-insensitively while preserving order.
    const seen = new Set<string>();
    const queries: string[] = [];
    for (const term of terms) {
      const q = where ? `${term} in ${where}` : term;
      const key = q.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      queries.push(q);
    }

    return queries;
  }

  /**
   * libphonenumber needs a default region for numbers without a "+" prefix.
   * Google usually returns internationalPhoneNumber (already prefixed), so this
   * is only a fallback for nationalPhoneNumber.
   */
  private regionHint(country?: string): string {
    if (!country) return 'IN';
    const map: Record<string, string> = {
      india: 'IN',
      thailand: 'TH',
      japan: 'JP',
      uae: 'AE',
      'united arab emirates': 'AE',
      singapore: 'SG',
      malaysia: 'MY',
      indonesia: 'ID',
      vietnam: 'VN',
      'sri lanka': 'LK',
      nepal: 'NP',
      china: 'CN',
      'south korea': 'KR',
      australia: 'AU',
      'united kingdom': 'GB',
      uk: 'GB',
      usa: 'US',
      'united states': 'US',
      germany: 'DE',
      france: 'FR',
      italy: 'IT',
      spain: 'ES',
      russia: 'RU',
      israel: 'IL',
    };
    return map[country.trim().toLowerCase()] ?? 'IN';
  }

  /**
   * Google returns a single formattedAddress string. Rather than guess with a
   * fragile parse, fall back to the job's configured city.
   */
  private cityFrom(_address: string, jobCity?: string): string | null {
    return jobCity || null;
  }

  private dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}

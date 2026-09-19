import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * GOOGLE PLACES PROVIDER — Text Search (New), Places API v1
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 *
 * We use Text Search (New) because it returns `internationalPhoneNumber` and
 * `websiteUri` directly in the search response. The legacy Places API required a
 * separate Place Details call per result to get a phone number, which multiplied
 * both latency and cost. With a tight field mask we get everything in one call.
 *
 * Cost control:
 *  - The field mask is the primary cost lever. Only request what we store.
 *  - pageSize is capped at 20 by the API.
 *  - Requests are spaced by MIN_REQUEST_INTERVAL_MS to stay well inside quota.
 */

/** Thrown when Google reports the quota/rate limit is exhausted. */
export class PlacesQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacesQuotaExceededError';
  }
}

/** Thrown when the API key is missing, invalid, or lacks permission. */
export class PlacesAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlacesAuthError';
  }
}

export interface PlaceResult {
  placeId: string;
  name: string;
  /** E.164-ish international number as returned by Google, e.g. "+61 433 479 794". */
  phone: string | null;
  address: string | null;
  website: string | null;
  rating: number | null;
  userRatingCount: number | null;
  primaryType: string | null;
  types: string[];
  /** Full raw place object, stored for auditability. */
  raw: Record<string, any>;
}

export interface SearchTextOptions {
  textQuery: string;
  pageToken?: string | null;
  pageSize?: number;
  languageCode?: string;
  regionCode?: string;
}

export interface SearchTextResponse {
  places: PlaceResult[];
  nextPageToken: string | null;
}

/**
 * Only the fields we actually persist. Adding fields here increases the billed
 * SKU tier, so keep this list minimal and intentional.
 */
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.internationalPhoneNumber',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.primaryType',
  'places.types',
  'nextPageToken',
].join(',');

const MIN_REQUEST_INTERVAL_MS = 2_000;

@Injectable()
export class GooglePlacesProvider {
  private readonly logger = new Logger(GooglePlacesProvider.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string | undefined;
  private lastRequestAt = 0;

  /** Number of Places requests issued this process lifetime (for cost monitoring). */
  private requestCount = 0;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');

    this.client = axios.create({
      baseURL: 'https://places.googleapis.com/v1',
      timeout: 20_000,
      headers: { 'Content-Type': 'application/json' },
    });

    if (this.apiKey) {
      this.logger.log('Google Places provider configured (Text Search New)');
    } else {
      this.logger.warn(
        'GOOGLE_MAPS_API_KEY is not set — data collection jobs cannot run. ' +
          'Set it in backend/.env to enable Google Maps collection.',
      );
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  /**
   * Run one Text Search (New) request.
   *
   * When paginating, every parameter other than pageToken/pageSize MUST match the
   * original request or Google returns INVALID_ARGUMENT — the caller is
   * responsible for keeping textQuery stable across pages.
   */
  async searchText(options: SearchTextOptions): Promise<SearchTextResponse> {
    if (!this.apiKey) {
      throw new PlacesAuthError(
        'GOOGLE_MAPS_API_KEY is not configured. Cannot run Google Maps collection.',
      );
    }

    await this.throttle();

    const body: Record<string, any> = {
      textQuery: options.textQuery,
      pageSize: Math.min(Math.max(options.pageSize ?? 20, 1), 20),
    };
    if (options.pageToken) body.pageToken = options.pageToken;
    if (options.languageCode) body.languageCode = options.languageCode;
    if (options.regionCode) body.regionCode = options.regionCode;

    try {
      this.requestCount++;
      const { data } = await this.client.post('/places:searchText', body, {
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
      });

      const places: PlaceResult[] = (data?.places ?? []).map((p: any) =>
        this.mapPlace(p),
      );

      return {
        places,
        nextPageToken: data?.nextPageToken ?? null,
      };
    } catch (error) {
      throw this.translateError(error, options.textQuery);
    }
  }

  private mapPlace(p: any): PlaceResult {
    return {
      placeId: p.id,
      name: p.displayName?.text ?? '',
      phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
      address: p.formattedAddress ?? null,
      website: p.websiteUri ?? null,
      rating: typeof p.rating === 'number' ? p.rating : null,
      userRatingCount:
        typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
      primaryType: p.primaryType ?? null,
      types: Array.isArray(p.types) ? p.types : [],
      raw: p,
    };
  }

  /**
   * Convert Google's error envelope into typed errors so the runner can decide
   * whether to pause the job (quota/auth) or just fail this run (transient).
   */
  private translateError(error: unknown, query: string): Error {
    if (!axios.isAxiosError(error)) {
      return error instanceof Error ? error : new Error(String(error));
    }

    const status = error.response?.status;
    const apiError = (error.response?.data as any)?.error;
    const reason = apiError?.status ?? '';
    const detail = apiError?.message ?? error.message;

    if (status === 429 || reason === 'RESOURCE_EXHAUSTED') {
      return new PlacesQuotaExceededError(
        `Google Places quota exhausted: ${detail}`,
      );
    }

    if (
      status === 401 ||
      status === 403 ||
      reason === 'PERMISSION_DENIED' ||
      reason === 'UNAUTHENTICATED'
    ) {
      return new PlacesAuthError(
        `Google Places rejected the API key (${status}): ${detail}. ` +
          'Verify the key is valid and that "Places API (New)" is enabled for the project.',
      );
    }

    return new Error(
      `Google Places search failed for "${query}" (${status ?? 'network'}): ${detail}`,
    );
  }

  /** Space requests out so a long pagination run never trips the rate limit. */
  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (this.lastRequestAt && elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    this.lastRequestAt = Date.now();
  }
}

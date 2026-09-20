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
  /** Structured administrative location, parsed from `addressComponents`. */
  location: PlaceLocation;
  /** Full raw place object, stored for auditability. */
  raw: Record<string, any>;
}

/**
 * Administrative hierarchy for a place, resolved from Google's address components.
 *
 * Google's levels do not map onto one universal civic vocabulary, so we normalise
 * to the labels this product uses:
 *   - `state`    <- administrative_area_level_1 (state / province / prefecture / emirate)
 *   - `district` <- administrative_area_level_2 (district / county / metropolitan area)
 *   - `city`     <- locality, falling back to postal_town / sublocality, since many
 *                   regions (notably the UK and parts of Asia) omit `locality`.
 * Every field is nullable: coverage genuinely varies by country, and a wrong guess
 * is worse than an absent value for filtering.
 */
export interface PlaceLocation {
  country: string | null;
  /** ISO 3166-1 alpha-2, e.g. "IN". Stable across languages, unlike the name. */
  countryCode: string | null;
  state: string | null;
  district: string | null;
  city: string | null;
  postalCode: string | null;
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
 * Only the fields we actually persist.
 *
 * Billing note: requests are charged at the highest SKU tier any requested field
 * belongs to. `internationalPhoneNumber`, `websiteUri`, `rating` and
 * `userRatingCount` are Enterprise-tier, so this request is already billed at
 * Text Search Enterprise. `addressComponents` is Pro-tier and therefore adds no
 * incremental cost here — but adding an Atmosphere-tier field would raise the tier,
 * so keep that in mind before extending this list.
 * See https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
 */
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  // Structured admin hierarchy: country / state / district / city, so filtering does
  // not depend on parsing the flat formattedAddress string.
  'places.addressComponents',
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

/** One entry of Google's `addressComponents` array. */
interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

const EMPTY_LOCATION: PlaceLocation = {
  country: null,
  countryCode: null,
  state: null,
  district: null,
  city: null,
  postalCode: null,
};

/**
 * Resolve the administrative hierarchy from Google's `addressComponents`.
 *
 * Exported for unit testing: this is pure and deserves coverage independent of the
 * network, since component coverage differs sharply between countries.
 *
 * City resolution walks a fallback chain rather than trusting `locality` alone:
 * UK addresses often carry `postal_town` with no `locality`, and dense metros in
 * India and Japan frequently only populate a `sublocality`. Taking the first match
 * in priority order yields a usable city far more often than a single lookup.
 */
export function extractLocation(components: unknown): PlaceLocation {
  if (!Array.isArray(components)) return { ...EMPTY_LOCATION };

  const typed = components as AddressComponent[];

  /** First component whose `types` includes `type`. */
  const find = (type: string): AddressComponent | undefined =>
    typed.find((c) => Array.isArray(c.types) && c.types.includes(type));

  const pick = (type: string): string | null => find(type)?.longText?.trim() || null;

  const country = find('country');
  const cityLike =
    find('locality') ??
    find('postal_town') ??
    find('sublocality_level_1') ??
    find('sublocality');

  return {
    country: country?.longText?.trim() || null,
    // shortText on `country` is the ISO 3166-1 alpha-2 code.
    countryCode: country?.shortText?.trim()?.toUpperCase() || null,
    state: pick('administrative_area_level_1'),
    district: pick('administrative_area_level_2'),
    city: cityLike?.longText?.trim() || null,
    postalCode: pick('postal_code'),
  };
}

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
      location: extractLocation(p.addressComponents),
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

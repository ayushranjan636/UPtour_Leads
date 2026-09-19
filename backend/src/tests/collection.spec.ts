import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  GooglePlacesProvider,
  PlacesAuthError,
  PlacesQuotaExceededError,
} from '../modules/collection/google-places.provider';
import { CollectionRunnerService } from '../modules/collection/collection-runner.service';
import { CollectionJob } from '../entities/collection-job.entity';

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string, fallback?: any) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('GooglePlacesProvider', () => {
  it('reports not configured when the API key is absent', () => {
    const provider = new GooglePlacesProvider(configWith({}));
    expect(provider.isConfigured()).toBe(false);
  });

  it('reports configured when the API key is present', () => {
    const provider = new GooglePlacesProvider(
      configWith({ GOOGLE_MAPS_API_KEY: 'test-key' }),
    );
    expect(provider.isConfigured()).toBe(true);
  });

  it('throws PlacesAuthError instead of calling the API when unconfigured', async () => {
    const provider = new GooglePlacesProvider(configWith({}));
    await expect(
      provider.searchText({ textQuery: 'travel agency in Bangkok' }),
    ).rejects.toBeInstanceOf(PlacesAuthError);
  });

  it('maps a Places response into PlaceResult shape', async () => {
    const provider = new GooglePlacesProvider(
      configWith({ GOOGLE_MAPS_API_KEY: 'test-key' }),
    );

    // Stub the internal axios instance.
    (provider as any).client = {
      post: vi.fn().mockResolvedValue({
        data: {
          places: [
            {
              id: 'ChIJabc',
              displayName: { text: 'Siam Tours' },
              formattedAddress: '1 Sukhumvit Rd, Bangkok, Thailand',
              internationalPhoneNumber: '+66 2 123 4567',
              websiteUri: 'https://siamtours.example',
              rating: 4.6,
              userRatingCount: 210,
              primaryType: 'travel_agency',
              types: ['travel_agency', 'point_of_interest'],
            },
          ],
          nextPageToken: 'token-2',
        },
      }),
    };

    const res = await provider.searchText({ textQuery: 'travel agency' });

    expect(res.nextPageToken).toBe('token-2');
    expect(res.places).toHaveLength(1);
    expect(res.places[0]).toMatchObject({
      placeId: 'ChIJabc',
      name: 'Siam Tours',
      phone: '+66 2 123 4567',
      website: 'https://siamtours.example',
      rating: 4.6,
      primaryType: 'travel_agency',
    });
  });

  it('falls back to nationalPhoneNumber and tolerates missing fields', async () => {
    const provider = new GooglePlacesProvider(
      configWith({ GOOGLE_MAPS_API_KEY: 'k' }),
    );
    (provider as any).client = {
      post: vi.fn().mockResolvedValue({
        data: { places: [{ id: 'x', nationalPhoneNumber: '02 123 4567' }] },
      }),
    };

    const res = await provider.searchText({ textQuery: 'q' });
    expect(res.places[0].phone).toBe('02 123 4567');
    expect(res.places[0].website).toBeNull();
    expect(res.places[0].rating).toBeNull();
    expect(res.nextPageToken).toBeNull();
  });

  it('translates a 429 into PlacesQuotaExceededError', async () => {
    const provider = new GooglePlacesProvider(
      configWith({ GOOGLE_MAPS_API_KEY: 'k' }),
    );
    (provider as any).client = {
      post: vi.fn().mockRejectedValue(
        Object.assign(new Error('rate limited'), {
          isAxiosError: true,
          response: {
            status: 429,
            data: { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } },
          },
        }),
      ),
    };

    await expect(
      provider.searchText({ textQuery: 'q' }),
    ).rejects.toBeInstanceOf(PlacesQuotaExceededError);
  });

  it('translates a 403 into PlacesAuthError', async () => {
    const provider = new GooglePlacesProvider(
      configWith({ GOOGLE_MAPS_API_KEY: 'k' }),
    );
    (provider as any).client = {
      post: vi.fn().mockRejectedValue(
        Object.assign(new Error('denied'), {
          isAxiosError: true,
          response: {
            status: 403,
            data: { error: { status: 'PERMISSION_DENIED', message: 'nope' } },
          },
        }),
      ),
    };

    await expect(
      provider.searchText({ textQuery: 'q' }),
    ).rejects.toBeInstanceOf(PlacesAuthError);
  });

  it('clamps pageSize to the API maximum of 20', async () => {
    const provider = new GooglePlacesProvider(
      configWith({ GOOGLE_MAPS_API_KEY: 'k' }),
    );
    const post = vi.fn().mockResolvedValue({ data: { places: [] } });
    (provider as any).client = { post };

    await provider.searchText({ textQuery: 'q', pageSize: 100 });

    expect(post.mock.calls[0][1].pageSize).toBe(20);
  });
});

describe('CollectionRunnerService.buildQueries', () => {
  let runner: CollectionRunnerService;

  beforeEach(() => {
    runner = new CollectionRunnerService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  const job = (over: Partial<CollectionJob>): CollectionJob =>
    ({ country: 'Thailand', city: 'Bangkok', keywords: [], ...over }) as CollectionJob;

  it('builds a city+country query from the category', () => {
    expect(runner.buildQueries(job({ category: 'travel agency' }))).toEqual([
      'travel agency in Bangkok, Thailand',
    ]);
  });

  it('adds one variation per keyword', () => {
    const queries = runner.buildQueries(
      job({ category: 'travel agency', keywords: ['tour operator', 'DMC'] }),
    );
    expect(queries).toEqual([
      'travel agency in Bangkok, Thailand',
      'tour operator in Bangkok, Thailand',
      'DMC in Bangkok, Thailand',
    ]);
  });

  it('omits the city when not set', () => {
    expect(
      runner.buildQueries(job({ city: undefined, category: 'tour operator' })),
    ).toEqual(['tour operator in Thailand']);
  });

  it('defaults the category when missing', () => {
    expect(runner.buildQueries(job({ category: undefined }))).toEqual([
      'travel agency in Bangkok, Thailand',
    ]);
  });

  it('de-duplicates queries case-insensitively', () => {
    const queries = runner.buildQueries(
      job({ category: 'Travel Agency', keywords: ['travel agency'] }),
    );
    expect(queries).toHaveLength(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CollectionRunnerService } from '../modules/collection/collection-runner.service';
import { CollectionJobStatus } from '../entities/collection-job.entity';
import { CollectionResultStatus } from '../entities/collection-result.entity';
import {
  GooglePlacesProvider,
  PlacesAuthError,
} from '../modules/collection/google-places.provider';

/**
 * Verifies the Google Maps collection runner's real behaviour: query building,
 * pagination, dedup, phone normalisation and the resume cursor.
 */

function makeJob(over: Partial<any> = {}): any {
  return {
    id: 'job-1',
    name: 'Thailand Agencies',
    country: 'Thailand',
    city: 'Bangkok',
    category: 'travel agency',
    keywords: [],
    daily_limit: 100,
    status: CollectionJobStatus.ACTIVE,
    total_collected: 0,
    search_offset: 0,
    pagination_token: null,
    auto_add_to_campaign_id: null,
    last_run_at: null,
    ...over,
  };
}

function place(over: Partial<any> = {}) {
  return {
    placeId: 'p1',
    name: 'Siam Tours',
    phone: '+66 2 123 4567',
    address: '1 Sukhumvit Rd, Bangkok',
    website: 'https://siamtours.example',
    rating: 4.5,
    userRatingCount: 120,
    primaryType: 'travel_agency',
    types: ['travel_agency'],
    raw: {},
    ...over,
  };
}

function makeRepos() {
  const saved: any = { companies: [], contacts: [], results: [], cc: [] };

  const jobRepo = { find: vi.fn(), update: vi.fn(), findOne: vi.fn() };
  const resultRepo = {
    create: (d: any) => d,
    save: vi.fn(async (d: any) => {
      saved.results.push(d);
      return d;
    }),
  };
  const contactRepo = {
    findOne: vi.fn(async () => null),
    create: (d: any) => d,
    save: vi.fn(async (d: any) => {
      const row = { id: `c${saved.contacts.length + 1}`, ...d };
      saved.contacts.push(row);
      return row;
    }),
  };
  const companyRepo = {
    findOne: vi.fn(async () => null),
    create: (d: any) => d,
    save: vi.fn(async (d: any) => {
      const row = { id: `co${saved.companies.length + 1}`, ...d };
      saved.companies.push(row);
      return row;
    }),
  };
  const ccRepo = {
    findOne: vi.fn(async () => null),
    create: (d: any) => d,
    save: vi.fn(async (d: any) => {
      saved.cc.push(d);
      return d;
    }),
  };

  return { saved, jobRepo, resultRepo, contactRepo, companyRepo, ccRepo };
}

function makeRunner(places: Partial<GooglePlacesProvider>, repos: any) {
  return new CollectionRunnerService(
    repos.jobRepo as any,
    repos.resultRepo as any,
    repos.contactRepo as any,
    repos.companyRepo as any,
    repos.ccRepo as any,
    places as GooglePlacesProvider,
  );
}

describe('CollectionRunnerService — Google Maps scraping', () => {
  let repos: ReturnType<typeof makeRepos>;

  beforeEach(() => {
    repos = makeRepos();
  });

  it('builds "<term> in <city>, <country>" queries, one per keyword', () => {
    const runner = makeRunner({ isConfigured: () => true }, repos);
    const queries = runner.buildQueries(
      makeJob({ keywords: ['buddhist tour', 'india tours'] }) as any,
    );

    expect(queries).toEqual([
      'travel agency in Bangkok, Thailand',
      'buddhist tour in Bangkok, Thailand',
      'india tours in Bangkok, Thailand',
    ]);
  });

  it('omits the city when not set, and de-duplicates repeated terms', () => {
    const runner = makeRunner({ isConfigured: () => true }, repos);
    const queries = runner.buildQueries(
      makeJob({ city: null, keywords: ['Travel Agency'] }) as any,
    );
    expect(queries).toEqual(['travel agency in Thailand']);
  });

  it('imports a place: creates company + contact, normalises phone to E.164', async () => {
    const searchText = vi
      .fn()
      .mockResolvedValueOnce({ places: [place()], nextPageToken: null });

    const runner = makeRunner(
      { isConfigured: () => true, searchText, getRequestCount: () => 0 } as any,
      repos,
    );

    const summary = await runner.executeJob(makeJob({ keywords: [] }) as any);

    expect(summary.imported).toBe(1);
    expect(summary.duplicates).toBe(0);

    // Phone normalised from "+66 2 123 4567" to E.164.
    expect(repos.saved.contacts[0].whatsapp_number).toBe('+6621234567');
    expect(repos.saved.contacts[0].source).toBe('google_maps');

    const company = repos.saved.companies[0];
    expect(company.google_place_id).toBe('p1');
    expect(company.source).toBe('google_maps');
    expect(company.rating).toBe(4.5);
  });

  it('follows nextPageToken, then advances to the next query', async () => {
    const searchText = vi
      .fn()
      .mockResolvedValueOnce({
        places: [place({ placeId: 'p1', phone: '+66 2 111 1111' })],
        nextPageToken: 'tok-1',
      })
      .mockResolvedValueOnce({
        places: [place({ placeId: 'p2', phone: '+66 2 222 2222' })],
        nextPageToken: null,
      })
      .mockResolvedValueOnce({
        places: [place({ placeId: 'p3', phone: '+66 2 333 3333' })],
        nextPageToken: null,
      });

    const runner = makeRunner(
      { isConfigured: () => true, searchText, getRequestCount: () => 0 } as any,
      repos,
    );

    const summary = await runner.executeJob(
      makeJob({ keywords: ['dmc'] }) as any,
    );

    // page1 + page2 of query 1, then query 2 → 3 requests, 3 imports.
    expect(searchText).toHaveBeenCalledTimes(3);
    expect(searchText.mock.calls[1][0].pageToken).toBe('tok-1');
    expect(searchText.mock.calls[2][0].pageToken).toBeNull();
    expect(summary.imported).toBe(3);
    expect(summary.exhausted).toBe(true);
  });

  it('stops as soon as daily_limit new contacts are reached', async () => {
    const searchText = vi.fn().mockResolvedValue({
      places: [
        place({ placeId: 'a', phone: '+66 2 111 1111' }),
        place({ placeId: 'b', phone: '+66 2 222 2222' }),
        place({ placeId: 'c', phone: '+66 2 333 3333' }),
      ],
      nextPageToken: 'more',
    });

    const runner = makeRunner(
      { isConfigured: () => true, searchText, getRequestCount: () => 0 } as any,
      repos,
    );

    const summary = await runner.executeJob(
      makeJob({ daily_limit: 2 }) as any,
    );

    expect(summary.imported).toBe(2);
    expect(searchText).toHaveBeenCalledTimes(1);
  });

  it('marks a known place_id as duplicate and does not create a contact', async () => {
    repos.companyRepo.findOne = vi.fn(async () => ({ id: 'co-existing' }));

    const searchText = vi
      .fn()
      .mockResolvedValueOnce({ places: [place()], nextPageToken: null });

    const runner = makeRunner(
      { isConfigured: () => true, searchText, getRequestCount: () => 0 } as any,
      repos,
    );

    const summary = await runner.executeJob(makeJob() as any);

    expect(summary.duplicates).toBe(1);
    expect(summary.imported).toBe(0);
    expect(repos.saved.contacts).toHaveLength(0);
    expect(repos.saved.results[0].status).toBe(
      CollectionResultStatus.DUPLICATE,
    );
  });

  it('records a listing with no usable phone as INVALID', async () => {
    const searchText = vi.fn().mockResolvedValueOnce({
      places: [place({ phone: null })],
      nextPageToken: null,
    });

    const runner = makeRunner(
      { isConfigured: () => true, searchText, getRequestCount: () => 0 } as any,
      repos,
    );

    const summary = await runner.executeJob(makeJob() as any);

    expect(summary.invalid).toBe(1);
    expect(repos.saved.contacts).toHaveLength(0);
    expect(repos.saved.results[0].status).toBe(CollectionResultStatus.INVALID);
  });

  it('persists the resume cursor so the next run continues where it stopped', async () => {
    const searchText = vi.fn().mockResolvedValue({
      places: [place({ placeId: 'x', phone: '+66 2 999 9999' })],
      nextPageToken: 'next-tok',
    });

    const runner = makeRunner(
      { isConfigured: () => true, searchText, getRequestCount: () => 0 } as any,
      repos,
    );

    await runner.executeJob(makeJob({ daily_limit: 1 }) as any);

    const update = repos.jobRepo.update.mock.calls[0][1];
    expect(update.pagination_token).toBe('next-tok');
    expect(update.total_collected).toBe(1);
  });

  it('auto-adds an imported contact to the configured campaign', async () => {
    const searchText = vi
      .fn()
      .mockResolvedValueOnce({ places: [place()], nextPageToken: null });

    const runner = makeRunner(
      { isConfigured: () => true, searchText, getRequestCount: () => 0 } as any,
      repos,
    );

    await runner.executeJob(
      makeJob({ auto_add_to_campaign_id: 'camp-1' }) as any,
    );

    expect(repos.saved.cc).toHaveLength(1);
    expect(repos.saved.cc[0].campaign_id).toBe('camp-1');
  });

  it('skips the whole cycle when no API key is configured', async () => {
    const searchText = vi.fn();
    const runner = makeRunner(
      { isConfigured: () => false, searchText } as any,
      repos,
    );

    await runner.runCollectionCycle();

    expect(repos.jobRepo.find).not.toHaveBeenCalled();
    expect(searchText).not.toHaveBeenCalled();
  });

  it('pauses the job on an auth error instead of retrying forever', async () => {
    repos.jobRepo.find = vi.fn(async () => [makeJob()]);
    const searchText = vi
      .fn()
      .mockRejectedValue(new PlacesAuthError('bad key'));

    const runner = makeRunner(
      { isConfigured: () => true, searchText, getRequestCount: () => 0 } as any,
      repos,
    );

    await runner.runCollectionCycle();

    expect(repos.jobRepo.update).toHaveBeenCalledWith('job-1', {
      status: CollectionJobStatus.PAUSED,
    });
  });
});

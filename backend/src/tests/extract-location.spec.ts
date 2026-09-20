import { describe, it, expect } from 'vitest';
import { extractLocation } from '../modules/collection/google-places.provider';

/**
 * Locks the addressComponents -> {country, state, district, city} mapping.
 *
 * Component coverage differs sharply between countries, which is exactly why this
 * is worth testing without the network: the UK omits `locality`, Indian metros often
 * only carry a `sublocality`, and Singapore has no state level at all. A regression
 * here silently degrades every contact location filter.
 */
describe('extractLocation', () => {
  const component = (longText: string, types: string[], shortText?: string) => ({
    longText,
    shortText: shortText ?? longText,
    types,
  });

  it('extracts the full hierarchy from a typical Indian address', () => {
    const result = extractLocation([
      component('Connaught Place', ['sublocality_level_1', 'sublocality']),
      component('New Delhi', ['locality']),
      component('New Delhi', ['administrative_area_level_2']),
      component('Delhi', ['administrative_area_level_1']),
      component('India', ['country'], 'IN'),
      component('110001', ['postal_code']),
    ]);

    expect(result).toEqual({
      country: 'India',
      countryCode: 'IN',
      state: 'Delhi',
      district: 'New Delhi',
      city: 'New Delhi',
      postalCode: '110001',
    });
  });

  it('falls back to postal_town for UK addresses, which omit locality', () => {
    const result = extractLocation([
      component('London', ['postal_town']),
      component('Greater London', ['administrative_area_level_2']),
      component('England', ['administrative_area_level_1']),
      component('United Kingdom', ['country'], 'GB'),
    ]);

    expect(result.city).toBe('London');
    expect(result.state).toBe('England');
    expect(result.district).toBe('Greater London');
    expect(result.countryCode).toBe('GB');
  });

  it('falls back to sublocality when neither locality nor postal_town is present', () => {
    const result = extractLocation([
      component('Shibuya', ['sublocality_level_1', 'sublocality']),
      component('Tokyo', ['administrative_area_level_1']),
      component('Japan', ['country'], 'JP'),
    ]);

    expect(result.city).toBe('Shibuya');
    expect(result.state).toBe('Tokyo');
    // No administrative_area_level_2 in the payload — must stay null, not guess.
    expect(result.district).toBeNull();
  });

  it('prefers locality over the sublocality fallbacks when both exist', () => {
    const result = extractLocation([
      component('Andheri', ['sublocality_level_1', 'sublocality']),
      component('Mumbai', ['locality']),
      component('India', ['country'], 'IN'),
    ]);

    expect(result.city).toBe('Mumbai');
  });

  it('returns nulls for a city-state with no administrative_area levels', () => {
    const result = extractLocation([
      component('Singapore', ['locality']),
      component('Singapore', ['country'], 'SG'),
    ]);

    expect(result.city).toBe('Singapore');
    expect(result.state).toBeNull();
    expect(result.district).toBeNull();
  });

  it('uppercases the country code and trims whitespace', () => {
    const result = extractLocation([
      { longText: '  France  ', shortText: ' fr ', types: ['country'] },
    ]);

    expect(result.country).toBe('France');
    expect(result.countryCode).toBe('FR');
  });

  it('returns an all-null location for missing or malformed input', () => {
    const empty = {
      country: null,
      countryCode: null,
      state: null,
      district: null,
      city: null,
      postalCode: null,
    };

    // Google omits addressComponents entirely when the field mask excludes it, so
    // every one of these shapes is reachable in production.
    expect(extractLocation(undefined)).toEqual(empty);
    expect(extractLocation(null)).toEqual(empty);
    expect(extractLocation([])).toEqual(empty);
    expect(extractLocation('not an array')).toEqual(empty);
    expect(extractLocation([{}])).toEqual(empty);
    expect(extractLocation([{ longText: 'Orphan' }])).toEqual(empty);
  });

  it('treats an empty-string component as absent rather than storing ""', () => {
    // An empty string would pass an `!== null` check downstream and show up as a
    // blank filter option, so it must normalise to null.
    const result = extractLocation([
      component('', ['administrative_area_level_1']),
      component('India', ['country'], 'IN'),
    ]);

    expect(result.state).toBeNull();
  });
});

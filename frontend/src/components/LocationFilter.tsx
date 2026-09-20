import { useCallback, useEffect, useState } from 'react';
import { Select, Flex } from 'antd';
import { contactsAPI } from '../services/endpoints';
import { space } from '../theme/tokens';

export interface LocationFilterValue {
  country?: string;
  state_region?: string;
  district?: string;
  city?: string;
  agency_type?: string;
}

interface Facets {
  countries: string[];
  states: string[];
  districts: string[];
  cities: string[];
  agencyTypes: string[];
}

const EMPTY_FACETS: Facets = {
  countries: [],
  states: [],
  districts: [],
  cities: [],
  agencyTypes: [],
};

interface LocationFilterProps {
  value: LocationFilterValue;
  onChange: (value: LocationFilterValue) => void;
  /** Hide the agency-type select where it isn't useful. */
  showAgencyType?: boolean;
  size?: 'small' | 'middle' | 'large';
}

/**
 * Cascading Country → State → District → City filter.
 *
 * Options come from `GET /contacts/locations`, i.e. the values actually present in
 * the database. The previous Contacts filter hardcoded eight countries, so contacts
 * collected anywhere else were unfilterable — and picking a country that had no data
 * silently returned nothing.
 *
 * Selecting a broader level clears the narrower ones, because a state from a
 * different country would produce a guaranteed-empty result set.
 *
 * Shared between the Contacts page and the campaign audience builder so a saved
 * audience filter means the same thing in both places.
 */
export default function LocationFilter({
  value,
  onChange,
  showAgencyType = false,
  size = 'middle',
}: LocationFilterProps) {
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await contactsAPI.locations({
        country: value.country,
        state_region: value.state_region,
      });
      setFacets({ ...EMPTY_FACETS, ...data });
    } catch {
      // A facet outage must not block filtering; the selects just show no options.
      setFacets(EMPTY_FACETS);
    } finally {
      setLoading(false);
    }
  }, [value.country, value.state_region]);

  useEffect(() => {
    load();
  }, [load]);

  const toOptions = (values: string[]) =>
    values.map((v) => ({ label: v, value: v }));

  return (
    <Flex gap={space.sm} wrap>
      <Select
        placeholder="All countries"
        aria-label="Filter by country"
        allowClear
        showSearch
        size={size}
        loading={loading}
        style={{ minWidth: 150 }}
        value={value.country}
        options={toOptions(facets.countries)}
        // Clearing the parent must clear its children, or the query keeps a
        // state/district that cannot co-exist with the new country.
        onChange={(country) => onChange({ ...value, country, state_region: undefined, district: undefined, city: undefined })}
        notFoundContent={loading ? 'Loading…' : 'No countries yet'}
      />

      <Select
        placeholder="All states"
        aria-label="Filter by state or province"
        allowClear
        showSearch
        size={size}
        loading={loading}
        style={{ minWidth: 150 }}
        value={value.state_region}
        options={toOptions(facets.states)}
        onChange={(state_region) => onChange({ ...value, state_region, district: undefined })}
        // Disabled rather than hidden so the hierarchy stays visible and the layout
        // does not shift as selections are made.
        disabled={facets.states.length === 0}
        notFoundContent={loading ? 'Loading…' : 'No states for this country'}
      />

      <Select
        placeholder="All districts"
        aria-label="Filter by district"
        allowClear
        showSearch
        size={size}
        loading={loading}
        style={{ minWidth: 150 }}
        value={value.district}
        options={toOptions(facets.districts)}
        onChange={(district) => onChange({ ...value, district })}
        disabled={facets.districts.length === 0}
        notFoundContent={loading ? 'Loading…' : 'No districts available'}
      />

      <Select
        placeholder="All cities"
        aria-label="Filter by city"
        allowClear
        showSearch
        size={size}
        loading={loading}
        style={{ minWidth: 150 }}
        value={value.city}
        options={toOptions(facets.cities)}
        onChange={(city) => onChange({ ...value, city })}
        disabled={facets.cities.length === 0}
        notFoundContent={loading ? 'Loading…' : 'No cities available'}
      />

      {showAgencyType && (
        <Select
          placeholder="All types"
          aria-label="Filter by business type"
          allowClear
          showSearch
          size={size}
          loading={loading}
          style={{ minWidth: 160 }}
          value={value.agency_type}
          options={toOptions(facets.agencyTypes)}
          onChange={(agency_type) => onChange({ ...value, agency_type })}
          disabled={facets.agencyTypes.length === 0}
          notFoundContent={loading ? 'Loading…' : 'No types available'}
        />
      )}
    </Flex>
  );
}

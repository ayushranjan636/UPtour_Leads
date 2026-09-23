import { useCallback, useEffect, useState } from 'react';
import { Select, Flex } from 'antd';
import { contactsAPI } from '../services/endpoints';
import { space } from '../theme/tokens';

/**
 * Every level is multi-valued because the API now takes repeatable params and an
 * audience is rarely one city: "Agra or Varanasi" was previously two separate
 * passes through the builder.
 */
export interface LocationFilterValue {
  country?: string[];
  state_region?: string[];
  district?: string[];
  city?: string[];
  agency_type?: string[];
}

export const EMPTY_LOCATION_FILTER: LocationFilterValue = {};

/** True when no level is set, i.e. the filter contributes nothing to a query. */
export function isLocationFilterEmpty(value: LocationFilterValue): boolean {
  return Object.values(value).every((v) => !v || v.length === 0);
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
 * Cascading Country → State → District → City filter, multi-select at every level.
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

  /*
   * `GET /contacts/locations` narrows by a single parent value. With several
   * countries picked there is no single parent to narrow by, so we ask for the
   * unnarrowed list instead of arbitrarily choosing one — offering only the first
   * country's states would hide the others' entirely.
   */
  const scopeCountry = value.country?.length === 1 ? value.country[0] : undefined;
  const scopeState = value.state_region?.length === 1 ? value.state_region[0] : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await contactsAPI.locations({
        country: scopeCountry,
        state_region: scopeState,
      });
      setFacets({ ...EMPTY_FACETS, ...data });
    } catch {
      // A facet outage must not block filtering; the selects just show no options.
      setFacets(EMPTY_FACETS);
    } finally {
      setLoading(false);
    }
  }, [scopeCountry, scopeState]);

  useEffect(() => {
    load();
  }, [load]);

  const toOptions = (values: string[]) =>
    values.map((v) => ({ label: v, value: v }));

  /**
   * antd hands back `undefined` when a multi-select is cleared; normalise to a real
   * array so callers never have to test for both shapes.
   */
  const asList = (next: string[] | undefined) => next ?? [];

  /*
   * A level stays enabled whenever it already holds a selection, even if the facet
   * list came back empty — disabling it would strand a value the operator cannot
   * then remove.
   */
  const lockedOut = (options: string[], current?: string[]) =>
    options.length === 0 && !current?.length;

  return (
    <Flex gap={space.sm} wrap>
      <Select
        mode="multiple"
        placeholder="All countries"
        aria-label="Filter by country"
        allowClear
        showSearch
        maxTagCount="responsive"
        size={size}
        loading={loading}
        style={{ minWidth: 160 }}
        value={value.country ?? []}
        options={toOptions(facets.countries)}
        // Clearing the parent must clear its children, or the query keeps a
        // state/district that cannot co-exist with the new country.
        onChange={(country: string[] | undefined) =>
          onChange({
            ...value,
            country: asList(country),
            state_region: [],
            district: [],
            city: [],
          })
        }
        notFoundContent={loading ? 'Loading…' : 'No countries yet'}
      />

      <Select
        mode="multiple"
        placeholder="All states"
        aria-label="Filter by state or province"
        allowClear
        showSearch
        maxTagCount="responsive"
        size={size}
        loading={loading}
        style={{ minWidth: 160 }}
        value={value.state_region ?? []}
        options={toOptions(facets.states)}
        onChange={(state_region: string[] | undefined) =>
          onChange({ ...value, state_region: asList(state_region), district: [] })
        }
        // Disabled rather than hidden so the hierarchy stays visible and the layout
        // does not shift as selections are made.
        disabled={lockedOut(facets.states, value.state_region)}
        notFoundContent={loading ? 'Loading…' : 'No states for this country'}
      />

      <Select
        mode="multiple"
        placeholder="All districts"
        aria-label="Filter by district"
        allowClear
        showSearch
        maxTagCount="responsive"
        size={size}
        loading={loading}
        style={{ minWidth: 160 }}
        value={value.district ?? []}
        options={toOptions(facets.districts)}
        onChange={(district: string[] | undefined) =>
          onChange({ ...value, district: asList(district) })
        }
        disabled={lockedOut(facets.districts, value.district)}
        notFoundContent={loading ? 'Loading…' : 'No districts available'}
      />

      <Select
        mode="multiple"
        placeholder="All cities"
        aria-label="Filter by city"
        allowClear
        showSearch
        maxTagCount="responsive"
        size={size}
        loading={loading}
        style={{ minWidth: 160 }}
        value={value.city ?? []}
        options={toOptions(facets.cities)}
        onChange={(city: string[] | undefined) => onChange({ ...value, city: asList(city) })}
        disabled={lockedOut(facets.cities, value.city)}
        notFoundContent={loading ? 'Loading…' : 'No cities available'}
      />

      {showAgencyType && (
        <Select
          mode="multiple"
          placeholder="All types"
          aria-label="Filter by business type"
          allowClear
          showSearch
          maxTagCount="responsive"
          size={size}
          loading={loading}
          style={{ minWidth: 170 }}
          value={value.agency_type ?? []}
          options={toOptions(facets.agencyTypes)}
          onChange={(agency_type: string[] | undefined) =>
            onChange({ ...value, agency_type: asList(agency_type) })
          }
          disabled={lockedOut(facets.agencyTypes, value.agency_type)}
          notFoundContent={loading ? 'Loading…' : 'No types available'}
        />
      )}
    </Flex>
  );
}

import { useEffect, useState } from 'react';
import { Select } from 'antd';
import { contactsAPI, type ContactDatasets } from '../services/endpoints';

/**
 * The two dataset kinds the API filters on, kept as separate id lists because the
 * backend joins them through different tables (`collection_results` vs
 * `contacts.import_file_id`).
 */
export interface DatasetFilterValue {
  collection_job_ids: string[];
  import_file_ids: string[];
}

export const EMPTY_DATASET_FILTER: DatasetFilterValue = {
  collection_job_ids: [],
  import_file_ids: [],
};

/** True when no dataset is selected, i.e. the filter contributes nothing. */
export function isDatasetFilterEmpty(value: DatasetFilterValue): boolean {
  return value.collection_job_ids.length === 0 && value.import_file_ids.length === 0;
}

interface DatasetFilterProps {
  value: DatasetFilterValue;
  onChange: (value: DatasetFilterValue) => void;
  size?: 'small' | 'middle' | 'large';
  style?: React.CSSProperties;
}

/*
 * antd's Select carries a single flat list of values, but a selection here has to
 * say *which kind* of dataset each id is: the same UUID space is shared by
 * collection jobs and import files, and the API takes them as two distinct params.
 * So option values are namespaced (`job:<id>` / `import:<id>`) internally and split
 * back into the two arrays in onChange. The prefixes never leave this component.
 */
const JOB_PREFIX = 'job:';
const IMPORT_PREFIX = 'import:';

/**
 * Multi-select over the datasets that produced contacts — one collection job or one
 * CSV import each.
 *
 * Location filters cannot express "just this scrape": two runs over the same city
 * are indistinguishable by country/state/city, so an audience built that way
 * silently includes contacts from every other run. Picking the dataset directly is
 * the only exact way to say it.
 *
 * Shared by the Contacts filter bar, the campaign audience builder and the
 * Conversations list so "this dataset" means the same thing everywhere.
 */
export default function DatasetFilter({
  value,
  onChange,
  size = 'middle',
  style,
}: DatasetFilterProps) {
  const [datasets, setDatasets] = useState<ContactDatasets>({
    collectionJobs: [],
    imports: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await contactsAPI.datasets();
        if (cancelled) return;
        setDatasets({
          collectionJobs: data?.collectionJobs ?? [],
          imports: data?.imports ?? [],
        });
      } catch {
        // A dataset-list outage must never take the page down with it: the select
        // stays mounted and usable, just with no options to offer.
        if (!cancelled) setDatasets({ collectionJobs: [], imports: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const countLabel = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'contact' : 'contacts'}`;

  // Labels are plain strings, not nodes, so `optionFilterProp="label"` can actually
  // match against them when the operator types.
  const groups = [
    {
      label: 'Collected datasets',
      options: datasets.collectionJobs.map((d) => ({
        label: `${d.name} (${countLabel(d.contactCount)})`,
        value: `${JOB_PREFIX}${d.id}`,
      })),
    },
    {
      label: 'Imported files',
      options: datasets.imports.map((d) => ({
        label: `${d.name} (${countLabel(d.contactCount)})`,
        value: `${IMPORT_PREFIX}${d.id}`,
      })),
    },
  ].filter((g) => g.options.length > 0);

  const selected = [
    ...value.collection_job_ids.map((v) => `${JOB_PREFIX}${v}`),
    ...value.import_file_ids.map((v) => `${IMPORT_PREFIX}${v}`),
  ];

  const handleChange = (next: string[]) => {
    onChange({
      collection_job_ids: next
        .filter((v) => v.startsWith(JOB_PREFIX))
        .map((v) => v.slice(JOB_PREFIX.length)),
      import_file_ids: next
        .filter((v) => v.startsWith(IMPORT_PREFIX))
        .map((v) => v.slice(IMPORT_PREFIX.length)),
    });
  };

  return (
    <Select
      mode="multiple"
      placeholder="All datasets"
      aria-label="Filter by dataset"
      allowClear
      showSearch
      optionFilterProp="label"
      maxTagCount="responsive"
      size={size}
      loading={loading}
      style={{ minWidth: 220, ...style }}
      value={selected}
      options={groups}
      onChange={handleChange}
      notFoundContent={loading ? 'Loading…' : 'No datasets yet'}
    />
  );
}

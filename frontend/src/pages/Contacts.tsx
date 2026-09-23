import { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Input,
  AutoComplete,
  Modal,
  Form,
  Typography,
  Flex,
  Spin,
  Empty,
  message,
  Popconfirm,
  Tooltip,
  Select,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  GlobalOutlined,
  StopOutlined,
  SafetyCertificateOutlined,
  ContactsOutlined,
  EditOutlined,
  DeleteOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import LocationFilter, {
  isLocationFilterEmpty,
  type LocationFilterValue,
} from '../components/LocationFilter';
import DatasetFilter, {
  EMPTY_DATASET_FILTER,
  isDatasetFilterEmpty,
  type DatasetFilterValue,
} from '../components/DatasetFilter';
import { contactsAPI } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

interface Contact {
  id: string;
  name: string;
  whatsapp_number: string;
  email?: string;
  phone?: string;
  designation?: string;
  company_id?: string;
  is_opted_out?: boolean;
  is_whatsapp_verified?: boolean;
  created_at?: string;
  /**
   * Location lives on the company, not the contact. The old code declared a
   * top-level `country` and rendered a column from it, which was always undefined —
   * so every row showed a dash.
   */
  company?: {
    name?: string;
    country?: string;
    state_region?: string;
    district?: string;
    city?: string;
  };
}

/** Company attributes captured by the contact form; not columns on `contacts`. */
const COMPANY_FIELDS = ['company_name', 'country', 'state_region', 'city'] as const;

/**
 * Trim every string and drop the blanks.
 *
 * A blank `company_name` must be absent rather than `''`, or the backend would try
 * to resolve a company named "" and attach the contact to it.
 */
function cleanPayload(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) out[key] = trimmed;
    } else if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out;
}

export default function Contacts() {
  const [data, setData] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState<LocationFilterValue>({});
  const [datasets, setDatasets] = useState<DatasetFilterValue>(EMPTY_DATASET_FILTER);
  /** Selected contact groups (tags). Multi-valued: several groups mean "in any of them". */
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** Row selection for bulk actions. Survives pagination via preserveSelectedRowKeys. */
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  /** Which bulk action is in flight, so only that button shows a spinner. */
  const [bulkBusy, setBulkBusy] = useState<'group' | 'verify' | 'delete' | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [existingGroups, setExistingGroups] = useState<{ name: string; contactCount: number }[]>([]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: pageSize };
      if (search) params.search = search;
      // Only send levels that have a value; an empty array would serialise to
      // nothing useful and an undefined one to the literal "undefined".
      for (const [key, value] of Object.entries(location)) {
        if (value?.length) params[key] = value;
      }
      if (groupFilter.length) params.groups = groupFilter;
      if (datasets.collection_job_ids.length) {
        params.collection_job_ids = datasets.collection_job_ids;
      }
      if (datasets.import_file_ids.length) {
        params.import_file_ids = datasets.import_file_ids;
      }
      const { data: res } = await contactsAPI.list(params);
      setData(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      message.error('Failed to load contacts');
    } finally {
      setLoading(false);
    }
    // `location` and `datasets` are objects rebuilt on every change, so depend on
    // their serialised form to avoid refetching when nothing actually changed.
  }, [page, pageSize, search, JSON.stringify(location), JSON.stringify(datasets), JSON.stringify(groupFilter)]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = cleanPayload(values);
      if (editingContact) {
        // PATCH /contacts/:id assigns the body straight onto the contact row, so the
        // company/location keys are stripped here — they belong to the company record
        // and are only accepted on create, where the backend resolves them.
        for (const key of COMPANY_FIELDS) delete payload[key];
        await contactsAPI.update(editingContact.id, payload);
        message.success('Contact updated');
      } else {
        await contactsAPI.create(payload);
        message.success('Contact created');
      }
      setModalOpen(false);
      setEditingContact(null);
      form.resetFields();
      fetchContacts();
    } catch {
      /* validation error or API error */
    } finally {
      setSaving(false);
    }
  };

  const handleOptOut = async (id: string) => {
    try {
      await contactsAPI.optOut(id);
      message.success('Contact opted out');
      fetchContacts();
    } catch {
      message.error('Failed to opt out contact');
    }
  };

  const handleVerify = async (id: string) => {
    try {
      await contactsAPI.verifyWhatsApp(id);
      message.success('WhatsApp verification initiated');
      fetchContacts();
    } catch {
      message.error('Verification failed');
    }
  };

  /**
   * Bulk actions.
   *
   * Each reports what actually happened rather than assuming success — the server
   * returns per-id outcomes, and "18 of 20 verified, 2 not on WhatsApp" is materially
   * different from "done".
   */
  // Refresh the label list each time the modal opens rather than once on mount, so a
  // group created moments ago in another tab still appears.
  useEffect(() => {
    let cancelled = false;
    contactsAPI
      .groups()
      .then(({ data }) => { if (!cancelled) setExistingGroups(data ?? []); })
      // A failed lookup only costs the suggestions; typing a new name still works.
      .catch(() => { if (!cancelled) setExistingGroups([]); });
    return () => { cancelled = true; };
    // Re-read after any bulk action so counts and new labels stay current.
  }, [groupModalOpen, total]);

  const handleBulkVerify = async () => {
    setBulkBusy('verify');
    try {
      const { data } = await contactsAPI.bulkVerify(selectedRowKeys);
      const parts = [`${data.verified} verified`];
      if (data.suppressed) parts.push(`${data.suppressed} not on WhatsApp`);
      if (data.failed) parts.push(`${data.failed} could not be checked`);
      message.success(parts.join(' · '));
      fetchContacts();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(detail ?? 'Verification failed. Check that WhatsApp is connected.');
    } finally {
      setBulkBusy(null);
    }
  };

  const handleBulkDelete = async () => {
    setBulkBusy('delete');
    // Row count on the current page, captured before the delete so we can tell whether
    // the page will be left empty.
    const data_length = data.length;
    try {
      const { data } = await contactsAPI.bulkDelete(selectedRowKeys);
      if (data.failed?.length) {
        message.warning(`Deleted ${data.deleted}; ${data.failed.length} could not be removed`);
      } else {
        message.success(`Deleted ${data.deleted} contact${data.deleted === 1 ? '' : 's'}`);
      }
      setSelectedRowKeys([]);
      // Step back a page if we just emptied the last one.
      if (data.deleted >= data_length && page > 1) setPage(page - 1);
      else fetchContacts();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(detail ?? 'Could not delete the selected contacts');
    } finally {
      setBulkBusy(null);
    }
  };

  const handleBulkGroup = async () => {
    const label = groupName.trim();
    if (!label) return;
    setBulkBusy('group');
    try {
      const { data } = await contactsAPI.bulkGroup(selectedRowKeys, label);
      message.success(
        data.updated > 0
          ? `Added ${data.updated} contact${data.updated === 1 ? '' : 's'} to "${data.group}"`
          : `All selected contacts were already in "${data.group}"`,
      );
      setGroupModalOpen(false);
      setGroupName('');
      setSelectedRowKeys([]);
      fetchContacts();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(detail ?? 'Could not add the contacts to that group');
    } finally {
      setBulkBusy(null);
    }
  };

  const handleDelete = async (record: Contact) => {
    setDeletingId(record.id);
    try {
      await contactsAPI.remove(record.id);
      message.success(`Deleted ${record.name}`);
      // Stepping back a page avoids landing on an empty final page after deleting
      // the only row on it.
      if (data.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        fetchContacts();
      }
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(detail ?? 'Could not delete this contact');
    } finally {
      setDeletingId(null);
    }
  };

  const openEdit = (record: Contact) => {
    setEditingContact(record);
    // Reset first: the form instance is shared with the create flow, so a previously
    // typed company/location would otherwise linger invisibly.
    form.resetFields();
    form.setFieldsValue({
      name: record.name,
      whatsapp_number: record.whatsapp_number,
      email: record.email,
      phone: record.phone,
      designation: record.designation,
    });
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditingContact(null);
    form.resetFields();
    setModalOpen(true);
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Contact) => (
        <div style={{ minWidth: 0 }}>
          <Text strong style={{ display: 'block' }}>{name}</Text>
          {record.email && (
            <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
              {record.email}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'WhatsApp',
      dataIndex: 'whatsapp_number',
      key: 'whatsapp_number',
      render: (w: string) => (
        <Text style={{ fontSize: font.size.footnote }}>{w}</Text>
      ),
    },
    {
      // Replaces a "Country" column bound to `contact.country`, a field that does not
      // exist — it rendered a dash for every row. Location lives on the company.
      title: 'Location',
      key: 'location',
      render: (_: unknown, record: Contact) => {
        const c = record.company;
        // City and state are the useful pair for outreach; district is often a
        // "…Division" administrative label that adds noise without aiding scanning.
        const primary = [c?.city, c?.state_region].filter(Boolean).join(', ');
        if (!primary && !c?.country) {
          return <Text style={{ color: color.textTertiary }}>—</Text>;
        }
        return (
          <div style={{ minWidth: 0 }}>
            {primary && (
              <Text style={{ fontSize: font.size.footnote, display: 'block' }}>{primary}</Text>
            )}
            {c?.country && (
              <Flex align="center" gap={4}>
                <GlobalOutlined style={{ color: color.textTertiary, fontSize: 11 }} />
                <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                  {c.country}
                </Text>
              </Flex>
            )}
          </div>
        );
      },
    },
    {
      title: 'Company',
      key: 'company',
      render: (_: unknown, record: Contact) =>
        record.company?.name || <Text style={{ color: color.textTertiary }}>—</Text>,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: unknown, record: Contact) => {
        if (record.is_opted_out) return <StatusTag status="opted_out" />;
        if (record.is_whatsapp_verified) return <StatusTag status="verified" />;
        return <StatusTag status="pending" />;
      },
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      align: 'right' as const,
      render: (_: unknown, record: Contact) => (
        <Flex gap={2} justify="flex-end" align="center">
          <Tooltip title="Edit contact">
            <Button
              size="small"
              type="text"
              aria-label={`Edit ${record.name}`}
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
            />
          </Tooltip>
          <Tooltip title="Verify on WhatsApp">
            <Button
              size="small"
              type="text"
              aria-label={`Verify ${record.name}`}
              icon={<SafetyCertificateOutlined />}
              onClick={() => handleVerify(record.id)}
            />
          </Tooltip>
          {!record.is_opted_out && (
            <Popconfirm
              title="Stop messaging this contact?"
              description="They stay in your records but receive no further messages."
              okText="Opt Out"
              cancelText="Cancel"
              onConfirm={() => handleOptOut(record.id)}
            >
              {/* Same reason as Delete below: no Tooltip wrapper inside a Popconfirm. */}
              <Button
                size="small"
                type="text"
                title="Opt out"
                aria-label={`Opt out ${record.name}`}
                icon={<StopOutlined />}
              />
            </Popconfirm>
          )}
          {/* Permanent delete. Kept visually quiet (text button, danger colour only
              on the icon) so it never competes with routine actions, and always
              gated behind an explicit confirmation naming the consequence.
              The button carries its own aria-label rather than a Tooltip: a tooltip
              here renders above the Popconfirm (z-index 1200 vs 1060) and can
              swallow the click on its own Delete button. */}
          <Popconfirm
            title={`Delete ${record.name}?`}
            description="This also removes their messages, campaign history and leads. This cannot be undone."
            okText="Delete"
            okButtonProps={{ danger: true }}
            cancelText="Cancel"
            onConfirm={() => handleDelete(record)}
          >
            <Button
              size="small"
              type="text"
              danger
              loading={deletingId === record.id}
              title="Delete contact"
              aria-label={`Delete ${record.name}`}
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Flex>
      ),
    },
  ];

  // The designed empty state is only right when the dataset itself is empty. With a
  // search or filter applied, the table's own "no matches" state is the honest answer.
  const hasFilters =
    !!search || !isLocationFilterEmpty(location) || !isDatasetFilterEmpty(datasets);

  if (!loading && data.length === 0 && !hasFilters) {
    return (
      <div>
        <PageHeader title="Contacts" subtitle="No contacts yet" />
        <Flex justify="center" style={{ padding: '72px 0' }}>
          <Empty
            image={<ContactsOutlined style={{ fontSize: 48, color: color.textTertiary }} />}
            description={
              <div style={{ marginTop: space.md }}>
                <Text
                  strong
                  style={{
                    fontSize: font.size.headline,
                    display: 'block',
                    marginBottom: 4,
                    color: color.text,
                  }}
                >
                  Add your first contact
                </Text>
                <Text style={{ color: color.textSecondary }}>
                  Import a list, collect from Google Maps, or add one manually.
                </Text>
              </div>
            }
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Contact
            </Button>
          </Empty>
        </Flex>
        <Modal
          title="Add Contact"
          open={modalOpen}
          onOk={handleSave}
          confirmLoading={saving}
          onCancel={() => { setModalOpen(false); form.resetFields(); }}
          okText="Create"
          width={520}
        >
          <ContactForm form={form} showCompanyFields />
        </Modal>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={`${total.toLocaleString()} ${total === 1 ? 'contact' : 'contacts'}`}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add Contact
          </Button>
        }
      />

      <Flex gap={space.sm} wrap style={{ marginBottom: space.lg }} align="center">
        <Input
          placeholder="Search name, number, company, or email"
          aria-label="Search contacts"
          prefix={<SearchOutlined style={{ color: color.textTertiary }} />}
          style={{ maxWidth: 300, flex: '1 1 220px' }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          allowClear
        />
        <LocationFilter
          value={location}
          onChange={(next) => { setLocation(next); setPage(1); }}
          showAgencyType
        />
        {/* Narrows to the contacts produced by one scrape or upload — something the
            location filters cannot express, since two runs over the same city look
            identical to them. */}
        <DatasetFilter
          value={datasets}
          onChange={(next) => { setDatasets(next); setPage(1); }}
        />
        {/* Group filter. Populated from the labels in use, so it only ever offers
            groups that actually exist. */}
        <Select
          mode="multiple"
          placeholder="All groups"
          aria-label="Filter by group"
          allowClear
          maxTagCount="responsive"
          style={{ minWidth: 170 }}
          value={groupFilter}
          onChange={(next: string[]) => { setGroupFilter(next); setPage(1); }}
          options={existingGroups.map((g) => ({
            value: g.name,
            label: `${g.name} (${g.contactCount})`,
          }))}
          notFoundContent="No groups yet"
        />
      </Flex>

      {/*
        Bulk toolbar. Only rendered when something is selected, so it never competes
        with the filters for attention, and it reports the count explicitly because a
        selection can span pages and is easy to lose track of.
      */}
      {selectedRowKeys.length > 0 && (
        <Flex
          align="center"
          gap={space.sm}
          wrap
          style={{
            marginBottom: space.md,
            padding: `${space.sm}px ${space.md}px`,
            background: color.accentSoft,
            border: `1px solid ${color.separator}`,
            borderRadius: radius.lg,
          }}
        >
          <Text strong style={{ fontSize: font.size.footnote }}>
            {selectedRowKeys.length} selected
          </Text>
          <Button size="small" onClick={() => setSelectedRowKeys([])}>
            Clear
          </Button>

          <div style={{ width: 1, height: 20, background: color.separator }} aria-hidden />

          <Button
            size="small"
            icon={<TagsOutlined />}
            onClick={() => setGroupModalOpen(true)}
            loading={bulkBusy === 'group'}
          >
            Add to group
          </Button>
          <Button
            size="small"
            icon={<SafetyCertificateOutlined />}
            onClick={handleBulkVerify}
            loading={bulkBusy === 'verify'}
          >
            Verify on WhatsApp
          </Button>
          {/* Destructive, so it sits last, is styled danger, and is gated behind a
              confirmation naming the consequence. No Tooltip wrapper — inside a
              Popconfirm a tooltip renders above it and swallows the click. */}
          <Popconfirm
            title={`Delete ${selectedRowKeys.length} contact${selectedRowKeys.length === 1 ? '' : 's'}?`}
            description="This also removes their messages, campaign history and leads. It cannot be undone."
            okText="Delete"
            okButtonProps={{ danger: true }}
            cancelText="Cancel"
            onConfirm={handleBulkDelete}
          >
            <Button size="small" danger icon={<DeleteOutlined />} loading={bulkBusy === 'delete'}>
              Delete
            </Button>
          </Popconfirm>
        </Flex>
      )}

      <Spin spinning={loading}>
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          size="middle"
          // Row selection drives the bulk toolbar above. `preserveSelectedRowKeys` keeps
          // a selection alive across pagination, so an operator can gather contacts from
          // several pages before acting on them.
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as string[]),
            preserveSelectedRowKeys: true,
          }}
          // Keeps the action column reachable instead of squashing cells on mobile.
          scroll={{ x: 'max-content' }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `${t.toLocaleString()} ${t === 1 ? 'contact' : 'contacts'}`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
          style={{
            background: color.surface,
            borderRadius: radius.xl,
            overflow: 'hidden',
            border: `1px solid ${color.separator}`,
          }}
        />
      </Spin>

      {/*
        Group modal. Offers the labels already in use as options while still accepting a
        new one, so "Agra agencies" does not end up alongside "agra agencies" — the
        server dedupes case-insensitively, but suggesting the existing spelling avoids
        the confusion in the first place.
      */}
      <Modal
        title={`Add ${selectedRowKeys.length} contact${selectedRowKeys.length === 1 ? '' : 's'} to a group`}
        open={groupModalOpen}
        onOk={handleBulkGroup}
        confirmLoading={bulkBusy === 'group'}
        okText="Add to group"
        okButtonProps={{ disabled: !groupName.trim() }}
        onCancel={() => { setGroupModalOpen(false); setGroupName(''); }}
        width={420}
      >
        <AutoComplete
          value={groupName}
          onChange={setGroupName}
          options={existingGroups.map((g) => ({
            value: g.name,
            label: `${g.name} (${g.contactCount})`,
          }))}
          filterOption={(input, option) =>
            String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
          }
          placeholder="e.g. Agra agencies"
          aria-label="Group name"
          style={{ width: '100%' }}
        />
        <Text
          style={{
            fontSize: font.size.caption,
            color: color.textSecondary,
            display: 'block',
            marginTop: space.sm,
          }}
        >
          A contact can belong to several groups. You can then target a group directly
          when building a campaign audience.
        </Text>
      </Modal>

      <Modal
        title={editingContact ? 'Edit Contact' : 'Add Contact'}
        open={modalOpen}
        onOk={handleSave}
        confirmLoading={saving}
        onCancel={() => {
          setModalOpen(false);
          setEditingContact(null);
          form.resetFields();
        }}
        okText={editingContact ? 'Save' : 'Create'}
        width={520}
      >
        {/* Company and location are resolved server-side only on create, so they are
            offered for a new contact and left to the company record on edit. */}
        <ContactForm form={form} showCompanyFields={!editingContact} />
      </Modal>
    </div>
  );
}

/** Countries already common in the data, offered as suggestions — free text still wins. */
const COUNTRY_SUGGESTIONS = [
  'India',
  'United States',
  'United Kingdom',
  'United Arab Emirates',
  'Singapore',
  'Australia',
  'Germany',
  'France',
  'Japan',
  'Canada',
].map((c) => ({ label: c, value: c }));

function ContactForm({
  form,
  showCompanyFields = false,
}: {
  form: ReturnType<typeof Form.useForm>[0];
  /** Only create accepts company/location; PATCH would write them to the contact row. */
  showCompanyFields?: boolean;
}) {
  return (
    <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
      <Form.Item
        name="name"
        label="Name"
        rules={[{ required: true, message: 'Name is required' }]}
      >
        <Input placeholder="Contact name" />
      </Form.Item>
      <Form.Item
        name="whatsapp_number"
        label="WhatsApp Number"
        rules={[{ required: true, message: 'WhatsApp number is required' }]}
      >
        <Input placeholder="+91XXXXXXXXXX" />
      </Form.Item>
      <Form.Item name="email" label="Email">
        <Input placeholder="email@example.com" />
      </Form.Item>
      <Form.Item name="phone" label="Phone">
        <Input placeholder="Phone number" />
      </Form.Item>
      <Form.Item name="designation" label="Designation">
        <Input placeholder="e.g. Sales Manager" />
      </Form.Item>

      {showCompanyFields && (
        <>
          {/* A quiet section heading rather than a card or divider: this is still one
              form, and the grouping only needs to be legible, not emphasised. */}
          <div style={{ marginTop: space.lg, marginBottom: space.md }}>
            <Text
              strong
              style={{
                display: 'block',
                fontSize: font.size.footnote,
                color: color.textSecondary,
              }}
            >
              Company & location
            </Text>
            <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>
              Location is stored on the company, not the contact. Filling it in is what
              makes this contact reachable by the campaign location filters — without it
              they are invisible to every country, state and city audience.
            </Text>
          </div>

          <Form.Item name="company_name" label="Company / Agency">
            <Input placeholder="e.g. Wanderlust Tours" />
          </Form.Item>
          <Form.Item name="country" label="Country">
            {/* AutoComplete, not a closed Select: the data spans whatever was
                collected, so a fixed country list would make some contacts
                unenterable. Suggestions speed up the common cases; the value is
                always a plain string, which is what the API expects. */}
            <AutoComplete
              placeholder="e.g. India"
              aria-label="Country"
              allowClear
              options={COUNTRY_SUGGESTIONS}
              filterOption={(input, option) =>
                (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="state_region" label="State / Province">
            <Input placeholder="Optional — e.g. Uttar Pradesh" />
          </Form.Item>
          <Form.Item name="city" label="City">
            <Input placeholder="e.g. Agra" />
          </Form.Item>
        </>
      )}
    </Form>
  );
}

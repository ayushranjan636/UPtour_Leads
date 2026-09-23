import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card,
  Table,
  Tabs,
  Button,
  Typography,
  Flex,
  Row,
  Col,
  Spin,
  Empty,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  message,
  Popconfirm,
  Alert,
  Divider,
} from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  SendOutlined,
  CheckCircleOutlined,
  EyeOutlined,
  MessageOutlined,
  FunnelPlotOutlined,
  PercentageOutlined,
  DeleteOutlined,
  SearchOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import StatusTag from '../components/StatusTag';
import LocationFilter, { type LocationFilterValue } from '../components/LocationFilter';
import DatasetFilter, {
  EMPTY_DATASET_FILTER,
  type DatasetFilterValue,
} from '../components/DatasetFilter';
import {
  campaignsAPI,
  templatesAPI,
  contactsAPI,
  engineAPI,
} from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;
const { TextArea } = Input;

interface CampaignData {
  id: string;
  name: string;
  product?: string;
  target_country?: string;
  status: string;
  description?: string;
  daily_send_limit?: number;
  send_window_start?: string;
  send_window_end?: string;
}

interface CampaignStats {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  leads: number;
}

interface CampaignContact {
  id: string;
  name: string;
  whatsapp_number: string;
  email?: string;
  /** Status of the enrolment (pending/sent/replied/…), not of the contact record. */
  status?: string;
  mode?: string;
  /** Location lives on the company, never on the contact itself. */
  company?: {
    name?: string;
    country?: string;
    state_region?: string;
    district?: string;
    city?: string;
  };
}

/** Shape of `GET /campaigns/:id/send-preview`. */
interface SendPreview {
  campaign: {
    id: string;
    name: string;
    status: string;
    daily_send_limit?: number;
    send_window_start?: string;
    send_window_end?: string;
    send_window_timezone?: string;
  };
  audience: {
    total: number;
    sendable: number;
    pending: number;
    alreadyProcessed: number;
    unverified: number;
  };
  excluded: {
    optedOut: number;
    suppressed: number;
    reasons: { reason: string; count: number }[];
  };
  schedule: { estimatedDays: number; firstDayCount: number };
  templates: Template[];
  blockers: string[];
}

interface Template {
  id: string;
  name: string;
  body: string;
  type?: string;
  sequence_order: number;
  trigger_condition?: string;
}

interface DistPlanSlot {
  time: string;
  count: number;
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<CampaignData | null>(null);
  const [stats, setStats] = useState<CampaignStats>({ sent: 0, delivered: 0, read: 0, replied: 0, leads: 0 });
  const [contacts, setContacts] = useState<CampaignContact[]>([]);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [contactsPage, setContactsPage] = useState(1);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [distPlan, setDistPlan] = useState<DistPlanSlot[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── Audience builder ──────────────────────────────
   * Two ways in: a server-resolved filter (no size ceiling) and hand-picking.
   */
  const [addContactModal, setAddContactModal] = useState(false);
  const [addTab, setAddTab] = useState<'filter' | 'manual'>('filter');

  // "By filter" tab
  const [audienceFilter, setAudienceFilter] = useState<LocationFilterValue>({});
  const [audienceDatasets, setAudienceDatasets] =
    useState<DatasetFilterValue>(EMPTY_DATASET_FILTER);
  /** Saved contact groups selected for this audience. Several groups mean "in any". */
  const [audienceGroups, setAudienceGroups] = useState<string[]>([]);
  const [availableGroups, setAvailableGroups] = useState<{ name: string; contactCount: number }[]>([]);
  const [audienceSearch, setAudienceSearch] = useState('');
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [addingByFilter, setAddingByFilter] = useState(false);

  // "Pick manually" tab — options come from the server on each search, so the whole
  // contact book is reachable rather than only a pre-loaded first page.
  const [manualSearch, setManualSearch] = useState('');
  const [manualOptions, setManualOptions] = useState<{ value: string; label: string }[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  /** Labels of picked contacts, kept so chips survive the options list being replaced. */
  const [pickedLabels, setPickedLabels] = useState<Record<string, string>>({});
  const [addingContacts, setAddingContacts] = useState(false);

  /* ── Send review ───────────────────────────────────── */
  const [reviewOpen, setReviewOpen] = useState(false);
  const [preview, setPreview] = useState<SendPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activating, setActivating] = useState(false);

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateForm] = Form.useForm();
  const [savingTemplate, setSavingTemplate] = useState(false);

  const fetchCampaign = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [campRes, statsRes, templRes] = await Promise.all([
        campaignsAPI.get(id),
        campaignsAPI.getStats(id).catch(() => ({ data: {} })),
        templatesAPI.listByCampaign(id).catch(() => ({ data: [] })),
      ]);
      setCampaign(campRes.data);
      const s = statsRes.data || {};
      setStats({
        sent: s.sent ?? s.stats_sent ?? 0,
        delivered: s.delivered ?? s.stats_delivered ?? 0,
        read: s.read ?? s.stats_read ?? 0,
        replied: s.replied ?? s.stats_replied ?? 0,
        leads: s.leads ?? s.stats_leads ?? 0,
      });
      setTemplates(Array.isArray(templRes.data) ? templRes.data : []);

      try {
        const limit = campRes.data?.daily_send_limit ?? 100;
        const start = campRes.data?.send_window_start ?? '09:00';
        const end = campRes.data?.send_window_end ?? '18:00';
        const dpRes = await engineAPI.getDistributionPlan({ daily_limit: limit, window_start: start, window_end: end });
        setDistPlan(Array.isArray(dpRes.data?.slots) ? dpRes.data.slots : []);
      } catch {
        /* distribution plan optional */
      }
    } catch {
      message.error('Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchContacts = useCallback(async () => {
    if (!id) return;
    try {
      const res = await campaignsAPI.getContacts(id, { page: contactsPage, limit: 20 });
      const d = res.data;
      // Rows are CampaignContact wrappers with the contact nested under
      // `.contact`. Flatten so the table's `name`/`whatsapp_number` dataIndexes
      // resolve, while keeping the join row's own status/mode.
      setContacts(
        (d.data ?? []).map((cc: Record<string, any>) => ({
          ...cc.contact,
          id: cc.contact_id ?? cc.contact?.id,
          campaign_contact_id: cc.id,
          status: cc.status,
          mode: cc.mode,
        })),
      );
      setContactsTotal(d.total ?? 0);
    } catch { /* ignore */ }
  }, [id, contactsPage]);

  useEffect(() => { fetchCampaign(); }, [fetchCampaign]);
  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  /**
   * Activating starts real WhatsApp sends, so it goes through a review first: the
   * button used to fire `activate` on a single click with no confirmation at all.
   */
  const openReview = async () => {
    if (!id) return;
    setReviewOpen(true);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const { data } = await campaignsAPI.sendPreview(id);
      setPreview(data as SendPreview);
    } catch {
      message.error('Could not load the send review');
      setReviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmActivate = async () => {
    if (!id) return;
    setActivating(true);
    try {
      await campaignsAPI.activate(id);
      setReviewOpen(false);
      message.success('Campaign activated — sending has started');
      fetchCampaign();
    } catch {
      message.error('Failed to activate');
    } finally {
      setActivating(false);
    }
  };

  const handlePause = async () => {
    if (!id) return;
    try {
      await campaignsAPI.pause(id);
      message.success('Campaign paused');
      fetchCampaign();
    } catch {
      message.error('Failed to pause');
    }
  };

  /**
   * Only levels that actually hold values are sent: an empty array contributes
   * nothing and an undefined one would serialise as the literal "undefined".
   *
   * The same object is used for the live count and for the submit, so the number the
   * operator is shown and the set that gets enrolled can never diverge.
   */
  // Load the saved group labels when the audience modal opens, so the list reflects
  // groups created since this page was rendered.
  useEffect(() => {
    if (!addContactModal) return;
    let cancelled = false;
    contactsAPI
      .groups()
      .then(({ data }) => { if (!cancelled) setAvailableGroups(data ?? []); })
      // Losing the suggestions is survivable; the rest of the filter still works.
      .catch(() => { if (!cancelled) setAvailableGroups([]); });
    return () => { cancelled = true; };
  }, [addContactModal]);

  const filterParams = useCallback((): Record<string, unknown> => {
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(audienceFilter)) {
      if (value?.length) params[key] = value;
    }
    if (audienceDatasets.collection_job_ids.length) {
      params.collection_job_ids = audienceDatasets.collection_job_ids;
    }
    if (audienceDatasets.import_file_ids.length) {
      params.import_file_ids = audienceDatasets.import_file_ids;
    }
    if (audienceGroups.length) params.groups = audienceGroups;
    const q = audienceSearch.trim();
    if (q) params.search = q;
    return params;
  }, [audienceFilter, audienceDatasets, audienceGroups, audienceSearch]);

  const openAddContacts = () => {
    setAddContactModal(true);
    setAddTab('filter');
  };

  const closeAddContacts = () => {
    setAddContactModal(false);
    setSelectedContactIds([]);
    setAudienceFilter({});
    setAudienceDatasets(EMPTY_DATASET_FILTER);
    setAudienceSearch('');
    setAudienceCount(null);
    setManualSearch('');
  };

  /**
   * Live audience size for the current filter. Debounced because every select and
   * keystroke changes the filter, and the count is an unpaginated COUNT query.
   */
  useEffect(() => {
    if (!id || !addContactModal || addTab !== 'filter') return;
    let cancelled = false;
    setCountLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await contactsAPI.count({
          ...filterParams(),
          // Unreachable or already-enrolled contacts cannot be added, so counting
          // them would promise an audience the submit could never deliver.
          reachable_only: true,
          not_in_campaign_id: id,
        });
        if (!cancelled) setAudienceCount(data?.count ?? 0);
      } catch {
        if (!cancelled) setAudienceCount(null);
      } finally {
        if (!cancelled) setCountLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, addContactModal, addTab, filterParams]);

  /** Server-side option search for the manual picker, also debounced. */
  useEffect(() => {
    if (!id || !addContactModal || addTab !== 'manual') return;
    let cancelled = false;
    setManualLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await contactsAPI.list({
          search: manualSearch.trim() || undefined,
          limit: 50,
          reachable_only: true,
          not_in_campaign_id: id,
        });
        if (cancelled) return;
        const rows: { id: string; name: string; whatsapp_number: string }[] = data?.data ?? [];
        setManualOptions(
          rows.map((c) => ({ value: c.id, label: `${c.name} (${c.whatsapp_number})` })),
        );
      } catch {
        if (!cancelled) setManualOptions([]);
      } finally {
        if (!cancelled) setManualLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, addContactModal, addTab, manualSearch]);

  const handleAddByFilter = async () => {
    if (!id) return;
    setAddingByFilter(true);
    try {
      const { data } = await campaignsAPI.addContactsByFilter(id, filterParams());
      const added = data?.added ?? 0;
      const skipped = data?.skipped ?? 0;
      const matched = data?.matched ?? added + skipped;
      if (added === 0) {
        // Distinguish "nothing matched" from "everything matched was already in" —
        // otherwise a no-op looks identical to a broken filter.
        message.info(
          matched > 0
            ? `No new contacts added — all ${matched.toLocaleString()} matches are already in this campaign`
            : 'No contacts matched this filter',
        );
      } else {
        message.success(
          `Added ${added.toLocaleString()} ${added === 1 ? 'contact' : 'contacts'}` +
            (skipped > 0 ? ` (${skipped.toLocaleString()} already in this campaign)` : ''),
        );
      }
      closeAddContacts();
      // Jump to the first page so the new rows are visible; when already there the
      // page-effect will not refire, so fetch explicitly.
      if (contactsPage === 1) {
        fetchContacts();
      } else {
        setContactsPage(1);
      }
    } catch {
      message.error('Failed to add contacts');
    } finally {
      setAddingByFilter(false);
    }
  };

  const handleAddContacts = async () => {
    if (!id || selectedContactIds.length === 0) return;
    setAddingContacts(true);
    try {
      await campaignsAPI.addContacts(id, selectedContactIds);
      message.success(
        `Added ${selectedContactIds.length} ${selectedContactIds.length === 1 ? 'contact' : 'contacts'}`,
      );
      closeAddContacts();
      fetchContacts();
    } catch {
      message.error('Failed to add contacts');
    } finally {
      setAddingContacts(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!id) return;
    try {
      const values = await templateForm.validateFields();
      setSavingTemplate(true);
      await templatesAPI.create({
        ...values,
        campaign_id: id,
      });
      message.success('Template created');
      setTemplateModalOpen(false);
      templateForm.resetFields();
      fetchCampaign();
    } catch {
      /* validation or API error */
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    try {
      await templatesAPI.delete(templateId);
      message.success('Template deleted');
      fetchCampaign();
    } catch {
      message.error('Failed to delete template');
    }
  };

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 400 }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (!campaign) {
    return <Empty description="Campaign not found" />;
  }

  const conversion = stats.sent > 0 ? ((stats.leads / stats.sent) * 100).toFixed(1) : '0';

  const statCards = [
    { icon: <SendOutlined />, title: 'Sent', value: stats.sent.toLocaleString(), accent: color.accent },
    { icon: <CheckCircleOutlined />, title: 'Delivered', value: stats.delivered.toLocaleString(), accent: color.accent },
    { icon: <EyeOutlined />, title: 'Read', value: stats.read.toLocaleString(), accent: color.info },
    { icon: <MessageOutlined />, title: 'Replied', value: stats.replied.toLocaleString(), accent: color.success },
    { icon: <FunnelPlotOutlined />, title: 'Leads', value: stats.leads.toString(), accent: color.warning },
    { icon: <PercentageOutlined />, title: 'Conversion', value: `${conversion}%`, accent: color.success },
  ];

  const contactColumns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (n: string) => <Text strong>{n}</Text>,
    },
    {
      title: 'WhatsApp',
      dataIndex: 'whatsapp_number',
      key: 'whatsapp_number',
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (e: string) => e || <Text style={{ color: color.textTertiary }}>—</Text>,
    },
    {
      // Location lives on the joined company, not the contact.
      title: 'Location',
      key: 'location',
      render: (_: unknown, record: CampaignContact) => {
        const label = [record.company?.city, record.company?.state_region]
          .filter(Boolean)
          .join(', ');
        return label
          ? <Text style={{ fontSize: font.size.footnote }}>{label}</Text>
          : <Text style={{ color: color.textTertiary }}>—</Text>;
      },
    },
    {
      // The enrolment status was already on every row but never rendered, so there
      // was no way to see who had been messaged and who was still pending.
      title: 'Status',
      key: 'status',
      render: (_: unknown, record: CampaignContact) =>
        record.status
          ? <StatusTag status={record.status} />
          : <Text style={{ color: color.textTertiary }}>—</Text>,
    },
  ];

  const tabItems = [
    {
      key: 'contacts',
      label: `Contacts (${contactsTotal})`,
      children: (
        <div>
          <Flex justify="flex-end" style={{ marginBottom: space.lg }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAddContacts}>
              Add Contacts
            </Button>
          </Flex>
          {contacts.length === 0 ? (
            <Empty description="No contacts added yet. Add contacts to start the campaign." />
          ) : (
            <Table
              dataSource={contacts}
              columns={contactColumns}
              rowKey="id"
              // Keeps every column reachable instead of clipping on narrow viewports.
              scroll={{ x: 'max-content' }}
              pagination={{
                current: contactsPage,
                pageSize: 20,
                total: contactsTotal,
                onChange: (p) => setContactsPage(p),
              }}
            />
          )}
        </div>
      ),
    },
    {
      key: 'templates',
      label: `Templates (${templates.length})`,
      children: (
        <div>
          {templates.length === 0 ? (
            <Empty description="No message templates yet.">
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => { templateForm.resetFields(); setTemplateModalOpen(true); }}
              >
                Add Template
              </Button>
            </Empty>
          ) : (
            <>
              {templates
                .sort((a, b) => a.sequence_order - b.sequence_order)
                .map((t) => (
                  <Card
                    key={t.id}
                    size="small"
                    title={
                      <Flex justify="space-between" align="center">
                        <Text strong>
                          Step {t.sequence_order}: {t.name}
                        </Text>
                        <Flex gap={space.sm}>
                          {t.trigger_condition && (
                            <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                              Trigger: {t.trigger_condition}
                            </Text>
                          )}
                          <Popconfirm
                            title="Delete this template?"
                            onConfirm={() => handleDeleteTemplate(t.id)}
                          >
                            {/* No Tooltip wrapper here: inside a Popconfirm the tooltip
                                renders above the confirm popup and swallows the click. */}
                            <Button
                              type="text"
                              size="small"
                              danger
                              title="Delete template"
                              aria-label={`Delete template ${t.name}`}
                              icon={<DeleteOutlined />}
                            />
                          </Popconfirm>
                        </Flex>
                      </Flex>
                    }
                    style={{ borderRadius: radius.lg, marginBottom: space.md }}
                  >
                    <TextArea
                      value={t.body}
                      readOnly
                      autoSize={{ minRows: 2 }}
                      style={{ border: 'none', background: color.fill, borderRadius: radius.md }}
                    />
                  </Card>
                ))}
              <Button
                icon={<PlusOutlined />}
                style={{ marginTop: space.sm }}
                onClick={() => { templateForm.resetFields(); setTemplateModalOpen(true); }}
              >
                Add Step
              </Button>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'distribution',
      label: 'Distribution Plan',
      children: (
        <Card style={{ borderRadius: radius.xl }}>
          {distPlan.length === 0 ? (
            <Empty description="Configure send window and daily limit to see the distribution plan." />
          ) : (
            <Flex vertical gap={space.sm}>
              {distPlan.map((slot, i) => (
                <Flex key={i} align="center" gap={space.lg}>
                  <Text
                    style={{
                      width: 60,
                      fontSize: font.size.footnote,
                      fontWeight: font.weight.medium,
                      color: color.textSecondary,
                    }}
                  >
                    {slot.time}
                  </Text>
                  <div
                    style={{
                      flex: 1,
                      background: color.fill,
                      borderRadius: radius.sm,
                      height: 24,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min((slot.count / Math.max(...distPlan.map((s) => s.count), 1)) * 100, 100)}%`,
                        height: '100%',
                        background: color.accent,
                        borderRadius: radius.sm,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        paddingRight: space.sm,
                      }}
                    >
                      <Text
                        style={{
                          color: color.textOnAccent,
                          fontSize: font.size.caption,
                          fontWeight: font.weight.semibold,
                        }}
                      >
                        {slot.count}
                      </Text>
                    </div>
                  </div>
                </Flex>
              ))}
            </Flex>
          )}
        </Card>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={campaign.name}
        subtitle={[campaign.product, campaign.target_country && `Target: ${campaign.target_country}`].filter(Boolean).join(' · ')}
        actions={
          <>
            <StatusTag status={campaign.status} />
            {campaign.status === 'active' ? (
              <Button icon={<PauseCircleOutlined />} onClick={handlePause}>
                Pause
              </Button>
            ) : (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={openReview}>
                Activate
              </Button>
            )}
          </>
        }
      />

      <Row gutter={[16, 16]} style={{ marginBottom: space.xl }}>
        {statCards.map((s) => (
          <Col xs={12} sm={8} lg={4} key={s.title}>
            <StatCard icon={s.icon} title={s.title} value={s.value} accentColor={s.accent} />
          </Col>
        ))}
      </Row>

      <Card style={{ borderRadius: radius.xl, border: `1px solid ${color.separator}` }}>
        <Tabs items={tabItems} />
      </Card>

      <Modal
        title="Add Contacts to Campaign"
        open={addContactModal}
        onCancel={closeAddContacts}
        // Footer is per-tab: each path has its own action, count and disabled rule.
        footer={null}
        width={680}
        destroyOnHidden
      >
        <Tabs
          activeKey={addTab}
          onChange={(k) => setAddTab(k as 'filter' | 'manual')}
          items={[
            {
              key: 'filter',
              label: 'By filter',
              children: (
                <Flex vertical gap={space.lg} style={{ paddingTop: space.sm }}>
                  <Text style={{ color: color.textSecondary, fontSize: font.size.footnote }}>
                    Everyone matching this filter is enrolled server-side. Opted-out and
                    suppressed contacts, and anyone already in this campaign, are skipped.
                  </Text>

                  <LocationFilter
                    value={audienceFilter}
                    onChange={setAudienceFilter}
                    showAgencyType
                  />

                  {/* Targets one scrape or upload exactly. Location filters cannot say
                      this: two collection runs over the same city are indistinguishable
                      by country/state/city, so rebuilding "Tuesday's Agra agencies" from
                      them would silently pull in every other run's contacts too. */}
                  <DatasetFilter
                    value={audienceDatasets}
                    onChange={setAudienceDatasets}
                    style={{ width: '100%' }}
                  />

                  {/* Saved groups. The most direct answer to "campaign this set again":
                      a group is an explicit, curated selection, so it does not depend on
                      the contacts still sharing a location or coming from one scrape. */}
                  <Select
                    mode="multiple"
                    placeholder="All groups"
                    aria-label="Filter by group"
                    allowClear
                    maxTagCount="responsive"
                    style={{ width: '100%' }}
                    value={audienceGroups}
                    onChange={(next: string[]) => setAudienceGroups(next)}
                    options={availableGroups.map((g) => ({
                      value: g.name,
                      label: `${g.name} (${g.contactCount} contacts)`,
                    }))}
                    notFoundContent="No groups yet — create one from the Contacts page"
                  />

                  <Input
                    placeholder="Search name, number, company, or email"
                    aria-label="Search contacts to add"
                    prefix={<SearchOutlined style={{ color: color.textTertiary }} />}
                    value={audienceSearch}
                    onChange={(e) => setAudienceSearch(e.target.value)}
                    allowClear
                  />

                  <Flex
                    align="center"
                    gap={space.md}
                    style={{
                      background: color.accentSofter,
                      border: `1px solid ${color.separator}`,
                      borderRadius: radius.lg,
                      padding: `${space.md}px ${space.lg}px`,
                    }}
                  >
                    <TeamOutlined style={{ color: color.accent, fontSize: font.size.title3 }} />
                    {countLoading ? (
                      <Flex align="center" gap={space.sm}>
                        <Spin size="small" />
                        <Text style={{ color: color.textSecondary }}>Counting matches…</Text>
                      </Flex>
                    ) : audienceCount === null ? (
                      <Text style={{ color: color.textSecondary }}>
                        Could not count matches. Adjust the filter and try again.
                      </Text>
                    ) : (
                      <div>
                        <Text
                          strong
                          style={{
                            display: 'block',
                            fontSize: font.size.title2,
                            fontWeight: font.weight.semibold,
                            lineHeight: 1.2,
                            color: audienceCount > 0 ? color.text : color.textSecondary,
                          }}
                        >
                          {audienceCount.toLocaleString()}{' '}
                          <span style={{ fontSize: font.size.body, fontWeight: font.weight.regular }}>
                            {audienceCount === 1 ? 'contact' : 'contacts'} will be added
                          </span>
                        </Text>
                        {audienceCount === 0 && (
                          <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                            No reachable contacts match, or they are all already enrolled.
                          </Text>
                        )}
                      </div>
                    )}
                  </Flex>

                  <Flex justify="flex-end" gap={space.sm}>
                    <Button onClick={closeAddContacts}>Cancel</Button>
                    <Button
                      type="primary"
                      loading={addingByFilter}
                      disabled={!audienceCount || countLoading}
                      onClick={handleAddByFilter}
                    >
                      {audienceCount
                        ? `Add ${audienceCount.toLocaleString()} ${audienceCount === 1 ? 'Contact' : 'Contacts'}`
                        : 'Add Contacts'}
                    </Button>
                  </Flex>
                </Flex>
              ),
            },
            {
              key: 'manual',
              label: 'Pick manually',
              children: (
                <Flex vertical gap={space.lg} style={{ paddingTop: space.sm }}>
                  <Text style={{ color: color.textSecondary, fontSize: font.size.footnote }}>
                    Type to search the whole contact book. Results are fetched from the
                    server, so you are not limited to a pre-loaded page.
                  </Text>

                  <Select
                    mode="multiple"
                    placeholder="Search and select contacts…"
                    aria-label="Select contacts to add"
                    style={{ width: '100%' }}
                    value={selectedContactIds}
                    // Filtering happens on the server; filtering again locally would
                    // hide freshly fetched results that do not match the raw input.
                    filterOption={false}
                    onSearch={setManualSearch}
                    onChange={(ids: string[], options) => {
                      setSelectedContactIds(ids);
                      // Remember labels so chosen chips keep their names when the
                      // option list is replaced by the next search.
                      const opts = (Array.isArray(options) ? options : [options]) as {
                        value?: string;
                        label?: string;
                      }[];
                      setPickedLabels((prev) => {
                        const next = { ...prev };
                        for (const o of opts) {
                          if (o?.value) next[o.value] = o.label ?? o.value;
                        }
                        return next;
                      });
                    }}
                    loading={manualLoading}
                    options={[
                      ...manualOptions,
                      // Keep selected-but-unlisted ids resolvable to a name.
                      ...selectedContactIds
                        .filter((sid) => !manualOptions.some((o) => o.value === sid))
                        .map((sid) => ({ value: sid, label: pickedLabels[sid] ?? sid })),
                    ]}
                    notFoundContent={manualLoading ? 'Searching…' : 'No matching contacts'}
                    maxTagCount="responsive"
                  />

                  <Flex justify="flex-end" gap={space.sm}>
                    <Button onClick={closeAddContacts}>Cancel</Button>
                    <Button
                      type="primary"
                      loading={addingContacts}
                      disabled={selectedContactIds.length === 0}
                      onClick={handleAddContacts}
                    >
                      {selectedContactIds.length > 0
                        ? `Add ${selectedContactIds.length} ${selectedContactIds.length === 1 ? 'Contact' : 'Contacts'}`
                        : 'Add Contacts'}
                    </Button>
                  </Flex>
                </Flex>
              ),
            },
          ]}
        />
      </Modal>

      <SendReviewModal
        open={reviewOpen}
        loading={previewLoading}
        preview={preview}
        activating={activating}
        onCancel={() => setReviewOpen(false)}
        onConfirm={handleConfirmActivate}
      />

      <Modal
        title="Add Message Template"
        open={templateModalOpen}
        onOk={handleCreateTemplate}
        confirmLoading={savingTemplate}
        onCancel={() => { setTemplateModalOpen(false); templateForm.resetFields(); }}
        okText="Create Template"
        width={520}
      >
        <Form form={templateForm} layout="vertical" style={{ marginTop: space.lg }}>
          <Form.Item name="name" label="Template Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Initial Outreach" />
          </Form.Item>
          <Form.Item name="body" label="Message Body" rules={[{ required: true }]}>
            <TextArea rows={4} placeholder="Hello {{name}}, ..." />
          </Form.Item>
          <Flex gap={space.md}>
            <Form.Item name="sequence_order" label="Sequence Order" style={{ flex: 1 }} rules={[{ required: true }]}>
              <InputNumber min={1} placeholder="1" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="type" label="Type" style={{ flex: 1 }}>
              <Select
                placeholder="Select type"
                allowClear
                options={[
                  { label: 'Text', value: 'text' },
                  { label: 'Image', value: 'image' },
                  { label: 'Document', value: 'document' },
                ]}
              />
            </Form.Item>
          </Flex>
          <Form.Item name="trigger_condition" label="Trigger Condition">
            <Input placeholder="e.g. no_reply_24h" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** One label/value line in the review's exclusion and schedule lists. */
function ReviewLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Flex justify="space-between" align="baseline" gap={space.lg}>
      <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>{label}</Text>
      <Text
        strong
        style={{ fontSize: font.size.footnote, color: tone ?? color.text, textAlign: 'right' }}
      >
        {value}
      </Text>
    </Flex>
  );
}

interface SendReviewModalProps {
  open: boolean;
  loading: boolean;
  preview: SendPreview | null;
  activating: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Last checkpoint before real WhatsApp messages go out.
 *
 * Activating used to be a single unconfirmed click. This shows who will be messaged,
 * who is excluded and why, when sends will happen, and the exact first message —
 * and refuses to activate at all while the server reports blockers.
 */
function SendReviewModal({
  open,
  loading,
  preview,
  activating,
  onCancel,
  onConfirm,
}: SendReviewModalProps) {
  const blocked = (preview?.blockers?.length ?? 0) > 0;
  // The first step of the sequence is what recipients actually see, so that is the
  // body worth reviewing. Sort defensively — the API order is not guaranteed.
  const firstTemplate = preview?.templates?.length
    ? [...preview.templates].sort((a, b) => a.sequence_order - b.sequence_order)[0]
    : undefined;

  const camp = preview?.campaign;
  const sendWindow =
    camp?.send_window_start && camp?.send_window_end
      ? `${camp.send_window_start}–${camp.send_window_end}${
          camp.send_window_timezone ? ` ${camp.send_window_timezone}` : ''
        }`
      : 'Not configured';

  return (
    <Modal
      title="Review before sending"
      open={open}
      onCancel={onCancel}
      width={620}
      destroyOnHidden
      footer={
        <Flex justify="flex-end" gap={space.sm}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            type="primary"
            loading={activating}
            // The safety property: blockers make activation impossible, not merely
            // discouraged. No Popconfirm — this review *is* the confirmation.
            disabled={loading || !preview || blocked}
            onClick={onConfirm}
          >
            Activate and start sending
          </Button>
        </Flex>
      }
    >
      {loading || !preview ? (
        <Flex justify="center" align="center" style={{ minHeight: 220 }}>
          <Spin />
        </Flex>
      ) : (
        <Flex vertical gap={space.lg} style={{ paddingTop: space.sm }}>
          {preview.blockers.map((b, i) => (
            <Alert key={i} type="error" showIcon message={b} />
          ))}

          <div
            style={{
              background: color.accentSofter,
              border: `1px solid ${color.separator}`,
              borderRadius: radius.lg,
              padding: space.lg,
            }}
          >
            <Text
              strong
              style={{
                display: 'block',
                fontSize: font.size.title1,
                fontWeight: font.weight.semibold,
                lineHeight: 1.1,
                color: color.text,
              }}
            >
              {preview.audience.sendable.toLocaleString()}
            </Text>
            <Text style={{ color: color.textSecondary, fontSize: font.size.footnote }}>
              {preview.audience.sendable === 1 ? 'contact' : 'contacts'} will receive a message
              {preview.audience.total > 0 && ` · ${preview.audience.total.toLocaleString()} in this campaign`}
            </Text>
          </div>

          {preview.audience.unverified > 0 && (
            <Alert
              type="warning"
              showIcon
              icon={<WarningOutlined />}
              message={`${preview.audience.unverified.toLocaleString()} ${
                preview.audience.unverified === 1 ? 'number has' : 'numbers have'
              } not been verified on WhatsApp`}
              description="Unverified numbers may fail to deliver, which can hurt sender reputation."
            />
          )}

          <div>
            <Text strong style={{ display: 'block', marginBottom: space.sm }}>
              Excluded
            </Text>
            <Flex
              vertical
              gap={space.sm}
              style={{
                background: color.fill,
                borderRadius: radius.md,
                padding: `${space.md}px ${space.lg}px`,
              }}
            >
              <ReviewLine
                label="Opted out"
                value={preview.excluded.optedOut.toLocaleString()}
                tone={preview.excluded.optedOut > 0 ? color.danger : undefined}
              />
              <ReviewLine
                label="Suppressed"
                value={preview.excluded.suppressed.toLocaleString()}
                tone={preview.excluded.suppressed > 0 ? color.danger : undefined}
              />
              <ReviewLine
                label="Already processed"
                value={preview.audience.alreadyProcessed.toLocaleString()}
              />
              {preview.excluded.reasons.map((r) => (
                <ReviewLine
                  key={r.reason}
                  label={r.reason.replace(/_/g, ' ')}
                  value={r.count.toLocaleString()}
                />
              ))}
            </Flex>
          </div>

          <div>
            <Flex align="center" gap={space.xs} style={{ marginBottom: space.sm }}>
              <ClockCircleOutlined style={{ color: color.textSecondary }} />
              <Text strong>Schedule</Text>
            </Flex>
            <Flex
              vertical
              gap={space.sm}
              style={{
                background: color.fill,
                borderRadius: radius.md,
                padding: `${space.md}px ${space.lg}px`,
              }}
            >
              <ReviewLine
                label="Estimated duration"
                value={`${preview.schedule.estimatedDays.toLocaleString()} ${
                  preview.schedule.estimatedDays === 1 ? 'day' : 'days'
                }`}
              />
              <ReviewLine
                label="Sent on day one"
                value={preview.schedule.firstDayCount.toLocaleString()}
              />
              <ReviewLine label="Send window" value={sendWindow} />
              <ReviewLine
                label="Daily limit"
                value={
                  camp?.daily_send_limit
                    ? `${camp.daily_send_limit.toLocaleString()}/day`
                    : 'Not set'
                }
              />
            </Flex>
          </div>

          <Divider style={{ margin: 0 }} />

          <div>
            <Text strong style={{ display: 'block', marginBottom: space.xs }}>
              First message that will be sent
            </Text>
            <Text
              style={{
                display: 'block',
                marginBottom: space.sm,
                fontSize: font.size.caption,
                color: color.textSecondary,
              }}
            >
              {firstTemplate
                ? `Step ${firstTemplate.sequence_order}: ${firstTemplate.name}. Placeholders like {{name}} are filled in per contact at send time.`
                : 'No template configured.'}
            </Text>
            {firstTemplate ? (
              // Shown verbatim, placeholders included: interpolating a sample here
              // would imply a rendering the engine does not actually perform.
              <div
                aria-label="First message body"
                style={{
                  background: color.fill,
                  border: `1px solid ${color.separatorOpaque}`,
                  borderRadius: radius.md,
                  padding: space.lg,
                  fontFamily: font.family,
                  fontSize: font.size.footnote,
                  color: color.text,
                  whiteSpace: 'pre-wrap',
                  maxHeight: 220,
                  overflowY: 'auto',
                }}
              >
                {firstTemplate.body}
              </div>
            ) : (
              <Empty
                image={null}
                description={
                  <Text style={{ color: color.textSecondary }}>
                    Add a message template before activating.
                  </Text>
                }
              />
            )}
          </div>
        </Flex>
      )}
    </Modal>
  );
}

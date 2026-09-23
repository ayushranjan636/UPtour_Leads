import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Row,
  Col,
  Card,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  TimePicker,
  Typography,
  Flex,
  Progress,
  Spin,
  Empty,
  Alert,
  Switch,
  message,
} from 'antd';
import {
  PlusOutlined,
  SendOutlined,
  UserOutlined,
  FunnelPlotOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  RocketOutlined,
  TeamOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import DatasetFilter, {
  EMPTY_DATASET_FILTER,
  type DatasetFilterValue,
} from '../components/DatasetFilter';
import { campaignsAPI, contactsAPI } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

/**
 * Demonstrates both authoring features at once: spintax alternatives in `{a|b}`
 * and merge fields in `{{field}}`. Kept as a constant so the braces are never
 * mistaken for JSX expressions.
 */
const FIRST_MESSAGE_PLACEHOLDER =
  '{Hi|Hello} {{contact_name}}, we design heritage tours across Uttar Pradesh for agencies like {{company_name}}. {Interested|Worth a quick chat}?';

interface Campaign {
  id: string;
  name: string;
  description?: string;
  product?: string;
  target_country?: string;
  status: string;
  daily_send_limit?: number;
  send_window_start?: string;
  send_window_end?: string;
  send_window_timezone?: string;
  stats_sent?: number;
  stats_delivered?: number;
  stats_read?: number;
  stats_replied?: number;
  stats_leads?: number;
  created_at?: string;
}

export default function Campaigns() {
  const [data, setData] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  /* ── Audience for the new campaign ─────────────────
   * Held here rather than inside CampaignModal because the submit handler lives
   * here, and because the modal is mounted from two places (empty state and list)
   * — one owner keeps the selection and the reset-on-create in a single spot.
   */
  const [audienceGroups, setAudienceGroups] = useState<string[]>([]);
  const [audienceDatasets, setAudienceDatasets] =
    useState<DatasetFilterValue>(EMPTY_DATASET_FILTER);
  const [availableGroups, setAvailableGroups] =
    useState<{ name: string; contactCount: number }[]>([]);
  /**
   * Last resolved count, tagged with the audience it was resolved for. Tagging (as
   * opposed to a bare number) means a count is never shown against a selection it
   * does not belong to: the moment the filter changes the old number stops matching
   * and the UI falls back to "counting…" instead of flashing a stale figure.
   * `count: null` records a failed lookup for that same audience.
   */
  const [countResult, setCountResult] =
    useState<{ key: string; count: number | null } | null>(null);

  /**
   * Only keys that actually hold values are included: an empty array would tell the
   * backend "filter on nothing", and an absent audience means "start empty".
   *
   * The same object feeds the live count and the create payload, so the number the
   * operator is shown and the set that gets enrolled can never diverge.
   */
  const audienceParams = useCallback((): Record<string, unknown> => {
    const params: Record<string, unknown> = {};
    if (audienceGroups.length) params.groups = audienceGroups;
    if (audienceDatasets.collection_job_ids.length) {
      params.collection_job_ids = audienceDatasets.collection_job_ids;
    }
    if (audienceDatasets.import_file_ids.length) {
      params.import_file_ids = audienceDatasets.import_file_ids;
    }
    return params;
  }, [audienceGroups, audienceDatasets]);

  const audienceKey = JSON.stringify(audienceParams());
  const hasAudience = Object.keys(audienceParams()).length > 0;
  /** True while the count in hand does not describe the current selection. */
  const countLoading = hasAudience && countResult?.key !== audienceKey;
  const audienceCount = countResult?.key === audienceKey ? countResult.count : null;

  const resetAudience = useCallback(() => {
    setAudienceGroups([]);
    setAudienceDatasets(EMPTY_DATASET_FILTER);
    setCountResult(null);
  }, []);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await campaignsAPI.list({ page, limit: 20 });
      setData(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      message.error('Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  // Group labels are loaded when the modal opens, not once on mount, so groups
  // created since this page rendered still show up.
  useEffect(() => {
    if (!modalOpen) return;
    let cancelled = false;
    contactsAPI
      .groups()
      .then(({ data: groups }) => { if (!cancelled) setAvailableGroups(groups ?? []); })
      // Losing the suggestions is survivable — the select stays mounted and usable.
      .catch(() => { if (!cancelled) setAvailableGroups([]); });
    return () => { cancelled = true; };
  }, [modalOpen]);

  /**
   * Live audience size. Debounced because every select change rewrites the filter
   * and the count is an unpaginated COUNT query. `cancelled` plus the audience key
   * stored alongside the number mean a slow earlier response can never overwrite a
   * newer one.
   *
   * Skipped entirely when nothing is selected: showing the full contact total there
   * would imply the campaign is about to enrol everyone, which it is not.
   */
  useEffect(() => {
    if (!modalOpen || !hasAudience) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data: res } = await contactsAPI.count({
          ...audienceParams(),
          // Opted-out and suppressed contacts are never enrolled, so counting them
          // would promise an audience the create could not deliver.
          reachable_only: true,
        });
        if (!cancelled) setCountResult({ key: audienceKey, count: res?.count ?? 0 });
      } catch {
        if (!cancelled) setCountResult({ key: audienceKey, count: null });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [modalOpen, hasAudience, audienceKey, audienceParams]);

  const closeModal = () => {
    setModalOpen(false);
    form.resetFields();
    resetAudience();
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: Record<string, unknown> = {
        name: values.name,
        description: values.description,
        product: values.product,
        target_country: values.target_country,
        daily_send_limit: values.daily_send_limit,
        // Nullable server-side, where null means "follow the global switch". Sent as an
        // explicit boolean so the choice made in the form is the one stored; it can still
        // only ever *restrict* the assistant, never enable it past the global switch.
        ai_auto_reply_enabled: values.ai_auto_reply_enabled !== false,
      };
      if (values.send_window) {
        payload.send_window_start = values.send_window[0]?.format('HH:mm');
        payload.send_window_end = values.send_window[1]?.format('HH:mm');
      }
      if (values.send_window_timezone) {
        payload.send_window_timezone = values.send_window_timezone;
      }
      // Optional: when present the backend creates the campaign's opening template
      // for us, so the operator never has to visit the Templates tab to start
      // sending. An empty box is omitted rather than sent as "".
      const firstMessage =
        typeof values.first_message === 'string' ? values.first_message.trim() : '';
      if (firstMessage) {
        payload.first_message = firstMessage;
      }
      // Omitted entirely when nothing is selected — an empty object would still be a
      // filter, and "no audience" must mean "create the campaign empty".
      const audience = audienceParams();
      const wantsAudience = Object.keys(audience).length > 0;
      if (wantsAudience) {
        payload.audience = audience;
      }
      const { data: created } = await campaignsAPI.create(payload);
      // The create response carries the campaign, not the enrolment result, so the
      // enrolled count is read back from the campaign's contact list. Best-effort:
      // enrolment happens server-side regardless, so a failure here only costs us
      // the richer toast.
      let enrolled: number | null = null;
      if (wantsAudience && created?.id) {
        try {
          const { data: res } = await campaignsAPI.getContacts(created.id, { page: 1, limit: 1 });
          enrolled = res?.total ?? null;
        } catch {
          enrolled = null;
        }
      }
      message.success(
        enrolled && enrolled > 0
          ? `Campaign created — ${enrolled.toLocaleString()} ${enrolled === 1 ? 'contact' : 'contacts'} enrolled`
          : 'Campaign created',
      );
      setModalOpen(false);
      form.resetFields();
      resetAudience();
      fetchCampaigns();
    } catch {
      /* validation or API error */
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await campaignsAPI.activate(id);
      message.success('Campaign activated');
      fetchCampaigns();
    } catch {
      message.error('Failed to activate campaign');
    }
  };

  const handlePause = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await campaignsAPI.pause(id);
      message.success('Campaign paused');
      fetchCampaigns();
    } catch {
      message.error('Failed to pause campaign');
    }
  };

  if (!loading && data.length === 0) {
    return (
      <div>
        <PageHeader title="Campaigns" subtitle="0 campaigns" />
        <Flex justify="center" style={{ padding: '80px 0' }}>
          <Empty
            image={<RocketOutlined style={{ fontSize: 64, color: color.textTertiary }} />}
            description={
              <div style={{ marginTop: space.lg }}>
                <Text
                  strong
                  style={{
                    fontSize: font.size.headline,
                    display: 'block',
                    marginBottom: space.sm,
                  }}
                >
                  Launch your first campaign
                </Text>
                <Text style={{ color: color.textSecondary }}>
                  Create a WhatsApp outreach campaign to start engaging contacts.
                </Text>
              </div>
            }
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              New Campaign
            </Button>
          </Empty>
        </Flex>
        <CampaignModal
          open={modalOpen}
          form={form}
          saving={saving}
          onSave={handleCreate}
          onCancel={closeModal}
          audienceGroups={audienceGroups}
          onAudienceGroupsChange={setAudienceGroups}
          audienceDatasets={audienceDatasets}
          onAudienceDatasetsChange={setAudienceDatasets}
          availableGroups={availableGroups}
          audienceCount={audienceCount}
          countLoading={countLoading}
          hasAudience={hasAudience}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle={`${total} campaigns`}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            New Campaign
          </Button>
        }
      />

      <Spin spinning={loading}>
        <Row gutter={[20, 20]}>
          {data.map((campaign) => {
            const sent = campaign.stats_sent ?? 0;
            const delivered = campaign.stats_delivered ?? 0;
            const replied = campaign.stats_replied ?? 0;
            const leads = campaign.stats_leads ?? 0;
            const deliveryRate = sent > 0 ? Math.round((delivered / sent) * 100) : 0;

            return (
              <Col xs={24} sm={12} xl={8} key={campaign.id}>
                <Card
                  hoverable
                  onClick={() => navigate(`/campaigns/${campaign.id}`)}
                  style={{
                    borderRadius: radius.xl,
                    border: `1px solid ${color.separator}`,
                    transition: 'all 0.2s ease',
                  }}
                  styles={{ body: { padding: space.xl } }}
                >
                  <Flex justify="space-between" align="flex-start" style={{ marginBottom: space.lg }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        strong
                        style={{
                          fontSize: font.size.headline,
                          display: 'block',
                          color: color.text,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {campaign.name}
                      </Text>
                      {campaign.product && (
                        <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>
                          {campaign.product}
                        </Text>
                      )}
                    </div>
                    <Flex align="center" gap={space.sm}>
                      <StatusTag status={campaign.status} />
                      {campaign.status === 'active' ? (
                        <Button
                          size="small"
                          icon={<PauseCircleOutlined />}
                          onClick={(e) => handlePause(campaign.id, e)}
                        />
                      ) : campaign.status !== 'completed' ? (
                        <Button
                          size="small"
                          type="primary"
                          icon={<PlayCircleOutlined />}
                          onClick={(e) => handleActivate(campaign.id, e)}
                        />
                      ) : null}
                    </Flex>
                  </Flex>

                  {campaign.target_country && (
                    <Text
                      style={{
                        fontSize: font.size.caption,
                        color: color.textTertiary,
                        display: 'block',
                        marginBottom: space.lg,
                      }}
                    >
                      Target: {campaign.target_country}
                    </Text>
                  )}

                  {sent > 0 && (
                    <Progress
                      percent={deliveryRate}
                      size={['100%', 6]}
                      strokeColor={color.accent}
                      trailColor={color.fill}
                      style={{ marginBottom: space.lg }}
                      format={(p) => `${p}% delivered`}
                    />
                  )}

                  <Flex justify="space-between">
                    <Flex align="center" gap={6}>
                      <SendOutlined style={{ fontSize: font.size.footnote, color: color.textSecondary }} />
                      <Text style={{ fontSize: font.size.footnote }}>
                        <Text strong>{sent.toLocaleString()}</Text>{' '}
                        <Text style={{ color: color.textTertiary }}>sent</Text>
                      </Text>
                    </Flex>
                    <Flex align="center" gap={6}>
                      <UserOutlined style={{ fontSize: font.size.footnote, color: color.textSecondary }} />
                      <Text style={{ fontSize: font.size.footnote }}>
                        <Text strong>{replied.toLocaleString()}</Text>{' '}
                        <Text style={{ color: color.textTertiary }}>replied</Text>
                      </Text>
                    </Flex>
                    <Flex align="center" gap={6}>
                      <FunnelPlotOutlined style={{ fontSize: font.size.footnote, color: color.textSecondary }} />
                      <Text style={{ fontSize: font.size.footnote }}>
                        <Text strong style={{ color: color.accent }}>{leads}</Text>{' '}
                        <Text style={{ color: color.textTertiary }}>leads</Text>
                      </Text>
                    </Flex>
                  </Flex>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Spin>

      {total > 20 && (
        <Flex justify="center" style={{ marginTop: space.xl }}>
          <Button
            disabled={page * 20 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Load More
          </Button>
        </Flex>
      )}

      <CampaignModal
        open={modalOpen}
        form={form}
        saving={saving}
        onSave={handleCreate}
        onCancel={closeModal}
        audienceGroups={audienceGroups}
        onAudienceGroupsChange={setAudienceGroups}
        audienceDatasets={audienceDatasets}
        onAudienceDatasetsChange={setAudienceDatasets}
        availableGroups={availableGroups}
        audienceCount={audienceCount}
        countLoading={countLoading}
        hasAudience={hasAudience}
      />
    </div>
  );
}

function CampaignModal({
  open,
  form,
  saving,
  onSave,
  onCancel,
  audienceGroups,
  onAudienceGroupsChange,
  audienceDatasets,
  onAudienceDatasetsChange,
  availableGroups,
  audienceCount,
  countLoading,
  hasAudience,
}: {
  open: boolean;
  form: ReturnType<typeof Form.useForm>[0];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  audienceGroups: string[];
  onAudienceGroupsChange: (next: string[]) => void;
  audienceDatasets: DatasetFilterValue;
  onAudienceDatasetsChange: (next: DatasetFilterValue) => void;
  availableGroups: { name: string; contactCount: number }[];
  audienceCount: number | null;
  countLoading: boolean;
  hasAudience: boolean;
}) {
  // Live value so the "no opening message" warning appears and disappears as the
  // operator types, rather than only after a failed submit.
  const firstMessage = Form.useWatch<string | undefined>('first_message', form);
  const hasFirstMessage = !!firstMessage?.trim();

  return (
    <Modal
      title="Create New Campaign"
      open={open}
      onOk={onSave}
      confirmLoading={saving}
      onCancel={onCancel}
      okText="Create Campaign"
      width={520}
    >
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: space.lg }}
        // Defaults must live here, not as `defaultValue` on the child input. Ant Design
        // fields are controlled by the form store, so a `defaultValue` is ignored
        // entirely — the picker rendered blank and the operator could not see which
        // send window they were about to accept. (The saved campaign was still safe:
        // the column itself defaults to 09:00-18:00.)
        initialValues={{
          send_window: [dayjs('09:00', 'HH:mm'), dayjs('18:00', 'HH:mm')],
          // Matches the column default. Subordinate to the global switch either way, so
          // "allowed" here never means "on" by itself.
          ai_auto_reply_enabled: true,
        }}
      >
        <Form.Item name="name" label="Campaign Name" rules={[{ required: true }]}>
          <Input placeholder="e.g. Japan Golden Route 2026" />
        </Form.Item>
        <Form.Item name="product" label="Product / Tour">
          <Input placeholder="e.g. Golden Triangle + Varanasi" />
        </Form.Item>
        <Form.Item name="target_country" label="Target Country">
          <Input placeholder="e.g. Japan" />
        </Form.Item>
        <Form.Item name="description" label="Description">
          <Input.TextArea rows={3} placeholder="Campaign description..." />
        </Form.Item>
        {/* Recommended, not required: sending it here saves a separate trip to the
            Templates tab, but a campaign can still be created without one. */}
        <Form.Item
          name="first_message"
          label="First Message"
          rules={[{ required: false }]}
          style={{ marginBottom: space.xs }}
        >
          <Input.TextArea
            rows={4}
            maxLength={4096}
            showCount
            placeholder={FIRST_MESSAGE_PLACEHOLDER}
          />
        </Form.Item>
        <div style={{ marginBottom: space.lg }}>
          <Text
            style={{
              display: 'block',
              fontSize: font.size.caption,
              color: color.textSecondary,
            }}
          >
            Recommended. Merge fields:{' '}
            {'{{contact_name}}, {{company_name}}, {{city}}, {{state}}, {{country}}, {{product}}'}
          </Text>
          <Text
            style={{
              display: 'block',
              marginTop: space.xs,
              fontSize: font.size.caption,
              color: color.textSecondary,
            }}
          >
            Spintax: {'{Hi|Hello|Hey}'} picks a different wording per recipient, so no two
            messages are identical — this reduces the chance WhatsApp flags the account.
          </Text>
        </div>
        {!hasFirstMessage && (
          <Alert
            type="warning"
            showIcon
            title="Without a first message you'll need to add a message template before this campaign can send."
            style={{ marginBottom: space.lg, borderRadius: radius.lg }}
          />
        )}

        {/* ── Audience ────────────────────────────────────
            Enrolling at creation time means a new campaign is not born empty and
            blocked from activating. Everything here is optional: an untouched
            audience creates the campaign with no contacts, exactly as before. */}
        <div style={{ marginBottom: space.lg }}>
          <Text
            style={{
              display: 'block',
              fontSize: font.size.footnote,
              color: color.textSecondary,
              marginBottom: space.sm,
            }}
          >
            Audience
          </Text>

          <Flex vertical gap={space.md}>
            {/* Saved groups — the most direct answer to "campaign this set again":
                a group is an explicit, curated selection, so it does not depend on
                the contacts still sharing a location or coming from one scrape. */}
            <Select
              mode="multiple"
              placeholder="All groups"
              aria-label="Select contact groups"
              allowClear
              maxTagCount="responsive"
              style={{ width: '100%' }}
              value={audienceGroups}
              onChange={(next: string[]) => onAudienceGroupsChange(next)}
              options={availableGroups.map((g) => ({
                value: g.name,
                label: `${g.name} (${g.contactCount} contacts)`,
              }))}
              notFoundContent="No groups yet — create one from the Contacts page"
            />

            {/* Targets one scrape or upload exactly, which location filters cannot
                express: two collection runs over the same city are indistinguishable
                by country/state/city. */}
            <DatasetFilter
              value={audienceDatasets}
              onChange={onAudienceDatasetsChange}
              style={{ width: '100%' }}
            />

            {/* Nothing selected shows a muted hint rather than the full contact
                total — a total there would read as "all of these are about to be
                enrolled", which is the opposite of what happens. */}
            {!hasAudience ? (
              <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                No audience selected — the campaign starts empty. You can add contacts
                later from the campaign page.
              </Text>
            ) : (
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
                    Could not count matches. Adjust the audience and try again.
                  </Text>
                ) : (
                  <div>
                    <Text
                      strong
                      style={{
                        display: 'block',
                        fontSize: font.size.title3,
                        fontWeight: font.weight.semibold,
                        lineHeight: 1.2,
                        color: audienceCount > 0 ? color.text : color.textSecondary,
                      }}
                    >
                      {audienceCount.toLocaleString()}{' '}
                      <span
                        style={{ fontSize: font.size.body, fontWeight: font.weight.regular }}
                      >
                        {audienceCount === 1 ? 'contact' : 'contacts'} will be enrolled
                      </span>
                    </Text>
                    {audienceCount === 0 && (
                      <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                        No reachable contacts match this audience.
                      </Text>
                    )}
                  </div>
                )}
              </Flex>
            )}

            <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
              Optional. The campaign starts with this audience; you can add more contacts
              at any time from the campaign page. Opted-out and suppressed contacts are
              always excluded.
            </Text>
          </Flex>
        </div>

        <Flex gap={space.md}>
          <Form.Item name="daily_send_limit" label="Daily Send Limit" style={{ flex: 1 }}>
            <InputNumber min={1} max={500} placeholder="100" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="send_window" label="Send Window" style={{ flex: 1 }}>
            <TimePicker.RangePicker
              format="HH:mm"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Flex>
        <Form.Item name="send_window_timezone" label="Timezone">
          <Input placeholder="e.g. Asia/Tokyo" />
        </Form.Item>

        {/* ── AI auto-reply ───────────────────────────────
            Opt-out only: the global switch in Settings → AI Assistant decides whether the
            assistant runs at all, and this can only take this campaign out of it. Stated
            in the caption so nobody reads "allowed" as "the assistant is now answering". */}
        <Form.Item
          name="ai_auto_reply_enabled"
          valuePropName="checked"
          label="AI auto-reply for this campaign"
          style={{ marginBottom: space.xs }}
        >
          <Switch
            checkedChildren="On"
            unCheckedChildren="Off"
            aria-label="Allow AI auto-reply for this campaign"
          />
        </Form.Item>
        <Flex align="flex-start" gap={space.sm}>
          <RobotOutlined
            style={{ color: color.textSecondary, fontSize: font.size.footnote, marginTop: 2 }}
          />
          <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
            Subordinate to the global switch in Settings → AI Assistant. A campaign cannot
            turn the assistant on by itself — leaving this on only means this campaign is
            included when the global switch is on. Turn it off to have people handle every
            reply here.
          </Text>
        </Flex>
      </Form>
    </Modal>
  );
}

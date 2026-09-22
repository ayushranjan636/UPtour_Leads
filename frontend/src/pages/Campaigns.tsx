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
  TimePicker,
  Typography,
  Flex,
  Progress,
  Spin,
  Empty,
  Alert,
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
} from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import { campaignsAPI } from '../services/endpoints';
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
      await campaignsAPI.create(payload);
      message.success('Campaign created');
      setModalOpen(false);
      form.resetFields();
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
          onCancel={() => { setModalOpen(false); form.resetFields(); }}
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
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
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
}: {
  open: boolean;
  form: ReturnType<typeof Form.useForm>[0];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
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
      <Form form={form} layout="vertical" style={{ marginTop: space.lg }}>
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
            message="Without a first message you'll need to add a message template before this campaign can send."
            style={{ marginBottom: space.lg, borderRadius: radius.lg }}
          />
        )}
        <Flex gap={space.md}>
          <Form.Item name="daily_send_limit" label="Daily Send Limit" style={{ flex: 1 }}>
            <InputNumber min={1} max={500} placeholder="100" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="send_window" label="Send Window" style={{ flex: 1 }}>
            <TimePicker.RangePicker
              format="HH:mm"
              defaultValue={[dayjs('09:00', 'HH:mm'), dayjs('18:00', 'HH:mm')]}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Flex>
        <Form.Item name="send_window_timezone" label="Timezone">
          <Input placeholder="e.g. Asia/Tokyo" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

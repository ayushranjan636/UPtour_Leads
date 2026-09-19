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

const { Text } = Typography;

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
            image={<RocketOutlined style={{ fontSize: 64, color: '#D1D5DB' }} />}
            description={
              <div style={{ marginTop: 16 }}>
                <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>
                  Launch your first campaign
                </Text>
                <Text style={{ color: '#6B7280' }}>
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
                    borderRadius: 14,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    transition: 'all 0.2s ease',
                  }}
                  styles={{ body: { padding: 24 } }}
                >
                  <Flex justify="space-between" align="flex-start" style={{ marginBottom: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        strong
                        style={{
                          fontSize: 16,
                          display: 'block',
                          color: '#111827',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {campaign.name}
                      </Text>
                      {campaign.product && (
                        <Text style={{ fontSize: 13, color: '#6B7280' }}>
                          {campaign.product}
                        </Text>
                      )}
                    </div>
                    <Flex align="center" gap={8}>
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
                    <Text style={{ fontSize: 12, color: '#9CA3AF', display: 'block', marginBottom: 16 }}>
                      Target: {campaign.target_country}
                    </Text>
                  )}

                  {sent > 0 && (
                    <Progress
                      percent={deliveryRate}
                      size={['100%', 6]}
                      strokeColor="#4F46E5"
                      trailColor="#F3F4F6"
                      style={{ marginBottom: 16 }}
                      format={(p) => `${p}% delivered`}
                    />
                  )}

                  <Flex justify="space-between">
                    <Flex align="center" gap={6}>
                      <SendOutlined style={{ fontSize: 13, color: '#6B7280' }} />
                      <Text style={{ fontSize: 13 }}>
                        <Text strong>{sent.toLocaleString()}</Text>{' '}
                        <Text style={{ color: '#9CA3AF' }}>sent</Text>
                      </Text>
                    </Flex>
                    <Flex align="center" gap={6}>
                      <UserOutlined style={{ fontSize: 13, color: '#6B7280' }} />
                      <Text style={{ fontSize: 13 }}>
                        <Text strong>{replied.toLocaleString()}</Text>{' '}
                        <Text style={{ color: '#9CA3AF' }}>replied</Text>
                      </Text>
                    </Flex>
                    <Flex align="center" gap={6}>
                      <FunnelPlotOutlined style={{ fontSize: 13, color: '#6B7280' }} />
                      <Text style={{ fontSize: 13 }}>
                        <Text strong style={{ color: '#4F46E5' }}>{leads}</Text>{' '}
                        <Text style={{ color: '#9CA3AF' }}>leads</Text>
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
        <Flex justify="center" style={{ marginTop: 24 }}>
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
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
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
        <Flex gap={12}>
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

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Form,
  InputNumber,
  Progress,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  TimePicker,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined, SendOutlined, SettingOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { campaignsAPI, engineAPI } from '../services/endpoints';
import type { CampaignSendStatus } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Kathmandu',
  'Asia/Colombo',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'Australia/Sydney',
];

const stateStyle: Record<CampaignSendStatus['state'], { tag: string; label: string }> = {
  sending: { tag: 'green', label: 'Sending' },
  waiting: { tag: 'gold', label: 'Waiting' },
  idle: { tag: 'blue', label: 'Idle' },
  stopped: { tag: 'default', label: 'Stopped' },
  problem: { tag: 'red', label: 'Problem' },
};

function apiError(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return (Array.isArray(msg) ? msg.join(', ') : msg) || fallback;
}

/**
 * Sending control for one campaign: what is happening right now, and the dials.
 *
 * The engine used to skip a campaign silently for being outside its hours, over its
 * daily limit or out of new-people allowance, so "Active, 0 sent" had no explanation
 * and no way to change it after creation. This shows the reason in words, today's
 * counts against each limit, lets the limits and hours be edited, and offers Send now.
 */
export default function CampaignSendingCard({
  campaignId,
  campaign,
  onChanged,
}: {
  campaignId: string;
  campaign: {
    daily_send_limit?: number;
    daily_new_contact_limit?: number | null;
    send_window_start?: string;
    send_window_end?: string;
    send_window_timezone?: string;
    min_gap_seconds?: number | null;
    max_gap_seconds?: number | null;
  } | null;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<CampaignSendStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendCount, setSendCount] = useState<number>(5);
  const [sending, setSending] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    try {
      const { data } = await engineAPI.sendStatus(campaignId);
      setStatus(data);
    } catch {
      setStatus(null);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const openEditor = () => {
    form.setFieldsValue({
      daily_send_limit: campaign?.daily_send_limit ?? status?.dailyLimit ?? 30,
      daily_new_contact_limit: campaign?.daily_new_contact_limit ?? status?.newLimit ?? 30,
      hours: [
        dayjs(String(campaign?.send_window_start ?? status?.window.start ?? '09:00').slice(0, 5), 'HH:mm'),
        dayjs(String(campaign?.send_window_end ?? status?.window.end ?? '18:00').slice(0, 5), 'HH:mm'),
      ],
      send_window_timezone: campaign?.send_window_timezone ?? status?.window.timezone ?? 'Asia/Kolkata',
      gap_mode: campaign?.min_gap_seconds ? 'custom' : 'auto',
      gap_min: campaign?.min_gap_seconds ?? 60,
      gap_max: campaign?.max_gap_seconds ?? campaign?.min_gap_seconds ?? 120,
    });
    setEditing(true);
  };

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await campaignsAPI.update(campaignId, {
        daily_send_limit: v.daily_send_limit,
        daily_new_contact_limit: Math.min(v.daily_new_contact_limit, v.daily_send_limit),
        send_window_start: v.hours?.[0]?.format('HH:mm'),
        send_window_end: v.hours?.[1]?.format('HH:mm'),
        send_window_timezone: v.send_window_timezone,
        // null switches back to automatic spacing across the sending hours.
        min_gap_seconds: v.gap_mode === 'custom' ? v.gap_min : null,
        max_gap_seconds: v.gap_mode === 'custom' ? Math.max(v.gap_min, v.gap_max) : null,
      });
      message.success('Sending settings saved');
      setEditing(false);
      onChanged();
      await load();
    } catch (err) {
      message.error(apiError(err, 'Could not save the sending settings.'), 8);
    } finally {
      setSaving(false);
    }
  };

  const sendNow = async () => {
    setSending(true);
    try {
      const { data } = await engineAPI.sendNow(campaignId, sendCount);
      setStatus(data.status);
      if (data.queued > 0) {
        message.success(`${data.queued} ${data.queued === 1 ? 'message' : 'messages'} sending now`);
      } else {
        message.warning(`Nothing was sent: ${data.status.headline}. ${data.status.detail}`, 8);
      }
      onChanged();
    } catch (err) {
      message.error(apiError(err, 'Could not send now.'), 8);
    } finally {
      setSending(false);
    }
  };

  if (!status) return null;
  const style = stateStyle[status.state];
  const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0);

  return (
    <Card size="small" style={{ borderRadius: radius.lg, marginBottom: space.lg }}>
      <Flex vertical gap={space.md}>
        <Flex justify="space-between" align="flex-start" gap={space.md} wrap>
          <Flex vertical gap={4} style={{ minWidth: 0, flex: 1 }}>
            <Flex align="center" gap={space.sm} wrap>
              <Tag color={style.tag}>{style.label}</Tag>
              <Text strong>{status.headline}</Text>
            </Flex>
            <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>{status.detail}</Text>
            {status.state === 'sending' && status.nextSendAt && (
              <Text style={{ fontSize: font.size.footnote }}>
                Next message at about <strong>{dayjs(status.nextSendAt).format('HH:mm')}</strong>
                {status.gapSeconds
                  ? ` · roughly one every ${status.gapSeconds >= 120 ? `${Math.round(status.gapSeconds / 60)} min` : `${status.gapSeconds} sec`}${status.gapIsCustom ? ' (your setting)' : ''}`
                  : ''}
              </Text>
            )}
          </Flex>
          <Space wrap>
            <InputNumber
              min={1}
              max={50}
              value={sendCount}
              onChange={(v) => setSendCount(v ?? 1)}
              addonAfter="msgs"
              style={{ width: 120 }}
              aria-label="How many messages to send now"
            />
            <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => void sendNow()}>
              Send now
            </Button>
            <Button icon={<SettingOutlined />} onClick={openEditor}>
              Limits & hours
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} aria-label="Refresh sending status" />
          </Space>
        </Flex>

        <Row gutter={[16, 8]}>
          <Col xs={24} md={8}>
            <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>Messages today</Text>
            <Progress percent={pct(status.todaySent, status.dailyLimit)} format={() => `${status.todaySent} / ${status.dailyLimit}`} />
          </Col>
          <Col xs={24} md={8}>
            <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>New people today</Text>
            <Progress percent={pct(status.newToday, status.newLimit)} format={() => `${status.newToday} / ${status.newLimit}`} />
          </Col>
          <Col xs={24} md={8}>
            <Text style={{ fontSize: font.size.caption, color: color.textSecondary, display: 'block' }}>
              Sending hours
            </Text>
            <Text style={{ fontSize: font.size.footnote }}>
              {status.window.start} to {status.window.end} {status.window.timezone}{' '}
              <Tag color={status.window.open ? 'green' : 'default'}>{status.window.open ? 'open now' : 'closed now'}</Tag>
            </Text>
            <Text style={{ fontSize: font.size.caption, color: color.textSecondary, display: 'block' }}>
              {status.pending} waiting · {status.total} in campaign
            </Text>
          </Col>
        </Row>

        {editing && (
          <div style={{ border: `1px solid ${color.separatorOpaque}`, borderRadius: radius.md, padding: space.md }}>
            <Form form={form} layout="vertical">
              <Row gutter={16}>
                <Col xs={24} md={6}>
                  <Form.Item
                    name="daily_send_limit"
                    label="Messages per day"
                    extra="All messages, including follow-ups. Max 200."
                    rules={[{ required: true }]}
                  >
                    <InputNumber min={1} max={200} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={6}>
                  <Form.Item
                    name="daily_new_contact_limit"
                    label="New people per day"
                    extra="First messages to people who never heard from you."
                    rules={[{ required: true }]}
                  >
                    <InputNumber min={1} max={200} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={6}>
                  <Form.Item name="hours" label="Sending hours" rules={[{ required: true }]}>
                    <TimePicker.RangePicker format="HH:mm" minuteStep={15} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={6}>
                  <Form.Item name="send_window_timezone" label="Timezone">
                    <Select showSearch options={TIMEZONES.map((z) => ({ value: z, label: z }))} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="Time between messages" style={{ marginBottom: space.sm }}>
                <Flex gap={space.md} align="center" wrap>
                  <Form.Item name="gap_mode" noStyle>
                    <Radio.Group
                      options={[
                        { value: 'auto', label: 'Automatic (spread over the sending hours)' },
                        { value: 'custom', label: 'I choose' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(a, b) => a.gap_mode !== b.gap_mode}>
                    {({ getFieldValue }) =>
                      getFieldValue('gap_mode') === 'custom' && (
                        <Flex gap={space.sm} align="center" wrap>
                          <Text style={{ fontSize: font.size.footnote }}>every</Text>
                          <Form.Item name="gap_min" noStyle rules={[{ required: true }]}>
                            <InputNumber min={5} max={86400} addonAfter="sec" style={{ width: 130 }} />
                          </Form.Item>
                          <Text style={{ fontSize: font.size.footnote }}>to</Text>
                          <Form.Item name="gap_max" noStyle rules={[{ required: true }]}>
                            <InputNumber min={5} max={86400} addonAfter="sec" style={{ width: 130 }} />
                          </Form.Item>
                          <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                            Picked at random in this range. Daily limits still apply.
                          </Text>
                        </Flex>
                      )
                    }
                  </Form.Item>
                </Flex>
              </Form.Item>
              {status.dailyLimit > 100 && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: space.md }}
                  title="A new WhatsApp number starts with a limit set by Meta (often 250 people a day) that grows as messages are read and answered."
                />
              )}
              <Flex gap={space.sm}>
                <Button type="primary" loading={saving} onClick={() => void save()}>
                  Save
                </Button>
                <Button onClick={() => setEditing(false)}>Cancel</Button>
              </Flex>
            </Form>
          </div>
        )}
      </Flex>
    </Card>
  );
}

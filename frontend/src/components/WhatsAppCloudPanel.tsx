import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CloudOutlined,
  DisconnectOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { whatsappCloudAPI } from '../services/endpoints';
import type {
  WhatsAppCloudConfigInput,
  WhatsAppProvider,
  WhatsAppProviderState,
} from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text, Paragraph, Link } = Typography;

/** Pull the server's explanation out of an axios error, which is what operators need. */
function errorText(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const msg = Array.isArray(data?.message) ? data?.message.join(', ') : data?.message;
  return msg?.trim() || fallback;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Flex justify="space-between" align="center" gap={space.lg} wrap>
      <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>{label}</Text>
      <Text strong style={{ fontSize: font.size.footnote, color: color.text }}>
        {value}
      </Text>
    </Flex>
  );
}

const qualityColor: Record<string, string> = { GREEN: 'success', YELLOW: 'warning', RED: 'error' };

/**
 * Settings for Meta's official WhatsApp Cloud API, plus the switch that decides which
 * transport (QR session or Cloud API) sends the portal's messages.
 *
 * Lives next to the QR session card rather than replacing it: both can be configured
 * at once, and only the active one sends.
 */
export default function WhatsAppCloudPanel({ onProviderChanged }: { onProviderChanged?: () => void }) {
  const [state, setState] = useState<WhatsAppProviderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<WhatsAppCloudConfigInput>();

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await whatsappCloudAPI.provider();
      if (mounted.current) setState(data);
    } catch {
      if (mounted.current) setState(null);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cloud = state?.cloud;
  const provider = state?.provider ?? 'session';
  const showForm = editing || !cloud?.configured;

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await whatsappCloudAPI.save(values);
      message.success('WhatsApp Cloud API connected');
      setEditing(false);
      await load();
    } catch (err) {
      message.error(errorText(err, 'Could not save the Cloud API settings.'));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const switchProvider = (next: WhatsAppProvider) => {
    if (next === provider) return;
    Modal.confirm({
      title: next === 'cloud' ? 'Send through the official Cloud API?' : 'Send through the QR session?',
      content:
        next === 'cloud'
          ? 'Campaigns, follow-ups, AI replies and manual messages will go through Meta’s Cloud API. ' +
            'First messages to a contact need an approved Meta template, set on each campaign template.'
          : 'All messages will go through the QR-linked WhatsApp session again.',
      okText: 'Switch',
      onOk: async () => {
        setSwitching(true);
        try {
          await whatsappCloudAPI.setProvider(next);
          message.success(next === 'cloud' ? 'Now sending through the Cloud API' : 'Now sending through the QR session');
          await load();
          onProviderChanged?.();
        } catch (err) {
          message.error(errorText(err, 'Could not switch the WhatsApp provider.'));
        } finally {
          if (mounted.current) setSwitching(false);
        }
      },
    });
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await whatsappCloudAPI.disconnect();
      message.success('Cloud API credentials removed');
      await load();
      onProviderChanged?.();
    } catch (err) {
      message.error(errorText(err, 'Could not remove the Cloud API credentials.'));
    } finally {
      if (mounted.current) setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <Flex justify="center" style={{ padding: space.xl }}>
        <Spin />
      </Flex>
    );
  }

  if (!state || !cloud) {
    return (
      <Alert
        type="warning"
        showIcon
        title="Cloud API settings are unavailable."
        description="The API did not answer. Update the backend to a version with WhatsApp Cloud API support."
      />
    );
  }

  return (
    <Flex vertical gap={space.xl}>
      {/* ── Which transport sends ─────────────────────────── */}
      <Card size="small" style={{ borderRadius: radius.lg }}>
        <Flex vertical gap={space.md}>
          <Text strong>Send messages through</Text>
          <Radio.Group
            value={provider}
            onChange={(e) => switchProvider(e.target.value)}
            disabled={switching}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="session">
              <QrcodeOutlined /> QR session
            </Radio.Button>
            <Radio.Button value="cloud" disabled={!cloud.configured}>
              <CloudOutlined /> Official Cloud API
            </Radio.Button>
          </Radio.Group>
          <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
            {provider === 'cloud'
              ? 'Messages go through Meta’s official WhatsApp Business Platform.'
              : cloud.configured
                ? 'Messages go through the QR-linked session. Switch to the Cloud API at any time.'
                : 'Connect the Cloud API below to make it available here.'}
          </Text>
        </Flex>
      </Card>

      {/* ── Cloud API connection ──────────────────────────── */}
      <Card size="small" style={{ borderRadius: radius.lg }}>
        <Flex vertical gap={space.lg}>
          <Flex justify="space-between" align="center" gap={space.md} wrap>
            <Flex align="center" gap={space.md}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.lg,
                  background: cloud.connected ? color.successSoft : color.warningSoft,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <SafetyCertificateOutlined
                  style={{ color: cloud.connected ? color.success : color.warning, fontSize: font.size.headline }}
                />
              </div>
              <div>
                <Text strong style={{ display: 'block' }}>
                  WhatsApp Cloud API (official)
                </Text>
                <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                  {cloud.message}
                </Text>
              </div>
            </Flex>
            <Flex align="center" gap={space.sm}>
              <Badge
                status={cloud.connected ? 'success' : cloud.configured ? 'error' : 'default'}
                text={cloud.connected ? 'Connected' : cloud.configured ? 'Error' : 'Not connected'}
              />
              <Button type="text" icon={<ReloadOutlined />} aria-label="Refresh Cloud API status" onClick={() => void load()} />
            </Flex>
          </Flex>

          {cloud.configured && (
            <Flex vertical gap={space.sm}>
              <Row label="Business name" value={cloud.verifiedName ?? '—'} />
              <Row label="Phone number" value={cloud.phone ?? '—'} />
              <Row
                label="Quality rating"
                value={
                  cloud.qualityRating ? (
                    <Tag color={qualityColor[cloud.qualityRating] ?? 'default'}>{cloud.qualityRating}</Tag>
                  ) : (
                    '—'
                  )
                }
              />
              <Row label="Phone number ID" value={cloud.phoneNumberId ?? '—'} />
              <Row label="Business Account ID" value={cloud.wabaId ?? 'Not set'} />
              <Row label="Access token" value={cloud.accessTokenHint ?? '—'} />
              <Row label="Credentials from" value={cloud.source === 'env' ? 'Server environment' : 'This portal'} />
            </Flex>
          )}

          {cloud.configured && !cloud.hasAppSecret && (
            <Alert
              type="warning"
              showIcon
              title="App secret missing"
              description="Without the Meta app secret the portal cannot verify webhooks, so replies and delivery receipts are rejected."
            />
          )}

          {showForm && (
            <Form
              form={form}
              layout="vertical"
              requiredMark="optional"
              // Drop typed values on close, so a pasted token never lingers in memory.
              preserve={false}
              // Secrets are never sent back, so their fields always start empty.
              initialValues={{
                phoneNumberId: cloud.phoneNumberId ?? '',
                wabaId: cloud.wabaId ?? '',
                apiVersion: cloud.apiVersion,
                verifyToken: cloud.verifyToken ?? '',
                accessToken: '',
                appSecret: '',
              }}
            >
              <Form.Item
                name="accessToken"
                label="Permanent access token"
                extra={
                  cloud.configured
                    ? 'Leave blank to keep the saved token.'
                    : 'A System User token with whatsapp_business_messaging and whatsapp_business_management.'
                }
                rules={cloud.configured ? [] : [{ required: true, message: 'Paste the access token' }]}
              >
                <Input.Password placeholder="EAAG…" autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="phoneNumberId"
                label="Phone number ID"
                extra="WhatsApp Manager → API Setup. This is an ID, not the phone number."
                rules={[
                  { required: true, message: 'Enter the phone number ID' },
                  { pattern: /^\d+$/, message: 'Digits only' },
                ]}
              >
                <Input placeholder="123456789012345" />
              </Form.Item>
              <Form.Item
                name="wabaId"
                label="WhatsApp Business Account ID"
                extra="Needed to list your approved templates and to subscribe webhooks."
                rules={[{ pattern: /^\d*$/, message: 'Digits only' }]}
              >
                <Input placeholder="987654321098765" />
              </Form.Item>
              <Form.Item
                name="appSecret"
                label="App secret"
                extra={
                  cloud.hasAppSecret
                    ? 'Leave blank to keep the saved secret.'
                    : 'Meta app → App settings → Basic. Used to verify webhook signatures.'
                }
              >
                <Input.Password placeholder="App secret" autoComplete="off" />
              </Form.Item>
              <Flex gap={space.md}>
                <Form.Item
                  name="verifyToken"
                  label="Webhook verify token"
                  extra="Any string. Generated for you when left blank."
                  style={{ flex: 2 }}
                >
                  <Input placeholder="auto-generated" />
                </Form.Item>
                <Form.Item name="apiVersion" label="Graph API version" style={{ flex: 1 }}>
                  <Input placeholder="v23.0" />
                </Form.Item>
              </Flex>
            </Form>
          )}

          <Flex gap={space.md} wrap>
            {showForm ? (
              <>
                <Button type="primary" icon={<CloudOutlined />} loading={saving} onClick={() => void save()}>
                  {cloud.configured ? 'Save & verify' : 'Connect Cloud API'}
                </Button>
                {cloud.configured && <Button onClick={() => setEditing(false)}>Cancel</Button>}
              </>
            ) : (
              <Button onClick={() => setEditing(true)}>Edit credentials</Button>
            )}
            {cloud.configured && cloud.source === 'portal' && (
              <Popconfirm
                title="Remove Cloud API credentials?"
                description={
                  provider === 'cloud'
                    ? 'Sending switches back to the QR session immediately.'
                    : 'The saved token and IDs are deleted from the portal.'
                }
                okText="Remove"
                okButtonProps={{ danger: true }}
                onConfirm={disconnect}
              >
                <Button danger icon={<DisconnectOutlined />} loading={disconnecting}>
                  Disconnect
                </Button>
              </Popconfirm>
            )}
          </Flex>
        </Flex>
      </Card>

      {/* ── Webhook setup ─────────────────────────────────── */}
      <Card size="small" style={{ borderRadius: radius.lg }}>
        <Flex vertical gap={space.md}>
          <Text strong>Webhook (replies and delivery receipts)</Text>
          <Paragraph style={{ margin: 0, fontSize: font.size.footnote, color: color.textSecondary }}>
            In your Meta app open WhatsApp → Configuration, paste these two values, press Verify and save,
            then subscribe to the <Text code>messages</Text> field.
          </Paragraph>
          <Row label="Callback URL" value={<Text copyable>{cloud.webhookUrl}</Text>} />
          <Row
            label="Verify token"
            value={cloud.verifyToken ? <Text copyable>{cloud.verifyToken}</Text> : 'Saved after you connect'}
          />
          {/^http:\/\/(localhost|127\.)/.test(cloud.webhookUrl) && (
            <Alert
              type="info"
              showIcon
              title="Meta cannot reach localhost"
              description="Webhooks need a public HTTPS address. Use the deployed portal, or set PUBLIC_API_URL to a tunnel such as ngrok while testing."
            />
          )}
        </Flex>
      </Card>

      {/* ── How to get credentials ────────────────────────── */}
      <Card size="small" style={{ borderRadius: radius.lg }}>
        <Flex vertical gap={space.sm}>
          <Text strong>Getting your Cloud API credentials</Text>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: font.size.footnote, color: color.textSecondary }}>
            <li>
              Create a Business app at{' '}
              <Link href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer">
                developers.facebook.com
              </Link>{' '}
              and add the WhatsApp product.
            </li>
            <li>Add your business phone number in WhatsApp Manager and verify it by SMS or voice call.</li>
            <li>Copy the Phone number ID and WhatsApp Business Account ID from WhatsApp → API Setup.</li>
            <li>
              In Business Settings → System users, create a system user, assign the app and the WhatsApp account,
              and generate a permanent token.
            </li>
            <li>Create message templates in WhatsApp Manager and wait for approval. Cold first messages must use one.</li>
          </ol>
        </Flex>
      </Card>
    </Flex>
  );
}

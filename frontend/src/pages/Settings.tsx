import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Card,
  Tabs,
  Form,
  Input,
  Button,
  Typography,
  Flex,
  Badge,
  Popconfirm,
  Alert,
  message,
  Spin,
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ApiOutlined,
  WhatsAppOutlined,
  DisconnectOutlined,
  ExportOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import WhatsAppConnectModal, {
  whatsAppStatusLabel,
} from '../components/WhatsAppConnectModal';
import { useAuth } from '../contexts/AuthContext';
import { gatewayAPI, isGatewayHealthy } from '../services/endpoints';
import type { WhatsAppConnection } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

function ProfileTab() {
  const { user } = useAuth();

  const handleSave = () => {
    message.info('Profile update not yet implemented');
  };

  return (
    <div style={{ maxWidth: 500 }}>
      <Form
        layout="vertical"
        initialValues={{
          name: user?.name ?? '',
          email: user?.email ?? '',
        }}
        onFinish={handleSave}
      >
        <Form.Item name="name" label="Full Name" rules={[{ required: true }]}>
          <Input prefix={<UserOutlined style={{ color: color.textTertiary }} />} />
        </Form.Item>
        <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
          <Input prefix={<MailOutlined style={{ color: color.textTertiary }} />} disabled />
        </Form.Item>
        <Form.Item name="currentPassword" label="Current Password">
          <Input.Password
            prefix={<LockOutlined style={{ color: color.textTertiary }} />}
            placeholder="Enter to change password"
          />
        </Form.Item>
        <Form.Item name="newPassword" label="New Password">
          <Input.Password
            prefix={<LockOutlined style={{ color: color.textTertiary }} />}
            placeholder="Enter new password"
          />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          Save Changes
        </Button>
      </Form>
    </div>
  );
}

/**
 * The gateway ships its own web UI for deep session admin (logs, multi-session,
 * message debugging). We link out to it rather than reimplementing it. Env-driven
 * so a deployed portal can point at the real host instead of localhost.
 */
const OPENWA_URL =
  (import.meta.env.VITE_OPENWA_URL as string | undefined)?.trim() ||
  'http://localhost:2785';

/** One label/value line in the connection summary. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Flex justify="space-between" align="center" gap={space.lg}>
      <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>
        {label}
      </Text>
      <Text strong style={{ fontSize: font.size.footnote, color: color.text }}>
        {value}
      </Text>
    </Flex>
  );
}

function WhatsAppTab() {
  const [conn, setConn] = useState<WhatsAppConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  /**
   * Open the gateway dashboard already signed in.
   *
   * Asks the backend for a link carrying a handover fragment, so the operator is not
   * prompted for an API key they should never have to handle. Falls back to the plain
   * URL if the endpoint is unavailable — a sign-in prompt beats a dead button.
   */
  const openWhatsAppPortal = async () => {
    setOpeningPortal(true);
    try {
      const { data } = await gatewayAPI.portalLink();
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      window.open(OPENWA_URL, '_blank', 'noopener,noreferrer');
    } finally {
      setOpeningPortal(false);
    }
  };
  const [disconnecting, setDisconnecting] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await gatewayAPI.connection();
      if (!mounted.current) return;
      setConn(data);
      setFailed(false);
    } catch {
      // A failed request must not blank the tab — the buttons below (including the
      // link out to the gateway's own portal) are exactly what you need when the
      // gateway is unreachable.
      if (!mounted.current) return;
      setConn(null);
      setFailed(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await gatewayAPI.disconnect();
      message.success('WhatsApp disconnected');
      await load(true);
    } catch {
      message.error('Could not disconnect — the messaging gateway may be offline.');
    } finally {
      if (mounted.current) setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <Flex justify="center" style={{ padding: 40 }}>
        <Spin />
      </Flex>
    );
  }

  const connected = conn?.connected === true;
  const reachable = conn?.gatewayReachable === true;

  return (
    <Flex vertical gap={space.xl} style={{ maxWidth: 560 }}>
      <Card size="small" style={{ borderRadius: radius.lg }}>
        <Flex vertical gap={space.lg}>
          <Flex justify="space-between" align="center" gap={space.md}>
            <Flex align="center" gap={space.md}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.lg,
                  background: connected ? color.successSoft : color.warningSoft,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <WhatsAppOutlined
                  style={{
                    color: connected ? color.success : color.warning,
                    fontSize: font.size.headline,
                  }}
                />
              </div>
              <div>
                <Text strong style={{ display: 'block' }}>
                  WhatsApp Session
                </Text>
                <Text
                  style={{ fontSize: font.size.caption, color: color.textSecondary }}
                >
                  {conn?.message?.trim() || 'Connection state unavailable'}
                </Text>
              </div>
            </Flex>
            <Flex align="center" gap={space.sm}>
              <Badge
                status={connected ? 'success' : reachable ? 'warning' : 'error'}
                text={
                  <Text
                    style={{
                      fontSize: font.size.footnote,
                      color: connected ? color.success : reachable ? color.warning : color.danger,
                    }}
                  >
                    {whatsAppStatusLabel(conn?.status)}
                  </Text>
                }
              />
              <Button
                type="text"
                icon={<ReloadOutlined />}
                aria-label="Refresh WhatsApp connection status"
                onClick={() => void load(true)}
              />
            </Flex>
          </Flex>

          {failed && (
            <Alert
              type="error"
              showIcon
              title="Could not read the WhatsApp connection state."
              description="The API or the messaging gateway is unreachable. Campaigns cannot send until it recovers."
            />
          )}

          <Flex vertical gap={space.sm}>
            <DetailRow label="Status" value={whatsAppStatusLabel(conn?.status)} />
            <DetailRow label="Phone number" value={conn?.phone ?? '—'} />
            <DetailRow label="Session" value={conn?.sessionName ?? conn?.sessionId ?? '—'} />
          </Flex>

          <Flex gap={space.md} wrap>
            {connected ? (
              <Popconfirm
                title="Disconnect WhatsApp?"
                description="Campaigns stop sending immediately, and reconnecting needs a fresh QR scan on the phone."
                okText="Disconnect"
                okButtonProps={{ danger: true }}
                cancelText="Cancel"
                onConfirm={handleDisconnect}
              >
                {/* No Tooltip wrapper here: it renders above the Popconfirm and
                    swallows the click that should open the confirmation. */}
                <Button danger icon={<DisconnectOutlined />} loading={disconnecting}>
                  Disconnect
                </Button>
              </Popconfirm>
            ) : (
              <Button
                type="primary"
                icon={<WhatsAppOutlined />}
                onClick={() => setConnectOpen(true)}
              >
                Connect WhatsApp
              </Button>
            )}
            <Button
              icon={<ExportOutlined />}
              loading={openingPortal}
              onClick={openWhatsAppPortal}
            >
              Open WhatsApp portal
            </Button>
          </Flex>
        </Flex>
      </Card>

      <WhatsAppConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={() => void load(true)}
      />
    </Flex>
  );
}

function SystemTab() {
  const [health, setHealth] = useState<{ status?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data } = await gatewayAPI.getHealth().catch(() => ({ data: null }));
        setHealth(data);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <Flex justify="center" style={{ padding: 40 }}>
        <Spin />
      </Flex>
    );
  }

  const services = [
    {
      name: 'API Server',
      status: 'connected',
      url: 'http://localhost:3000',
    },
    {
      // The messaging gateway is separate infrastructure — session/QR admin lives
      // in its own dashboard, not here. We surface only up/down, because campaigns
      // silently stop sending when it is unreachable.
      name: 'Messaging Gateway',
      status: isGatewayHealthy(health) ? 'connected' : 'disconnected',
      url: 'Outbound messaging service',
    },
  ];

  return (
    <Flex vertical gap={20}>
      {services.map((svc) => (
        <Card key={svc.name} size="small" style={{ borderRadius: radius.lg }}>
          <Flex justify="space-between" align="center">
            <Flex align="center" gap={12}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.lg,
                  background: svc.status === 'connected' ? color.successSoft : color.dangerSoft,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {svc.status === 'connected' ? (
                  <CheckCircleFilled style={{ color: color.success, fontSize: 16 }} />
                ) : (
                  <CloseCircleFilled style={{ color: color.danger, fontSize: 16 }} />
                )}
              </div>
              <div>
                <Text strong style={{ display: 'block' }}>{svc.name}</Text>
                <Flex align="center" gap={8}>
                  <ApiOutlined style={{ fontSize: font.size.caption, color: color.textTertiary }} />
                  <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>{svc.url}</Text>
                </Flex>
              </div>
            </Flex>
            <Badge
              status={svc.status === 'connected' ? 'success' : 'error'}
              text={svc.status === 'connected' ? 'Healthy' : 'Down'}
            />
          </Flex>
        </Card>
      ))}
    </Flex>
  );
}

export default function Settings() {
  const tabItems = [
    { key: 'profile', label: 'Profile', children: <ProfileTab /> },
    { key: 'whatsapp', label: 'WhatsApp', children: <WhatsAppTab /> },
    { key: 'system', label: 'System', children: <SystemTab /> },
  ];

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Manage your account and system configuration"
      />

      <Card style={{ borderRadius: radius.xl }}>
        <Tabs items={tabItems} />
      </Card>
    </div>
  );
}

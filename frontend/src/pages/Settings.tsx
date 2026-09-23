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
  Modal,
  Switch,
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
  RobotOutlined,
  ExclamationCircleFilled,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import WhatsAppConnectModal, {
  whatsAppStatusLabel,
} from '../components/WhatsAppConnectModal';
import { useAuth } from '../contexts/AuthContext';
import { aiAPI, gatewayAPI, isGatewayHealthy } from '../services/endpoints';
import type { AiAutoReplySetting, WhatsAppConnection } from '../services/endpoints';
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

/**
 * Global AI auto-reply switch.
 *
 * Deliberately asymmetric: turning it **on** hands the assistant permission to send
 * WhatsApp messages to real prospects with nobody in the loop, so it goes through a
 * confirmation that says exactly that. Turning it **off** is immediate — the one moment
 * someone reaches for this is when the assistant is saying something wrong, and a
 * confirmation dialog in that path is an obstacle, not a safeguard.
 */
function AssistantTab() {
  const [setting, setSetting] = useState<AiAutoReplySetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * Optimistic value while a write is in flight. Held separately from `setting` so a
   * rejected request simply drops it and the switch snaps back to the server's value —
   * the UI never claims a state the server did not accept.
   */
  const [pending, setPending] = useState<boolean | null>(null);
  /**
   * Hook form rather than the static `Modal.confirm`: the static one renders in its own
   * React root and so would miss the app's ConfigProvider theme.
   */
  const [modal, modalContextHolder] = Modal.useModal();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    aiAPI
      .getAutoReply()
      .then(({ data }) => {
        if (cancelled) return;
        setSetting(data);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSetting(null);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Writes the value, reverting the switch if the server refuses it. */
  const apply = async (next: boolean) => {
    setPending(next);
    setSaving(true);
    try {
      const { data } = await aiAPI.setAutoReply(next);
      // Trust the response over our own optimism, and record that the value is now an
      // explicit operator choice rather than the deploy-time default.
      setSetting((prev) => ({
        enabled: data?.enabled ?? next,
        source: 'override',
        envDefault: prev?.envDefault ?? false,
      }));
      setFailed(false);
      message.success(
        next
          ? 'AI auto-reply is on — the assistant will reply to inbound messages'
          : 'AI auto-reply is off — inbound messages wait for a human',
      );
    } catch {
      message.error(
        next
          ? 'Could not turn AI auto-reply on. It is still off.'
          : 'Could not turn AI auto-reply off — it may still be replying. Try again.',
      );
    } finally {
      setPending(null);
      setSaving(false);
    }
  };

  const handleChange = (next: boolean) => {
    if (!next) {
      // Never obstruct someone trying to stop it.
      void apply(false);
      return;
    }
    modal.confirm({
      title: 'Let the assistant reply on its own?',
      icon: <ExclamationCircleFilled style={{ color: color.warning }} />,
      width: 520,
      okText: 'Turn on auto-reply',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      content: (
        <Flex vertical gap={space.md} style={{ marginTop: space.sm }}>
          <Text style={{ color: color.text }}>
            The assistant will start sending WhatsApp messages to real prospects without
            anyone reviewing them first. It applies to every campaign that has not opted
            out, and takes effect immediately.
          </Text>
          <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>
            Still in force: per-campaign switches, opted-out and suppressed contacts are
            never messaged, the assistant hands over to a human when it is unsure, and
            replies use the same humanised pacing as campaigns.
          </Text>
          <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>
            You can turn this off again at any time, with immediate effect.
          </Text>
        </Flex>
      ),
      onOk: () => apply(true),
    });
  };

  if (loading) {
    return (
      <Flex justify="center" style={{ padding: 40 }}>
        <Spin />
      </Flex>
    );
  }

  const enabled = pending ?? setting?.enabled ?? false;
  /** No operator has chosen a value, so the server's deploy-time default is what is live. */
  const fromServerConfig = setting?.source === 'env';

  return (
    <Flex vertical gap={space.xl} style={{ maxWidth: 560 }}>
      {modalContextHolder}
      <Card size="small" style={{ borderRadius: radius.lg }}>
        <Flex vertical gap={space.lg}>
          <Flex justify="space-between" align="flex-start" gap={space.md}>
            <Flex align="center" gap={space.md}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.lg,
                  background: enabled ? color.successSoft : color.fillStrong,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RobotOutlined
                  style={{
                    color: enabled ? color.success : color.textSecondary,
                    fontSize: font.size.headline,
                  }}
                />
              </div>
              <div>
                <Text strong style={{ display: 'block' }} id="ai-auto-reply-label">
                  AI auto-reply
                </Text>
                <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                  {failed
                    ? 'State unknown — the setting could not be read'
                    : enabled
                      ? 'The assistant answers inbound WhatsApp messages on its own'
                      : 'Inbound WhatsApp messages wait for a human'}
                </Text>
              </div>
            </Flex>
            {/* State is stated in words next to the switch, not carried by colour alone. */}
            <Flex align="center" gap={space.sm}>
              <Text
                aria-hidden
                style={{
                  fontSize: font.size.footnote,
                  fontWeight: font.weight.medium,
                  color: failed
                    ? color.textSecondary
                    : enabled
                      ? color.success
                      : color.textSecondary,
                }}
              >
                {failed ? 'Unknown' : enabled ? 'On' : 'Off'}
              </Text>
              <Switch
                checked={enabled}
                loading={saving}
                disabled={failed}
                onChange={handleChange}
                aria-labelledby="ai-auto-reply-label"
                aria-label="AI auto-reply"
              />
            </Flex>
          </Flex>

          {failed && (
            <Alert
              type="error"
              showIcon
              title="Could not read the AI auto-reply setting."
              description={
                <Flex vertical gap={space.md} align="flex-start">
                  <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>
                    The switch is disabled because its real state is unknown — it is not
                    necessarily off. Stopping the assistant is still possible below.
                  </Text>
                  {/* The one action that must survive a failed read: an operator who came
                      here to stop the assistant cannot be told to wait for a GET. */}
                  <Button danger size="small" loading={saving} onClick={() => void apply(false)}>
                    Turn auto-reply off
                  </Button>
                </Flex>
              }
            />
          )}

          {!failed && fromServerConfig && (
            <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
              Currently {enabled ? 'on' : 'off'} because of the server configuration — no
              one has set this explicitly. Using the switch overrides it from now on.
            </Text>
          )}

          <div
            style={{
              background: color.fill,
              borderRadius: radius.md,
              padding: `${space.md}px ${space.lg}px`,
            }}
          >
            <Text
              strong
              style={{
                display: 'block',
                fontSize: font.size.footnote,
                marginBottom: space.sm,
              }}
            >
              What this does
            </Text>
            <Text
              style={{
                display: 'block',
                fontSize: font.size.footnote,
                color: color.textSecondary,
                marginBottom: space.md,
              }}
            >
              When on, the assistant reads each inbound reply and answers it over WhatsApp
              without waiting for a person. When off, every reply is left for a human in
              Conversations.
            </Text>
            <Text
              strong
              style={{
                display: 'block',
                fontSize: font.size.footnote,
                marginBottom: space.sm,
              }}
            >
              Guards that stay in force while it is on
            </Text>
            <Flex vertical gap={space.xs}>
              {[
                'Per-campaign switches — any campaign can opt out and be handled by people only.',
                'Opted-out and suppressed contacts are never messaged.',
                'The assistant hands over to a human whenever it is unsure.',
                'Replies go out through the same humanised pacing as campaigns.',
              ].map((guard) => (
                <Text
                  key={guard}
                  style={{ fontSize: font.size.footnote, color: color.textSecondary }}
                >
                  • {guard}
                </Text>
              ))}
            </Flex>
          </div>
        </Flex>
      </Card>
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
    { key: 'assistant', label: 'AI Assistant', children: <AssistantTab /> },
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

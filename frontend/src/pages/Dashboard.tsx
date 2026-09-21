import { useCallback, useEffect, useState } from 'react';
import { Row, Col, Card, Table, Typography, Progress, Flex, Spin, Empty, Badge, Button } from 'antd';
import {
  ContactsOutlined,
  SendOutlined,
  CheckCircleOutlined,
  MessageOutlined,
  FunnelPlotOutlined,
  TrophyOutlined,
  WhatsAppOutlined,
} from '@ant-design/icons';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import WhatsAppConnectModal from '../components/WhatsAppConnectModal';
import { dashboardAPI, gatewayAPI } from '../services/endpoints';
import type { WhatsAppConnection } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

interface OverviewData {
  totalContacts: number;
  validContacts: number;
  messagesSent: number;
  messagesDelivered: number;
  messagesRead: number;
  responses: number;
  totalLeads: number;
  totalDeals: number;
  activeCampaigns: number;
  conversionRate: number;
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  stats_sent: number;
  stats_delivered: number;
  stats_read: number;
  stats_replied: number;
  stats_opted_out: number;
  stats_leads: number;
}

interface PipelineEntry {
  status: string;
  count: number;
}

const pipelineColors: Record<string, string> = {
  new: color.accent,
  contacted: color.info,
  interested: color.info,
  qualified: color.success,
  proposal_sent: color.accent,
  negotiation: color.warning,
  won: color.success,
  lost: color.danger,
};

export default function Dashboard() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineEntry[]>([]);
  const [connection, setConnection] = useState<WhatsAppConnection | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  /** Bumped to force an out-of-band re-probe, e.g. right after pairing succeeds. */
  const [connectionTick, setConnectionTick] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [ovRes, campRes, pipeRes] = await Promise.all([
          dashboardAPI.getOverview(),
          dashboardAPI.getCampaigns(),
          dashboardAPI.getPipeline(),
        ]);
        setOverview(ovRes.data);
        setCampaigns(Array.isArray(campRes.data) ? campRes.data : []);
        setPipeline(Array.isArray(pipeRes.data) ? pipeRes.data : []);
      } catch {
        /* errors handled silently — empty state shown */
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // WhatsApp connection state is fetched separately so a gateway outage never
  // blocks or blanks the business metrics above — they come from our own database.
  // A failed request is reported as "unreachable" rather than thrown away, so the
  // operator always sees *why* messaging is unavailable.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const { data } = await gatewayAPI.connection();
        if (!cancelled) setConnection(data);
      } catch {
        if (!cancelled) {
          setConnection({
            connected: false,
            gatewayReachable: false,
            status: 'gateway_unreachable',
            phone: null,
            sessionId: null,
            sessionName: null,
            awaitingScan: false,
            message: 'Messaging gateway unreachable',
          });
        }
      }
    };
    void probe();
    const timer = setInterval(() => void probe(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connectionTick]);

  const refreshConnection = useCallback(() => setConnectionTick((n) => n + 1), []);

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 400 }}>
        <Spin size="large" />
      </Flex>
    );
  }

  const ov = overview;
  const deliveryPct =
    ov && ov.messagesSent > 0
      ? ((ov.messagesDelivered / ov.messagesSent) * 100).toFixed(1)
      : '0';
  const responsePct =
    ov && ov.messagesSent > 0
      ? ((ov.responses / ov.messagesSent) * 100).toFixed(1)
      : '0';

  const stats = [
    {
      icon: <ContactsOutlined />,
      title: 'Total Contacts',
      value: ov?.totalContacts?.toLocaleString() ?? '0',
      subtitle: `${ov?.validContacts ?? 0} verified`,
      accent: color.accent,
    },
    {
      icon: <SendOutlined />,
      title: 'Messages Sent',
      value: ov?.messagesSent?.toLocaleString() ?? '0',
      accent: color.accent,
    },
    {
      icon: <CheckCircleOutlined />,
      title: 'Delivered Rate',
      value: `${deliveryPct}%`,
      subtitle: `${ov?.messagesDelivered?.toLocaleString() ?? 0} delivered`,
      accent: color.success,
    },
    {
      icon: <MessageOutlined />,
      title: 'Response Rate',
      value: `${responsePct}%`,
      subtitle: `${ov?.responses ?? 0} responses`,
      accent: color.info,
    },
    {
      icon: <FunnelPlotOutlined />,
      title: 'Active Leads',
      value: ov?.totalLeads?.toLocaleString() ?? '0',
      subtitle: `${ov?.activeCampaigns ?? 0} campaigns`,
      accent: color.warning,
    },
    {
      icon: <TrophyOutlined />,
      title: 'Total Deals',
      value: ov?.totalDeals?.toLocaleString() ?? '0',
      subtitle: `${ov?.conversionRate ?? 0}% conversion`,
      accent: color.success,
    },
  ];

  const campaignColumns = [
    {
      title: 'Campaign',
      dataIndex: 'name',
      key: 'name',
      render: (t: string) => <Text strong>{t}</Text>,
    },
    {
      title: 'Sent',
      dataIndex: 'stats_sent',
      key: 'stats_sent',
      render: (v: number) => (v ?? 0).toLocaleString(),
    },
    {
      title: 'Delivered',
      dataIndex: 'stats_delivered',
      key: 'stats_delivered',
      render: (v: number) => (v ?? 0).toLocaleString(),
    },
    {
      title: 'Read',
      dataIndex: 'stats_read',
      key: 'stats_read',
      render: (v: number) => (v ?? 0).toLocaleString(),
    },
    {
      title: 'Replied',
      dataIndex: 'stats_replied',
      key: 'stats_replied',
      render: (v: number) => (v ?? 0).toLocaleString(),
    },
    {
      title: 'Leads',
      dataIndex: 'stats_leads',
      key: 'stats_leads',
      render: (v: number) => (
        <Text strong style={{ color: color.accent }}>
          {v ?? 0}
        </Text>
      ),
    },
  ];

  const maxPipelineCount = Math.max(...pipeline.map((s) => s.count), 1);

  const connected = connection?.connected === true;
  // Amber for a session problem the operator can fix by scanning; red only when
  // the gateway process itself is unreachable and scanning would not help.
  const problemColor = connection?.gatewayReachable ? color.warning : color.danger;
  const connectionLabel = connected
    ? connection?.phone
      ? `WhatsApp connected · ${connection.phone}`
      : 'WhatsApp connected'
    : // Empty/absent messages fall back, so the badge never renders blank.
      (connection?.message?.trim() || 'WhatsApp not connected');

  return (
    <div>
      <Flex justify="space-between" align="flex-start" wrap gap={space.md}>
        <PageHeader
          title="Dashboard"
          subtitle="Welcome back — here's what's happening today"
        />
        {connection && (
          <Flex align="center" gap={space.md} wrap style={{ marginTop: 6 }}>
            <Badge
              status={connected ? 'success' : connection.gatewayReachable ? 'warning' : 'error'}
              text={
                <Text
                  style={{
                    fontSize: font.size.footnote,
                    color: connected ? color.success : problemColor,
                  }}
                >
                  {connectionLabel}
                </Text>
              }
            />
            {!connected && (
              <Button
                type="primary"
                icon={<WhatsAppOutlined />}
                onClick={() => setConnectOpen(true)}
              >
                Connect WhatsApp
              </Button>
            )}
          </Flex>
        )}
      </Flex>

      <WhatsAppConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={refreshConnection}
      />

      <Row gutter={[20, 20]} style={{ marginBottom: 28 }}>
        {stats.map((s) => (
          <Col xs={24} sm={12} lg={8} xl={4} key={s.title}>
            <StatCard
              icon={s.icon}
              title={s.title}
              value={s.value}
              subtitle={s.subtitle}
              accentColor={s.accent}
            />
          </Col>
        ))}
      </Row>

      <Row gutter={[20, 20]}>
        <Col xs={24} xl={16}>
          <Card
            title={
              <Text strong style={{ fontSize: font.size.headline, color: color.text }}>
                Campaign Performance
              </Text>
            }
            style={{
              borderRadius: radius.xl,
              border: `1px solid ${color.separator}`,
            }}
            styles={{ body: { padding: 0 } }}
          >
            {campaigns.length === 0 ? (
              <div style={{ padding: space.xxxl }}>
                <Empty description="No campaigns yet. Create your first campaign to see performance data." />
              </div>
            ) : (
              <Table
                dataSource={campaigns}
                columns={campaignColumns}
                rowKey="id"
                pagination={false}
                size="middle"
                // Without this the Sent/Delivered/Read/Replied/Leads columns run past
                // a narrow viewport with no way to reach them.
                scroll={{ x: 'max-content' }}
                style={{
                  borderRadius: `0 0 ${radius.xl}px ${radius.xl}px`,
                  overflow: 'hidden',
                }}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card
            title={
              <Text strong style={{ fontSize: font.size.headline, color: color.text }}>
                Lead Pipeline
              </Text>
            }
            style={{
              borderRadius: radius.xl,
              border: `1px solid ${color.separator}`,
            }}
          >
            {pipeline.length === 0 ? (
              <Empty description="No leads in the pipeline yet." />
            ) : (
              <Flex vertical gap={space.lg}>
                {pipeline.map((s) => {
                  const barColor =
                    pipelineColors[s.status?.toLowerCase().replace(/[\s-]/g, '_')] ?? color.accent;
                  const label = (s.status ?? 'Unknown')
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase());
                  return (
                    <div key={s.status}>
                      <Flex
                        justify="space-between"
                        style={{ marginBottom: 6 }}
                      >
                        <Text
                          style={{
                            fontSize: font.size.footnote,
                            color: color.textSecondary,
                            fontWeight: font.weight.medium,
                          }}
                        >
                          {label}
                        </Text>
                        <Text
                          strong
                          style={{ fontSize: font.size.footnote, color: color.text }}
                        >
                          {s.count}
                        </Text>
                      </Flex>
                      <Progress
                        percent={(s.count / maxPipelineCount) * 100}
                        showInfo={false}
                        strokeColor={barColor}
                        trailColor={color.fill}
                        size={['100%', 10]}
                        style={{ marginBottom: 0 }}
                      />
                    </div>
                  );
                })}
              </Flex>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

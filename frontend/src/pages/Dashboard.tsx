import { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Typography, Progress, Flex, Spin, Empty } from 'antd';
import {
  ContactsOutlined,
  SendOutlined,
  CheckCircleOutlined,
  MessageOutlined,
  FunnelPlotOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import StatCard from '../components/StatCard';
import PageHeader from '../components/PageHeader';
import { dashboardAPI } from '../services/endpoints';

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
  new: '#6366F1',
  contacted: '#06B6D4',
  interested: '#06B6D4',
  qualified: '#10B981',
  proposal_sent: '#8B5CF6',
  negotiation: '#F59E0B',
  won: '#10B981',
  lost: '#EF4444',
};

export default function Dashboard() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineEntry[]>([]);
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
      accent: '#4F46E5',
    },
    {
      icon: <SendOutlined />,
      title: 'Messages Sent',
      value: ov?.messagesSent?.toLocaleString() ?? '0',
      accent: '#6366F1',
    },
    {
      icon: <CheckCircleOutlined />,
      title: 'Delivered Rate',
      value: `${deliveryPct}%`,
      subtitle: `${ov?.messagesDelivered?.toLocaleString() ?? 0} delivered`,
      accent: '#10B981',
    },
    {
      icon: <MessageOutlined />,
      title: 'Response Rate',
      value: `${responsePct}%`,
      subtitle: `${ov?.responses ?? 0} responses`,
      accent: '#06B6D4',
    },
    {
      icon: <FunnelPlotOutlined />,
      title: 'Active Leads',
      value: ov?.totalLeads?.toLocaleString() ?? '0',
      subtitle: `${ov?.activeCampaigns ?? 0} campaigns`,
      accent: '#F59E0B',
    },
    {
      icon: <TrophyOutlined />,
      title: 'Total Deals',
      value: ov?.totalDeals?.toLocaleString() ?? '0',
      subtitle: `${ov?.conversionRate ?? 0}% conversion`,
      accent: '#10B981',
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
        <Text strong style={{ color: '#4F46E5' }}>
          {v ?? 0}
        </Text>
      ),
    },
  ];

  const maxPipelineCount = Math.max(...pipeline.map((s) => s.count), 1);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Welcome back — here's what's happening today"
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
              <Text strong style={{ fontSize: 16, color: '#111827' }}>
                Campaign Performance
              </Text>
            }
            style={{
              borderRadius: 14,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
            styles={{ body: { padding: 0 } }}
          >
            {campaigns.length === 0 ? (
              <div style={{ padding: 48 }}>
                <Empty description="No campaigns yet. Create your first campaign to see performance data." />
              </div>
            ) : (
              <Table
                dataSource={campaigns}
                columns={campaignColumns}
                rowKey="id"
                pagination={false}
                size="middle"
                style={{
                  borderRadius: '0 0 14px 14px',
                  overflow: 'hidden',
                }}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card
            title={
              <Text strong style={{ fontSize: 16, color: '#111827' }}>
                Lead Pipeline
              </Text>
            }
            style={{
              borderRadius: 14,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            {pipeline.length === 0 ? (
              <Empty description="No leads in the pipeline yet." />
            ) : (
              <Flex vertical gap={16}>
                {pipeline.map((s) => {
                  const color =
                    pipelineColors[s.status?.toLowerCase().replace(/[\s-]/g, '_')] ?? '#6366F1';
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
                            fontSize: 13,
                            color: '#374151',
                            fontWeight: 500,
                          }}
                        >
                          {label}
                        </Text>
                        <Text
                          strong
                          style={{ fontSize: 13, color: '#111827' }}
                        >
                          {s.count}
                        </Text>
                      </Flex>
                      <Progress
                        percent={(s.count / maxPipelineCount) * 100}
                        showInfo={false}
                        strokeColor={color}
                        trailColor="#F3F4F6"
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

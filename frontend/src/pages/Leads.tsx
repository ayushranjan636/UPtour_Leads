import { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Input,
  Select,
  Typography,
  Flex,
  Spin,
  Empty,
  message,
  Drawer,
  Descriptions,
} from 'antd';
import {
  SearchOutlined,
  FunnelPlotOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import { leadsAPI } from '../services/endpoints';

const { Text } = Typography;

const statusOptions = [
  { label: 'New', value: 'new' },
  { label: 'Contacted', value: 'contacted' },
  { label: 'Interested', value: 'interested' },
  { label: 'Qualified', value: 'qualified' },
  { label: 'Proposal Sent', value: 'proposal_sent' },
  { label: 'Negotiation', value: 'negotiation' },
  { label: 'Won', value: 'won' },
  { label: 'Lost', value: 'lost' },
];

interface Lead {
  id: string;
  contact_name?: string;
  contact?: { name: string; whatsapp_number: string; email?: string };
  campaign?: { name: string };
  campaign_id?: string;
  status: string;
  score?: number;
  product_interest?: string;
  notes?: string;
  created_at?: string;
}

export default function Leads() {
  const [data, setData] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: pageSize };
      if (search) params.search = search;
      if (filterStatus) params.status = filterStatus;
      const { data: res } = await leadsAPI.list(params);
      setData(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      message.error('Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, filterStatus]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const handleStatusChange = async (leadId: string, newStatus: string) => {
    try {
      await leadsAPI.update(leadId, { status: newStatus });
      message.success('Lead status updated');
      fetchLeads();
      if (selected?.id === leadId) {
        setSelected({ ...selected, status: newStatus });
      }
    } catch {
      message.error('Failed to update status');
    }
  };

  const columns = [
    {
      title: 'Contact',
      key: 'contact',
      render: (_: unknown, record: Lead) => (
        <div>
          <Text strong style={{ display: 'block' }}>
            {record.contact?.name ?? record.contact_name ?? '—'}
          </Text>
          {record.contact?.email && (
            <Text style={{ fontSize: 12, color: '#6B7280' }}>{record.contact.email}</Text>
          )}
        </div>
      ),
    },
    {
      title: 'Campaign',
      key: 'campaign',
      render: (_: unknown, record: Lead) => record.campaign?.name ?? '—',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 180,
      render: (status: string, record: Lead) => (
        <Select
          value={status}
          size="small"
          style={{ width: 160 }}
          onChange={(val) => handleStatusChange(record.id, val)}
          options={statusOptions}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    {
      title: 'Score',
      dataIndex: 'score',
      key: 'score',
      width: 80,
      render: (s: number) =>
        s != null ? (
          <Text strong style={{ color: s >= 80 ? '#10B981' : s >= 60 ? '#F59E0B' : '#EF4444' }}>
            {s}
          </Text>
        ) : (
          <Text style={{ color: '#D1D5DB' }}>—</Text>
        ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (d: string) =>
        d ? (
          <Text style={{ fontSize: 13, color: '#6B7280' }}>
            {new Date(d).toLocaleDateString()}
          </Text>
        ) : (
          '—'
        ),
    },
  ];

  if (!loading && data.length === 0 && !search && !filterStatus) {
    return (
      <div>
        <PageHeader title="Leads" subtitle="0 leads" />
        <Flex justify="center" style={{ padding: '80px 0' }}>
          <Empty
            image={<FunnelPlotOutlined style={{ fontSize: 64, color: '#D1D5DB' }} />}
            description={
              <div style={{ marginTop: 16 }}>
                <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>
                  No leads yet
                </Text>
                <Text style={{ color: '#6B7280' }}>
                  Leads will appear here as contacts respond to your campaigns.
                </Text>
              </div>
            }
          />
        </Flex>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle={`${total} leads`}
      />

      <Flex gap={12} style={{ marginBottom: 20 }}>
        <Input
          placeholder="Search leads..."
          prefix={<SearchOutlined style={{ color: '#9CA3AF' }} />}
          style={{ maxWidth: 320 }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          allowClear
        />
        <Select
          placeholder="Status"
          allowClear
          style={{ width: 180 }}
          value={filterStatus}
          onChange={(v) => { setFilterStatus(v); setPage(1); }}
          options={statusOptions}
        />
      </Flex>

      <Spin spinning={loading}>
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `${t} leads`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
          onRow={(record) => ({
            onClick: () => { setSelected(record); setDrawerOpen(true); },
            style: { cursor: 'pointer' },
          })}
          style={{
            background: '#FFF',
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        />
      </Spin>

      <Drawer
        title={selected?.contact?.name ?? selected?.contact_name ?? 'Lead Detail'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={440}
      >
        {selected && (
          <Flex vertical gap={20}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Contact">
                {selected.contact?.name ?? selected.contact_name ?? '—'}
              </Descriptions.Item>
              {selected.contact?.whatsapp_number && (
                <Descriptions.Item label="WhatsApp">
                  {selected.contact.whatsapp_number}
                </Descriptions.Item>
              )}
              {selected.contact?.email && (
                <Descriptions.Item label="Email">
                  {selected.contact.email}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Campaign">
                {selected.campaign?.name ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <StatusTag status={selected.status} />
              </Descriptions.Item>
              {selected.score != null && (
                <Descriptions.Item label="Score">{selected.score}</Descriptions.Item>
              )}
              {selected.product_interest && (
                <Descriptions.Item label="Product Interest">
                  {selected.product_interest}
                </Descriptions.Item>
              )}
              {selected.notes && (
                <Descriptions.Item label="Notes">{selected.notes}</Descriptions.Item>
              )}
              <Descriptions.Item label="Created">
                {selected.created_at
                  ? new Date(selected.created_at).toLocaleDateString()
                  : '—'}
              </Descriptions.Item>
            </Descriptions>
            <Select
              value={selected.status}
              style={{ width: '100%' }}
              onChange={(val) => handleStatusChange(selected.id, val)}
              options={statusOptions}
            />
          </Flex>
        )}
      </Drawer>
    </div>
  );
}

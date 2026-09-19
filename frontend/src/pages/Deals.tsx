import { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Select,
  Modal,
  Form,
  Input,
  InputNumber,
  DatePicker,
  Typography,
  Flex,
  Spin,
  Empty,
  message,
  Popconfirm,
} from 'antd';
import {
  PlusOutlined,
  DollarOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { dealsAPI, leadsAPI } from '../services/endpoints';

const { Text } = Typography;

const stageOptions = [
  { label: 'Proposal', value: 'proposal' },
  { label: 'Negotiation', value: 'negotiation' },
  { label: 'Verbal Agreement', value: 'verbal_agreement' },
  { label: 'Won', value: 'won' },
  { label: 'Lost', value: 'lost' },
];

interface Deal {
  id: string;
  name?: string;
  lead_id?: string;
  lead?: { contact?: { name: string; company?: { name: string } } };
  stage: string;
  estimated_value?: number;
  expected_close_date?: string;
  created_at?: string;
}

function formatCurrency(v: number | undefined) {
  if (!v) return '—';
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  return `₹${v.toLocaleString()}`;
}

export default function Deals() {
  const [data, setData] = useState<Deal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [leads, setLeads] = useState<{ id: string; label: string }[]>([]);

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await dealsAPI.list({ page, limit: pageSize });
      setData(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      message.error('Failed to load deals');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await dealsAPI.create({
        lead_id: values.lead_id,
        name: values.name,
        estimated_value: values.estimated_value,
        expected_close_date: values.expected_close_date?.format('YYYY-MM-DD'),
        stage: values.stage || 'proposal',
      });
      message.success('Deal created');
      setModalOpen(false);
      form.resetFields();
      fetchDeals();
    } catch {
      /* validation or API error */
    } finally {
      setSaving(false);
    }
  };

  const handleStageChange = async (dealId: string, newStage: string) => {
    try {
      await dealsAPI.update(dealId, { stage: newStage });
      message.success('Deal stage updated');
      fetchDeals();
    } catch {
      message.error('Failed to update stage');
    }
  };

  const handleDelete = async (dealId: string) => {
    try {
      await dealsAPI.delete(dealId);
      message.success('Deal deleted');
      fetchDeals();
    } catch {
      message.error('Failed to delete deal');
    }
  };

  const openCreate = async () => {
    form.resetFields();
    setModalOpen(true);
    try {
      const { data: res } = await leadsAPI.list({ page: 1, limit: 100 });
      setLeads(
        (res.data ?? []).map((l: { id: string; contact?: { name: string }; contact_name?: string }) => ({
          id: l.id,
          label: l.contact?.name ?? l.contact_name ?? l.id,
        })),
      );
    } catch { /* ignore */ }
  };

  const totalValue = data.reduce((s, d) => s + (d.estimated_value ?? 0), 0);
  const wonValue = data.filter((d) => d.stage === 'won').reduce((s, d) => s + (d.estimated_value ?? 0), 0);

  const columns = [
    {
      title: 'Deal',
      key: 'name',
      render: (_: unknown, record: Deal) => (
        <Text strong>{record.name || record.lead?.contact?.name || '—'}</Text>
      ),
    },
    {
      title: 'Contact',
      key: 'contact',
      render: (_: unknown, record: Deal) => record.lead?.contact?.name ?? '—',
    },
    {
      title: 'Value',
      dataIndex: 'estimated_value',
      key: 'estimated_value',
      sorter: (a: Deal, b: Deal) => (a.estimated_value ?? 0) - (b.estimated_value ?? 0),
      render: (v: number) => (
        <Flex align="center" gap={4}>
          <DollarOutlined style={{ color: '#10B981', fontSize: 13 }} />
          <Text strong style={{ color: '#111827' }}>{formatCurrency(v)}</Text>
        </Flex>
      ),
    },
    {
      title: 'Stage',
      dataIndex: 'stage',
      key: 'stage',
      width: 180,
      render: (stage: string, record: Deal) => (
        <Select
          value={stage}
          size="small"
          style={{ width: 160 }}
          onChange={(val) => handleStageChange(record.id, val)}
          options={stageOptions}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    {
      title: 'Expected Close',
      dataIndex: 'expected_close_date',
      key: 'expected_close_date',
      render: (d: string) =>
        d ? (
          <Text style={{ fontSize: 13, color: '#6B7280' }}>
            {new Date(d).toLocaleDateString()}
          </Text>
        ) : (
          <Text style={{ color: '#D1D5DB' }}>—</Text>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_: unknown, record: Deal) => (
        <Popconfirm title="Delete this deal?" onConfirm={() => handleDelete(record.id)}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  if (!loading && data.length === 0) {
    return (
      <div>
        <PageHeader title="Deals" subtitle="0 deals" />
        <Flex justify="center" style={{ padding: '80px 0' }}>
          <Empty
            image={<DollarOutlined style={{ fontSize: 64, color: '#D1D5DB' }} />}
            description={
              <div style={{ marginTop: 16 }}>
                <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>
                  No deals yet
                </Text>
                <Text style={{ color: '#6B7280' }}>
                  Create a deal from a qualified lead to start tracking revenue.
                </Text>
              </div>
            }
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Create Deal
            </Button>
          </Empty>
        </Flex>
        <DealModal
          open={modalOpen}
          form={form}
          saving={saving}
          leads={leads}
          onSave={handleCreate}
          onCancel={() => { setModalOpen(false); form.resetFields(); }}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Deals"
        subtitle={`${total} deals · Pipeline: ${formatCurrency(totalValue)} · Won: ${formatCurrency(wonValue)}`}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Create Deal
          </Button>
        }
      />

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
            showTotal: (t) => `${t} deals`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
          style={{
            background: '#FFF',
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}
        />
      </Spin>

      <DealModal
        open={modalOpen}
        form={form}
        saving={saving}
        leads={leads}
        onSave={handleCreate}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
      />
    </div>
  );
}

function DealModal({
  open,
  form,
  saving,
  leads,
  onSave,
  onCancel,
}: {
  open: boolean;
  form: ReturnType<typeof Form.useForm>[0];
  saving: boolean;
  leads: { id: string; label: string }[];
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title="Create Deal"
      open={open}
      onOk={onSave}
      confirmLoading={saving}
      onCancel={onCancel}
      okText="Create Deal"
      width={480}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="lead_id" label="Lead" rules={[{ required: true }]}>
          <Select
            placeholder="Select a lead..."
            showSearch
            filterOption={(input, option) =>
              (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={leads.map((l) => ({ label: l.label, value: l.id }))}
          />
        </Form.Item>
        <Form.Item name="name" label="Deal Name" rules={[{ required: true, message: 'Enter a deal name' }]}>
          <Input placeholder="e.g. Sakura Travel — Golden Triangle" />
        </Form.Item>
        <Flex gap={12}>
          <Form.Item name="estimated_value" label="Estimated Value (₹)" style={{ flex: 1 }}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="500000" />
          </Form.Item>
          <Form.Item name="expected_close_date" label="Expected Close" style={{ flex: 1 }}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Flex>
        <Form.Item name="stage" label="Stage" initialValue="proposal">
          <Select options={[
            { label: 'Proposal', value: 'proposal' },
            { label: 'Negotiation', value: 'negotiation' },
            { label: 'Verbal Agreement', value: 'verbal_agreement' },
            { label: 'Won', value: 'won' },
            { label: 'Lost', value: 'lost' },
          ]} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

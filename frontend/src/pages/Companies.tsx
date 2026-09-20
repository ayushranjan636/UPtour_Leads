import { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Input,
  Select,
  Modal,
  Form,
  Typography,
  Flex,
  Spin,
  Empty,
  message,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  GlobalOutlined,
  BankOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { companiesAPI } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

interface Company {
  id: string;
  name: string;
  country?: string;
  city?: string;
  agency_type?: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  contacts_count?: number;
  created_at?: string;
}

export default function Companies() {
  const [data, setData] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [filterCountry, setFilterCountry] = useState<string | undefined>(undefined);
  const [filterType, setFilterType] = useState<string | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: pageSize };
      if (search) params.search = search;
      if (filterCountry) params.country = filterCountry;
      if (filterType) params.agency_type = filterType;
      const { data: res } = await companiesAPI.list(params);
      setData(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      message.error('Failed to load companies');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, filterCountry, filterType]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingCompany) {
        await companiesAPI.update(editingCompany.id, values);
        message.success('Company updated');
      } else {
        await companiesAPI.create(values);
        message.success('Company created');
      }
      setModalOpen(false);
      setEditingCompany(null);
      form.resetFields();
      fetchCompanies();
    } catch {
      /* validation or API error */
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (record: Company) => {
    setEditingCompany(record);
    form.setFieldsValue({
      name: record.name,
      country: record.country,
      city: record.city,
      agency_type: record.agency_type,
      website: record.website,
      phone: record.phone,
      email: record.email,
      address: record.address,
    });
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditingCompany(null);
    form.resetFields();
    setModalOpen(true);
  };

  const columns = [
    {
      title: 'Company',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Company) => (
        <Flex align="center" gap={space.md}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: radius.lg,
              background: color.accentSoft,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <BankOutlined style={{ color: color.accent }} />
          </div>
          <div>
            <Text strong style={{ display: 'block' }}>{name}</Text>
            {record.website && (
              <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>{record.website}</Text>
            )}
          </div>
        </Flex>
      ),
    },
    {
      title: 'Country',
      dataIndex: 'country',
      key: 'country',
      render: (c: string) =>
        c ? (
          <Flex align="center" gap={6}>
            <GlobalOutlined style={{ color: color.textTertiary, fontSize: font.size.footnote }} />
            {c}
          </Flex>
        ) : (
          <Text style={{ color: color.textTertiary }}>—</Text>
        ),
    },
    {
      title: 'City',
      dataIndex: 'city',
      key: 'city',
      render: (c: string) => c || <Text style={{ color: color.textTertiary }}>—</Text>,
    },
    {
      title: 'Type',
      dataIndex: 'agency_type',
      key: 'agency_type',
      render: (t: string) =>
        t ? (
          <span
            style={{
              padding: '3px 10px',
              borderRadius: radius.sm,
              background:
                t === 'Inbound' ? color.successSoft : t === 'Outbound' ? color.accentSoft : color.warningSoft,
              color:
                t === 'Inbound' ? color.success : t === 'Outbound' ? color.accent : color.warning,
              fontWeight: font.weight.medium,
              fontSize: font.size.caption,
            }}
          >
            {t}
          </span>
        ) : (
          <Text style={{ color: color.textTertiary }}>—</Text>
        ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: Company) => (
        <Button size="small" type="link" onClick={() => openEdit(record)}>
          Edit
        </Button>
      ),
    },
  ];

  if (!loading && data.length === 0 && !search && !filterCountry && !filterType) {
    return (
      <div>
        <PageHeader title="Companies" subtitle="0 companies" />
        <Flex justify="center" style={{ padding: '80px 0' }}>
          <Empty
            image={<BankOutlined style={{ fontSize: 64, color: color.textTertiary }} />}
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
                  No companies yet
                </Text>
                <Text style={{ color: color.textSecondary }}>
                  Add your first company to organize contacts.
                </Text>
              </div>
            }
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Company
            </Button>
          </Empty>
        </Flex>
        <CompanyModal
          open={modalOpen}
          editing={editingCompany}
          form={form}
          saving={saving}
          onSave={handleSave}
          onCancel={() => { setModalOpen(false); setEditingCompany(null); form.resetFields(); }}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Companies"
        subtitle={`${total} companies total`}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add Company
          </Button>
        }
      />

      <Flex gap={space.md} style={{ marginBottom: 20 }}>
        <Input
          placeholder="Search companies..."
          prefix={<SearchOutlined style={{ color: color.textTertiary }} />}
          style={{ maxWidth: 320 }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          allowClear
        />
        <Select
          placeholder="Country"
          allowClear
          style={{ width: 180 }}
          value={filterCountry}
          onChange={(v) => { setFilterCountry(v); setPage(1); }}
          options={[
            { label: 'Japan', value: 'Japan' },
            { label: 'India', value: 'India' },
            { label: 'United Kingdom', value: 'United Kingdom' },
            { label: 'UAE', value: 'UAE' },
            { label: 'France', value: 'France' },
            { label: 'Thailand', value: 'Thailand' },
          ]}
        />
        <Select
          placeholder="Agency Type"
          allowClear
          style={{ width: 160 }}
          value={filterType}
          onChange={(v) => { setFilterType(v); setPage(1); }}
          options={[
            { label: 'Inbound', value: 'Inbound' },
            { label: 'Outbound', value: 'Outbound' },
            { label: 'Both', value: 'Both' },
          ]}
        />
      </Flex>

      <Spin spinning={loading}>
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          // Keeps every column reachable instead of clipping on narrow viewports.
          scroll={{ x: 'max-content' }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `${t} companies`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
          style={{
            background: color.surface,
            borderRadius: radius.xl,
            overflow: 'hidden',
            border: `1px solid ${color.separator}`,
          }}
        />
      </Spin>

      <CompanyModal
        open={modalOpen}
        editing={editingCompany}
        form={form}
        saving={saving}
        onSave={handleSave}
        onCancel={() => { setModalOpen(false); setEditingCompany(null); form.resetFields(); }}
      />
    </div>
  );
}

function CompanyModal({
  open,
  editing,
  form,
  saving,
  onSave,
  onCancel,
}: {
  open: boolean;
  editing: Company | null;
  form: ReturnType<typeof Form.useForm>[0];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={editing ? 'Edit Company' : 'Add Company'}
      open={open}
      onOk={onSave}
      confirmLoading={saving}
      onCancel={onCancel}
      okText={editing ? 'Save' : 'Create'}
      width={520}
    >
      <Form form={form} layout="vertical" style={{ marginTop: space.lg }}>
        <Form.Item name="name" label="Company Name" rules={[{ required: true }]}>
          <Input placeholder="e.g. Sakura Travel Co." />
        </Form.Item>
        <Flex gap={space.md}>
          <Form.Item name="country" label="Country" style={{ flex: 1 }}>
            <Input placeholder="e.g. Japan" />
          </Form.Item>
          <Form.Item name="city" label="City" style={{ flex: 1 }}>
            <Input placeholder="e.g. Tokyo" />
          </Form.Item>
        </Flex>
        <Form.Item name="agency_type" label="Agency Type">
          <Select
            placeholder="Select type"
            allowClear
            options={[
              { label: 'Inbound', value: 'Inbound' },
              { label: 'Outbound', value: 'Outbound' },
              { label: 'Both', value: 'Both' },
            ]}
          />
        </Form.Item>
        <Form.Item name="website" label="Website">
          <Input placeholder="e.g. sakuratravel.jp" />
        </Form.Item>
        <Flex gap={space.md}>
          <Form.Item name="phone" label="Phone" style={{ flex: 1 }}>
            <Input placeholder="+81312345678" />
          </Form.Item>
          <Form.Item name="email" label="Email" style={{ flex: 1 }}>
            <Input placeholder="info@company.com" />
          </Form.Item>
        </Flex>
        <Form.Item name="address" label="Address">
          <Input.TextArea rows={2} placeholder="Full address" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

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
  Popconfirm,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  WhatsAppOutlined,
  GlobalOutlined,
  StopOutlined,
  SafetyCertificateOutlined,
  ContactsOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import { contactsAPI } from '../services/endpoints';

const { Text } = Typography;

interface Contact {
  id: string;
  name: string;
  whatsapp_number: string;
  email?: string;
  phone?: string;
  designation?: string;
  company_id?: string;
  country?: string;
  is_opted_out?: boolean;
  is_whatsapp_verified?: boolean;
  created_at?: string;
  company?: { name: string };
}

export default function Contacts() {
  const [data, setData] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [filterCountry, setFilterCountry] = useState<string | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: pageSize };
      if (search) params.search = search;
      if (filterCountry) params.country = filterCountry;
      const { data: res } = await contactsAPI.list(params);
      setData(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch {
      message.error('Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, filterCountry]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingContact) {
        await contactsAPI.update(editingContact.id, values);
        message.success('Contact updated');
      } else {
        await contactsAPI.create(values);
        message.success('Contact created');
      }
      setModalOpen(false);
      setEditingContact(null);
      form.resetFields();
      fetchContacts();
    } catch {
      /* validation error or API error */
    } finally {
      setSaving(false);
    }
  };

  const handleOptOut = async (id: string) => {
    try {
      await contactsAPI.optOut(id);
      message.success('Contact opted out');
      fetchContacts();
    } catch {
      message.error('Failed to opt out contact');
    }
  };

  const handleVerify = async (id: string) => {
    try {
      await contactsAPI.verifyWhatsApp(id);
      message.success('WhatsApp verification initiated');
      fetchContacts();
    } catch {
      message.error('Verification failed');
    }
  };

  const openEdit = (record: Contact) => {
    setEditingContact(record);
    form.setFieldsValue({
      name: record.name,
      whatsapp_number: record.whatsapp_number,
      email: record.email,
      phone: record.phone,
      designation: record.designation,
    });
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditingContact(null);
    form.resetFields();
    setModalOpen(true);
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Contact) => (
        <div>
          <Text strong style={{ display: 'block' }}>{name}</Text>
          {record.email && (
            <Text style={{ fontSize: 12, color: '#6B7280' }}>{record.email}</Text>
          )}
        </div>
      ),
    },
    {
      title: 'WhatsApp',
      dataIndex: 'whatsapp_number',
      key: 'whatsapp_number',
      render: (w: string) => (
        <Flex align="center" gap={6}>
          <WhatsAppOutlined style={{ color: '#25D366' }} />
          <Text style={{ fontSize: 13 }}>{w}</Text>
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
            <GlobalOutlined style={{ color: '#9CA3AF', fontSize: 13 }} />
            {c}
          </Flex>
        ) : (
          <Text style={{ color: '#D1D5DB' }}>—</Text>
        ),
    },
    {
      title: 'Designation',
      dataIndex: 'designation',
      key: 'designation',
      render: (d: string) => d || <Text style={{ color: '#D1D5DB' }}>—</Text>,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_: unknown, record: Contact) => {
        if (record.is_opted_out) return <StatusTag status="opted_out" />;
        if (record.is_whatsapp_verified) return <StatusTag status="verified" />;
        return <StatusTag status="pending" />;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 240,
      render: (_: unknown, record: Contact) => (
        <Flex gap={4}>
          <Button size="small" type="link" onClick={() => openEdit(record)}>
            Edit
          </Button>
          <Button
            size="small"
            type="link"
            icon={<SafetyCertificateOutlined />}
            onClick={() => handleVerify(record.id)}
          >
            Verify
          </Button>
          {!record.is_opted_out && (
            <Popconfirm
              title="Opt out this contact?"
              onConfirm={() => handleOptOut(record.id)}
            >
              <Button size="small" type="link" danger icon={<StopOutlined />}>
                Opt Out
              </Button>
            </Popconfirm>
          )}
        </Flex>
      ),
    },
  ];

  if (!loading && data.length === 0 && !search && !filterCountry) {
    return (
      <div>
        <PageHeader title="Contacts" subtitle="0 contacts" />
        <Flex justify="center" style={{ padding: '80px 0' }}>
          <Empty
            image={<ContactsOutlined style={{ fontSize: 64, color: '#D1D5DB' }} />}
            description={
              <div style={{ marginTop: 16 }}>
                <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>
                  Add your first contact
                </Text>
                <Text style={{ color: '#6B7280' }}>
                  Import contacts or add them manually to get started.
                </Text>
              </div>
            }
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add Contact
            </Button>
          </Empty>
        </Flex>
        <Modal
          title="Add Contact"
          open={modalOpen}
          onOk={handleSave}
          confirmLoading={saving}
          onCancel={() => { setModalOpen(false); form.resetFields(); }}
          okText="Create"
          width={480}
        >
          <ContactForm form={form} />
        </Modal>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={`${total} contacts total`}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add Contact
          </Button>
        }
      />

      <Flex gap={12} style={{ marginBottom: 20 }}>
        <Input
          placeholder="Search contacts..."
          prefix={<SearchOutlined style={{ color: '#9CA3AF' }} />}
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
            { label: 'Germany', value: 'Germany' },
            { label: 'Australia', value: 'Australia' },
          ]}
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
            showTotal: (t) => `${t} contacts`,
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

      <Modal
        title={editingContact ? 'Edit Contact' : 'Add Contact'}
        open={modalOpen}
        onOk={handleSave}
        confirmLoading={saving}
        onCancel={() => {
          setModalOpen(false);
          setEditingContact(null);
          form.resetFields();
        }}
        okText={editingContact ? 'Save' : 'Create'}
        width={480}
      >
        <ContactForm form={form} />
      </Modal>
    </div>
  );
}

function ContactForm({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  return (
    <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
      <Form.Item
        name="name"
        label="Name"
        rules={[{ required: true, message: 'Name is required' }]}
      >
        <Input placeholder="Contact name" />
      </Form.Item>
      <Form.Item
        name="whatsapp_number"
        label="WhatsApp Number"
        rules={[{ required: true, message: 'WhatsApp number is required' }]}
      >
        <Input placeholder="+91XXXXXXXXXX" />
      </Form.Item>
      <Form.Item name="email" label="Email">
        <Input placeholder="email@example.com" />
      </Form.Item>
      <Form.Item name="phone" label="Phone">
        <Input placeholder="Phone number" />
      </Form.Item>
      <Form.Item name="designation" label="Designation">
        <Input placeholder="e.g. Sales Manager" />
      </Form.Item>
    </Form>
  );
}

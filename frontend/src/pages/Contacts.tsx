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
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  GlobalOutlined,
  StopOutlined,
  SafetyCertificateOutlined,
  ContactsOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import { contactsAPI } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

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
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const handleDelete = async (record: Contact) => {
    setDeletingId(record.id);
    try {
      await contactsAPI.remove(record.id);
      message.success(`Deleted ${record.name}`);
      // Stepping back a page avoids landing on an empty final page after deleting
      // the only row on it.
      if (data.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        fetchContacts();
      }
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(detail ?? 'Could not delete this contact');
    } finally {
      setDeletingId(null);
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
        <div style={{ minWidth: 0 }}>
          <Text strong style={{ display: 'block' }}>{name}</Text>
          {record.email && (
            <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
              {record.email}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'WhatsApp',
      dataIndex: 'whatsapp_number',
      key: 'whatsapp_number',
      render: (w: string) => (
        <Text style={{ fontSize: font.size.footnote }}>{w}</Text>
      ),
    },
    {
      title: 'Country',
      dataIndex: 'country',
      key: 'country',
      render: (c: string) =>
        c ? (
          <Flex align="center" gap={6}>
            <GlobalOutlined style={{ color: color.textTertiary, fontSize: 13 }} />
            {c}
          </Flex>
        ) : (
          <Text style={{ color: color.textTertiary }}>—</Text>
        ),
    },
    {
      title: 'Designation',
      dataIndex: 'designation',
      key: 'designation',
      render: (d: string) => d || <Text style={{ color: color.textTertiary }}>—</Text>,
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
      title: '',
      key: 'actions',
      width: 150,
      align: 'right' as const,
      render: (_: unknown, record: Contact) => (
        <Flex gap={2} justify="flex-end" align="center">
          <Tooltip title="Edit contact">
            <Button
              size="small"
              type="text"
              aria-label={`Edit ${record.name}`}
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
            />
          </Tooltip>
          <Tooltip title="Verify on WhatsApp">
            <Button
              size="small"
              type="text"
              aria-label={`Verify ${record.name}`}
              icon={<SafetyCertificateOutlined />}
              onClick={() => handleVerify(record.id)}
            />
          </Tooltip>
          {!record.is_opted_out && (
            <Popconfirm
              title="Stop messaging this contact?"
              description="They stay in your records but receive no further messages."
              okText="Opt Out"
              cancelText="Cancel"
              onConfirm={() => handleOptOut(record.id)}
            >
              {/* Same reason as Delete below: no Tooltip wrapper inside a Popconfirm. */}
              <Button
                size="small"
                type="text"
                title="Opt out"
                aria-label={`Opt out ${record.name}`}
                icon={<StopOutlined />}
              />
            </Popconfirm>
          )}
          {/* Permanent delete. Kept visually quiet (text button, danger colour only
              on the icon) so it never competes with routine actions, and always
              gated behind an explicit confirmation naming the consequence.
              The button carries its own aria-label rather than a Tooltip: a tooltip
              here renders above the Popconfirm (z-index 1200 vs 1060) and can
              swallow the click on its own Delete button. */}
          <Popconfirm
            title={`Delete ${record.name}?`}
            description="This also removes their messages, campaign history and leads. This cannot be undone."
            okText="Delete"
            okButtonProps={{ danger: true }}
            cancelText="Cancel"
            onConfirm={() => handleDelete(record)}
          >
            <Button
              size="small"
              type="text"
              danger
              loading={deletingId === record.id}
              title="Delete contact"
              aria-label={`Delete ${record.name}`}
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Flex>
      ),
    },
  ];

  if (!loading && data.length === 0 && !search && !filterCountry) {
    return (
      <div>
        <PageHeader title="Contacts" subtitle="No contacts yet" />
        <Flex justify="center" style={{ padding: '72px 0' }}>
          <Empty
            image={<ContactsOutlined style={{ fontSize: 48, color: color.textTertiary }} />}
            description={
              <div style={{ marginTop: space.md }}>
                <Text
                  strong
                  style={{
                    fontSize: font.size.headline,
                    display: 'block',
                    marginBottom: 4,
                    color: color.text,
                  }}
                >
                  Add your first contact
                </Text>
                <Text style={{ color: color.textSecondary }}>
                  Import a list, collect from Google Maps, or add one manually.
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
          width={460}
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
        subtitle={`${total.toLocaleString()} ${total === 1 ? 'contact' : 'contacts'}`}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add Contact
          </Button>
        }
      />

      <Flex gap={space.sm} wrap style={{ marginBottom: space.lg }}>
        <Input
          placeholder="Search name, number, or email"
          aria-label="Search contacts"
          prefix={<SearchOutlined style={{ color: color.textTertiary }} />}
          style={{ maxWidth: 300, flex: '1 1 220px' }}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          allowClear
        />
        <Select
          placeholder="All countries"
          aria-label="Filter by country"
          allowClear
          style={{ width: 168 }}
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
          size="middle"
          // Keeps the action column reachable instead of squashing cells on mobile.
          scroll={{ x: 'max-content' }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `${t.toLocaleString()} ${t === 1 ? 'contact' : 'contacts'}`,
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

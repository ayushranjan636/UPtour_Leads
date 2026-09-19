import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card,
  Table,
  Tabs,
  Button,
  Typography,
  Flex,
  Row,
  Col,
  Spin,
  Empty,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  message,
  Popconfirm,
} from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  SendOutlined,
  CheckCircleOutlined,
  EyeOutlined,
  MessageOutlined,
  FunnelPlotOutlined,
  PercentageOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import StatusTag from '../components/StatusTag';
import {
  campaignsAPI,
  templatesAPI,
  contactsAPI,
  engineAPI,
} from '../services/endpoints';

const { Text } = Typography;
const { TextArea } = Input;

interface CampaignData {
  id: string;
  name: string;
  product?: string;
  target_country?: string;
  status: string;
  description?: string;
  daily_send_limit?: number;
  send_window_start?: string;
  send_window_end?: string;
}

interface CampaignStats {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  leads: number;
}

interface CampaignContact {
  id: string;
  name: string;
  whatsapp_number: string;
  email?: string;
  company?: { name: string };
}

interface Template {
  id: string;
  name: string;
  body: string;
  type?: string;
  sequence_order: number;
  trigger_condition?: string;
}

interface DistPlanSlot {
  time: string;
  count: number;
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<CampaignData | null>(null);
  const [stats, setStats] = useState<CampaignStats>({ sent: 0, delivered: 0, read: 0, replied: 0, leads: 0 });
  const [contacts, setContacts] = useState<CampaignContact[]>([]);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [contactsPage, setContactsPage] = useState(1);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [distPlan, setDistPlan] = useState<DistPlanSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [addContactModal, setAddContactModal] = useState(false);
  const [allContacts, setAllContacts] = useState<{ id: string; name: string; whatsapp_number: string }[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [addingContacts, setAddingContacts] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateForm] = Form.useForm();
  const [savingTemplate, setSavingTemplate] = useState(false);

  const fetchCampaign = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [campRes, statsRes, templRes] = await Promise.all([
        campaignsAPI.get(id),
        campaignsAPI.getStats(id).catch(() => ({ data: {} })),
        templatesAPI.listByCampaign(id).catch(() => ({ data: [] })),
      ]);
      setCampaign(campRes.data);
      const s = statsRes.data || {};
      setStats({
        sent: s.sent ?? s.stats_sent ?? 0,
        delivered: s.delivered ?? s.stats_delivered ?? 0,
        read: s.read ?? s.stats_read ?? 0,
        replied: s.replied ?? s.stats_replied ?? 0,
        leads: s.leads ?? s.stats_leads ?? 0,
      });
      setTemplates(Array.isArray(templRes.data) ? templRes.data : []);

      try {
        const limit = campRes.data?.daily_send_limit ?? 100;
        const start = campRes.data?.send_window_start ?? '09:00';
        const end = campRes.data?.send_window_end ?? '18:00';
        const dpRes = await engineAPI.getDistributionPlan({ daily_limit: limit, window_start: start, window_end: end });
        setDistPlan(Array.isArray(dpRes.data?.slots) ? dpRes.data.slots : []);
      } catch {
        /* distribution plan optional */
      }
    } catch {
      message.error('Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchContacts = useCallback(async () => {
    if (!id) return;
    try {
      const res = await campaignsAPI.getContacts(id, { page: contactsPage, limit: 20 });
      const d = res.data;
      // Rows are CampaignContact wrappers with the contact nested under
      // `.contact`. Flatten so the table's `name`/`whatsapp_number` dataIndexes
      // resolve, while keeping the join row's own status/mode.
      setContacts(
        (d.data ?? []).map((cc: Record<string, any>) => ({
          ...cc.contact,
          id: cc.contact_id ?? cc.contact?.id,
          campaign_contact_id: cc.id,
          status: cc.status,
          mode: cc.mode,
        })),
      );
      setContactsTotal(d.total ?? 0);
    } catch { /* ignore */ }
  }, [id, contactsPage]);

  useEffect(() => { fetchCampaign(); }, [fetchCampaign]);
  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const handleActivate = async () => {
    if (!id) return;
    try {
      await campaignsAPI.activate(id);
      message.success('Campaign activated');
      fetchCampaign();
    } catch {
      message.error('Failed to activate');
    }
  };

  const handlePause = async () => {
    if (!id) return;
    try {
      await campaignsAPI.pause(id);
      message.success('Campaign paused');
      fetchCampaign();
    } catch {
      message.error('Failed to pause');
    }
  };

  const openAddContacts = async () => {
    setAddContactModal(true);
    try {
      const res = await contactsAPI.list({ page: 1, limit: 100 });
      setAllContacts(res.data.data ?? []);
    } catch { /* ignore */ }
  };

  const handleAddContacts = async () => {
    if (!id || selectedContactIds.length === 0) return;
    setAddingContacts(true);
    try {
      await campaignsAPI.addContacts(id, selectedContactIds);
      message.success(`Added ${selectedContactIds.length} contacts`);
      setAddContactModal(false);
      setSelectedContactIds([]);
      fetchContacts();
    } catch {
      message.error('Failed to add contacts');
    } finally {
      setAddingContacts(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!id) return;
    try {
      const values = await templateForm.validateFields();
      setSavingTemplate(true);
      await templatesAPI.create({
        ...values,
        campaign_id: id,
      });
      message.success('Template created');
      setTemplateModalOpen(false);
      templateForm.resetFields();
      fetchCampaign();
    } catch {
      /* validation or API error */
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    try {
      await templatesAPI.delete(templateId);
      message.success('Template deleted');
      fetchCampaign();
    } catch {
      message.error('Failed to delete template');
    }
  };

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 400 }}>
        <Spin size="large" />
      </Flex>
    );
  }

  if (!campaign) {
    return <Empty description="Campaign not found" />;
  }

  const conversion = stats.sent > 0 ? ((stats.leads / stats.sent) * 100).toFixed(1) : '0';

  const statCards = [
    { icon: <SendOutlined />, title: 'Sent', value: stats.sent.toLocaleString(), accent: '#4F46E5' },
    { icon: <CheckCircleOutlined />, title: 'Delivered', value: stats.delivered.toLocaleString(), accent: '#6366F1' },
    { icon: <EyeOutlined />, title: 'Read', value: stats.read.toLocaleString(), accent: '#06B6D4' },
    { icon: <MessageOutlined />, title: 'Replied', value: stats.replied.toLocaleString(), accent: '#10B981' },
    { icon: <FunnelPlotOutlined />, title: 'Leads', value: stats.leads.toString(), accent: '#F59E0B' },
    { icon: <PercentageOutlined />, title: 'Conversion', value: `${conversion}%`, accent: '#10B981' },
  ];

  const contactColumns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (n: string) => <Text strong>{n}</Text>,
    },
    {
      title: 'WhatsApp',
      dataIndex: 'whatsapp_number',
      key: 'whatsapp_number',
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (e: string) => e || <Text style={{ color: '#D1D5DB' }}>—</Text>,
    },
  ];

  const tabItems = [
    {
      key: 'contacts',
      label: `Contacts (${contactsTotal})`,
      children: (
        <div>
          <Flex justify="flex-end" style={{ marginBottom: 16 }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAddContacts}>
              Add Contacts
            </Button>
          </Flex>
          {contacts.length === 0 ? (
            <Empty description="No contacts added yet. Add contacts to start the campaign." />
          ) : (
            <Table
              dataSource={contacts}
              columns={contactColumns}
              rowKey="id"
              pagination={{
                current: contactsPage,
                pageSize: 20,
                total: contactsTotal,
                onChange: (p) => setContactsPage(p),
              }}
            />
          )}
        </div>
      ),
    },
    {
      key: 'templates',
      label: `Templates (${templates.length})`,
      children: (
        <div>
          {templates.length === 0 ? (
            <Empty description="No message templates yet.">
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => { templateForm.resetFields(); setTemplateModalOpen(true); }}
              >
                Add Template
              </Button>
            </Empty>
          ) : (
            <>
              {templates
                .sort((a, b) => a.sequence_order - b.sequence_order)
                .map((t) => (
                  <Card
                    key={t.id}
                    size="small"
                    title={
                      <Flex justify="space-between" align="center">
                        <Text strong>
                          Step {t.sequence_order}: {t.name}
                        </Text>
                        <Flex gap={8}>
                          {t.trigger_condition && (
                            <Text style={{ fontSize: 12, color: '#6B7280' }}>
                              Trigger: {t.trigger_condition}
                            </Text>
                          )}
                          <Popconfirm
                            title="Delete this template?"
                            onConfirm={() => handleDeleteTemplate(t.id)}
                          >
                            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Flex>
                      </Flex>
                    }
                    style={{ borderRadius: 10, marginBottom: 12 }}
                  >
                    <TextArea
                      value={t.body}
                      readOnly
                      autoSize={{ minRows: 2 }}
                      style={{ border: 'none', background: '#FAFBFC', borderRadius: 8 }}
                    />
                  </Card>
                ))}
              <Button
                icon={<PlusOutlined />}
                style={{ marginTop: 8 }}
                onClick={() => { templateForm.resetFields(); setTemplateModalOpen(true); }}
              >
                Add Step
              </Button>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'distribution',
      label: 'Distribution Plan',
      children: (
        <Card style={{ borderRadius: 14 }}>
          {distPlan.length === 0 ? (
            <Empty description="Configure send window and daily limit to see the distribution plan." />
          ) : (
            <Flex vertical gap={8}>
              {distPlan.map((slot, i) => (
                <Flex key={i} align="center" gap={16}>
                  <Text style={{ width: 60, fontSize: 13, fontWeight: 500, color: '#374151' }}>
                    {slot.time}
                  </Text>
                  <div style={{ flex: 1, background: '#F3F4F6', borderRadius: 6, height: 24, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min((slot.count / Math.max(...distPlan.map((s) => s.count), 1)) * 100, 100)}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #4F46E5, #6366F1)',
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        paddingRight: 8,
                      }}
                    >
                      <Text style={{ color: '#FFF', fontSize: 11, fontWeight: 600 }}>
                        {slot.count}
                      </Text>
                    </div>
                  </div>
                </Flex>
              ))}
            </Flex>
          )}
        </Card>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={campaign.name}
        subtitle={[campaign.product, campaign.target_country && `Target: ${campaign.target_country}`].filter(Boolean).join(' · ')}
        actions={
          <>
            <StatusTag status={campaign.status} />
            {campaign.status === 'active' ? (
              <Button icon={<PauseCircleOutlined />} onClick={handlePause}>
                Pause
              </Button>
            ) : (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleActivate}>
                Activate
              </Button>
            )}
          </>
        }
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {statCards.map((s) => (
          <Col xs={12} sm={8} lg={4} key={s.title}>
            <StatCard icon={s.icon} title={s.title} value={s.value} accentColor={s.accent} />
          </Col>
        ))}
      </Row>

      <Card style={{ borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <Tabs items={tabItems} />
      </Card>

      <Modal
        title="Add Contacts to Campaign"
        open={addContactModal}
        onOk={handleAddContacts}
        confirmLoading={addingContacts}
        onCancel={() => { setAddContactModal(false); setSelectedContactIds([]); }}
        okText={`Add ${selectedContactIds.length} Contacts`}
        width={600}
      >
        <Select
          mode="multiple"
          placeholder="Search and select contacts..."
          style={{ width: '100%', marginTop: 16 }}
          value={selectedContactIds}
          onChange={setSelectedContactIds}
          filterOption={(input, option) =>
            (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={allContacts.map((c) => ({
            label: `${c.name} (${c.whatsapp_number})`,
            value: c.id,
          }))}
        />
      </Modal>

      <Modal
        title="Add Message Template"
        open={templateModalOpen}
        onOk={handleCreateTemplate}
        confirmLoading={savingTemplate}
        onCancel={() => { setTemplateModalOpen(false); templateForm.resetFields(); }}
        okText="Create Template"
        width={520}
      >
        <Form form={templateForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Template Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Initial Outreach" />
          </Form.Item>
          <Form.Item name="body" label="Message Body" rules={[{ required: true }]}>
            <TextArea rows={4} placeholder="Hello {{name}}, ..." />
          </Form.Item>
          <Flex gap={12}>
            <Form.Item name="sequence_order" label="Sequence Order" style={{ flex: 1 }} rules={[{ required: true }]}>
              <InputNumber min={1} placeholder="1" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="type" label="Type" style={{ flex: 1 }}>
              <Select
                placeholder="Select type"
                allowClear
                options={[
                  { label: 'Text', value: 'text' },
                  { label: 'Image', value: 'image' },
                  { label: 'Document', value: 'document' },
                ]}
              />
            </Form.Item>
          </Flex>
          <Form.Item name="trigger_condition" label="Trigger Condition">
            <Input placeholder="e.g. no_reply_24h" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

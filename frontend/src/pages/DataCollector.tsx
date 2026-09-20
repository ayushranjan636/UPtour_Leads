import { useEffect, useState, useCallback } from 'react';
import {
  Row,
  Col,
  Card,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Table,
  Typography,
  Flex,
  Spin,
  Empty,
  Alert,
  message,
} from 'antd';
import {
  PlusOutlined,
  CloudDownloadOutlined,
  PlayCircleOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import { collectionAPI, campaignsAPI } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

interface CollectionJob {
  id: string;
  name: string;
  country?: string;
  city?: string;
  category?: string;
  keywords?: string[];
  daily_limit?: number;
  status?: string;
  total_collected?: number;
  last_run_at?: string;
  created_at?: string;
}

interface CollectionResult {
  id: string;
  business_name?: string;
  phone?: string;
  country?: string;
  city?: string;
  address?: string;
  website?: string;
  status?: string;
  created_at?: string;
}

export default function DataCollector() {
  const [jobs, setJobs] = useState<CollectionJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [selectedJob, setSelectedJob] = useState<CollectionJob | null>(null);
  const [results, setResults] = useState<CollectionResult[]>([]);
  const [resultsTotal, setResultsTotal] = useState(0);
  const [resultsPage, setResultsPage] = useState(1);
  const [loadingResults, setLoadingResults] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [sourceReady, setSourceReady] = useState<boolean | null>(null);
  const [sourceMessage, setSourceMessage] = useState('');

  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const { data } = await collectionAPI.list();
      setJobs(Array.isArray(data) ? data : []);
    } catch {
      message.error('Failed to load collection jobs');
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Surface a clear banner when GOOGLE_MAPS_API_KEY is missing, instead of
  // letting every "Run Now" fail with an opaque error.
  useEffect(() => {
    collectionAPI
      .status()
      .then(({ data }) => {
        setSourceReady(!!data.configured);
        setSourceMessage(data.message ?? '');
      })
      .catch(() => setSourceReady(null));
  }, []);

  const fetchResults = useCallback(async (jobId: string) => {
    setLoadingResults(true);
    try {
      const { data } = await collectionAPI.getResults(jobId, { page: resultsPage, limit: 20 });
      setResults(data.data ?? []);
      setResultsTotal(data.total ?? 0);
    } catch {
      setResults([]);
    } finally {
      setLoadingResults(false);
    }
  }, [resultsPage]);

  useEffect(() => {
    if (selectedJob) {
      fetchResults(selectedJob.id);
    }
  }, [selectedJob, fetchResults]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await collectionAPI.create(values);
      message.success('Collection job created');
      setModalOpen(false);
      form.resetFields();
      fetchJobs();
    } catch {
      /* validation or API error */
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async (jobId: string) => {
    setRunningJobId(jobId);
    message.loading({
      content: 'Searching Google Maps…',
      key: 'run',
      duration: 0,
    });
    try {
      const { data } = await collectionAPI.runNow(jobId);
      message.success({
        content: data?.message ?? 'Collection run completed',
        key: 'run',
        duration: 6,
      });
      fetchJobs();
      if (selectedJob?.id === jobId) fetchResults(jobId);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      message.error({
        content: error.response?.data?.message ?? 'Failed to run job',
        key: 'run',
        duration: 6,
      });
    } finally {
      setRunningJobId(null);
    }
  };

  const resultColumns = [
    { title: 'Business', dataIndex: 'business_name', key: 'business_name', render: (n: string) => <Text strong>{n || '—'}</Text> },
    { title: 'Phone', dataIndex: 'phone', key: 'phone', render: (p: string) => p || '—' },
    { title: 'City', dataIndex: 'city', key: 'city', render: (c: string) => c || '—' },
    { title: 'Country', dataIndex: 'country', key: 'country', render: (c: string) => c || '—' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => s ? <StatusTag status={s} /> : '—',
    },
  ];

  if (!loadingJobs && jobs.length === 0) {
    return (
      <div>
        <PageHeader title="Data Collector" subtitle="Automated business contact discovery" />
        <Flex justify="center" style={{ padding: '80px 0' }}>
          <Empty
            image={<CloudDownloadOutlined style={{ fontSize: 48, color: color.textTertiary }} />}
            description={
              <div style={{ marginTop: space.lg }}>
                <Text
                  strong
                  style={{
                    fontSize: font.size.headline,
                    display: 'block',
                    marginBottom: space.sm,
                    color: color.text,
                  }}
                >
                  No collection jobs yet
                </Text>
                <Text style={{ color: color.textSecondary }}>
                  Create a job to automatically discover business contacts in your target markets.
                </Text>
              </div>
            }
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              New Collection Job
            </Button>
          </Empty>
        </Flex>
        <CreateJobModal
          open={modalOpen}
          form={form}
          saving={saving}
          onSave={handleCreate}
          onCancel={() => { setModalOpen(false); form.resetFields(); }}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Data Collector"
        subtitle="Automated business contact discovery via Google Maps"
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            New Collection Job
          </Button>
        }
      />

      {sourceReady === false && (
        <Alert
          type="warning"
          showIcon
          message="Google Maps data source not configured"
          description={sourceMessage}
          style={{ marginBottom: space.xl, borderRadius: radius.lg }}
        />
      )}

      <Spin spinning={loadingJobs}>
        <Row gutter={[space.xl, space.xl]} style={{ marginBottom: 28 }}>
          {jobs.map((job) => {
            const collected = job.total_collected ?? 0;
            const limit = job.daily_limit ?? 0;

            return (
              <Col xs={24} sm={12} xl={6} key={job.id}>
                <Card
                  hoverable
                  onClick={() => setSelectedJob(job)}
                  style={{
                    borderRadius: radius.xl,
                    border:
                      selectedJob?.id === job.id
                        ? `2px solid ${color.accent}`
                        : `1px solid ${color.separator}`,
                  }}
                  styles={{ body: { padding: space.xl } }}
                >
                  <Flex justify="space-between" align="flex-start" style={{ marginBottom: space.md }}>
                    <div>
                      <Text
                        strong
                        style={{
                          fontSize: font.size.callout,
                          display: 'block',
                          color: color.text,
                        }}
                      >
                        {job.name}
                      </Text>
                      {(job.city || job.country) && (
                        <Flex align="center" gap={space.xs} style={{ marginTop: space.xs }}>
                          <GlobalOutlined
                            style={{ fontSize: font.size.caption, color: color.textTertiary }}
                          />
                          <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                            {[job.city, job.country].filter(Boolean).join(', ')}
                          </Text>
                        </Flex>
                      )}
                    </div>
                    {job.status && <StatusTag status={job.status} />}
                  </Flex>

                  <Text
                    style={{
                      fontSize: font.size.caption,
                      color: color.textTertiary,
                      display: 'block',
                      marginBottom: space.md,
                    }}
                  >
                    {job.category ?? 'General'} · Limit: {limit || '—'}/day
                  </Text>

                  <Flex justify="space-between" style={{ marginBottom: space.md }}>
                    <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                      Total collected
                    </Text>
                    <Text
                      style={{
                        fontSize: font.size.caption,
                        fontWeight: font.weight.semibold,
                        color: color.text,
                      }}
                    >
                      {collected}
                    </Text>
                  </Flex>

                  <Button
                    size="small"
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    block
                    loading={runningJobId === job.id}
                    disabled={runningJobId !== null || sourceReady === false}
                    onClick={(e) => { e.stopPropagation(); handleRunNow(job.id); }}
                  >
                    {runningJobId === job.id ? 'Collecting…' : 'Run Now'}
                  </Button>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Spin>

      {selectedJob && (
        <Card
          title={
            <Text strong style={{ fontSize: font.size.headline, color: color.text }}>
              Results: {selectedJob.name}
            </Text>
          }
          style={{ borderRadius: radius.xl, border: `1px solid ${color.separator}` }}
          styles={{ body: { padding: 0 } }}
        >
          <Spin spinning={loadingResults}>
            {results.length === 0 ? (
              <div style={{ padding: space.xxxl }}>
                <Empty description="No results yet. Run the job to start collecting data." />
              </div>
            ) : (
              <Table
                dataSource={results}
                columns={resultColumns}
                rowKey="id"
                // Keeps every column reachable instead of clipping on narrow viewports.
                scroll={{ x: 'max-content' }}
                pagination={{
                  current: resultsPage,
                  pageSize: 20,
                  total: resultsTotal,
                  onChange: (p) => setResultsPage(p),
                }}
              />
            )}
          </Spin>
        </Card>
      )}

      <CreateJobModal
        open={modalOpen}
        form={form}
        saving={saving}
        onSave={handleCreate}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
      />
    </div>
  );
}

function CreateJobModal({
  open,
  form,
  saving,
  onSave,
  onCancel,
}: {
  open: boolean;
  form: ReturnType<typeof Form.useForm>[0];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (open) {
      campaignsAPI.list({ page: 1, limit: 100 }).then(({ data: res }) => {
        setCampaigns((res.data ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
      }).catch(() => {});
    }
  }, [open]);

  return (
    <Modal
      title="New Collection Job"
      open={open}
      onOk={onSave}
      confirmLoading={saving}
      onCancel={onCancel}
      okText="Start Collection"
      width={520}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label="Job Name" rules={[{ required: true }]}>
          <Input placeholder="e.g. Japan Tour Agencies" />
        </Form.Item>
        <Row gutter={space.md}>
          <Col span={12}>
            <Form.Item name="country" label="Country" rules={[{ required: true }]}>
              <Input placeholder="e.g. Japan" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="city" label="City">
              <Input placeholder="e.g. Tokyo (leave empty for all cities)" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="category" label="Business Category" rules={[{ required: true }]}>
          <Select
            placeholder="Select category"
            options={[
              { label: 'Travel Agencies', value: 'Travel Agencies' },
              { label: 'Tour Operators', value: 'Tour Operators' },
              { label: 'Luxury Travel', value: 'Luxury Travel' },
              { label: 'Heritage Tourism', value: 'Heritage Tourism' },
              { label: 'Adventure Tours', value: 'Adventure Tours' },
              { label: 'Buddhist Pilgrimage', value: 'Buddhist Pilgrimage' },
              { label: 'Inbound Tourism', value: 'Inbound Tourism' },
              { label: 'DMC (Destination Mgmt)', value: 'DMC' },
            ]}
          />
        </Form.Item>
        <Form.Item name="auto_add_to_campaign_id" label="Auto-Add to Campaign" extra="Collected contacts will be automatically added to this campaign">
          <Select
            placeholder="Select a campaign (optional)"
            allowClear
            options={campaigns.map((c) => ({ label: c.name, value: c.id }))}
          />
        </Form.Item>
        <Form.Item name="keywords" label="Keywords" extra="Comma-separated. Each keyword becomes an extra Google Maps search, so more keywords = more reach.">
          <Input placeholder="e.g. buddhist tour, pilgrimage operator" />
        </Form.Item>
        <Form.Item
          name="daily_limit"
          label="Daily Contact Limit"
          initialValue={50}
          extra="How many NEW contacts to collect per day"
        >
          <InputNumber min={1} max={500} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

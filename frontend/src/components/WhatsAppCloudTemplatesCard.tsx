import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { whatsappCloudAPI } from '../services/endpoints';
import type { NewWhatsAppCloudTemplate, WhatsAppCloudTemplate } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

const statusColor: Record<string, string> = {
  APPROVED: 'success',
  PENDING: 'processing',
  IN_APPEAL: 'processing',
  REJECTED: 'error',
  PAUSED: 'warning',
  DISABLED: 'default',
};

const LANGUAGES = [
  { value: 'en', label: 'English (en)' },
  { value: 'en_US', label: 'English US (en_US)' },
  { value: 'en_GB', label: 'English UK (en_GB)' },
  { value: 'hi', label: 'Hindi (hi)' },
  { value: 'ml', label: 'Malayalam (ml)' },
  { value: 'ta', label: 'Tamil (ta)' },
  { value: 'kn', label: 'Kannada (kn)' },
  { value: 'te', label: 'Telugu (te)' },
  { value: 'mr', label: 'Marathi (mr)' },
  { value: 'bn', label: 'Bengali (bn)' },
  { value: 'gu', label: 'Gujarati (gu)' },
];

function errorText(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return (Array.isArray(msg) ? msg.join(', ') : msg) || fallback;
}

/**
 * The account's WhatsApp message templates, managed without leaving the portal.
 *
 * The official API only lets a business open a conversation with a template Meta has
 * approved, so this is where outreach starts. Templates are submitted for review here
 * and their approval status is shown, so no one has to go into WhatsApp Manager.
 */
export default function WhatsAppCloudTemplatesCard() {
  const [templates, setTemplates] = useState<WhatsAppCloudTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<NewWhatsAppCloudTemplate & { examplesList?: string[] }>();
  const body = Form.useWatch('body', form) as string | undefined;

  /** How many {{n}} blanks the body has, so one sample box is shown per blank. */
  const blankCount = useMemo(() => {
    const nums = (body?.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => Number(m.replace(/\D/g, '')));
    return nums.length ? Math.max(...nums) : 0;
  }, [body]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await whatsappCloudAPI.templates();
      setTemplates(data);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Templates could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const { data } = await whatsappCloudAPI.createTemplate({
        name: values.name,
        language: values.language,
        category: values.category,
        body: values.body,
        examples: (values.examplesList ?? []).slice(0, blankCount),
        headerText: values.headerText,
        footer: values.footer,
        quickReplies: values.quickReplies,
      });
      message.success(`Template "${data.name}" sent to Meta for approval (${data.status.toLowerCase()})`);
      setCreating(false);
      form.resetFields();
      await load();
    } catch (err) {
      message.error(errorText(err, 'Meta did not accept the template.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    try {
      await whatsappCloudAPI.deleteTemplate(name);
      message.success(`Template "${name}" deleted`);
      await load();
    } catch (err) {
      message.error(errorText(err, 'The template could not be deleted.'));
    }
  };

  return (
    <Card size="small" style={{ borderRadius: radius.lg }}>
      <Flex vertical gap={space.md}>
        <Flex justify="space-between" align="center" gap={space.md} wrap>
          <div>
            <Text strong style={{ display: 'block' }}>
              Message templates
            </Text>
            <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
              First messages must use a template Meta has approved. Approval usually takes minutes.
            </Text>
          </div>
          <Flex gap={space.sm}>
            <Button icon={<ReloadOutlined />} aria-label="Refresh templates" onClick={() => void load()} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              New template
            </Button>
          </Flex>
        </Flex>

        {error && <Alert type="warning" showIcon title={error} />}

        {loading ? (
          <Flex justify="center" style={{ padding: space.lg }}>
            <Spin />
          </Flex>
        ) : templates && templates.length === 0 ? (
          <Empty description="No templates yet. Create your first outreach message." />
        ) : (
          <Flex vertical gap={space.sm}>
            {(templates ?? []).map((t) => (
              <div
                key={`${t.name}|${t.language}`}
                style={{ border: `1px solid ${color.separatorOpaque}`, borderRadius: radius.md, padding: space.sm }}
              >
                <Flex justify="space-between" align="center" gap={space.sm} wrap>
                  <Flex align="center" gap={space.sm} wrap>
                    <Text strong>{t.name}</Text>
                    <Tag>{t.language}</Tag>
                    <Tag color={statusColor[t.status] ?? 'default'}>{t.status}</Tag>
                    <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                      {t.category?.toLowerCase()}
                    </Text>
                  </Flex>
                  <Popconfirm
                    title={`Delete "${t.name}"?`}
                    description="Campaign steps using it will stop sending until you pick another."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => remove(t.name)}
                  >
                    <Button type="text" danger icon={<DeleteOutlined />} aria-label={`Delete template ${t.name}`} />
                  </Popconfirm>
                </Flex>
                {t.body && (
                  <Text
                    style={{
                      display: 'block',
                      whiteSpace: 'pre-wrap',
                      fontSize: font.size.footnote,
                      color: color.textSecondary,
                      marginTop: 4,
                    }}
                  >
                    {t.body}
                  </Text>
                )}
              </div>
            ))}
          </Flex>
        )}
      </Flex>

      <Modal
        title="New WhatsApp template"
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={() => void submit()}
        okText="Submit to Meta"
        confirmLoading={saving}
        width={560}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={{ language: 'en', category: 'MARKETING', quickReplies: [] }}
          style={{ marginTop: space.md }}
        >
          <Form.Item
            name="name"
            label="Template name"
            extra="Lowercase letters, numbers and underscores, e.g. heritage_tour_intro."
            rules={[{ required: true, message: 'Give the template a name' }]}
          >
            <Input placeholder="heritage_tour_intro" />
          </Form.Item>
          <Flex gap={space.md}>
            <Form.Item name="language" label="Language" style={{ flex: 1 }}>
              <Select options={LANGUAGES} showSearch />
            </Form.Item>
            <Form.Item
              name="category"
              label="Category"
              style={{ flex: 1 }}
              extra="Outreach and offers are Marketing."
            >
              <Radio.Group>
                <Radio value="MARKETING">Marketing</Radio>
                <Radio value="UTILITY">Utility</Radio>
              </Radio.Group>
            </Form.Item>
          </Flex>
          <Form.Item name="headerText" label="Header (optional)">
            <Input maxLength={60} placeholder="UP Heritage Tours" />
          </Form.Item>
          <Form.Item
            name="body"
            label="Message"
            extra="Use {{1}}, {{2}}… for blanks such as the contact's name. Don't start or end with a blank."
            rules={[{ required: true, message: 'Write the message' }]}
          >
            <Input.TextArea
              rows={5}
              maxLength={1024}
              showCount
              placeholder="Namaste {{1}}! We run heritage tours across Kerala and would love to host guests from {{2}}. Shall I share our itinerary?"
            />
          </Form.Item>
          {blankCount > 0 && (
            <Form.Item label="Sample values (Meta's reviewers read these)">
              <Flex vertical gap={space.xs}>
                {Array.from({ length: blankCount }, (_, i) => (
                  <Form.Item
                    key={i}
                    name={['examplesList', i]}
                    noStyle
                    rules={[{ required: true, message: `Sample for {{${i + 1}}}` }]}
                  >
                    <Input addonBefore={`{{${i + 1}}}`} placeholder={i === 0 ? 'Asha' : 'Hill Palace'} />
                  </Form.Item>
                ))}
              </Flex>
            </Form.Item>
          )}
          <Form.Item name="footer" label="Footer (optional)">
            <Input maxLength={60} placeholder="Reply STOP to opt out" />
          </Form.Item>
          <Form.Item
            name="quickReplies"
            label="Quick-reply buttons (optional, up to 3)"
            extra="Type a label and press Enter, e.g. Yes, send details."
          >
            <Select mode="tags" maxCount={3} placeholder="Yes, send details" open={false} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

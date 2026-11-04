import { useEffect, useState } from 'react';
import { Button, Card, Flex, Form, Input, InputNumber, Typography, message } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import { whatsappCloudAPI } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

/**
 * The map pin sent by templates with a location header.
 *
 * Meta does not store a location on the template: every message must carry one, so
 * the portal keeps the business location here and sends it each time.
 */
export default function BusinessLocationCard() {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    whatsappCloudAPI
      .getLocation()
      .then(({ data }) => data && form.setFieldsValue(data))
      .catch(() => undefined);
  }, [form]);

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await whatsappCloudAPI.saveLocation(v);
      message.success('Business location saved');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      message.error((Array.isArray(msg) ? msg.join(', ') : msg) || 'Could not save the location.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="small" style={{ borderRadius: radius.lg }}>
      <Flex vertical gap={space.sm}>
        <Flex align="center" gap={space.sm}>
          <EnvironmentOutlined style={{ color: color.accent }} />
          <Text strong>Business location</Text>
        </Flex>
        <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
          Sent as the map pin of templates with a Location header. In Google Maps, right-click your office and click the
          numbers at the top to copy latitude and longitude.
        </Text>
        <Form form={form} layout="vertical">
          <Flex gap={space.sm} wrap>
            <Form.Item name="name" label="Name" style={{ flex: 1, minWidth: 180 }}>
              <Input placeholder="UP Heritage Tours" />
            </Form.Item>
            <Form.Item name="address" label="Address" style={{ flex: 2, minWidth: 220 }}>
              <Input placeholder="Hazratganj, Lucknow, Uttar Pradesh" />
            </Form.Item>
          </Flex>
          <Flex gap={space.sm} wrap align="flex-end">
            <Form.Item name="latitude" label="Latitude" rules={[{ required: true }]}>
              <InputNumber min={-90} max={90} step={0.000001} placeholder="26.8467" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="longitude" label="Longitude" rules={[{ required: true }]}>
              <InputNumber min={-180} max={180} step={0.000001} placeholder="80.9462" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" loading={saving} onClick={() => void save()}>
                Save location
              </Button>
            </Form.Item>
          </Flex>
        </Form>
      </Flex>
    </Card>
  );
}

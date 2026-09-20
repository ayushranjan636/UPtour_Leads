import { useEffect, useState } from 'react';
import {
  Card,
  Tabs,
  Form,
  Input,
  Button,
  Typography,
  Flex,
  Badge,
  message,
  Spin,
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ApiOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import { gatewayAPI, isGatewayHealthy } from '../services/endpoints';
import { color, font, radius } from '../theme/tokens';

const { Text } = Typography;

function ProfileTab() {
  const { user } = useAuth();

  const handleSave = () => {
    message.info('Profile update not yet implemented');
  };

  return (
    <div style={{ maxWidth: 500 }}>
      <Form
        layout="vertical"
        initialValues={{
          name: user?.name ?? '',
          email: user?.email ?? '',
        }}
        onFinish={handleSave}
      >
        <Form.Item name="name" label="Full Name" rules={[{ required: true }]}>
          <Input prefix={<UserOutlined style={{ color: color.textTertiary }} />} />
        </Form.Item>
        <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
          <Input prefix={<MailOutlined style={{ color: color.textTertiary }} />} disabled />
        </Form.Item>
        <Form.Item name="currentPassword" label="Current Password">
          <Input.Password
            prefix={<LockOutlined style={{ color: color.textTertiary }} />}
            placeholder="Enter to change password"
          />
        </Form.Item>
        <Form.Item name="newPassword" label="New Password">
          <Input.Password
            prefix={<LockOutlined style={{ color: color.textTertiary }} />}
            placeholder="Enter new password"
          />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          Save Changes
        </Button>
      </Form>
    </div>
  );
}

function SystemTab() {
  const [health, setHealth] = useState<{ status?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data } = await gatewayAPI.getHealth().catch(() => ({ data: null }));
        setHealth(data);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <Flex justify="center" style={{ padding: 40 }}>
        <Spin />
      </Flex>
    );
  }

  const services = [
    {
      name: 'API Server',
      status: 'connected',
      url: 'http://localhost:3000',
    },
    {
      // The messaging gateway is separate infrastructure — session/QR admin lives
      // in its own dashboard, not here. We surface only up/down, because campaigns
      // silently stop sending when it is unreachable.
      name: 'Messaging Gateway',
      status: isGatewayHealthy(health) ? 'connected' : 'disconnected',
      url: 'Outbound messaging service',
    },
  ];

  return (
    <Flex vertical gap={20}>
      {services.map((svc) => (
        <Card key={svc.name} size="small" style={{ borderRadius: radius.lg }}>
          <Flex justify="space-between" align="center">
            <Flex align="center" gap={12}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.lg,
                  background: svc.status === 'connected' ? color.successSoft : color.dangerSoft,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {svc.status === 'connected' ? (
                  <CheckCircleFilled style={{ color: color.success, fontSize: 16 }} />
                ) : (
                  <CloseCircleFilled style={{ color: color.danger, fontSize: 16 }} />
                )}
              </div>
              <div>
                <Text strong style={{ display: 'block' }}>{svc.name}</Text>
                <Flex align="center" gap={8}>
                  <ApiOutlined style={{ fontSize: font.size.caption, color: color.textTertiary }} />
                  <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>{svc.url}</Text>
                </Flex>
              </div>
            </Flex>
            <Badge
              status={svc.status === 'connected' ? 'success' : 'error'}
              text={svc.status === 'connected' ? 'Healthy' : 'Down'}
            />
          </Flex>
        </Card>
      ))}
    </Flex>
  );
}

export default function Settings() {
  const tabItems = [
    { key: 'profile', label: 'Profile', children: <ProfileTab /> },
    { key: 'system', label: 'System', children: <SystemTab /> },
  ];

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Manage your account and system configuration"
      />

      <Card style={{ borderRadius: radius.xl }}>
        <Tabs items={tabItems} />
      </Card>
    </div>
  );
}

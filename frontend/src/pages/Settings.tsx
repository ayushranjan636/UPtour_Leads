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
  WhatsAppOutlined,
  ReloadOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import { whatsappAPI } from '../services/endpoints';

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
          <Input prefix={<UserOutlined style={{ color: '#9CA3AF' }} />} />
        </Form.Item>
        <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
          <Input prefix={<MailOutlined style={{ color: '#9CA3AF' }} />} disabled />
        </Form.Item>
        <Form.Item name="currentPassword" label="Current Password">
          <Input.Password
            prefix={<LockOutlined style={{ color: '#9CA3AF' }} />}
            placeholder="Enter to change password"
          />
        </Form.Item>
        <Form.Item name="newPassword" label="New Password">
          <Input.Password
            prefix={<LockOutlined style={{ color: '#9CA3AF' }} />}
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

function WhatsAppTab() {
  const [sessions, setSessions] = useState<unknown[]>([]);
  const [health, setHealth] = useState<{ status?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [sessRes, healthRes] = await Promise.all([
          whatsappAPI.getSessions().catch(() => ({ data: [] })),
          whatsappAPI.getHealth().catch(() => ({ data: null })),
        ]);
        setSessions(Array.isArray(sessRes.data) ? sessRes.data : []);
        setHealth(healthRes.data);
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

  const isConnected = health?.status === 'connected' || health?.status === 'healthy';

  return (
    <Flex vertical gap={20}>
      <Card style={{ borderRadius: 14 }}>
        <Flex justify="space-between" align="center" style={{ marginBottom: 20 }}>
          <Flex align="center" gap={12}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: isConnected ? '#ECFDF5' : '#FEF2F2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <WhatsAppOutlined
                style={{ fontSize: 24, color: isConnected ? '#25D366' : '#EF4444' }}
              />
            </div>
            <div>
              <Text strong style={{ fontSize: 16, display: 'block' }}>
                WhatsApp Connection
              </Text>
              <Flex align="center" gap={6}>
                <Badge status={isConnected ? 'success' : 'error'} />
                <Text
                  style={{
                    color: isConnected ? '#10B981' : '#EF4444',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {isConnected ? 'Connected' : 'Disconnected'}
                </Text>
              </Flex>
            </div>
          </Flex>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => window.location.reload()}
          >
            Refresh
          </Button>
        </Flex>

        <Text style={{ fontSize: 13, color: '#6B7280' }}>
          {sessions.length} active session{sessions.length !== 1 ? 's' : ''}
        </Text>
      </Card>
    </Flex>
  );
}

function SystemTab() {
  const [health, setHealth] = useState<{ status?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data } = await whatsappAPI.getHealth().catch(() => ({ data: null }));
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
      name: 'WhatsApp Service',
      status: health?.status === 'connected' || health?.status === 'healthy' ? 'connected' : 'disconnected',
      url: 'WhatsApp Business API',
    },
  ];

  return (
    <Flex vertical gap={20}>
      {services.map((svc) => (
        <Card key={svc.name} size="small" style={{ borderRadius: 10 }}>
          <Flex justify="space-between" align="center">
            <Flex align="center" gap={12}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: svc.status === 'connected' ? '#ECFDF5' : '#FEF2F2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {svc.status === 'connected' ? (
                  <CheckCircleFilled style={{ color: '#10B981', fontSize: 18 }} />
                ) : (
                  <CloseCircleFilled style={{ color: '#EF4444', fontSize: 18 }} />
                )}
              </div>
              <div>
                <Text strong style={{ display: 'block' }}>{svc.name}</Text>
                <Flex align="center" gap={8}>
                  <ApiOutlined style={{ fontSize: 12, color: '#9CA3AF' }} />
                  <Text style={{ fontSize: 12, color: '#6B7280' }}>{svc.url}</Text>
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
    { key: 'whatsapp', label: 'WhatsApp', children: <WhatsAppTab /> },
    { key: 'system', label: 'System', children: <SystemTab /> },
  ];

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Manage your account and system configuration"
      />

      <Card style={{ borderRadius: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <Tabs items={tabItems} />
      </Card>
    </div>
  );
}

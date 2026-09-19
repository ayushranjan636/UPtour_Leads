import { useState } from 'react';
import { Card, Form, Input, Button, Typography, Alert } from 'antd';
import { MailOutlined, LockOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';

const { Text } = Typography;

export default function Login() {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError('');
    try {
      await login(values.email, values.password);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      style={{
        borderRadius: 16,
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.06)',
        border: '1px solid #F0F0F0',
      }}
      styles={{ body: { padding: '40px 36px 36px' } }}
    >
      <Text
        strong
        style={{
          fontSize: 20,
          display: 'block',
          textAlign: 'center',
          marginBottom: 4,
          color: '#111827',
        }}
      >
        Welcome back
      </Text>
      <Text
        style={{
          display: 'block',
          textAlign: 'center',
          color: '#6B7280',
          marginBottom: 32,
          fontSize: 14,
        }}
      >
        Sign in to UP Heritage Tours CRM
      </Text>

      {error && (
        <Alert
          message={error}
          type="error"
          showIcon
          closable
          onClose={() => setError('')}
          style={{ marginBottom: 20, borderRadius: 10 }}
        />
      )}

      <Form
        layout="vertical"
        onFinish={onFinish}
        size="large"
        requiredMark={false}
        initialValues={{ email: 'admin@uptour.in' }}
      >
        <Form.Item
          name="email"
          label={<Text style={{ fontWeight: 500, color: '#374151' }}>Email</Text>}
          rules={[
            { required: true, message: 'Please enter your email' },
            { type: 'email', message: 'Enter a valid email' },
          ]}
        >
          <Input
            prefix={<MailOutlined style={{ color: '#9CA3AF' }} />}
            placeholder="admin@uptour.in"
          />
        </Form.Item>

        <Form.Item
          name="password"
          label={<Text style={{ fontWeight: 500, color: '#374151' }}>Password</Text>}
          rules={[{ required: true, message: 'Please enter your password' }]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: '#9CA3AF' }} />}
            placeholder="Enter your password"
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loading}
            style={{
              height: 48,
              borderRadius: 12,
              fontWeight: 600,
              fontSize: 15,
              background: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)',
              border: 'none',
              boxShadow: '0 4px 14px rgba(79, 70, 229, 0.3)',
            }}
          >
            Sign In
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

import { useState } from 'react';
import { Card, Form, Input, Button, Alert } from 'antd';
import { MailOutlined, LockOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { color, font, radius, space } from '../theme/tokens';

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
      setError(e.response?.data?.message || 'That email and password did not match.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      style={{ borderRadius: radius.xxl, border: `1px solid ${color.separator}` }}
      styles={{ body: { padding: `${space.xxl}px ${space.xl + 4}px ${space.xl + 4}px` } }}
    >
      {error && (
        <Alert
          title={error}
          type="error"
          showIcon
          closable
          onClose={() => setError('')}
          style={{ marginBottom: space.lg, borderRadius: radius.lg }}
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
          label="Email"
          rules={[
            { required: true, message: 'Enter your email' },
            { type: 'email', message: 'Enter a valid email address' },
          ]}
        >
          <Input
            prefix={<MailOutlined style={{ color: color.textTertiary }} />}
            placeholder="you@example.com"
            autoComplete="email"
            // Focus starts in the first field so the keyboard path is immediate.
            autoFocus
          />
        </Form.Item>

        <Form.Item
          name="password"
          label="Password"
          rules={[{ required: true, message: 'Enter your password' }]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: color.textTertiary }} />}
            placeholder="Password"
            autoComplete="current-password"
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, marginTop: space.xl }}>
          {/* Flat accent fill. The gradient + coloured glow this replaces was the
              loudest element on an otherwise calm screen. */}
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loading}
            style={{
              height: 44,
              borderRadius: radius.lg,
              fontWeight: font.weight.medium,
              fontSize: font.size.callout,
            }}
          >
            Sign In
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

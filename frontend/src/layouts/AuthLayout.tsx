import { Outlet } from 'react-router-dom';
import { Flex, Typography } from 'antd';

const { Text } = Typography;

export default function AuthLayout() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #EEF2FF 0%, #F5F7FA 50%, #FDF4FF 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Flex align="center" justify="center" gap={14} style={{ marginBottom: 40 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFF',
              fontWeight: 800,
              fontSize: 20,
              boxShadow: '0 4px 14px rgba(79, 70, 229, 0.3)',
            }}
          >
            UP
          </div>
          <div>
            <Text
              strong
              style={{
                fontSize: 22,
                display: 'block',
                lineHeight: 1.2,
                color: '#111827',
              }}
            >
              UP Heritage Tours
            </Text>
            <Text style={{ fontSize: 13, color: '#6B7280' }}>
              Customer Relationship Management
            </Text>
          </div>
        </Flex>

        <Outlet />
      </div>
    </div>
  );
}

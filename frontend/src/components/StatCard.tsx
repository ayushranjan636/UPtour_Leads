import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';

const { Text, Title } = Typography;

interface StatCardProps {
  icon: ReactNode;
  title: string;
  value: string | number;
  subtitle?: string;
  accentColor?: string;
}

export default function StatCard({
  icon,
  title,
  value,
  subtitle,
  accentColor = '#4F46E5',
}: StatCardProps) {
  return (
    <Card
      style={{
        borderRadius: 14,
        borderTop: `3px solid ${accentColor}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)',
      }}
      styles={{ body: { padding: '20px 24px' } }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <Text
            style={{
              fontSize: 13,
              color: '#6B7280',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {title}
          </Text>
          <Title
            level={3}
            style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 700, color: '#111827' }}
          >
            {value}
          </Title>
          {subtitle && (
            <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 4, display: 'block' }}>
              {subtitle}
            </Text>
          )}
        </div>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: `${accentColor}10`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            color: accentColor,
          }}
        >
          {icon}
        </div>
      </div>
    </Card>
  );
}

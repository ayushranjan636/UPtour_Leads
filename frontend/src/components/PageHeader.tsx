import { Typography, Flex } from 'antd';
import type { ReactNode } from 'react';

const { Title, Text } = Typography;

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <Flex
      justify="space-between"
      align="center"
      style={{ marginBottom: 24 }}
    >
      <div>
        <Title level={3} style={{ margin: 0, fontWeight: 700, color: '#111827' }}>
          {title}
        </Title>
        {subtitle && (
          <Text style={{ color: '#6B7280', fontSize: 14, marginTop: 4, display: 'block' }}>
            {subtitle}
          </Text>
        )}
      </div>
      {actions && <Flex gap={12}>{actions}</Flex>}
    </Flex>
  );
}

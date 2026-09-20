import { Typography, Flex } from 'antd';
import type { ReactNode } from 'react';
import { color, font, space } from '../theme/tokens';

const { Title, Text } = Typography;

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/**
 * One clear title per view, with actions trailing.
 *
 * Wraps on narrow widths so the title and its actions never collide or force
 * horizontal scrolling on mobile.
 */
export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <Flex
      justify="space-between"
      align="flex-start"
      wrap
      gap={space.md}
      style={{ marginBottom: space.xl }}
    >
      <div style={{ minWidth: 0 }}>
        <Title
          level={3}
          style={{
            margin: 0,
            fontSize: font.size.title2,
            fontWeight: font.weight.semibold,
            // Slight negative tracking on large type only, matching Apple display text.
            letterSpacing: '-0.02em',
            color: color.text,
          }}
        >
          {title}
        </Title>
        {subtitle && (
          <Text
            style={{
              color: color.textSecondary,
              fontSize: font.size.body,
              marginTop: 2,
              display: 'block',
            }}
          >
            {subtitle}
          </Text>
        )}
      </div>
      {actions && (
        <Flex gap={space.sm} wrap align="center">
          {actions}
        </Flex>
      )}
    </Flex>
  );
}

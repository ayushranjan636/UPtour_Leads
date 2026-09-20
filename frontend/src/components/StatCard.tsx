import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

interface StatCardProps {
  icon: ReactNode;
  title: string;
  value: string | number;
  subtitle?: string;
  /** Optional icon tint. Defaults to the single accent; use status colours sparingly. */
  accentColor?: string;
}

/**
 * A single metric.
 *
 * Deliberately restrained versus the previous version, which gave every card a
 * coloured top border and an uppercase label. Six cards each with their own accent
 * stripe made the row compete with the content below it; the number is the hero, so
 * hierarchy now comes from type size and weight instead of colour.
 */
export default function StatCard({
  icon,
  title,
  value,
  subtitle,
  accentColor = color.accent,
}: StatCardProps) {
  return (
    <Card
      style={{ borderRadius: radius.xl, height: '100%' }}
      styles={{ body: { padding: `${space.lg}px ${space.lg + 2}px` } }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md }}>
        <div style={{ minWidth: 0 }}>
          <Text
            style={{
              fontSize: font.size.footnote,
              color: color.textSecondary,
              fontWeight: font.weight.regular,
              display: 'block',
            }}
          >
            {title}
          </Text>
          <div
            style={{
              margin: '4px 0 0',
              fontSize: font.size.title1,
              fontWeight: font.weight.semibold,
              letterSpacing: '-0.02em',
              color: color.text,
              lineHeight: 1.15,
            }}
          >
            {value}
          </div>
          {subtitle && (
            <Text
              style={{
                fontSize: font.size.footnote,
                color: color.textSecondary,
                marginTop: 2,
                display: 'block',
              }}
            >
              {subtitle}
            </Text>
          )}
        </div>
        <div
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: radius.md,
            // 14% alpha keeps the tint legible without becoming a second focal point.
            background: `${accentColor}24`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 15,
            color: accentColor,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      </div>
    </Card>
  );
}

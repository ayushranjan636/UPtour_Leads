import { Tag } from 'antd';

const statusColorMap: Record<string, string> = {
  verified: 'green',
  active: 'green',
  won: 'green',
  completed: 'blue',
  delivered: 'blue',
  qualified: 'blue',
  running: 'blue',
  interested: 'cyan',
  new: 'geekblue',
  pending: 'gold',
  draft: 'default',
  paused: 'orange',
  proposal_sent: 'purple',
  negotiation: 'purple',
  opted_out: 'red',
  lost: 'red',
  failed: 'red',
  error: 'red',
  read: 'cyan',
  replied: 'green',
  sent: 'blue',
};

interface StatusTagProps {
  status: string;
  style?: React.CSSProperties;
}

export default function StatusTag({ status, style }: StatusTagProps) {
  const color =
    statusColorMap[status.toLowerCase().replace(/[\s-]/g, '_')] || 'default';
  const label = status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Tag
      color={color}
      style={{
        borderRadius: 6,
        fontWeight: 500,
        fontSize: 12,
        padding: '2px 10px',
        border: 'none',
        ...style,
      }}
    >
      {label}
    </Tag>
  );
}

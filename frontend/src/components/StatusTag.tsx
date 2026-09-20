import { Tag } from 'antd';
import { color as token, font, radius } from '../theme/tokens';

/**
 * Status vocabulary, grouped by meaning rather than given a colour each.
 *
 * The previous map used nine different Ant preset colours (cyan, geekblue, purple,
 * gold, orange…), so a table could show five hues at once and none of them carried
 * a consistent meaning. These four semantic groups reuse the same tokens as the rest
 * of the app: positive, in-progress, attention, and problem. The label always spells
 * the status out, so colour is never the only signal.
 */
type Tone = 'positive' | 'progress' | 'attention' | 'negative' | 'neutral';

const toneByStatus: Record<string, Tone> = {
  // Positive / complete
  verified: 'positive',
  active: 'positive',
  won: 'positive',
  replied: 'positive',
  completed: 'positive',
  interested: 'positive',

  // In progress
  running: 'progress',
  sent: 'progress',
  delivered: 'progress',
  read: 'progress',
  qualified: 'progress',
  proposal_sent: 'progress',
  negotiation: 'progress',
  new: 'progress',

  // Needs attention
  pending: 'attention',
  paused: 'attention',
  scheduled: 'attention',

  // Problem / terminal
  opted_out: 'negative',
  lost: 'negative',
  failed: 'negative',
  error: 'negative',
  suppressed: 'negative',
  invalid: 'negative',

  // Inactive
  draft: 'neutral',
  archived: 'neutral',
};

const toneStyles: Record<Tone, { bg: string; fg: string }> = {
  positive: { bg: token.successSoft, fg: token.success },
  progress: { bg: token.accentSoft, fg: token.accent },
  attention: { bg: token.warningSoft, fg: token.warning },
  negative: { bg: token.dangerSoft, fg: token.danger },
  neutral: { bg: token.fillStrong, fg: token.textSecondary },
};

interface StatusTagProps {
  status: string;
  style?: React.CSSProperties;
}

export default function StatusTag({ status, style }: StatusTagProps) {
  const key = status.toLowerCase().replace(/[\s-]/g, '_');
  const tone = toneByStatus[key] ?? 'neutral';
  const { bg, fg } = toneStyles[tone];
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Tag
      style={{
        background: bg,
        color: fg,
        borderRadius: radius.sm,
        fontWeight: font.weight.medium,
        fontSize: font.size.caption,
        lineHeight: '18px',
        padding: '1px 8px',
        border: 'none',
        margin: 0,
        ...style,
      }}
    >
      {label}
    </Tag>
  );
}

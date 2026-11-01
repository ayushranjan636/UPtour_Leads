import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Flex, Popconfirm, Tag, Typography, message } from 'antd';
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { campaignsAPI } from '../services/endpoints';
import type { CampaignFailureSummary } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

/** Split a stored reason into Meta's words and the fix the server attached, if any. */
function splitReason(reason: string): { what: string; fix: string | null } {
  const i = reason.indexOf(' Fix: ');
  return i === -1 ? { what: reason, fix: null } : { what: reason.slice(0, i), fix: reason.slice(i + 6) };
}

/**
 * Why this campaign's messages failed, and a way to send them again.
 *
 * The cause of each failure was always stored, but the campaign page only said
 * "Failed", so one fixable problem (no Meta template, an unregistered number, a
 * payment issue at Meta) looked like the whole system was broken. Hidden when nothing
 * has failed.
 */
export default function CampaignFailuresCard({
  campaignId,
  onRetried,
}: {
  campaignId: string;
  /** Refresh the campaign after failed contacts are queued again. */
  onRetried: () => void;
}) {
  const [summary, setSummary] = useState<CampaignFailureSummary | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await campaignsAPI.failures(campaignId);
      setSummary(data);
    } catch {
      setSummary(null);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = async () => {
    setRetrying(true);
    try {
      const { data } = await campaignsAPI.retryFailed(campaignId);
      message.success(
        data.requeued
          ? `${data.requeued} contacts queued again${data.status === 'active' ? '; sending resumes shortly' : '. Activate the campaign to send'}`
          : 'Nothing to retry',
      );
      await load();
      onRetried();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      message.error((Array.isArray(msg) ? msg.join(', ') : msg) || 'Could not retry the failed messages.', 10);
    } finally {
      setRetrying(false);
    }
  };

  if (!summary || summary.failed === 0) return null;

  return (
    <Card
      size="small"
      style={{ borderRadius: radius.lg, borderColor: color.danger, marginBottom: space.lg }}
      title={
        <Flex align="center" gap={space.sm}>
          <WarningOutlined style={{ color: color.danger }} />
          <Text strong>
            {summary.failed} {summary.failed === 1 ? 'message' : 'messages'} failed. Here is why
          </Text>
        </Flex>
      }
      extra={
        <Flex gap={space.sm}>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} aria-label="Refresh failures" />
          <Popconfirm
            title="Send the failed messages again?"
            description="Fix the reason below first, or they will fail the same way."
            okText="Retry"
            onConfirm={retry}
          >
            <Button size="small" type="primary" loading={retrying}>
              Retry failed
            </Button>
          </Popconfirm>
        </Flex>
      }
    >
      <Flex vertical gap={space.sm}>
        {summary.reasons.map((r) => {
          const { what, fix } = splitReason(r.reason);
          const advice = fix ?? r.hint;
          return (
            <div
              key={r.reason}
              style={{ background: color.fill, borderRadius: radius.md, padding: space.sm }}
            >
              <Flex align="flex-start" gap={space.sm}>
                <Tag color="red" style={{ marginTop: 2 }}>
                  {r.count}
                </Tag>
                <Flex vertical gap={4} style={{ minWidth: 0 }}>
                  <Text style={{ fontSize: font.size.footnote, wordBreak: 'break-word' }}>{what}</Text>
                  {advice && (
                    <Alert type="info" showIcon title={<Text style={{ fontSize: font.size.footnote }}>{advice}</Text>} />
                  )}
                </Flex>
              </Flex>
            </div>
          );
        })}
      </Flex>
    </Card>
  );
}

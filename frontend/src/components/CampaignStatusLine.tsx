import { useEffect, useState } from 'react';
import { Typography } from 'antd';
import { engineAPI } from '../services/endpoints';
import type { CampaignSendStatus } from '../services/endpoints';
import { color, font } from '../theme/tokens';

const { Text } = Typography;

const tone: Record<CampaignSendStatus['state'], string> = {
  sending: color.success,
  waiting: color.warning,
  idle: color.textSecondary,
  stopped: color.textSecondary,
  problem: color.danger,
};

/**
 * One line on a campaign card saying what it is doing right now, e.g. "Outside sending
 * hours (09:00 to 18:00)". Only for active campaigns, where "0 sent" otherwise has no
 * explanation. Fails silently: the card is still useful without it.
 */
export default function CampaignStatusLine({ campaignId }: { campaignId: string }) {
  const [status, setStatus] = useState<CampaignSendStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    engineAPI
      .sendStatus(campaignId)
      .then(({ data }) => !cancelled && setStatus(data))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (!status) return null;
  return (
    <Text
      style={{ display: 'block', fontSize: font.size.caption, color: tone[status.state], marginBottom: 8 }}
      title={status.detail}
    >
      ● {status.headline}
    </Text>
  );
}

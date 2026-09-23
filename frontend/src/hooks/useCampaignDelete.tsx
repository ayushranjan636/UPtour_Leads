import { useState } from 'react';
import { Modal, Typography, Flex, message } from 'antd';
import { ExclamationCircleFilled } from '@ant-design/icons';
import { campaignsAPI } from '../services/endpoints';
import { color, font, space } from '../theme/tokens';

const { Text } = Typography;

/** The minimum a caller needs to know about the campaign it is deleting. */
export interface DeletableCampaign {
  id: string;
  name: string;
  status: string;
}

/**
 * Why an active campaign cannot be deleted, phrased as the next step to take.
 *
 * Shown as a tooltip on the disabled button rather than left to a failed request: the
 * server refuses it, and a dead-end error after a confirmation dialog is a worse way to
 * learn that than never being offered the action.
 */
export const ACTIVE_CAMPAIGN_DELETE_HINT =
  'This campaign is active and may be sending. Pause it first, then delete it.';

/**
 * Destructive confirmation plus the delete request, shared by the campaign list and the
 * campaign detail header.
 *
 * One owner for the dialog copy is deliberate. The dialog's job is to state plainly that
 * leads, deals and message history are *kept* — an operator who fears losing their leads
 * will keep dead campaigns forever instead — and that promise must not drift between the
 * two places the action is offered.
 *
 * Uses the `Modal.useModal()` hook form: the static `Modal.confirm` renders in its own
 * React root, outside the app's ConfigProvider, so it would lose the theme.
 */
export function useCampaignDelete() {
  const [modal, contextHolder] = Modal.useModal();
  /** Id currently being deleted, so only the affected row shows a spinner. */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const runDelete = async (campaign: DeletableCampaign, onDeleted: () => void) => {
    setDeletingId(campaign.id);
    try {
      const { data } = await campaignsAPI.remove(campaign.id);
      // Reports the preserved counts, not just "deleted": the point of the whole
      // preserve-vs-delete split is that the operator can see their leads survived.
      const kept = [
        data?.preserved?.leads ? `${data.preserved.leads} leads` : null,
        data?.preserved?.messages ? `${data.preserved.messages} messages` : null,
      ].filter(Boolean);
      message.success(
        kept.length
          ? `Deleted "${campaign.name}" — ${kept.join(' and ')} kept`
          : `Deleted "${campaign.name}"`,
      );
      onDeleted();
    } catch (err: unknown) {
      // Surfaces the server's own reason (an active campaign, a failed transaction)
      // rather than inventing one, and never claims success.
      const detail =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(detail ?? `Could not delete "${campaign.name}"`);
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDelete = (campaign: DeletableCampaign, onDeleted: () => void) => {
    modal.confirm({
      title: `Delete "${campaign.name}"?`,
      icon: <ExclamationCircleFilled style={{ color: color.danger }} />,
      width: 520,
      okText: 'Delete campaign',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      content: (
        <Flex vertical gap={space.md} style={{ marginTop: space.sm }}>
          <div>
            <Text strong style={{ display: 'block', color: color.text }}>
              Deleted
            </Text>
            <Text style={{ color: color.textSecondary, fontSize: font.size.footnote }}>
              The campaign, who was enrolled in it, its message templates and any
              follow-ups still waiting to be sent.
            </Text>
          </div>
          <div>
            <Text strong style={{ display: 'block', color: color.text }}>
              Kept
            </Text>
            <Text style={{ color: color.textSecondary, fontSize: font.size.footnote }}>
              Every lead and deal this campaign produced, and the full message history
              with each contact. Conversations stay readable exactly as they are — they
              simply stop being attributed to this campaign.
            </Text>
          </div>
          <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>
            This cannot be undone.
          </Text>
        </Flex>
      ),
      onOk: () => runDelete(campaign, onDeleted),
    });
  };

  return { contextHolder, confirmDelete, deletingId };
}

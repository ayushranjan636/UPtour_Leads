import { useEffect, useMemo, useState } from 'react';
import { Alert, Flex, Input, Modal, Select, Spin, Typography, message } from 'antd';
import { messagesAPI, whatsappCloudAPI } from '../services/endpoints';
import type { WhatsAppCloudTemplate } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

interface Props {
  open: boolean;
  contact: { id: string; name?: string | null } | null;
  onClose: () => void;
  /** Called after Meta accepted the message, so the conversation can refresh. */
  onSent: () => void;
}

/**
 * Send one approved Meta template to the open conversation.
 *
 * On the official API this is the only way to reach someone who has not written in
 * the last 24 hours. Blanks are pre-filled with the contact's name where sensible, and
 * the filled-in text is previewed exactly as the contact will read it.
 */
export default function SendTemplateModal({ open, contact, onClose, onSent }: Props) {
  const [templates, setTemplates] = useState<WhatsAppCloudTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | undefined>();
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    whatsappCloudAPI
      .templates()
      .then(({ data }) => {
        if (cancelled) return;
        const approved = data.filter((t) => t.status === 'APPROVED');
        setTemplates(approved);
        if (approved.length && !choice) setChoice(`${approved[0].name}|${approved[0].language}`);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.response?.data?.message;
        setError(typeof msg === 'string' ? msg : 'Templates could not be loaded.');
        setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
    // `choice` is only a default here; re-running on it would refetch on every pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selected = useMemo(
    () => templates?.find((t) => `${t.name}|${t.language}` === choice) ?? null,
    [templates, choice],
  );

  // Size the blanks to the chosen template; {{1}} defaults to the contact's name.
  useEffect(() => {
    if (!selected) return;
    setParams((prev) =>
      Array.from({ length: selected.bodyParamCount }, (_, i) => prev[i] ?? (i === 0 ? contact?.name ?? '' : '')),
    );
  }, [selected, contact?.name]);

  const preview = useMemo(() => {
    if (!selected?.body) return '';
    return selected.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`);
  }, [selected, params]);

  const send = async () => {
    if (!contact || !selected) return;
    if (params.some((p) => !p.trim())) {
      message.warning('Fill every blank before sending.');
      return;
    }
    setSending(true);
    try {
      await messagesAPI.sendTemplate({
        contactId: contact.id,
        template: selected.name,
        language: selected.language,
        params,
        previewBody: preview,
      });
      message.success('Template sent');
      onSent();
      onClose();
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      message.error((Array.isArray(msg) ? msg.join(', ') : msg) || 'The template could not be sent.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      title={`Send a template to ${contact?.name ?? 'this contact'}`}
      open={open}
      onCancel={onClose}
      onOk={() => void send()}
      okText="Send"
      okButtonProps={{ disabled: !selected }}
      confirmLoading={sending}
      destroyOnHidden
    >
      {templates === null ? (
        <Flex justify="center" style={{ padding: space.lg }}>
          <Spin />
        </Flex>
      ) : templates.length === 0 ? (
        <Alert
          type="info"
          showIcon
          title={error ?? 'No approved templates yet'}
          description="Create one in Settings → WhatsApp → Message templates. Meta usually approves it within minutes."
        />
      ) : (
        <Flex vertical gap={space.md} style={{ marginTop: space.sm }}>
          <Select
            value={choice}
            onChange={setChoice}
            options={templates.map((t) => ({ value: `${t.name}|${t.language}`, label: `${t.name} (${t.language})` }))}
          />
          {params.map((p, i) => (
            <Input
              key={i}
              addonBefore={`{{${i + 1}}}`}
              value={p}
              onChange={(e) => setParams((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
            />
          ))}
          {preview && (
            <div style={{ background: color.fill, borderRadius: radius.md, padding: space.md }}>
              <Text style={{ whiteSpace: 'pre-wrap', fontSize: font.size.footnote }}>{preview}</Text>
            </div>
          )}
        </Flex>
      )}
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Flex, Input, Select, Typography, message } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { whatsappCloudAPI } from '../services/endpoints';
import type { WhatsAppCloudTemplate } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

/** Value of the "type my own text" choice in the template picker. */
const PLAIN_TEXT = '__text__';

/**
 * Send one real message through the Cloud API from Settings.
 *
 * The quickest proof that the token, the phone number and Meta's side all work,
 * without building a campaign. A number that has not written in the last 24 hours can
 * only receive an approved template, so a template is the default choice.
 */
export default function WhatsAppCloudTestCard() {
  const [to, setTo] = useState('');
  const [choice, setChoice] = useState<string>('hello_world|en_US');
  const [text, setText] = useState('Test message from UP Heritage Tours portal.');
  const [templates, setTemplates] = useState<WhatsAppCloudTemplate[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    whatsappCloudAPI
      .templates()
      .then(({ data }) => {
        if (cancelled) return;
        const approved = data.filter((t) => t.status === 'APPROVED');
        setTemplates(approved);
        // Prefer Meta's built-in hello_world; otherwise the first approved template.
        if (approved.length && !approved.some((t) => t.name === 'hello_world')) {
          setChoice(`${approved[0].name}|${approved[0].language}`);
        }
      })
      .catch(() => {
        /* Listing needs the Business Account ID; plain text and hello_world still work. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const send = async () => {
    setResult(null);
    const digits = to.replace(/[^\d]/g, '');
    if (digits.length < 8) {
      setResult({ ok: false, text: 'Enter the full number with country code, for example 919876543210.' });
      return;
    }
    setSending(true);
    try {
      const payload =
        choice === PLAIN_TEXT
          ? { to: digits, text }
          : { to: digits, template: choice.split('|')[0], language: choice.split('|')[1] };
      const { data } = await whatsappCloudAPI.sendTest(payload);
      message.success('Test message sent');
      setResult({
        ok: true,
        text: `Meta accepted the message to +${data.to}. It should arrive on that phone within a few seconds.`,
      });
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setResult({ ok: false, text: (Array.isArray(msg) ? msg.join(', ') : msg) || 'The test message could not be sent.' });
    } finally {
      setSending(false);
    }
  };

  const options = [
    ...(templates.some((t) => t.name === 'hello_world')
      ? []
      : [{ value: 'hello_world|en_US', label: 'hello_world (en_US) · Meta sample template' }]),
    ...templates.map((t) => ({ value: `${t.name}|${t.language}`, label: `${t.name} (${t.language})` })),
    { value: PLAIN_TEXT, label: 'Plain text (only if they messaged you in the last 24 hours)' },
  ];

  return (
    <Card size="small" style={{ borderRadius: radius.lg }}>
      <Flex vertical gap={space.md}>
        <Text strong>Send a test message</Text>
        <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
          Sends one message right now through the Cloud API, to check everything works.
        </Text>
        <Input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Phone with country code, e.g. 919876543210"
          inputMode="tel"
        />
        <Select value={choice} onChange={setChoice} options={options} />
        {choice === PLAIN_TEXT && (
          <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} />
        )}
        {templates.some((t) => `${t.name}|${t.language}` === choice && t.bodyParamCount > 0) && (
          <Text style={{ fontSize: font.size.caption, color: color.warning }}>
            This template has blanks to fill, so Meta may reject it here. Use one without blanks, or hello_world.
          </Text>
        )}
        <Flex>
          <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => void send()}>
            Send test
          </Button>
        </Flex>
        {result && <Alert type={result.ok ? 'success' : 'error'} showIcon title={result.text} />}
      </Flex>
    </Card>
  );
}

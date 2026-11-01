import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Flex, Form, Input, Tag, Typography, message } from 'antd';
import { KeyOutlined } from '@ant-design/icons';
import { aiAPI } from '../services/endpoints';
import type { AiProviderState, AiProvidersState } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text, Link } = Typography;

function apiError(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return (Array.isArray(msg) ? msg.join(', ') : msg) || fallback;
}

function Status({ p }: { p: AiProviderState }) {
  if (!p.configured) return <Tag>Not set</Tag>;
  return (
    <Tag color="green">
      Set {p.keyHint} · {p.model}
      {p.source === 'env' ? ' · from server' : ''}
    </Tag>
  );
}

/**
 * Gemini and OpenAI keys, entered in the portal.
 *
 * AI replies and reply analysis did nothing until someone edited the server's
 * environment file and redeployed. Keys saved here take effect immediately. Gemini
 * alone is enough; when both are set OpenAI is tried first and Gemini takes over if it
 * fails.
 */
export default function AiKeysCard() {
  const [state, setState] = useState<AiProvidersState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    try {
      const { data } = await aiAPI.providers();
      setState(data);
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const v = form.getFieldsValue();
    setSaving(true);
    try {
      const { data } = await aiAPI.saveProviders(v);
      setState(data);
      form.resetFields();
      message.success('AI keys saved');
    } catch (err) {
      message.error(apiError(err, 'Could not save the AI keys.'), 8);
    } finally {
      setSaving(false);
    }
  };

  const test = async (provider: 'openai' | 'gemini') => {
    setTesting(provider);
    try {
      const { data } = await aiAPI.testProvider(provider);
      message.success(`${provider === 'gemini' ? 'Gemini' : 'OpenAI'} works (answered "${data.reply}" in ${data.ms} ms)`);
    } catch (err) {
      message.error(apiError(err, 'The key did not work.'), 10);
    } finally {
      setTesting(null);
    }
  };

  return (
    <Card size="small" style={{ borderRadius: radius.lg }}>
      <Flex vertical gap={space.md}>
        <Flex align="center" gap={space.sm}>
          <KeyOutlined style={{ color: color.accent }} />
          <Text strong>AI keys</Text>
        </Flex>
        <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>
          The assistant needs a key to read replies and answer them. Gemini alone is enough. Get a free key at{' '}
          <Link href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">
            aistudio.google.com
          </Link>
          .
        </Text>

        {state && !state.gemini.configured && !state.openai.configured && (
          <Alert
            type="warning"
            showIcon
            title="No AI key is set, so AI replies and reply analysis cannot run."
          />
        )}

        <Form form={form} layout="vertical">
          <Flex justify="space-between" align="center" gap={space.sm} wrap>
            <Text strong>Gemini (Google)</Text>
            {state && <Status p={state.gemini} />}
          </Flex>
          <Flex gap={space.sm} wrap style={{ marginTop: space.xs }}>
            <Form.Item name="geminiKey" style={{ flex: 2, minWidth: 220, marginBottom: space.sm }}>
              <Input.Password placeholder={state?.gemini.configured ? 'Leave blank to keep the saved key' : 'Paste Gemini API key (AIza…)'} autoComplete="off" />
            </Form.Item>
            <Form.Item name="geminiModel" style={{ flex: 1, minWidth: 160, marginBottom: space.sm }}>
              <Input placeholder={state?.gemini.model ?? 'gemini-2.0-flash'} />
            </Form.Item>
            <Button onClick={() => void test('gemini')} loading={testing === 'gemini'} disabled={!state?.gemini.configured}>
              Test
            </Button>
          </Flex>

          <Flex justify="space-between" align="center" gap={space.sm} wrap style={{ marginTop: space.md }}>
            <Text strong>OpenAI (optional)</Text>
            {state && <Status p={state.openai} />}
          </Flex>
          <Flex gap={space.sm} wrap style={{ marginTop: space.xs }}>
            <Form.Item name="openaiKey" style={{ flex: 2, minWidth: 220, marginBottom: space.sm }}>
              <Input.Password placeholder={state?.openai.configured ? 'Leave blank to keep the saved key' : 'Paste OpenAI API key (sk-…)'} autoComplete="off" />
            </Form.Item>
            <Form.Item name="openaiModel" style={{ flex: 1, minWidth: 160, marginBottom: space.sm }}>
              <Input placeholder={state?.openai.model ?? 'gpt-4o'} />
            </Form.Item>
            <Button onClick={() => void test('openai')} loading={testing === 'openai'} disabled={!state?.openai.configured}>
              Test
            </Button>
          </Flex>

          <Flex gap={space.sm} align="center" wrap style={{ marginTop: space.sm }}>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              Save keys
            </Button>
            <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
              Type a single dash (-) in a key box and save to remove that key.
            </Text>
          </Flex>
        </Form>

        <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
          AI replies also need the switch below turned on, and the WhatsApp webhook set up so replies reach the portal.
        </Text>
      </Flex>
    </Card>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Alert, Flex, Form, Radio, Select, Tag, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { whatsappCloudAPI } from '../services/endpoints';
import TemplatePreview from './TemplatePreview';
import type { WhatsAppCloudTemplate } from '../services/endpoints';
import { toMetaTemplate } from '../utils/metaTemplate';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

const MERGE_FIELDS = [
  '{{contact_name}}',
  '{{company_name}}',
  '{{city}}',
  '{{district}}',
  '{{state}}',
  '{{country}}',
  '{{product}}',
  '{{campaign_name}}',
];

export type MetaMode = 'create' | 'existing';

/** Form fields this section owns, read by the Create Campaign submit handler. */
export interface MetaTemplateFormValues {
  meta_mode?: MetaMode;
  meta_existing?: string; // "name|language"
  meta_params?: string[];
  meta_category?: 'MARKETING' | 'UTILITY';
}

/** Payload for `meta_template` on campaign create, or undefined when not on the Cloud API. */
export function buildMetaTemplatePayload(values: MetaTemplateFormValues, cloudActive: boolean) {
  if (!cloudActive) return undefined;
  if (values.meta_mode === 'existing' && values.meta_existing) {
    const [name, language] = values.meta_existing.split('|');
    return { mode: 'existing' as const, name, language, params: values.meta_params ?? [] };
  }
  return { mode: 'create' as const, language: 'en', category: values.meta_category ?? 'MARKETING' };
}

/**
 * "How should the first message reach people?" for the official WhatsApp API.
 *
 * Meta only lets a business start a conversation with a template it has approved. The
 * default turns the First Message typed above into a template and submits it to Meta
 * when the campaign is created, showing exactly the text Meta will review. The
 * alternative picks a template that is already approved, so the campaign can run at once.
 */
export default function CampaignMetaTemplateSection({ form }: { form: FormInstance }) {
  const mode = (Form.useWatch('meta_mode', form) as MetaMode | undefined) ?? 'create';
  const firstMessage = Form.useWatch('first_message', form) as string | undefined;
  const product = Form.useWatch('product', form) as string | undefined;
  const name = Form.useWatch('name', form) as string | undefined;
  const existing = Form.useWatch('meta_existing', form) as string | undefined;
  const [templates, setTemplates] = useState<WhatsAppCloudTemplate[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    whatsappCloudAPI
      .templates()
      .then(({ data }) => !cancelled && setTemplates(data.filter((t) => t.status === 'APPROVED')))
      .catch(() => !cancelled && setTemplates([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const draft = useMemo(
    () => toMetaTemplate(firstMessage ?? '', { product, campaignName: name }),
    [firstMessage, product, name],
  );
  const chosen = templates?.find((t) => `${t.name}|${t.language}` === existing) ?? null;

  // Size the blank values to the chosen template; {{1}} defaults to the contact's name.
  useEffect(() => {
    if (!chosen) return;
    const current = (form.getFieldValue('meta_params') as string[] | undefined) ?? [];
    form.setFieldValue(
      'meta_params',
      Array.from({ length: chosen.bodyParamCount }, (_, i) => current[i] ?? (i === 0 ? '{{contact_name}}' : '')),
    );
  }, [chosen, form]);

  return (
    <div
      style={{
        marginBottom: space.lg,
        padding: space.md,
        borderRadius: radius.lg,
        border: `1px solid ${color.separatorOpaque}`,
      }}
    >
      <Flex vertical gap={space.sm}>
        <Flex align="center" gap={space.sm}>
          <Text strong>WhatsApp official API</Text>
          <Tag color="blue">Meta template</Tag>
        </Flex>
        <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
          Meta only delivers a first message that it has approved as a template.
        </Text>

        <Form.Item name="meta_mode" initialValue="create" style={{ marginBottom: 0 }}>
          <Radio.Group>
            <Flex vertical gap={4}>
              <Radio value="create">Create a new Meta template from the First Message</Radio>
              <Radio value="existing">Use a template Meta has already approved</Radio>
            </Flex>
          </Radio.Group>
        </Form.Item>

        {mode === 'create' ? (
          <>
            {draft.body ? (
              <div style={{ background: color.fill, borderRadius: radius.md, padding: space.sm }}>
                <Text style={{ fontSize: font.size.caption, color: color.textSecondary, display: 'block' }}>
                  Text sent to Meta for approval
                </Text>
                <Text style={{ whiteSpace: 'pre-wrap', fontSize: font.size.footnote }}>{draft.body}</Text>
                {draft.params.length > 0 && (
                  <Text style={{ display: 'block', fontSize: font.size.caption, color: color.textSecondary }}>
                    {draft.params.map((p, i) => `{{${i + 1}}} = ${p}`).join(' · ')}
                  </Text>
                )}
              </div>
            ) : (
              <Text style={{ fontSize: font.size.caption, color: color.warning }}>
                Write the First Message above; it becomes the template.
              </Text>
            )}
            {draft.body && draft.problems.length > 0 && (
              <Alert type="warning" showIcon title={draft.problems.join(' ')} />
            )}
            <Form.Item name="meta_category" initialValue="MARKETING" label="Category" style={{ marginBottom: 0 }}>
              <Radio.Group>
                <Radio value="MARKETING">Marketing (offers, outreach)</Radio>
                <Radio value="UTILITY">Utility</Radio>
              </Radio.Group>
            </Form.Item>
            <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
              Meta usually approves within minutes. You can activate the campaign once it shows Approved. Spintax
              keeps only its first option, because a template is fixed text.
            </Text>
          </>
        ) : templates && templates.length === 0 ? (
          <Alert
            type="info"
            showIcon
            title="No approved templates yet"
            description="Choose “Create a new Meta template” instead, or make one in Settings → WhatsApp."
          />
        ) : (
          <>
            <Form.Item
              name="meta_existing"
              rules={[{ required: true, message: 'Choose an approved template' }]}
              style={{ marginBottom: space.xs }}
            >
              <Select
                loading={templates === null}
                placeholder="Choose an approved template"
                options={(templates ?? []).map((t) => ({
                  value: `${t.name}|${t.language}`,
                  label: `${t.name} (${t.language})`,
                }))}
              />
            </Form.Item>
            {chosen && <TemplatePreview template={chosen} />}
            {chosen && chosen.bodyParamCount > 0 && (
              <Form.Item
                name="meta_params"
                label={`Values, in this order: ${(chosen.bodyParamNames ?? []).map((n) => `{{${n}}}`).join(', ')}`}
                style={{ marginBottom: 0 }}
              >
                <Select mode="tags" options={MERGE_FIELDS.map((f) => ({ value: f, label: f }))} />
              </Form.Item>
            )}
          </>
        )}
      </Flex>
    </div>
  );
}

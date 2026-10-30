import { useEffect, useState } from 'react';
import { Collapse, Flex, Form, Input, Select, Tag, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { whatsappCloudAPI } from '../services/endpoints';
import type { WhatsAppCloudTemplate } from '../services/endpoints';
import { color, font, space } from '../theme/tokens';

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

/**
 * Optional Meta template for a campaign step, used when the WhatsApp Cloud API sends.
 *
 * Meta only lets a business start a conversation with a template it has approved, so
 * cold outreach through the Cloud API needs one. The QR session ignores these fields.
 * Lists the account's approved templates when the Cloud API is connected, and falls back
 * to typing the name when it is not.
 */
export default function MetaTemplateFields({
  form,
  defaultOpen = false,
}: {
  form: FormInstance;
  /** Start expanded, for the dialog whose only purpose is choosing the template. */
  defaultOpen?: boolean;
}) {
  const [templates, setTemplates] = useState<WhatsAppCloudTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const selectedName = Form.useWatch('cloud_template_name', form) as string | undefined;
  const selectedLang = Form.useWatch('cloud_template_language', form) as string | undefined;

  useEffect(() => {
    let cancelled = false;
    whatsappCloudAPI
      .templates()
      .then(({ data }) => {
        if (!cancelled) setTemplates(data);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.response?.data?.message;
        setLoadError(typeof msg === 'string' ? msg : 'Cloud API not connected');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = templates?.find(
    (t) => t.name === selectedName && (!selectedLang || t.language === selectedLang),
  );

  const onPick = (value: string | undefined) => {
    if (!value) {
      form.setFieldsValue({ cloud_template_name: null, cloud_template_language: null, cloud_template_params: [] });
      return;
    }
    const [name, language] = value.split('|');
    const tpl = templates?.find((t) => t.name === name && t.language === language);
    const current = (form.getFieldValue('cloud_template_params') as string[] | undefined) ?? [];
    form.setFieldsValue({
      cloud_template_name: name,
      cloud_template_language: language,
      // Pre-size the parameter list so the operator sees how many values Meta expects.
      cloud_template_params: tpl
        ? Array.from({ length: tpl.bodyParamCount }, (_, i) => current[i] ?? (i === 0 ? '{{contact_name}}' : ''))
        : current,
    });
  };

  return (
    <Collapse
      size="small"
      ghost
      defaultActiveKey={defaultOpen ? ['meta'] : undefined}
      items={[
        {
          key: 'meta',
          label: (
            <Text style={{ fontSize: font.size.footnote }}>
              WhatsApp Cloud API template {selectedName ? <Tag color="blue">{selectedName}</Tag> : '(optional)'}
            </Text>
          ),
          children: (
            <Flex vertical gap={space.sm}>
              <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                Used only when sending through the official Cloud API. Meta requires an approved template for the
                first message to a contact. The message body above stays as the readable copy in the portal.
              </Text>

              {templates && templates.length > 0 ? (
                <Form.Item label="Approved template" style={{ marginBottom: space.sm }}>
                  <Select
                    allowClear
                    showSearch
                    loading={loading}
                    placeholder="Pick a Meta template"
                    value={selectedName ? `${selectedName}|${selectedLang ?? ''}` : undefined}
                    onChange={onPick}
                    options={templates.map((t) => ({
                      value: `${t.name}|${t.language}`,
                      label: `${t.name} (${t.language})${t.status === 'APPROVED' ? '' : ` · ${t.status}`}`,
                      disabled: t.status !== 'APPROVED',
                    }))}
                  />
                </Form.Item>
              ) : (
                !loading && (
                  <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                    {loadError ? `Templates could not be listed: ${loadError}. ` : 'No templates found. '}
                    You can still type the template name and language.
                  </Text>
                )
              )}

              <Flex gap={space.md}>
                <Form.Item name="cloud_template_name" label="Template name" style={{ flex: 2, marginBottom: space.sm }}>
                  <Input placeholder="e.g. heritage_tour_intro" allowClear />
                </Form.Item>
                <Form.Item name="cloud_template_language" label="Language" style={{ flex: 1, marginBottom: space.sm }}>
                  <Input placeholder="en" />
                </Form.Item>
              </Flex>

              {selected?.body && (
                <div
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: font.size.footnote,
                    background: color.fill,
                    padding: space.sm,
                    borderRadius: 8,
                  }}
                >
                  {selected.body}
                </div>
              )}

              <Form.Item
                name="cloud_template_params"
                label="Values for {{1}}, {{2}}…"
                extra="In order. Merge fields are filled per contact."
                style={{ marginBottom: 0 }}
              >
                <Select
                  mode="tags"
                  placeholder="{{contact_name}}"
                  options={MERGE_FIELDS.map((f) => ({ value: f, label: f }))}
                  tokenSeparators={[]}
                />
              </Form.Item>
            </Flex>
          ),
        },
      ]}
    />
  );
}

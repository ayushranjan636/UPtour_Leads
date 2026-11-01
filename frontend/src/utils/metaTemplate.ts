/**
 * Turn a portal message into the shape Meta's template API wants.
 *
 * Portal messages use named merge fields ({{contact_name}}) and spintax
 * ({Hi|Hello}). A Meta template is fixed text with numbered blanks ({{1}}, {{2}}…),
 * filled per contact at send time. So the first spintax variant is kept, each distinct
 * merge field becomes the next number, and the original field names are kept in order
 * as the send-time parameters.
 *
 * Frontend copy of backend/src/modules/whatsapp-cloud/meta-template.util.ts, used for
 * the live preview in Create Campaign. The server converts again on submit, so the two
 * only have to agree for the preview to be honest; keep them in step.
 */

/** Example values shown to Meta's reviewers, per merge field. */
const SAMPLE_VALUES: Record<string, string> = {
  contact_name: 'Asha',
  company_name: 'Hill Palace Tours',
  city: 'Kochi',
  district: 'Ernakulam',
  state: 'Kerala',
  country: 'India',
  product: 'Heritage tour',
  campaign_name: 'Kerala heritage',
};

export interface MetaTemplateDraft {
  /** Template text with {{1}}, {{2}}… */
  body: string;
  /** Send-time values, in order, as merge fields: ['{{contact_name}}', …]. */
  params: string[];
  /** One reviewer sample per blank. */
  examples: string[];
  /** Why Meta would reject this text, in plain words; empty when it looks acceptable. */
  problems: string[];
}

/** Keep the first option of each {a|b|c} group, leaving {{merge_fields}} alone. */
export function firstSpintaxVariant(text: string): string {
  let out = text;
  // Innermost groups first, so nested spintax collapses fully.
  for (let i = 0; i < 10; i++) {
    const next = out.replace(/(^|[^{])\{([^{}]*\|[^{}]*)\}(?!\})/g, (_m, pre, group) => `${pre}${group.split('|')[0]}`);
    if (next === out) break;
    out = next;
  }
  return out;
}

export function toMetaTemplate(
  message: string,
  context: { product?: string | null; campaignName?: string | null } = {},
): MetaTemplateDraft {
  const plain = firstSpintaxVariant(message ?? '').trim();
  const order: string[] = [];
  const body = plain.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, field: string) => {
    const key = field.toLowerCase();
    let index = order.indexOf(key);
    if (index === -1) {
      order.push(key);
      index = order.length - 1;
    }
    return `{{${index + 1}}}`;
  });

  const examples = order.map((key) => {
    if (key === 'product' && context.product?.trim()) return context.product.trim();
    if (key === 'campaign_name' && context.campaignName?.trim()) return context.campaignName.trim();
    return SAMPLE_VALUES[key] ?? 'Example';
  });

  const problems: string[] = [];
  if (!body) problems.push('Write the first message first.');
  if (/^\{\{\d+\}\}/.test(body)) {
    problems.push('Meta does not allow a template to start with a merge field. Put a word before it, e.g. "Hi {{contact_name}}".');
  }
  if (/\{\{\d+\}\}[\s.!?,]*$/.test(body)) {
    problems.push('Meta does not allow a template to end with a merge field. Add a few words after it.');
  }
  const unknown = order.filter((k) => !(k in SAMPLE_VALUES));
  if (unknown.length) {
    problems.push(`Unknown merge field: ${unknown.map((k) => `{{${k}}}`).join(', ')}.`);
  }

  return { body, params: order.map((k) => `{{${k}}}`), examples, problems };
}

/** A template name Meta accepts and that will not clash with an earlier one. */
export function metaTemplateName(campaignName: string, suffix: string): string {
  const slug = (campaignName || 'campaign')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${slug || 'campaign'}_${suffix}`;
}

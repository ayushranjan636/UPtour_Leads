import { Flex, Typography } from 'antd';
import {
  CopyOutlined,
  EnvironmentOutlined,
  ExportOutlined,
  FilePdfOutlined,
  PhoneOutlined,
  RollbackOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import type { WhatsAppCloudTemplate } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

const buttonIcon: Record<string, React.ReactNode> = {
  URL: <ExportOutlined />,
  PHONE_NUMBER: <PhoneOutlined />,
  COPY_CODE: <CopyOutlined />,
  QUICK_REPLY: <RollbackOutlined />,
};

/**
 * A template drawn the way WhatsApp shows it: header, text, footer and buttons.
 *
 * Used wherever a template is chosen, so the operator sees what the recipient gets,
 * including the image or video header, rather than only the template's name.
 */
export default function TemplatePreview({
  template,
  values,
}: {
  template: Pick<
    WhatsAppCloudTemplate,
    'body' | 'headerFormat' | 'headerExampleUrl' | 'headerText' | 'footer' | 'buttons' | 'bodyParamNames'
  >;
  /** Values for the blanks, in order; shown in place of {{…}} when given. */
  values?: string[];
}) {
  const names = template.bodyParamNames ?? [];
  const body = (template.body ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, n) => {
    const i = names.indexOf(n);
    return (i >= 0 && values?.[i]?.trim()) || m;
  });
  const h = template.headerFormat;

  return (
    <div style={{ background: '#E7DDD3', borderRadius: radius.lg, padding: space.sm, maxWidth: 340 }}>
      <div style={{ background: '#fff', borderRadius: radius.md, overflow: 'hidden' }}>
        {h === 'IMAGE' && template.headerExampleUrl && (
          <img src={template.headerExampleUrl} alt="" style={{ display: 'block', width: '100%', maxHeight: 200, objectFit: 'cover' }} />
        )}
        {h && h !== 'TEXT' && !(h === 'IMAGE' && template.headerExampleUrl) && (
          <Flex
            align="center"
            justify="center"
            gap={space.xs}
            style={{ height: 90, background: color.fill, color: color.textSecondary, fontSize: font.size.footnote }}
          >
            {h === 'VIDEO' ? <VideoCameraOutlined /> : h === 'DOCUMENT' ? <FilePdfOutlined /> : h === 'LOCATION' ? <EnvironmentOutlined /> : null}
            {h === 'LOCATION' ? 'Your business location' : `${h.toLowerCase()} header`}
          </Flex>
        )}
        <div style={{ padding: `${space.sm}px ${space.md}px` }}>
          {h === 'TEXT' && template.headerText && (
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              {template.headerText}
            </Text>
          )}
          <Text style={{ whiteSpace: 'pre-wrap', fontSize: font.size.footnote }}>{body}</Text>
          {template.footer && (
            <Text style={{ display: 'block', marginTop: 4, fontSize: font.size.caption, color: color.textSecondary }}>
              {template.footer}
            </Text>
          )}
        </div>
        {(template.buttons ?? []).map((b, i) => (
          <Flex
            key={i}
            align="center"
            justify="center"
            gap={6}
            style={{ borderTop: `1px solid ${color.separatorOpaque}`, padding: 8, color: '#027EB5', fontSize: font.size.footnote }}
          >
            {buttonIcon[b.type]}
            {b.text}
          </Flex>
        ))}
      </div>
    </div>
  );
}

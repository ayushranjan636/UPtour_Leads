import { useState } from 'react';
import { Button, Flex, Typography, Upload, message } from 'antd';
import { DeleteOutlined, FilePdfOutlined, PaperClipOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { mediaAPI } from '../services/endpoints';
import type { UploadedMedia } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

const ACCEPT: Record<'image' | 'video' | 'document' | 'any', string> = {
  image: 'image/jpeg,image/png',
  video: 'video/mp4,video/3gpp',
  document: 'application/pdf',
  any: 'image/jpeg,image/png,video/mp4,video/3gpp,application/pdf',
};

/** What a form stores for an attached file. */
export interface MediaValue {
  url: string;
  filename: string;
  kind: 'image' | 'video' | 'document';
  id?: string;
}

/**
 * Attach one image, video or PDF to a WhatsApp message or template.
 *
 * Uploads straight away and hands back the public link WhatsApp downloads it from, so
 * forms only store a URL. Shows a thumbnail for images so the operator sees what will
 * be sent.
 */
export default function MediaUpload({
  value,
  onChange,
  kind = 'any',
  label = 'Attach image, video or PDF',
}: {
  value?: MediaValue | null;
  onChange?: (v: MediaValue | null) => void;
  kind?: 'image' | 'video' | 'document' | 'any';
  label?: string;
}) {
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const { data } = await mediaAPI.upload(file);
      onChange?.({ url: data.url, filename: data.filename, kind: (data as UploadedMedia).kind, id: data.id });
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(msg || 'The file could not be uploaded.', 8);
    } finally {
      setUploading(false);
    }
  };

  if (value?.url) {
    return (
      <Flex align="center" gap={space.sm} style={{ border: `1px solid ${color.separatorOpaque}`, borderRadius: radius.md, padding: space.sm }}>
        {value.kind === 'image' ? (
          <img src={value.url} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: radius.sm }} />
        ) : value.kind === 'video' ? (
          <VideoCameraOutlined style={{ fontSize: 28, color: color.accent }} />
        ) : (
          <FilePdfOutlined style={{ fontSize: 28, color: color.danger }} />
        )}
        <Text style={{ flex: 1, fontSize: font.size.footnote, wordBreak: 'break-all' }}>{value.filename}</Text>
        <Button type="text" danger icon={<DeleteOutlined />} aria-label="Remove file" onClick={() => onChange?.(null)} />
      </Flex>
    );
  }

  return (
    <Upload
      accept={ACCEPT[kind]}
      showUploadList={false}
      beforeUpload={(file) => {
        void upload(file);
        return false;
      }}
    >
      <Button icon={<PaperClipOutlined />} loading={uploading}>
        {label}
      </Button>
    </Upload>
  );
}

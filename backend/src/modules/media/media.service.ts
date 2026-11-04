import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { publicApiBase } from '../../common/utils/public-url.util';

/** What WhatsApp accepts, by kind, with Meta's size limits. */
const KINDS: Record<string, { kind: 'image' | 'video' | 'document'; maxBytes: number }> = {
  'image/jpeg': { kind: 'image', maxBytes: 5 * 1024 * 1024 },
  'image/png': { kind: 'image', maxBytes: 5 * 1024 * 1024 },
  'video/mp4': { kind: 'video', maxBytes: 16 * 1024 * 1024 },
  'video/3gpp': { kind: 'video', maxBytes: 16 * 1024 * 1024 },
  'application/pdf': { kind: 'document', maxBytes: 16 * 1024 * 1024 },
};

export interface StoredMedia {
  id: string;
  url: string;
  filename: string;
  mime: string;
  size: number;
  kind: 'image' | 'video' | 'document';
}

/**
 * Images, videos and PDFs attached to campaign messages and Meta templates.
 *
 * Stored in Postgres rather than on disk: the API container is rebuilt on every deploy
 * and has no persistent volume, so a file on disk would vanish and every campaign using
 * it would start failing. Each file is served at a public URL, because WhatsApp fetches
 * media by link when it delivers a message.
 */
@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(
        `CREATE TABLE IF NOT EXISTS app_media (
           id varchar(64) PRIMARY KEY,
           filename varchar(255) NOT NULL,
           mime varchar(100) NOT NULL,
           size int NOT NULL,
           data bytea NOT NULL,
           created_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
    } catch (err) {
      this.logger.error(`Could not create the media table: ${(err as Error).message}`);
    }
  }

  static kindOf(mime: string): 'image' | 'video' | 'document' | null {
    return KINDS[mime]?.kind ?? null;
  }

  /** Public link WhatsApp downloads the file from. */
  urlFor(id: string, filename: string): string {
    return `${publicApiBase(this.config)}/media/${id}/${encodeURIComponent(filename)}`;
  }

  /** Pull our own media id back out of a stored media URL, or null for an outside link. */
  static idFromUrl(url: string | null | undefined): string | null {
    const m = /\/media\/([a-f0-9-]{36})\//i.exec(url ?? '');
    return m ? m[1] : null;
  }

  async save(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }): Promise<StoredMedia> {
    const rule = KINDS[file.mimetype];
    if (!rule) {
      throw new BadRequestException('Use a JPG or PNG image, an MP4 video, or a PDF. WhatsApp accepts only these.');
    }
    if (file.size > rule.maxBytes) {
      throw new BadRequestException(
        `WhatsApp allows ${rule.kind === 'image' ? 'images' : `${rule.kind}s`} up to ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`,
      );
    }
    const id = randomUUID();
    const filename = (file.originalname || `file.${file.mimetype.split('/')[1]}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    await this.dataSource.query(
      'INSERT INTO app_media (id, filename, mime, size, data) VALUES ($1, $2, $3, $4, $5)',
      [id, filename, file.mimetype, file.size, file.buffer],
    );
    return { id, url: this.urlFor(id, filename), filename, mime: file.mimetype, size: file.size, kind: rule.kind };
  }

  async get(id: string): Promise<{ filename: string; mime: string; data: Buffer }> {
    const rows = await this.dataSource.query('SELECT filename, mime, data FROM app_media WHERE id = $1', [id]);
    if (!rows?.[0]) throw new NotFoundException('File not found');
    return rows[0];
  }
}

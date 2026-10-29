import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';

export enum MessageTemplateType {
  TEXT = 'text',
  IMAGE = 'image',
  DOCUMENT = 'document',
  VIDEO = 'video',
}

@Entity('message_templates')
export class MessageTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  campaign_id: string;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: MessageTemplateType,
    default: MessageTemplateType.TEXT,
  })
  type: MessageTemplateType;

  @Column({ type: 'text' })
  body: string;

  @Column({ nullable: true })
  media_url: string;

  @Column({ nullable: true })
  media_filename: string;

  @Column({ type: 'int', default: 0 })
  sequence_order: number;

  @Column({ default: 'initial' })
  trigger_condition: string;

  /**
   * Approved Meta template to send instead of `body` when the WhatsApp Cloud API is
   * active. Meta only lets a business open a conversation with an approved template,
   * so a first message without one is refused. Ignored by the session gateway.
   */
  @Column({ type: 'varchar', nullable: true })
  cloud_template_name: string | null;

  /** Language code the Meta template was approved in, e.g. `en` or `en_US`. */
  @Column({ type: 'varchar', nullable: true })
  cloud_template_language: string | null;

  /**
   * Values for the template's {{1}}, {{2}}… placeholders, in order. Each entry may use
   * the same merge fields as `body`, e.g. `{{contact_name}}`.
   */
  @Column({ type: 'simple-json', nullable: true })
  cloud_template_params: string[] | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Campaign, (campaign) => campaign.templates, {
    nullable: true,
  })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}

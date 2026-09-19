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

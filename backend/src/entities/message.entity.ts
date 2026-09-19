import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CampaignContact } from './campaign-contact.entity';
import { Contact } from './contact.entity';
import { MessageTemplate } from './message-template.entity';

export enum MessageDirection {
  OUTGOING = 'outgoing',
  INCOMING = 'incoming',
}

export enum MessageStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed',
}

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  campaign_contact_id: string;

  @Column()
  contact_id: string;

  @Column({ type: 'enum', enum: MessageDirection })
  direction: MessageDirection;

  @Column({ default: 'text' })
  type: string;

  @Column({ type: 'text', nullable: true })
  body: string;

  @Column({ nullable: true })
  media_url: string;

  @Column({ nullable: true })
  openwa_message_id: string;

  @Column({ nullable: true })
  openwa_session_id: string;

  @Column({
    type: 'enum',
    enum: MessageStatus,
    default: MessageStatus.QUEUED,
  })
  status: MessageStatus;

  @Column({ nullable: true })
  failed_reason: string;

  @Column({ nullable: true })
  template_id: string;

  @Column({ type: 'timestamptz', nullable: true })
  sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  delivered_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  read_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => CampaignContact, { nullable: true })
  @JoinColumn({ name: 'campaign_contact_id' })
  campaign_contact: CampaignContact;

  @ManyToOne(() => Contact, (contact) => contact.messages)
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @ManyToOne(() => MessageTemplate, { nullable: true })
  @JoinColumn({ name: 'template_id' })
  template: MessageTemplate;
}

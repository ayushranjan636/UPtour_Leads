import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { Contact } from './contact.entity';
import { User } from './user.entity';

export enum CampaignContactStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  REPLIED = 'replied',
  OPTED_OUT = 'opted_out',
  FAILED = 'failed',
  HUMAN_TAKEOVER = 'human_takeover',
  UNRESPONSIVE = 'unresponsive',
}

export enum CampaignContactMode {
  AI = 'ai',
  HUMAN = 'human',
}

@Entity('campaign_contacts')
@Unique(['campaign_id', 'contact_id'])
export class CampaignContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  campaign_id: string;

  @Column()
  contact_id: string;

  @Column({
    type: 'enum',
    enum: CampaignContactStatus,
    default: CampaignContactStatus.PENDING,
  })
  status: CampaignContactStatus;

  @Column({
    type: 'enum',
    enum: CampaignContactMode,
    default: CampaignContactMode.AI,
  })
  mode: CampaignContactMode;

  @Column({ nullable: true })
  assigned_to: string;

  @Column({ type: 'int', default: 0 })
  current_sequence_step: number;

  @Column({ type: 'timestamptz', nullable: true })
  first_sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_sent_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_reply_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  next_followup_at: Date | null;

  @Column({ type: 'int', default: 0 })
  followup_count: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Campaign, (campaign) => campaign.campaign_contacts)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @ManyToOne(() => Contact, (contact) => contact.campaign_contacts)
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assigned_to' })
  assignedTo: User;
}

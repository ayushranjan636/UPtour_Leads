import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { CampaignContact } from './campaign-contact.entity';
import { MessageTemplate } from './message-template.entity';

export enum CampaignStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  product: string;

  @Column({ nullable: true })
  target_country: string;

  @Column({ nullable: true })
  target_region: string;

  @Column({ nullable: true })
  target_agency_type: string;

  @Column({
    type: 'enum',
    enum: CampaignStatus,
    default: CampaignStatus.DRAFT,
  })
  status: CampaignStatus;

  @Column({ type: 'int', default: 100 })
  daily_send_limit: number;

  @Column({ type: 'time', default: '09:00' })
  send_window_start: string;

  @Column({ type: 'time', default: '18:00' })
  send_window_end: string;

  @Column({ default: 'Asia/Kolkata' })
  send_window_timezone: string;

  @Column({ nullable: true })
  openwa_session_id: string;

  @Column({ type: 'int', default: 2 })
  max_followups: number;

  @Column({ type: 'int', default: 0 })
  stats_sent: number;

  @Column({ type: 'int', default: 0 })
  stats_delivered: number;

  @Column({ type: 'int', default: 0 })
  stats_read: number;

  @Column({ type: 'int', default: 0 })
  stats_replied: number;

  @Column({ type: 'int', default: 0 })
  stats_opted_out: number;

  @Column({ type: 'int', default: 0 })
  stats_leads: number;

  @Column()
  created_by: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @OneToMany(() => CampaignContact, (cc) => cc.campaign)
  campaign_contacts: CampaignContact[];

  @OneToMany(() => MessageTemplate, (mt) => mt.campaign)
  templates: MessageTemplate[];
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CampaignContact } from './campaign-contact.entity';
import { MessageTemplate } from './message-template.entity';

export enum FollowupJobStatus {
  SCHEDULED = 'scheduled',
  SENT = 'sent',
  CANCELLED = 'cancelled',
  SKIPPED = 'skipped',
}

@Entity('followup_jobs')
export class FollowupJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  campaign_contact_id: string;

  @Column({ nullable: true })
  template_id: string;

  @Column({ type: 'timestamptz' })
  scheduled_at: Date;

  @Column({
    type: 'enum',
    enum: FollowupJobStatus,
    default: FollowupJobStatus.SCHEDULED,
  })
  status: FollowupJobStatus;

  @Column({ nullable: true })
  skip_reason: string;

  @Column({ type: 'timestamptz', nullable: true })
  sent_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => CampaignContact)
  @JoinColumn({ name: 'campaign_contact_id' })
  campaign_contact: CampaignContact;

  @ManyToOne(() => MessageTemplate, { nullable: true })
  @JoinColumn({ name: 'template_id' })
  template: MessageTemplate;
}

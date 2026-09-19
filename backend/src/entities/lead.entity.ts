import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contact } from './contact.entity';
import { Company } from './company.entity';
import { Campaign } from './campaign.entity';
import { CampaignContact } from './campaign-contact.entity';
import { User } from './user.entity';

export enum LeadStatus {
  NEW = 'new',
  CONTACTED = 'contacted',
  ENGAGED = 'engaged',
  INTERESTED = 'interested',
  QUALIFIED = 'qualified',
  HUMAN_HANDOVER = 'human_handover',
  PROPOSAL_SENT = 'proposal_sent',
  NEGOTIATION = 'negotiation',
  WON = 'won',
  LOST = 'lost',
  NOT_INTERESTED = 'not_interested',
  OPTED_OUT = 'opted_out',
}

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  contact_id: string;

  @Column({ nullable: true })
  company_id: string;

  @Column({ nullable: true })
  campaign_id: string;

  @Column({ nullable: true })
  campaign_contact_id: string;

  @Column({ type: 'enum', enum: LeadStatus, default: LeadStatus.NEW })
  status: LeadStatus;

  @Column({ nullable: true })
  assigned_to: string;

  @Column({ nullable: true })
  source: string;

  @Column({ nullable: true })
  product_interest: string;

  @Column('text', { array: true, default: '{}' })
  destinations: string[];

  @Column({ nullable: true })
  travel_period: string;

  @Column({ nullable: true })
  group_size: string;

  @Column({ type: 'text', nullable: true })
  requirements: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'int', nullable: true })
  lead_score: number;

  @Column({ type: 'date', nullable: true })
  next_followup_date: Date;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  estimated_value: number;

  @Column({ default: 'INR' })
  currency: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Contact)
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @ManyToOne(() => Company, { nullable: true })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => Campaign, { nullable: true })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @ManyToOne(() => CampaignContact, { nullable: true })
  @JoinColumn({ name: 'campaign_contact_id' })
  campaign_contact: CampaignContact;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assigned_to' })
  assignedTo: User;
}

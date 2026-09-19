import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Message } from './message.entity';
import { Contact } from './contact.entity';
import { CampaignContact } from './campaign-contact.entity';

@Entity('ai_analyses')
export class AiAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  message_id: string;

  @Column()
  contact_id: string;

  @Column({ nullable: true })
  campaign_contact_id: string;

  @Column({ nullable: true })
  intent: string;

  @Column({ nullable: true })
  interest_level: string;

  @Column({ nullable: true })
  product_interest: string;

  @Column('text', { array: true, default: '{}' })
  destination_interest: string[];

  @Column({ nullable: true })
  travel_period: string;

  @Column({ nullable: true })
  traveller_count: string;

  @Column({ type: 'text', nullable: true })
  requirements: string;

  @Column('text', { array: true, default: '{}' })
  questions: string[];

  @Column({ default: false })
  needs_human: boolean;

  @Column({ default: false })
  opt_out: boolean;

  @Column({ type: 'decimal', nullable: true })
  confidence: number;

  @Column({ type: 'int', nullable: true })
  lead_score: number;

  @Column({ type: 'text', nullable: true })
  reasoning: string;

  @Column({ type: 'jsonb', nullable: true })
  raw_llm_response: Record<string, any>;

  @Column({ nullable: true })
  model_used: string;

  @Column({ type: 'int', nullable: true })
  processing_time_ms: number;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => Message)
  @JoinColumn({ name: 'message_id' })
  message: Message;

  @ManyToOne(() => Contact)
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @ManyToOne(() => CampaignContact, { nullable: true })
  @JoinColumn({ name: 'campaign_contact_id' })
  campaign_contact: CampaignContact;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Lead } from './lead.entity';
import { User } from './user.entity';

export enum DealStage {
  PROPOSAL = 'proposal',
  NEGOTIATION = 'negotiation',
  VERBAL_AGREEMENT = 'verbal_agreement',
  WON = 'won',
  LOST = 'lost',
}

@Entity('deals')
export class Deal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  lead_id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  product: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  estimated_value: number;

  @Column({ default: 'INR' })
  currency: string;

  @Column({ type: 'enum', enum: DealStage, default: DealStage.PROPOSAL })
  stage: DealStage;

  @Column({ nullable: true })
  assigned_to: string;

  @Column({ type: 'date', nullable: true })
  expected_close_date: Date;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'timestamptz', nullable: true })
  won_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lost_at: Date | null;

  @Column({ nullable: true })
  lost_reason: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Lead)
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assigned_to' })
  assignedTo: User;
}

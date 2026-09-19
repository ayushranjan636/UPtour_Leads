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
import { User } from './user.entity';

export enum CollectionJobStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('collection_jobs')
export class CollectionJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  country: string;

  // Optional — an empty city means "search the whole country".
  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  category: string;

  @Column('text', { array: true, default: '{}' })
  keywords: string[];

  @Column({ default: 'google_maps' })
  data_source: string;

  @Column({ type: 'int', default: 100 })
  daily_limit: number;

  /** Optional overall goal, used by the UI to render a progress bar. */
  @Column({ type: 'int', nullable: true })
  target_total: number | null;

  @Column({
    type: 'enum',
    enum: CollectionJobStatus,
    default: CollectionJobStatus.ACTIVE,
  })
  status: CollectionJobStatus;

  @Column({ nullable: true })
  auto_add_to_campaign_id: string;

  @Column({ default: true })
  auto_verify_whatsapp: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  last_run_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  next_run_at: Date | null;

  @Column({ type: 'int', default: 0 })
  total_collected: number;

  @Column({ type: 'text', nullable: true })
  pagination_token: string | null;

  @Column({ type: 'int', default: 0 })
  search_offset: number;

  @Column()
  created_by: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Campaign, { nullable: true })
  @JoinColumn({ name: 'auto_add_to_campaign_id' })
  auto_add_to_campaign: Campaign;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;
}

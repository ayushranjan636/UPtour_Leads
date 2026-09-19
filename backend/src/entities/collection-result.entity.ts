import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CollectionJob } from './collection-job.entity';
import { Contact } from './contact.entity';
import { Company } from './company.entity';

export enum CollectionResultStatus {
  COLLECTED = 'collected',
  IMPORTED = 'imported',
  DUPLICATE = 'duplicate',
  INVALID = 'invalid',
  SKIPPED = 'skipped',
}

@Entity('collection_results')
export class CollectionResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  job_id: string;

  @Column({ type: 'date' })
  run_date: Date;

  @Column({ type: 'jsonb', nullable: true })
  raw_data: Record<string, any>;

  @Column({ nullable: true })
  business_name: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  website: string;

  @Column({ nullable: true })
  google_place_id: string;

  @Column({
    type: 'enum',
    enum: CollectionResultStatus,
    default: CollectionResultStatus.COLLECTED,
  })
  status: CollectionResultStatus;

  @Column({ nullable: true })
  contact_id: string;

  @Column({ nullable: true })
  company_id: string;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => CollectionJob)
  @JoinColumn({ name: 'job_id' })
  job: CollectionJob;

  @ManyToOne(() => Contact, { nullable: true })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @ManyToOne(() => Company, { nullable: true })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum ImportFileStatus {
  UPLOADED = 'uploaded',
  MAPPED = 'mapped',
  VALIDATING = 'validating',
  IMPORTING = 'importing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('import_files')
export class ImportFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  filename: string;

  @Column()
  original_filename: string;

  @Column({ type: 'int' })
  file_size: number;

  @Column()
  mime_type: string;

  @Column({ type: 'jsonb', nullable: true })
  column_mapping: Record<string, any>;

  @Column({ type: 'int', default: 0 })
  total_rows: number;

  @Column({ type: 'int', default: 0 })
  valid_rows: number;

  @Column({ type: 'int', default: 0 })
  duplicate_rows: number;

  @Column({ type: 'int', default: 0 })
  error_rows: number;

  @Column({
    type: 'enum',
    enum: ImportFileStatus,
    default: ImportFileStatus.UPLOADED,
  })
  status: ImportFileStatus;

  @Column({ type: 'jsonb', nullable: true })
  errors: Record<string, any>;

  @Column()
  imported_by: string;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'imported_by' })
  importer: User;
}

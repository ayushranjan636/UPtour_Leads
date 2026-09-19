import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum WorkflowStage {
  DATA_COLLECTED = 'data_collected',
  VALIDATED = 'validated',
  IMPORTED = 'imported',
  CAMPAIGN_QUEUED = 'campaign_queued',
  MESSAGE_SENT = 'message_sent',
  MESSAGE_DELIVERED = 'message_delivered',
  MESSAGE_READ = 'message_read',
  REPLY_RECEIVED = 'reply_received',
  AI_ANALYZED = 'ai_analyzed',
  LEAD_CREATED = 'lead_created',
  FOLLOWUP_SENT = 'followup_sent',
  HUMAN_HANDOVER = 'human_handover',
  DEAL_CREATED = 'deal_created',
  OPTED_OUT = 'opted_out',
}

export enum WorkflowStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  PENDING = 'pending',
}

@Entity('workflow_events')
@Index(['contact_id', 'stage'])
@Index(['campaign_id', 'stage'])
export class WorkflowEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  contact_id: string;

  @Column({ type: 'uuid', nullable: true })
  campaign_id: string;

  @Column({ type: 'enum', enum: WorkflowStage })
  stage: WorkflowStage;

  @Column({ type: 'enum', enum: WorkflowStatus, default: WorkflowStatus.SUCCESS })
  status: WorkflowStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @CreateDateColumn()
  created_at: Date;
}

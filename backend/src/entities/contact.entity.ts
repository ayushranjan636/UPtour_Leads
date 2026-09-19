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
import { Company } from './company.entity';
import { ImportFile } from './import-file.entity';
import { CampaignContact } from './campaign-contact.entity';
import { Message } from './message.entity';

@Entity('contacts')
export class Contact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  company_id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  designation: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ unique: true })
  whatsapp_number: string;

  @Column({ default: false })
  whatsapp_verified: boolean;

  @Column({ nullable: true })
  whatsapp_chat_id: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  source: string;

  @Column({ nullable: true })
  import_file_id: string;

  @Column({ default: false })
  is_opted_out: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  opted_out_at: Date | null;

  @Column({ default: false })
  is_suppressed: boolean;

  @Column({ nullable: true })
  suppressed_reason: string;

  @Column('text', { array: true, default: '{}' })
  tags: string[];

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Company, (company) => company.contacts, { nullable: true })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => ImportFile, { nullable: true })
  @JoinColumn({ name: 'import_file_id' })
  import_file: ImportFile;

  @OneToMany(() => CampaignContact, (cc) => cc.contact)
  campaign_contacts: CampaignContact[];

  @OneToMany(() => Message, (m) => m.contact)
  messages: Message[];
}

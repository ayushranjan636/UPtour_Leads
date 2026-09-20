import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Contact } from './contact.entity';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  /*
   * Administrative location, resolved from Google's addressComponents during
   * collection (see google-places.provider.ts extractLocation). All nullable:
   * component coverage genuinely varies by country, and recording a guessed value
   * would poison the contact filters these columns exist to drive.
   */
  @Column({ nullable: true })
  country: string;

  /** ISO 3166-1 alpha-2, e.g. "IN". Language-stable, unlike the country name. */
  @Column({ length: 2, nullable: true })
  country_code: string;

  /** administrative_area_level_1 — state / province / prefecture / emirate. */
  @Column({ nullable: true })
  state_region: string;

  /** administrative_area_level_2 — district / county / metropolitan area. */
  @Column({ nullable: true })
  district: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  postal_code: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  website: string;

  @Column({ nullable: true })
  agency_type: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  source: string;

  @Column({ nullable: true })
  source_url: string;

  @Column({ unique: true, nullable: true })
  google_place_id: string;

  @Column({ type: 'decimal', nullable: true })
  rating: number;

  @Column('text', { array: true, default: '{}' })
  tags: string[];

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => Contact, (contact) => contact.company)
  contacts: Contact[];
}

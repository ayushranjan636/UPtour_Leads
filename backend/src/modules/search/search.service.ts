import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import { Lead } from '../../entities/lead.entity';
import { Deal } from '../../entities/deal.entity';

export interface SearchResults {
  contacts: any[];
  companies: any[];
  leads: any[];
  deals: any[];
  total: number;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Deal)
    private readonly dealRepo: Repository<Deal>,
  ) {}

  /**
   * Global search across contacts, companies, leads, deals.
   * Uses PostgreSQL ILIKE for simple, effective text matching.
   */
  async search(
    query: string,
    type: 'all' | 'contacts' | 'companies' | 'leads' | 'deals' = 'all',
    page = 1,
    limit = 20,
  ): Promise<SearchResults> {
    if (!query || query.trim().length < 2) {
      return { contacts: [], companies: [], leads: [], deals: [], total: 0 };
    }

    const searchTerm = `%${query.trim()}%`;
    const offset = (page - 1) * limit;

    const results: SearchResults = {
      contacts: [],
      companies: [],
      leads: [],
      deals: [],
      total: 0,
    };

    const searches: Promise<void>[] = [];

    if (type === 'all' || type === 'contacts') {
      searches.push(this.searchContacts(searchTerm, offset, limit).then(r => {
        results.contacts = r;
      }));
    }
    if (type === 'all' || type === 'companies') {
      searches.push(this.searchCompanies(searchTerm, offset, limit).then(r => {
        results.companies = r;
      }));
    }
    if (type === 'all' || type === 'leads') {
      searches.push(this.searchLeads(searchTerm, offset, limit).then(r => {
        results.leads = r;
      }));
    }
    if (type === 'all' || type === 'deals') {
      searches.push(this.searchDeals(searchTerm, offset, limit).then(r => {
        results.deals = r;
      }));
    }

    await Promise.all(searches);

    results.total =
      results.contacts.length +
      results.companies.length +
      results.leads.length +
      results.deals.length;

    return results;
  }

  private async searchContacts(term: string, offset: number, limit: number): Promise<any[]> {
    try {
      return await this.contactRepo
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.company', 'company')
        .where(
          '(c.name ILIKE :term OR c.whatsapp_number ILIKE :term OR c.email ILIKE :term OR c.designation ILIKE :term OR c.notes ILIKE :term)',
          { term },
        )
        .orderBy('c.created_at', 'DESC')
        .skip(offset)
        .take(limit)
        .getMany();
    } catch (err) {
      this.logger.warn(`Contact search failed: ${err.message}`);
      return [];
    }
  }

  private async searchCompanies(term: string, offset: number, limit: number): Promise<any[]> {
    try {
      return await this.companyRepo
        .createQueryBuilder('co')
        .where(
          '(co.name ILIKE :term OR co.country ILIKE :term OR co.city ILIKE :term OR co.state_region ILIKE :term OR co.website ILIKE :term OR co.agency_type ILIKE :term)',
          { term },
        )
        .orderBy('co.created_at', 'DESC')
        .skip(offset)
        .take(limit)
        .getMany();
    } catch (err) {
      this.logger.warn(`Company search failed: ${err.message}`);
      return [];
    }
  }

  private async searchLeads(term: string, offset: number, limit: number): Promise<any[]> {
    try {
      return await this.leadRepo
        .createQueryBuilder('l')
        .leftJoinAndSelect('l.contact', 'contact')
        .leftJoinAndSelect('l.company', 'company')
        .where(
          '(contact.name ILIKE :term OR company.name ILIKE :term OR l.product_interest ILIKE :term OR l.requirements ILIKE :term OR l.notes ILIKE :term OR l.travel_period ILIKE :term)',
          { term },
        )
        .orderBy('l.created_at', 'DESC')
        .skip(offset)
        .take(limit)
        .getMany();
    } catch (err) {
      this.logger.warn(`Lead search failed: ${err.message}`);
      return [];
    }
  }

  private async searchDeals(term: string, offset: number, limit: number): Promise<any[]> {
    try {
      return await this.dealRepo
        .createQueryBuilder('d')
        .leftJoinAndSelect('d.lead', 'lead')
        .where(
          '(d.name ILIKE :term OR d.product ILIKE :term OR d.notes ILIKE :term)',
          { term },
        )
        .orderBy('d.created_at', 'DESC')
        .skip(offset)
        .take(limit)
        .getMany();
    } catch (err) {
      this.logger.warn(`Deal search failed: ${err.message}`);
      return [];
    }
  }
}

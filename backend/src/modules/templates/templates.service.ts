import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseService } from '../../common/base/base.service';
import { MessageTemplate, MessageTemplateType } from '../../entities/message-template.entity';
import { PreviewTemplateDto } from './dto/preview-template.dto';

@Injectable()
export class TemplatesService extends BaseService<MessageTemplate> {
  protected readonly entityName = 'Template';
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    @InjectRepository(MessageTemplate) protected readonly repo: Repository<MessageTemplate>,
  ) { super(); }

  async findByCampaign(campaignId: string): Promise<MessageTemplate[]> {
    return this.repo.find({ where: { campaign_id: campaignId }, order: { sequence_order: 'ASC' } });
  }

  /** Render template with {{contact.name}}, {{company.city}} etc. */
  renderTemplate(template: MessageTemplate, contact: Record<string, any>, company: Record<string, any>): string {
    const ctx: Record<string, Record<string, any>> = { contact: contact || {}, company: company || {} };
    return template.body.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_, obj, field) => {
      const src = ctx[obj];
      return src?.[field] != null ? String(src[field]) : '';
    });
  }

  /**
   * Preview a template with sample data.
   * Accepts either a template_id (loads existing) or inline body text.
   * Substitutes all {{contact.xxx}} and {{company.xxx}} placeholders.
   */
  async previewTemplate(dto: PreviewTemplateDto): Promise<{
    rendered_body: string;
    type: string;
    media_url: string | null;
    placeholders_found: string[];
    sample_data_used: { contact: Record<string, any>; company: Record<string, any> };
  }> {
    let body: string;
    let type: string = dto.type || MessageTemplateType.TEXT;
    let mediaUrl: string | null = dto.media_url || null;

    if (dto.template_id) {
      const template = await this.findById(dto.template_id);
      body = template.body;
      type = template.type;
      mediaUrl = template.media_url || null;
    } else if (dto.body) {
      body = dto.body;
    } else {
      throw new BadRequestException('Provide either template_id or body to preview');
    }

    // Default sample data
    const sampleContact: Record<string, any> = {
      name: 'John Smith',
      designation: 'Travel Manager',
      whatsapp_number: '+819012345678',
      email: 'john@example.com',
      phone: '+819012345678',
      ...dto.sample_contact,
    };

    const sampleCompany: Record<string, any> = {
      name: 'Tokyo Travel Agency',
      country: 'Japan',
      city: 'Tokyo',
      state_region: 'Kanto',
      agency_type: 'Outbound',
      ...dto.sample_company,
    };

    // Extract placeholder names
    const placeholders: string[] = [];
    const placeholderRegex = /\{\{(\w+\.\w+)\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = placeholderRegex.exec(body)) !== null) {
      if (!placeholders.includes(match[1])) {
        placeholders.push(match[1]);
      }
    }

    // Render
    const ctx: Record<string, Record<string, any>> = {
      contact: sampleContact,
      company: sampleCompany,
    };
    const renderedBody = body.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_, obj, field) => {
      const src = ctx[obj];
      return src?.[field] != null ? String(src[field]) : `{{${obj}.${field}}}`;
    });

    return {
      rendered_body: renderedBody,
      type,
      media_url: mediaUrl,
      placeholders_found: placeholders,
      sample_data_used: { contact: sampleContact, company: sampleCompany },
    };
  }
}

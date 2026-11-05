import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { BaseService } from '../../common/base/base.service';
import { Campaign, CampaignStatus } from '../../entities/campaign.entity';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { Contact } from '../../entities/contact.entity';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { ContactsService } from '../contacts/contacts.service';
import { QueryContactDto } from '../contacts/dto/query-contact.dto';
import { MessageTemplate } from '../../entities/message-template.entity';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import { MediaService } from '../media/media.service';
import { isReplyTriggered, resolveTriggerCondition } from '../engine/trigger-conditions';
import { metaTemplateName, toMetaTemplate } from '../whatsapp-cloud/meta-template.util';
import {
  metaErrorCodeOf,
  metaErrorHint,
  PERMANENT_RECIPIENT_ERROR_CODES,
  reasonCodePattern,
} from '../whatsapp-cloud/meta-errors';

/** Shape returned by getSendPreview — the facts behind the "send" decision. */
export interface SendPreview {
  campaign: {
    id: string;
    name: string;
    status: CampaignStatus;
    daily_send_limit: number;
    send_window_start: string;
    send_window_end: string;
    send_window_timezone: string;
  };
  audience: {
    total: number;
    sendable: number;
    pending: number;
    alreadyProcessed: number;
    unverified: number;
  };
  excluded: {
    optedOut: number;
    suppressed: number;
    reasons: { reason: string; count: number }[];
  };
  schedule: { estimatedDays: number; firstDayCount: number };
  templates: {
    id: string;
    name: string;
    type: string;
    sequence_order: number;
    trigger_condition: string;
    body: string;
  }[];
  blockers: string[];
}

/**
 * What a delete actually did, so the caller can confirm nothing valuable was lost.
 *
 * `deleted` is campaign-owned scaffolding; `preserved` is business record that
 * outlives the campaign and was merely unlinked from it.
 */
export interface CampaignDeletionReport {
  id: string;
  name: string;
  deleted: true;
  removed: {
    campaign_contacts: number;
    message_templates: number;
    followup_jobs: number;
  };
  preserved: {
    leads: number;
    messages: number;
    ai_analyses: number;
    collection_jobs: number;
  };
}

/**
 * State machine for campaign status transitions.
 * O(1) lookup via hash map instead of switch/case chains.
 */
const STATUS_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  [CampaignStatus.DRAFT]:     [CampaignStatus.ACTIVE, CampaignStatus.CANCELLED],
  [CampaignStatus.ACTIVE]:    [CampaignStatus.PAUSED, CampaignStatus.COMPLETED, CampaignStatus.CANCELLED],
  [CampaignStatus.PAUSED]:    [CampaignStatus.ACTIVE, CampaignStatus.CANCELLED],
  [CampaignStatus.COMPLETED]: [],
  [CampaignStatus.CANCELLED]: [],
};

@Injectable()
export class CampaignsService extends BaseService<Campaign> {
  protected readonly entityName = 'Campaign';
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectRepository(Campaign) protected readonly repo: Repository<Campaign>,
    @InjectRepository(CampaignContact) private readonly ccRepo: Repository<CampaignContact>,
    @InjectRepository(Contact) private readonly contactRepo: Repository<Contact>,
    @InjectRepository(MessageTemplate) private readonly templateRepo: Repository<MessageTemplate>,
    private readonly contactsService: ContactsService,
    // Optional so unit tests that build the service by hand keep working.
    @Optional() private readonly cloud?: WhatsappCloudService,
    @Optional() private readonly media?: MediaService,
  ) { super(); }

  async createCampaign(dto: CreateCampaignDto, userId: string): Promise<Campaign> {
    const { first_message, audience, meta_template, first_message_media_url, ...campaignFields } = dto;
    const media = await this.mediaFor(first_message_media_url);

    // Resolve the Meta template before anything is saved. When Meta rejects the text,
    // the operator gets Meta's reason and can fix the message, instead of ending up with
    // a half-made campaign that can never send.
    const metaFields = await this.resolveMetaTemplate(meta_template, first_message, dto, media);

    const campaign = await this.repo.save(
      this.repo.create({ ...campaignFields, created_by: userId, status: CampaignStatus.DRAFT }),
    );

    // Create the opening template alongside the campaign.
    //
    // Without this a new campaign has no message at all: the operator has to notice
    // that activation is blocked, find the Templates tab, and add one. Since every
    // campaign needs a first message by definition, it belongs in creation.
    //
    // sequence_order 0 matters — current_sequence_step starts at 0, so a template
    // authored as step 1 never matches and the send falls back.
    if (first_message?.trim()) {
      await this.templateRepo.save(
        this.templateRepo.create({
          campaign_id: campaign.id,
          name: 'Opening message',
          body: first_message.trim(),
          sequence_order: 0,
          trigger_condition: 'initial',
          ...(media ? { type: media.kind as any, media_url: media.url, media_filename: media.filename } : {}),
          ...metaFields,
        }),
      );
      this.logger.log(`Campaign ${campaign.name} created with an opening message`);
    } else if (metaFields.cloud_template_name) {
      // An approved template can stand in for a typed first message.
      await this.templateRepo.save(
        this.templateRepo.create({
          campaign_id: campaign.id,
          name: 'Opening message',
          body: `[Meta template: ${metaFields.cloud_template_name}]`,
          sequence_order: 0,
          trigger_condition: 'initial',
          ...metaFields,
        }),
      );
    }

    // Enrol the audience in the same request.
    //
    // Creating a campaign and pointing it at an existing group or dataset is one
    // intention, so it should be one action — otherwise a new campaign is always born
    // empty and blocked from activating until the operator remembers a second step.
    // Failure here must not lose the campaign: it exists and is editable, so the
    // audience can be added from its page.
    if (audience && Object.keys(audience).length > 0) {
      try {
        const result = await this.addContactsByFilter(
          campaign.id,
          audience as unknown as QueryContactDto,
        );
        this.logger.log(
          `Campaign ${campaign.name}: enrolled ${result.added} of ${result.matched} matching contacts`,
        );
      } catch (err) {
        this.logger.warn(
          `Campaign ${campaign.name} created, but its audience could not be enrolled: ` +
            `${(err as Error).message}`,
        );
      }
    }

    return campaign;
  }

  async updateCampaign(id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.findById(id);
    if (dto.status && dto.status !== campaign.status) {
      this.assertTransition(campaign.status, dto.status);
    }
    Object.assign(campaign, dto);
    return this.repo.save(campaign);
  }

  /** One-liner state transitions using the state machine */
  /**
   * Why this campaign's messages failed, grouped by reason, most common first.
   *
   * The reason was always stored on the failed message, but the campaign page only
   * showed a bare "Failed", so a campaign failing for one fixable cause (a missing Meta
   * template, an unregistered number, an unpaid account) looked like random breakage.
   */
  async failureSummary(id: string): Promise<{
    failed: number;
    reasons: { reason: string; count: number; lastAt: string | null; hint: string | null }[];
  }> {
    await this.findById(id);
    const rows: { reason: string; count: number; last_at: Date | null }[] = await this.ccRepo.query(
      `SELECT COALESCE(NULLIF(m.failed_reason, ''), 'No reason was recorded') AS reason,
              COUNT(*)::int AS count,
              MAX(m.created_at) AS last_at
         FROM campaign_contacts cc
         LEFT JOIN LATERAL (
           SELECT failed_reason, created_at FROM messages
            WHERE campaign_contact_id = cc.id AND status = 'failed'
            ORDER BY created_at DESC LIMIT 1
         ) m ON true
        WHERE cc.campaign_id = $1 AND cc.status = 'failed'
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 20`,
      [id],
    );
    return {
      failed: rows.reduce((n, r) => n + Number(r.count), 0),
      reasons: rows.map((r) => ({
        reason: r.reason,
        count: Number(r.count),
        lastAt: r.last_at ? new Date(r.last_at).toISOString() : null,
        // Reasons stored before fixes were attached carry only Meta's code.
        hint: /Fix: /.test(r.reason) ? null : metaErrorHint(metaErrorCodeOf(r.reason)),
      })),
    };
  }

  /**
   * Put failed contacts back in the queue, once whatever made them fail is fixed.
   *
   * Refuses while the official API would refuse again, so a retry cannot just repeat
   * the failure. A campaign that "completed" only because every send failed is reopened:
   * completion is normally final, but here it recorded nothing but failures.
   */
  async retryFailed(id: string): Promise<{ requeued: number; skipped: number; status: CampaignStatus }> {
    const campaign = await this.findById(id);
    const templates = await this.templateRepo.find({ where: { campaign_id: id } });
    const blockers = await this.cloudTemplateBlockers(templates);
    if (blockers.length) throw new BadRequestException(blockers.join(' '));

    // Numbers not on WhatsApp, and people who opted out, would only fail again.
    const rows: { id: string; permanent: boolean }[] = await this.ccRepo.query(
      `SELECT cc.id, COALESCE(m.failed_reason, '') ~ $2 AS permanent
         FROM campaign_contacts cc
         LEFT JOIN LATERAL (
           SELECT failed_reason FROM messages
            WHERE campaign_contact_id = cc.id AND status = 'failed'
            ORDER BY created_at DESC LIMIT 1
         ) m ON true
        WHERE cc.campaign_id = $1 AND cc.status = 'failed'`,
      [id, reasonCodePattern(PERMANENT_RECIPIENT_ERROR_CODES)],
    );
    const ids = rows.filter((r) => !r.permanent).map((r) => r.id);
    const skipped = rows.length - ids.length;
    if (ids.length) await this.ccRepo.update({ id: In(ids) }, { status: 'pending' as any });
    const requeued = ids.length;
    if (requeued === 0) return { requeued, skipped, status: campaign.status };

    let status = campaign.status;
    if (status === CampaignStatus.COMPLETED) {
      await this.repo.update(id, { status: CampaignStatus.ACTIVE });
      status = CampaignStatus.ACTIVE;
    }
    this.logger.log(`Campaign ${campaign.name}: ${requeued} failed contacts queued again (${status})`);
    return { requeued, skipped, status };
  }

  /**
   * Start sending, unless the official API would refuse every message.
   *
   * The review dialog already shows these problems, but the Activate button on the
   * campaign list goes straight here. Without this check a campaign could run with an
   * unapproved or missing Meta template and fail every send silently in the queue.
   */
  async activate(id: string): Promise<Campaign> {
    const templates = await this.templateRepo.find({ where: { campaign_id: id } });
    const blockers = await this.cloudTemplateBlockers(templates);
    if (blockers.length) throw new BadRequestException(blockers.join(' '));
    return this.transitionTo(id, CampaignStatus.ACTIVE);
  }
  async pause(id: string): Promise<Campaign> { return this.transitionTo(id, CampaignStatus.PAUSED); }

  /**
   * Permanently delete a campaign while keeping everything it earned.
   *
   * Eight foreign keys point at `campaigns`/`campaign_contacts` and none of them
   * declare ON DELETE CASCADE, so a plain repository delete raises a foreign-key
   * violation for any campaign that has ever been enrolled or sent. Dependents are
   * therefore handled explicitly, and the split between them is a data-safety
   * decision rather than a technical one:
   *
   *  - PRESERVED by nulling the campaign link. `leads` (and their `deals`, which hang
   *    off `lead_id`) are the business value the outreach produced — deleting the
   *    campaign that happened to source a lead must never destroy the lead.
   *    `messages` and `ai_analyses` are the record of what was really said to real
   *    people; both keep their NOT NULL `contact_id`, so the conversation thread in
   *    the Conversations page survives intact, just no longer attributed to a
   *    campaign. `collection_jobs` are scrape schedules that exist on their own, so
   *    only their auto-enrol target is cleared.
   *  - DELETED as campaign-owned scaffolding with no standalone meaning:
   *    `campaign_contacts` (an enrolment in a campaign that no longer exists),
   *    `message_templates` (its wording, already copied onto every sent message) and
   *    `followup_jobs` (planned future sends for a campaign that will never send).
   *
   * All of it runs in one transaction: a half-deleted campaign — templates gone,
   * contacts still enrolled — is worse than a delete that failed and can be retried.
   */
  /**
   * Row count from a `RETURNING id` write.
   *
   * TypeORM's `query` resolves to `[rows, affectedCount]` for INSERT/UPDATE/DELETE, so
   * reading `.length` off the result counts the two-element wrapper and reports "2" no
   * matter how many rows were actually touched. The deletion report exists to prove
   * nothing valuable was lost, so a count that is always 2 is worse than none.
   */
  private static rowCount(result: unknown): number {
    if (!Array.isArray(result)) return 0;
    // [rows[], affected] form.
    if (
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === 'number'
    ) {
      return result[1];
    }
    return result.length;
  }

  async deleteCampaign(id: string): Promise<CampaignDeletionReport> {
    // 404s before opening a transaction if the campaign does not exist.
    const campaign = await this.findById(id);

    // Refused only for ACTIVE. An active campaign is mid-flight: the distributor has
    // already enqueued delayed `message-send` jobs for its contacts, and deleting it
    // strands every one of them. Pausing is a single click away in both the list and
    // the detail header and stops the distributor picking it up, so the operator is
    // asked to do that first rather than being told "no".
    //
    // Deliberately NOT refused for the other statuses: `draft` has never sent,
    // `paused` is not enqueuing, and `completed`/`cancelled` are terminal in
    // STATUS_TRANSITIONS so nothing can put them back to sending. Refusing those too
    // would leave finished campaigns permanently undeletable, which is the whole
    // reason this endpoint exists.
    if (campaign.status === CampaignStatus.ACTIVE) {
      throw new BadRequestException(
        `Campaign "${campaign.name}" is active and may be sending right now. ` +
          'Pause it first, then delete it.',
      );
    }

    const removed = { campaign_contacts: 0, message_templates: 0, followup_jobs: 0 };
    const preserved = { leads: 0, messages: 0, ai_analyses: 0, collection_jobs: 0 };

    await this.repo.manager.transaction(async (tx) => {
      // RETURNING id on every statement is what makes the report trustworthy: the
      // counts are the rows Postgres actually touched, not a separate estimate that
      // could disagree with what happened.
      const ccIds: string[] = (
        await tx.query('SELECT id FROM campaign_contacts WHERE campaign_id = $1', [id])
      ).map((r: { id: string }) => r.id);

      const templateIds: string[] = (
        await tx.query('SELECT id FROM message_templates WHERE campaign_id = $1', [id])
      ).map((r: { id: string }) => r.id);

      // ── Preserve ──────────────────────────────────
      // Both columns in one statement: a lead can be linked by campaign, by
      // campaign_contact, or by either alone, and all three must end up unlinked.
      preserved.leads = CampaignsService.rowCount(
        await tx.query(
          `UPDATE leads SET campaign_id = NULL, campaign_contact_id = NULL
             WHERE campaign_id = $1 OR campaign_contact_id = ANY($2::uuid[])
             RETURNING id`,
          [id, ccIds],
        ),
      );

      preserved.messages = CampaignsService.rowCount(
        await tx.query(
          `UPDATE messages SET campaign_contact_id = NULL
             WHERE campaign_contact_id = ANY($1::uuid[])
             RETURNING id`,
          [ccIds],
        ),
      );

      preserved.ai_analyses = CampaignsService.rowCount(
        await tx.query(
          `UPDATE ai_analyses SET campaign_contact_id = NULL
             WHERE campaign_contact_id = ANY($1::uuid[])
             RETURNING id`,
          [ccIds],
        ),
      );

      // The scrape schedule itself is not the campaign's to delete — only its
      // auto-enrol target goes away, so the job keeps running and simply stops
      // adding contacts anywhere.
      preserved.collection_jobs = CampaignsService.rowCount(
        await tx.query(
          `UPDATE collection_jobs SET auto_add_to_campaign_id = NULL
             WHERE auto_add_to_campaign_id = $1
             RETURNING id`,
          [id],
        ),
      );

      // `messages.template_id` is a ninth reference, to `message_templates` rather
      // than to the campaign, so the templates below cannot be deleted while any
      // message still points at one. Nulling it loses nothing: the rendered body is
      // stored on the message row itself.
      await tx.query(
        `UPDATE messages SET template_id = NULL WHERE template_id = ANY($1::uuid[])`,
        [templateIds],
      );

      // ── Delete ────────────────────────────────────
      removed.followup_jobs = CampaignsService.rowCount(
        await tx.query(
          'DELETE FROM followup_jobs WHERE campaign_contact_id = ANY($1::uuid[]) RETURNING id',
          [ccIds],
        ),
      );

      // Defensive: a follow-up belonging to another campaign should never reference
      // this one's template, but the column is nullable, so unlink rather than let a
      // stray row block the delete.
      await tx.query(
        `UPDATE followup_jobs SET template_id = NULL WHERE template_id = ANY($1::uuid[])`,
        [templateIds],
      );

      removed.campaign_contacts = CampaignsService.rowCount(
        await tx.query('DELETE FROM campaign_contacts WHERE campaign_id = $1 RETURNING id', [id]),
      );

      removed.message_templates = CampaignsService.rowCount(
        await tx.query('DELETE FROM message_templates WHERE campaign_id = $1 RETURNING id', [id]),
      );

      await tx.query('DELETE FROM campaigns WHERE id = $1', [id]);
    });

    // BaseService caches findById results for 60s; the row above was deleted with raw
    // SQL, so without this the deleted campaign keeps being served from cache and
    // appears to still exist for up to a minute.
    this.invalidate(id);

    this.logger.log(
      `Deleted campaign ${campaign.name}: removed ${removed.campaign_contacts} enrolments, ` +
        `${removed.message_templates} templates, ${removed.followup_jobs} follow-ups; ` +
        `preserved ${preserved.leads} leads and ${preserved.messages} messages`,
    );

    return { id, name: campaign.name, deleted: true, removed, preserved };
  }

  /**
   * Enrol every contact matching a filter.
   *
   * Resolves ids server-side via the same filter logic the contacts list uses, so
   * the audience matches exactly what the operator previewed. The previous flow
   * could only add from the 100 contacts the modal happened to have fetched, which
   * silently capped every audience.
   */
  async addContactsByFilter(
    campaignId: string,
    filter: QueryContactDto,
  ): Promise<{ added: number; skipped: number; matched: number }> {
    await this.findById(campaignId);

    const ids = await this.contactsService.findIdsFiltered({
      ...filter,
      // Never enrol someone who cannot be messaged; the distributor would skip them
      // anyway and they would sit at 'pending' forever, blocking auto-complete.
      reachable_only: true,
    });

    if (!ids.length) {
      return { added: 0, skipped: 0, matched: 0 };
    }

    const result = await this.addContacts(campaignId, ids);
    return { ...result, matched: ids.length };
  }

  /**
   * Everything the operator needs to confirm before a campaign goes live.
   *
   * Activation previously sent real WhatsApp messages on a single click with no
   * confirmation and no indication of who would receive what. This assembles the
   * facts for that decision: audience size, why anyone is excluded, the template
   * that will actually be used, and when sending would start and finish under the
   * campaign's own pacing rules.
   */
  async getSendPreview(campaignId: string): Promise<SendPreview> {
    const campaign = await this.findById(campaignId);

    const rows = await this.ccRepo
      .createQueryBuilder('cc')
      .innerJoin('cc.contact', 'c')
      .select('cc.status', 'status')
      .addSelect('c.is_opted_out', 'opted_out')
      .addSelect('c.is_suppressed', 'suppressed')
      .addSelect('c.suppressed_reason', 'suppressed_reason')
      .addSelect('c.whatsapp_verified', 'verified')
      .where('cc.campaign_id = :campaignId', { campaignId })
      .getRawMany<{
        status: string;
        opted_out: boolean;
        suppressed: boolean;
        suppressed_reason: string | null;
        verified: boolean;
      }>();

    const pending = rows.filter((r) => r.status === 'pending');
    // Mirrors send-distributor.service.ts eligibility exactly.
    const sendable = pending.filter((r) => !r.opted_out && !r.suppressed);
    const optedOut = pending.filter((r) => r.opted_out).length;
    const suppressed = pending.filter((r) => !r.opted_out && r.suppressed).length;
    const alreadyProcessed = rows.length - pending.length;

    const dailyLimit = campaign.daily_send_limit || 100;
    const days = sendable.length > 0 ? Math.ceil(sendable.length / dailyLimit) : 0;

    const templates = await this.templateRepo.find({
      where: { campaign_id: campaignId },
      order: { sequence_order: 'ASC' },
    });

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        daily_send_limit: dailyLimit,
        send_window_start: campaign.send_window_start,
        send_window_end: campaign.send_window_end,
        send_window_timezone: campaign.send_window_timezone,
      },
      audience: {
        total: rows.length,
        sendable: sendable.length,
        pending: pending.length,
        alreadyProcessed,
        unverified: sendable.filter((r) => !r.verified).length,
      },
      excluded: {
        optedOut,
        suppressed,
        // Surfaces *why*, so "why is my audience smaller than expected" is answerable
        // without opening the database.
        reasons: Object.entries(
          pending
            .filter((r) => r.suppressed && r.suppressed_reason)
            .reduce<Record<string, number>>((acc, r) => {
              const key = r.suppressed_reason as string;
              acc[key] = (acc[key] ?? 0) + 1;
              return acc;
            }, {}),
        ).map(([reason, count]) => ({ reason, count })),
      },
      schedule: {
        estimatedDays: days,
        firstDayCount: Math.min(sendable.length, dailyLimit),
      },
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        sequence_order: t.sequence_order,
        trigger_condition: t.trigger_condition,
        body: t.body,
      })),
      /** Blocking problems. A non-empty list means activation cannot succeed usefully. */
      blockers: [
        ...(templates.length === 0
          ? ['No message template — the campaign would fail on every send.']
          : []),
        ...(sendable.length === 0
          ? ['No sendable contacts — add an audience before activating.']
          : []),
        ...(await this.cloudTemplateBlockers(templates)),
      ],
    };
  }

  /**
   * Steps that would fail on the official WhatsApp Cloud API.
   *
   * Meta delivers free text only within 24 hours of the contact's last message. An
   * opening message, or a "no reply" follow-up, goes to someone who has not written, so
   * it must be an approved Meta template; without one every send fails. Steps that fire
   * on a reply are answering a fresh message and may stay free text.
   */
  private async cloudTemplateBlockers(templates: MessageTemplate[]): Promise<string[]> {
    if (!this.cloud || (await this.cloud.getProvider().catch(() => 'session')) !== 'cloud') return [];
    const needsTemplate = templates.filter((t) => {
      const condition = resolveTriggerCondition(t.trigger_condition).condition;
      return !condition || !isReplyTriggered(condition);
    });

    const missing = needsTemplate
      .filter((t) => !t.cloud_template_name?.trim())
      .map(
        (t) =>
          `"${t.name}" needs an approved Meta template: the official WhatsApp API will not deliver ` +
          'free text to someone who has not messaged you. Press "Set Meta template" on that step.',
      );

    // A chosen template must also be approved, or every send fails at Meta. When the
    // list cannot be read (no WABA id, Meta down) this check is skipped rather than
    // blocking a campaign on a guess.
    const chosen = needsTemplate.filter((t) => t.cloud_template_name?.trim());
    if (!chosen.length) return missing;
    const onMeta = await this.cloud.listTemplates().catch(() => null);
    if (!onMeta) return missing;
    const notReady = chosen.flatMap((t) => {
      const name = t.cloud_template_name!.trim();
      const matches = onMeta.filter(
        (m) => m.name === name && (!t.cloud_template_language || m.language === t.cloud_template_language),
      );
      if (!matches.length) {
        return [`"${t.name}" uses Meta template "${name}", which is not on your WhatsApp account.`];
      }
      if (matches.some((m) => m.status === 'APPROVED')) return [];
      const status = matches[0].status;
      return [
        status === 'REJECTED'
          ? `Meta rejected template "${name}" for "${t.name}". Change the wording and create a new one.`
          : `Template "${name}" for "${t.name}" is waiting for Meta's approval (${status.toLowerCase()}). ` +
            'This usually takes a few minutes; refresh to check again.',
      ];
    });
    return [...missing, ...notReady];
  }

  /**
   * Fields to store on the opening step for the official API, creating the Meta template
   * first when asked. Returns nothing when the QR session is in use.
   */
  /**
   * Turn one campaign step's message into a new Meta template and link the step to it.
   *
   * Campaigns made before templates could be created at creation time had no way to get
   * one from the campaign page: "Set Meta template" could only pick an existing template.
   */
  async createMetaTemplateForStep(templateId: string, category: 'MARKETING' | 'UTILITY' = 'MARKETING') {
    const step = await this.templateRepo.findOne({ where: { id: templateId }, relations: ['campaign'] });
    if (!step) throw new NotFoundException('Campaign step not found');
    const fields = await this.resolveMetaTemplate(
      { mode: 'create', category },
      step.body,
      { name: `${step.campaign?.name ?? 'campaign'} ${step.name}`, product: step.campaign?.product } as CreateCampaignDto,
      await this.mediaFor(step.media_url),
    );
    Object.assign(step, fields);
    await this.templateRepo.save(step);
    return step;
  }

  /** Details of a file uploaded to the portal, from its public URL. */
  private async mediaFor(url: string | null | undefined) {
    if (!url?.trim()) return null;
    const id = MediaService.idFromUrl(url);
    if (!id || !this.media) return null;
    const file = await this.media.get(id);
    const kind = MediaService.kindOf(file.mime);
    if (!kind) return null;
    return { id, url: url.trim(), filename: file.filename, kind };
  }

  private async resolveMetaTemplate(
    choice: CreateCampaignDto['meta_template'],
    firstMessage: string | undefined,
    dto: CreateCampaignDto,
    media?: { id: string | null; kind: string } | null,
  ): Promise<Partial<MessageTemplate>> {
    if (!choice) return {};
    if (!this.cloud) throw new BadRequestException('The WhatsApp Cloud API is not available.');

    if (choice.mode === 'existing') {
      if (!choice.name?.trim()) throw new BadRequestException('Choose an approved Meta template.');
      return {
        cloud_template_name: choice.name.trim(),
        cloud_template_language: choice.language?.trim() || 'en',
        cloud_template_params: choice.params ?? [],
      };
    }

    if (!firstMessage?.trim()) {
      throw new BadRequestException('Write the first message, so it can be sent to Meta as a template.');
    }
    const draft = toMetaTemplate(firstMessage, { product: dto.product, campaignName: dto.name });
    if (draft.problems.length) throw new BadRequestException(draft.problems.join(' '));

    const name = metaTemplateName(dto.name, Date.now().toString(36).slice(-5));
    const created = await this.cloud.createTemplate({
      name,
      language: choice.language?.trim() || 'en',
      category: choice.category ?? 'MARKETING',
      body: draft.body,
      examples: draft.examples,
      // An attached file becomes the template's header, so the message carries it.
      ...(media?.id
        ? { headerMedia: { format: media.kind.toUpperCase() as 'IMAGE' | 'VIDEO' | 'DOCUMENT', mediaId: media.id } }
        : {}),
    });
    this.logger.log(`Submitted Meta template ${created.name} for campaign ${dto.name} (${created.status})`);
    return {
      cloud_template_name: created.name,
      cloud_template_language: choice.language?.trim() || 'en',
      cloud_template_params: draft.params,
    };
  }

  private async transitionTo(id: string, target: CampaignStatus): Promise<Campaign> {
    const campaign = await this.findById(id);
    this.assertTransition(campaign.status, target);
    campaign.status = target;
    this.logger.log(`Campaign ${campaign.name} → ${target}`);
    return this.repo.save(campaign);
  }

  private assertTransition(current: CampaignStatus, target: CampaignStatus) {
    if (!STATUS_TRANSITIONS[current]?.includes(target)) {
      throw new BadRequestException(`Cannot transition from "${current}" to "${target}"`);
    }
  }

  /**
   * Batch add contacts — uses Set for O(1) dedup.
   */
  async addContacts(campaignId: string, contactIds: string[]): Promise<{ added: number; skipped: number }> {
    await this.findById(campaignId); // assert campaign exists

    const contacts = await this.contactRepo.find({ where: { id: In(contactIds) }, select: ['id'] });
    if (!contacts.length) throw new BadRequestException('No valid contact IDs');

    // O(n) dedup using Set
    const existing = await this.ccRepo.find({
      where: { campaign_id: campaignId, contact_id: In(contacts.map(c => c.id)) },
      select: ['contact_id'],
    });
    const existingSet = new Set(existing.map(cc => cc.contact_id));
    const newIds = contacts.map(c => c.id).filter(id => !existingSet.has(id));

    if (newIds.length) {
      await this.ccRepo.save(newIds.map(cid => this.ccRepo.create({ campaign_id: campaignId, contact_id: cid })));
    }

    return { added: newIds.length, skipped: contactIds.length - newIds.length };
  }

  async listContacts(campaignId: string, page = 1, limit = 20): Promise<PaginatedResponseDto<CampaignContact>> {
    await this.findById(campaignId);
    const [data, total] = await this.ccRepo.findAndCount({
      where: { campaign_id: campaignId },
      relations: ['contact', 'contact.company'],
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return new PaginatedResponseDto(data, total, page, limit);
  }

  async getStats(campaignId: string): Promise<Record<string, number>> {
    const c = await this.repo.findOne({
      where: { id: campaignId },
      select: ['id', 'stats_sent', 'stats_delivered', 'stats_read', 'stats_replied', 'stats_opted_out', 'stats_leads'],
    });
    if (!c) throw new NotFoundException(`Campaign '${campaignId}' not found`);
    return {
      sent: c.stats_sent, delivered: c.stats_delivered, read: c.stats_read,
      replied: c.stats_replied, opted_out: c.stats_opted_out, leads: c.stats_leads,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CampaignContact } from '../../entities/campaign-contact.entity';
import { MessageTemplate } from '../../entities/message-template.entity';
import { Message, MessageDirection } from '../../entities/message.entity';
import { AiAnalysis } from '../../entities/ai-analysis.entity';
import { Campaign } from '../../entities/campaign.entity';
import { RedisService } from '../../common/redis/redis.service';
import {
  AnalysisLike,
  ReplySignals,
  TriggerCondition,
  TriggerResolution,
  classifyReply,
  conditionMatchesReply,
  isReplyTriggered,
  resolveTriggerCondition,
  selectBranch,
} from './trigger-conditions';

/**
 * SEQUENCE SERVICE
 *
 * Manages multi-step message sequences with conditional triggers.
 *
 * A step is a *set of alternatives*, not one message. Several templates may share a
 * `sequence_order` — a yes branch, a no branch, an acknowledgement branch — and this
 * service picks exactly one of them per contact per step. See `trigger-conditions.ts`
 * for the supported conditions, how free text an operator typed is interpreted, and how
 * a winner is chosen when more than one branch matches the same reply.
 *
 * Two properties are load-bearing here:
 *   - A condition that cannot be understood is logged loudly and does not fire. It must
 *     never be dropped in silence, because that is how four of five live steps sat dead
 *     while the operator believed the sequence was configured.
 *   - A step sends at most once per contact, guarded twice over (see `claimStep`).
 *     Messaging a prospect twice for the same step is worse than missing the step.
 */
@Injectable()
export class SequenceService {
  private readonly logger = new Logger(SequenceService.name);

  /**
   * How long a step claim is held.
   *
   * Comfortably longer than any real gap between steps, and the key is per step, so it
   * expires only once the step can no longer be reached.
   */
  private static readonly STEP_CLAIM_TTL_SECONDS = 30 * 24 * 60 * 60;

  constructor(
    @InjectRepository(CampaignContact)
    private readonly ccRepo: Repository<CampaignContact>,
    @InjectRepository(MessageTemplate)
    private readonly templateRepo: Repository<MessageTemplate>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(AiAnalysis)
    private readonly analysisRepo: Repository<AiAnalysis>,
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectQueue('message-send')
    private readonly sendQueue: Queue,
    private readonly redis: RedisService,
  ) {}

  /**
   * Which template to send next for a campaign contact, or null when the sequence is
   * complete.
   *
   * Where a step has several branches this returns the one whose condition currently
   * matches, so callers see the same choice the engine would send.
   */
  async getNextStep(campaignContactId: string): Promise<MessageTemplate | null> {
    const cc = await this.ccRepo.findOne({
      where: { id: campaignContactId },
      relations: ['campaign'],
    });
    if (!cc) return null;

    const candidates = await this.templatesAtStep(cc.campaign_id, cc.current_sequence_step);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const signals = await this.loadReplySignals(cc);
    const { chosen } = selectBranch(candidates, signals);

    // Fall back to the lowest-id candidate rather than null: callers such as the preview
    // use this to show "what comes next", and no branch matching yet is a normal state
    // before the contact has replied.
    return chosen ?? candidates[0];
  }

  /**
   * Evaluate whether a trigger condition is currently met for a campaign contact.
   *
   * Accepts the canonical identifiers, known synonyms, and the natural language an
   * operator typed into the old free-text box — `resolveTriggerCondition` owns that
   * interpretation. A value it cannot read is logged as a misconfiguration and returns
   * false, which is the only safe answer: an unreadable condition could equally mean
   * "on reply" or "after five days", and sending on the wrong one messages a prospect
   * the operator meant to exclude.
   */
  async evaluateCondition(
    condition: string,
    campaignContact: CampaignContact,
  ): Promise<boolean> {
    const resolved = resolveTriggerCondition(condition);

    if (!resolved.condition) {
      this.logUnrecognised(resolved, campaignContact.id);
      return false;
    }

    if (resolved.matchedBy === 'phrase') {
      // Worth a line in the log every time: it is the only place an operator can see
      // that free text they typed was interpreted, and what it was interpreted as.
      this.logger.log(
        `Trigger condition "${resolved.raw}" read as '${resolved.condition}' ` +
          `for CC ${campaignContact.id} — ${resolved.description}`,
      );
    }

    switch (resolved.condition) {
      case TriggerCondition.INITIAL:
        return true;

      case TriggerCondition.NO_REPLY_48H:
      case TriggerCondition.NO_REPLY_120H:
        return this.checkNoReply(campaignContact, resolved.hours ?? 48);

      default:
        break;
    }

    // Reply-triggered: read the reply once and answer against the same signals branch
    // selection would use, so a condition can never be true here and false there.
    const signals = await this.loadReplySignals(campaignContact);
    return conditionMatchesReply(resolved.condition, signals);
  }

  /**
   * Advance a campaign contact to the next step in the sequence.
   *
   * Evaluates every branch at the current step, picks at most one, and queues it.
   * Returns true if a message was queued, false otherwise.
   */
  async advanceSequence(campaignContactId: string): Promise<boolean> {
    const cc = await this.ccRepo.findOne({
      where: { id: campaignContactId },
      relations: ['contact', 'campaign'],
    });
    if (!cc) {
      this.logger.warn(`CampaignContact ${campaignContactId} not found`);
      return false;
    }

    // Skip if contact opted out, suppressed, or human takeover
    if (cc.contact.is_opted_out || cc.contact.is_suppressed || cc.mode === 'human') {
      return false;
    }

    // Skip if campaign not active
    if (cc.campaign.status !== 'active') return false;

    const candidates = await this.templatesAtStep(cc.campaign_id, cc.current_sequence_step);

    if (!candidates.length) {
      this.logger.log(`Sequence complete for CC ${campaignContactId} (no template at step ${cc.current_sequence_step})`);
      return false;
    }

    // Time-based and `initial` steps are decided per template, not by competing
    // branches, so they are evaluated in order and the first match wins. Reply-triggered
    // branches at the same step go through selectBranch instead — see pickAtStep.
    const picked = await this.pickAtStep(cc, candidates);
    if (!picked) return false;

    return this.queueTemplate(cc, picked.template, picked.resolution, cc.current_sequence_step);
  }

  /**
   * Choose at most one template from the candidates at a step.
   *
   * Split into two passes because the two families of condition answer different
   * questions. `initial` and the no-reply rules are independent facts about elapsed time,
   * so the first that holds is the step's message. The reply-triggered conditions are
   * genuine alternatives describing the same reply, and picking between them needs the
   * specificity ordering in `selectBranch` — without it a contact who says yes could
   * match both the yes branch and the any-reply branch, and row order would decide.
   */
  private async pickAtStep(
    cc: CampaignContact,
    candidates: MessageTemplate[],
  ): Promise<{ template: MessageTemplate; resolution: TriggerResolution } | null> {
    const resolved = candidates.map((template) => ({
      template,
      resolution: resolveTriggerCondition(template.trigger_condition),
    }));

    for (const entry of resolved) {
      if (!entry.resolution.condition) {
        this.logUnrecognised(entry.resolution, cc.id, entry.template);
      }
    }

    for (const entry of resolved) {
      const condition = entry.resolution.condition;
      if (!condition || isReplyTriggered(condition)) continue;

      if (condition === TriggerCondition.INITIAL) return entry;
      if (this.checkNoReply(cc, entry.resolution.hours ?? 48)) return entry;
    }

    const replyCandidates = resolved
      .filter((e) => e.resolution.condition && isReplyTriggered(e.resolution.condition))
      .map((e) => e.template);

    if (!replyCandidates.length) return null;

    const signals = await this.loadReplySignals(cc);
    if (!signals.replied) return null;

    const { chosen, resolution, considered } = selectBranch(replyCandidates, signals);

    if (!chosen || !resolution) {
      this.logger.debug(
        `No branch matched at step ${cc.current_sequence_step} for CC ${cc.id} ` +
          `(reply: ${signals.sentiment}${signals.isQuestion ? ', question' : ''} via ${signals.source})`,
      );
      return null;
    }

    if (considered.filter((c) => c.matched).length > 1) {
      // Recorded because it is the case that used to be impossible to see: several
      // branches fit the same reply and only one was sent.
      this.logger.log(
        `Step ${cc.current_sequence_step} for CC ${cc.id}: ${considered.filter((c) => c.matched).length} ` +
          `branches matched, chose "${chosen.name}" (${resolution.condition}) — ${signals.detail}`,
      );
    }

    return { template: chosen, resolution };
  }

  /**
   * Called after AI analysis to see whether the reply triggers a sequence step.
   *
   * Takes the whole analysis rather than the two fields the old signature accepted, so
   * `classifyReply` can use confidence and opt-out too: a low-confidence guess should not
   * decide which branch a prospect sees, and a contact asking to stop must never match the
   * interested branch because interest happened to be scored high.
   */
  async onAiAnalysisComplete(
    campaignContactId: string,
    analysisResult: AnalysisLike & { intent: string; interest_level: string },
    replyText?: string,
  ): Promise<boolean> {
    if (!campaignContactId) return false;

    const cc = await this.ccRepo.findOne({
      where: { id: campaignContactId },
      relations: ['contact', 'campaign'],
    });
    if (!cc || cc.mode === 'human') return false;

    // The same suppression rules the campaign path applies. This entry point is reached
    // straight from the analysis worker, so it cannot rely on advanceSequence's checks.
    if (cc.contact?.is_opted_out || cc.contact?.is_suppressed) {
      this.logger.log(
        `No sequence step for CC ${campaignContactId}: contact is opted out or suppressed`,
      );
      return false;
    }
    if (cc.campaign && cc.campaign.status !== 'active') return false;

    const group = await this.replyTriggeredStep(cc);
    if (!group) return false;

    // The analysis *is* the reply, so there is definitionally a reply to read here even if
    // `last_reply_at` has not been written yet by the business-rules pass.
    const signals = classifyReply({
      analysis: analysisResult,
      replyText,
      hasReplied: true,
    });

    const { chosen, resolution, considered } = selectBranch(group.candidates, signals);
    if (!chosen || !resolution) {
      this.logger.log(
        `Reply from CC ${campaignContactId} matched no branch at step ${group.step} ` +
          `(${signals.sentiment}${signals.isQuestion ? ', question' : ''} via ${signals.source}; ` +
          `candidates: ${considered.map((c) => c.resolution.condition ?? 'unrecognised').join(', ')})`,
      );
      return false;
    }

    this.logger.log(
      `Reply from CC ${campaignContactId} selected branch "${chosen.name}" ` +
        `(${resolution.condition}) at step ${group.step} — ${signals.detail}`,
    );

    return this.queueTemplate(cc, chosen, resolution, group.step);
  }

  /**
   * The step whose branches a reply should be evaluated against.
   *
   * The current step, if it has any reply-triggered template. Otherwise the next step
   * that does — preserving the forward scan the previous implementation performed, so a
   * campaign whose reply template sits above a time-based step (step 1 `no_reply_48h`,
   * step 2 `replied_interested`) keeps working exactly as it did. The scan stops at the
   * first step with reply branches rather than continuing, so a reply cannot skip past a
   * reply step it failed to match.
   */
  private async replyTriggeredStep(
    cc: CampaignContact,
  ): Promise<{ step: number; candidates: MessageTemplate[] } | null> {
    const all = await this.templateRepo.find({
      where: { campaign_id: cc.campaign_id },
      order: { sequence_order: 'ASC' },
    });

    const steps = Array.from(
      new Set(
        (all ?? [])
          .filter((t) => t.sequence_order >= cc.current_sequence_step)
          .map((t) => t.sequence_order),
      ),
    ).sort((a, b) => a - b);

    for (const step of steps) {
      const atStep = (all ?? [])
        .filter((t) => t.sequence_order === step)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));

      for (const template of atStep) {
        const resolution = resolveTriggerCondition(template.trigger_condition);
        if (!resolution.condition) this.logUnrecognised(resolution, cc.id, template);
      }

      const candidates = atStep.filter((t) => {
        const condition = resolveTriggerCondition(t.trigger_condition).condition;
        return condition !== null && isReplyTriggered(condition);
      });

      if (candidates.length) return { step, candidates };
    }

    return null;
  }

  /**
   * Every template authored for one step, lowest id first.
   *
   * Several rows at the same `sequence_order` is the normal, intended shape for a
   * branching step — the reason `findOne` was wrong here.
   */
  private async templatesAtStep(
    campaignId: string,
    step: number,
  ): Promise<MessageTemplate[]> {
    const rows = await this.templateRepo.find({
      where: { campaign_id: campaignId, sequence_order: step },
    });
    // Stable order so the branch tiebreak is reproducible whatever the database returns.
    return (rows ?? []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  /** Check if no reply within the given hours */
  private checkNoReply(cc: CampaignContact, hours: number): boolean {
    if (cc.last_reply_at) return false; // contact replied
    if (!cc.last_sent_at) return false; // nothing sent yet

    const hoursSinceSent = (Date.now() - cc.last_sent_at.getTime()) / (1000 * 60 * 60);
    return hoursSinceSent >= hours;
  }

  /**
   * What the engine believes about this contact's latest reply.
   *
   * Prefers the stored AI analysis, which already ran on the inbound message, and falls
   * back to the reply text only when there is no analysis or the model was not confident
   * enough — see `classifyReply`. Best-effort on both reads: a database hiccup here must
   * leave the sequence where it was rather than throw out of a worker.
   */
  private async loadReplySignals(cc: CampaignContact): Promise<ReplySignals> {
    if (!cc.last_reply_at) {
      return classifyReply({ hasReplied: false });
    }

    let analysis: AiAnalysis | null = null;
    try {
      analysis = await this.analysisRepo.findOne({
        where: { campaign_contact_id: cc.id },
        order: { created_at: 'DESC' },
      });
    } catch (err) {
      this.logger.warn(
        `Could not load AI analysis for CC ${cc.id}: ${(err as Error).message} — ` +
          'falling back to the reply text',
      );
    }

    let replyText: string | undefined;
    // Only fetched when it will actually be used; the analysis is the better signal and
    // this is an extra query on the hot path.
    if (!analysis) {
      try {
        const lastInbound = await this.messageRepo.findOne({
          where: {
            campaign_contact_id: cc.id,
            direction: MessageDirection.INCOMING,
          },
          order: { created_at: 'DESC' },
        });
        replyText = lastInbound?.body ?? undefined;
      } catch (err) {
        this.logger.warn(
          `Could not load the last reply for CC ${cc.id}: ${(err as Error).message}`,
        );
      }
    }

    return classifyReply({
      analysis: analysis
        ? {
            intent: analysis.intent,
            interest_level: analysis.interest_level,
            // `confidence` is a decimal column, which TypeORM hands back as a string.
            // Left as a number here so the confidence floor compares correctly rather
            // than always failing against a string.
            confidence: analysis.confidence != null ? Number(analysis.confidence) : null,
            opt_out: analysis.opt_out,
            questions: analysis.questions,
          }
        : null,
      replyText,
      hasReplied: true,
    });
  }

  /**
   * Report a condition the engine cannot act on.
   *
   * Warn level and named in full, because this is the failure the whole change exists to
   * make visible: a step configured by a person that will never send anything.
   */
  private logUnrecognised(
    resolution: TriggerResolution,
    campaignContactId: string,
    template?: MessageTemplate,
  ): void {
    this.logger.warn(
      `Unrecognised trigger condition "${resolution.raw}"` +
        (template ? ` on template "${template.name}" (${template.id})` : '') +
        ` — this step will not fire for CC ${campaignContactId}. ` +
        'Re-pick the condition in the campaign\'s Templates tab.',
    );
  }

  /**
   * Claim a step for a contact, returning false if it was already claimed.
   *
   * The guard against the thing that must not happen: two branches of the same step
   * reaching the same prospect. Several paths can trigger one step — the analysis worker,
   * a redelivered webhook, the follow-up cron — and each would otherwise queue its own
   * branch. An atomic SET NX keyed on contact and step lets exactly one through.
   *
   * `isDuplicate` returns false when Redis is unavailable, deliberately: the fallback is
   * the send-time check below, and failing open on a cache outage is the existing
   * convention across this codebase.
   */
  private async claimStep(campaignContactId: string, step: number): Promise<boolean> {
    const key = `sequence:step:${campaignContactId}:${step}`;
    try {
      const alreadyClaimed = await this.redis.isDuplicate(
        key,
        SequenceService.STEP_CLAIM_TTL_SECONDS,
      );
      return !alreadyClaimed;
    } catch {
      return true;
    }
  }

  /**
   * Queue one template for a campaign contact, at most once per step.
   *
   * Goes through the shared `message-send` queue rather than the gateway so the send
   * inherits the humanised pacing and typing simulation every other path relies on.
   */
  private async queueTemplate(
    cc: CampaignContact,
    template: MessageTemplate,
    resolution: TriggerResolution,
    step: number,
  ): Promise<boolean> {
    if (!(await this.claimStep(cc.id, step))) {
      this.logger.log(
        `Step ${step} for CC ${cc.id} is already claimed — not queueing "${template.name}" ` +
          'as well (one branch per step)',
      );
      return false;
    }

    // Backstop for a Redis outage, and for a claim written by a process that then died:
    // if this step's message is already in the database, it has been sent.
    if (await this.alreadySentAtStep(cc.id, step)) {
      this.logger.log(
        `Step ${step} for CC ${cc.id} has already been sent — not queueing "${template.name}"`,
      );
      return false;
    }

    await this.sendQueue.add(
      'send-campaign-message',
      {
        campaignContactId: cc.id,
        campaignId: cc.campaign_id,
        contactId: cc.contact_id,
        sessionId: cc.campaign?.openwa_session_id || 'default',
        templateId: template.id,
      },
      {
        attempts: 2,
        backoff: { type: 'fixed', delay: 30000 },
        removeOnComplete: true,
      },
    );

    this.logger.log(
      `Sequence step ${step} queued for CC ${cc.id}: template "${template.name}" ` +
        `(condition "${resolution.raw}" → ${resolution.condition}, matched by ${resolution.matchedBy})`,
    );

    return true;
  }

  /**
   * True when one of this step's templates has already produced an outgoing message.
   *
   * Reads the messages table rather than `current_sequence_step`, because the step
   * counter is only advanced once the send processor runs: between queueing and sending
   * the counter still points at this step, so it cannot tell a pending send from none.
   */
  private async alreadySentAtStep(campaignContactId: string, step: number): Promise<boolean> {
    try {
      const cc = await this.ccRepo.findOne({ where: { id: campaignContactId } });
      if (!cc) return false;

      const stepTemplates = await this.templatesAtStep(cc.campaign_id, step);
      if (!stepTemplates.length) return false;

      const sent = await this.messageRepo.findOne({
        where: {
          campaign_contact_id: campaignContactId,
          template_id: In(stepTemplates.map((t) => t.id)),
          direction: MessageDirection.OUTGOING,
        },
      });
      return !!sent;
    } catch (err) {
      // Cannot prove a duplicate, so do not block the send on it — the Redis claim above
      // is the primary guard and has already passed.
      this.logger.warn(
        `Could not check for an existing send at step ${step} for CC ${campaignContactId}: ` +
          `${(err as Error).message}`,
      );
      return false;
    }
  }
}

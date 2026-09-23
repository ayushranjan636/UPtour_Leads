/**
 * Pure decision rules for the inbound-message AI pipeline.
 *
 * Kept free of Nest, TypeORM and network calls so the rules that decide whether a
 * prospect is counted as a lead, gets an automated answer, or becomes a deal can be
 * read and tested on their own. Every one of them exists to prevent a specific,
 * expensive failure: an inflated funnel, an AI-to-AI loop on a WhatsApp account that
 * would get banned, or a fabricated deal a salesperson then has to explain away.
 */
import { AIAnalysisResult } from './ai.interfaces';
import { LeadStatus } from '../../entities/lead.entity';
import { DealStage } from '../../entities/deal.entity';

/**
 * Minimal view of a message this module needs.
 *
 * Structural rather than the Message entity so callers can pass a raw webhook-derived
 * row, and so the guards can be tested without constructing an entity.
 */
export interface InboundMessageLike {
  direction: string;
  is_ai_generated?: boolean | null;
}

/**
 * True only for a message a real person sent to us.
 *
 * This is the single gate that separates "a human replied" from "we spoke". Both halves
 * matter and neither is redundant:
 *   - `direction` rules out everything we sent, including templates and human sends.
 *   - `is_ai_generated` is belt-and-braces: if a future code path ever stores an
 *     assistant message with the wrong direction, that row still cannot be mistaken for
 *     a prospect's reply.
 *
 * Getting this wrong is the one thing that cannot be allowed to fail: an assistant
 * message counted as a reply creates a phantom lead AND provokes another automated
 * reply, which is the first step of an infinite AI-to-AI loop.
 */
export function isHumanInbound(message: InboundMessageLike | null | undefined): boolean {
  if (!message) return false;
  if (message.direction !== 'incoming') return false;
  if (message.is_ai_generated === true) return false;
  return true;
}

/**
 * True when a webhook payload describes a message the account itself sent.
 *
 * WhatsApp gateways echo our own outbound messages back on the same event stream. An
 * echo that reaches the inbound path looks exactly like a prospect replying instantly,
 * so it would be answered — and that answer echoes back, and so on. This check is the
 * outermost defence against that loop; the `is_ai_generated`/`direction` guards above
 * are the inner one.
 */
export function isOwnEcho(data: any): boolean {
  return data?.fromMe === true || data?.from_me === true || data?.self === true;
}

/** Confidence below which a generated reply is handed to a human instead of sent. */
export const AI_REPLY_MIN_CONFIDENCE = 0.6;

/**
 * How many assistant messages may sit unanswered at the end of a conversation before
 * automation refuses to add another.
 *
 * One, which is the strictest useful value: the assistant answers a prospect and then
 * says nothing more until the prospect speaks again. That single rule doubles as a
 * database-level loop breaker and as a duplicate-send backstop for when Redis (where the
 * per-message dedupe key lives) is unavailable, and it holds regardless of what caused
 * the extra trigger — a gateway echo, a replayed webhook, or an auto-responder on the
 * other end. A conversation where we spoke twice in a row with nothing in between is not
 * a conversation, and on an unofficial WhatsApp account it is how an account gets banned.
 */
export const MAX_CONSECUTIVE_AI_REPLIES = 1;

/**
 * Count assistant messages at the tail of a conversation, i.e. since the prospect last
 * said anything. `history` must be in chronological order.
 */
export function countTrailingAiReplies(history: InboundMessageLike[]): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (isHumanInbound(m)) break;
    if (m.direction === 'outgoing') count++;
  }
  return count;
}

/** Confidence floor for creating a deal from an analysis. */
export const DEAL_MIN_CONFIDENCE = 0.75;

/** Lead-score floor for creating a deal from an analysis. */
export const DEAL_MIN_LEAD_SCORE = 70;

/**
 * Deal stages that still count as open. A won or lost deal is history, so a lead that
 * re-engages later is allowed a fresh one.
 */
export const OPEN_DEAL_STAGES: DealStage[] = [
  DealStage.PROPOSAL,
  DealStage.NEGOTIATION,
  DealStage.VERBAL_AGREEMENT,
];

/** Intents that can never represent an intent to convert, whatever the scores say. */
const NON_CONVERTING_INTENTS = new Set([
  'opt_out',
  'not_interested',
  'out_of_office',
  'unclear',
  'greeting',
]);

/**
 * Decide whether an analysed conversation shows a real intent to convert.
 *
 * Deliberately conservative, because the two errors are not symmetric: a missed deal is
 * found again on the next reply, while a false deal pollutes the pipeline, skews
 * forecasting and costs a salesperson a call to work out why it exists. Four independent
 * signals must agree:
 *
 *   1. The stated intent is not one that rules conversion out.
 *   2. Interest is `high` — `medium` is an engaged prospect, not a buyer.
 *   3. The model is confident, so a shaky classification cannot create a deal.
 *   4. There is at least one concrete commercial detail (dates, group size, a named
 *      product, or stated requirements). Someone genuinely ready to book has told us
 *      something specific; enthusiasm on its own has not.
 *
 * The returned `reason` is recorded on the deal so a human can audit the decision.
 */
export function assessConversionIntent(analysis: AIAnalysisResult): {
  ready: boolean;
  reason: string;
} {
  if (analysis.opt_out) {
    return { ready: false, reason: 'contact asked to stop being contacted' };
  }
  if (NON_CONVERTING_INTENTS.has(analysis.intent)) {
    return { ready: false, reason: `intent '${analysis.intent}' does not indicate conversion` };
  }
  if (analysis.interest_level !== 'high') {
    return { ready: false, reason: `interest level '${analysis.interest_level}' is below high` };
  }
  if (analysis.confidence < DEAL_MIN_CONFIDENCE) {
    return {
      ready: false,
      reason: `confidence ${analysis.confidence} below ${DEAL_MIN_CONFIDENCE}`,
    };
  }
  if (analysis.lead_score < DEAL_MIN_LEAD_SCORE) {
    return {
      ready: false,
      reason: `lead score ${analysis.lead_score} below ${DEAL_MIN_LEAD_SCORE}`,
    };
  }

  const specifics = [
    analysis.travel_period ? `travel period "${analysis.travel_period}"` : null,
    analysis.traveller_count ? `group size "${analysis.traveller_count}"` : null,
    analysis.product_interest ? `product "${analysis.product_interest}"` : null,
    analysis.requirements ? 'stated requirements' : null,
    analysis.destination_interest?.length
      ? `destinations ${analysis.destination_interest.join(', ')}`
      : null,
  ].filter(Boolean) as string[];

  if (!specifics.length) {
    return {
      ready: false,
      reason: 'no concrete booking detail (dates, group size, product or requirements) yet',
    };
  }

  return {
    ready: true,
    reason:
      `high interest, confidence ${analysis.confidence}, lead score ${analysis.lead_score}; ` +
      `committed detail: ${specifics.join('; ')}`,
  };
}

/**
 * Ordering of lead statuses along the funnel.
 *
 * Used so automation can only ever move a lead forward. Terminal and human-owned
 * statuses sit at the top: once a person has marked a lead won, lost or not interested,
 * an AI classification must not quietly reopen it.
 */
const LEAD_STATUS_RANK: Record<string, number> = {
  [LeadStatus.NEW]: 0,
  [LeadStatus.CONTACTED]: 1,
  [LeadStatus.ENGAGED]: 2,
  [LeadStatus.INTERESTED]: 3,
  [LeadStatus.QUALIFIED]: 4,
  [LeadStatus.HUMAN_HANDOVER]: 5,
  [LeadStatus.PROPOSAL_SENT]: 6,
  [LeadStatus.NEGOTIATION]: 7,
  [LeadStatus.WON]: 100,
  [LeadStatus.LOST]: 100,
  [LeadStatus.NOT_INTERESTED]: 100,
  [LeadStatus.OPTED_OUT]: 100,
};

/**
 * Return `next` only when it is genuinely further along than `current`, else null.
 * Null means "leave the lead alone".
 */
export function advanceLeadStatus(
  current: LeadStatus | string | null | undefined,
  next: LeadStatus,
): LeadStatus | null {
  const currentRank = LEAD_STATUS_RANK[current ?? LeadStatus.NEW] ?? 0;
  const nextRank = LEAD_STATUS_RANK[next] ?? 0;
  return nextRank > currentRank ? next : null;
}

/**
 * Trigger-condition vocabulary and free-text interpretation for message sequences.
 *
 * Kept free of Nest, TypeORM and network calls so the rules that decide whether a
 * sequence step fires can be read and tested on their own — the same split as
 * `inbound-ai.decisions.ts`.
 *
 * This module exists because the authoring UI offered a free-text box while the engine
 * accepted exactly five literals, so anything an operator typed in their own words
 * ("after reply", "If they say YES") matched nothing and the step silently never fired.
 * Four of five live steps were dead that way, with nothing in the product saying so.
 * Normalising here rather than migrating the rows means the conditions already in the
 * database start working without an operator re-entering anything.
 */

/**
 * The conditions the engine can actually act on.
 *
 * Every free-text value an operator can type resolves to one of these or to nothing;
 * there is no third state where a step is configured but unreachable.
 */
export enum TriggerCondition {
  /** First message of the sequence. Always fires. */
  INITIAL = 'initial',
  /** Contact replied at all, whatever they said. */
  REPLIED_ANY = 'replied_any',
  /** Reply reads as positive / interested. */
  REPLIED_INTERESTED = 'replied_interested',
  /** Reply reads as a refusal or lack of interest. */
  REPLIED_NOT_INTERESTED = 'replied_not_interested',
  /** Reply is an acknowledgement or otherwise neutral — "thanks", "ok", "noted". */
  REPLIED_NEUTRAL = 'replied_neutral',
  /** Reply asks something. */
  REPLIED_QUESTION = 'replied_question',
  /** No reply 48h after the last send. */
  NO_REPLY_48H = 'no_reply_48h',
  /** No reply 120h (5 days) after the last send. */
  NO_REPLY_120H = 'no_reply_120h',
}

/** Conditions that need an inbound reply before they can ever fire. */
const REPLY_TRIGGERED = new Set<TriggerCondition>([
  TriggerCondition.REPLIED_ANY,
  TriggerCondition.REPLIED_INTERESTED,
  TriggerCondition.REPLIED_NOT_INTERESTED,
  TriggerCondition.REPLIED_NEUTRAL,
  TriggerCondition.REPLIED_QUESTION,
]);

/** True when this condition can only be evaluated once the contact has replied. */
export function isReplyTriggered(condition: TriggerCondition): boolean {
  return REPLY_TRIGGERED.has(condition);
}

/**
 * Operator-facing copy, shared with the authoring UI via `GET /engine/trigger-conditions`.
 *
 * Kept next to the enum on purpose: a label that drifts from the behaviour it describes
 * is how the original bug was able to hide.
 */
export const TRIGGER_CONDITION_LABELS: Record<TriggerCondition, string> = {
  [TriggerCondition.INITIAL]: 'First message (sent immediately)',
  [TriggerCondition.REPLIED_ANY]: 'When they reply (any)',
  [TriggerCondition.REPLIED_INTERESTED]: 'When they say yes / show interest',
  [TriggerCondition.REPLIED_NOT_INTERESTED]: 'When they say no',
  [TriggerCondition.REPLIED_NEUTRAL]: 'When they acknowledge (thanks, ok)',
  [TriggerCondition.REPLIED_QUESTION]: 'When they ask a question',
  [TriggerCondition.NO_REPLY_48H]: 'No reply after 48 hours',
  [TriggerCondition.NO_REPLY_120H]: 'No reply after 5 days',
};

/**
 * Which branch wins when several at the same step match the same reply.
 *
 * A reply can legitimately satisfy more than one condition — an enthusiastic question
 * is both interested and a question — so the choice has to be deterministic rather than
 * dependent on row order. More specific conditions outrank broader ones, and interest
 * outranks a question because that is the precedence the engine has always applied and
 * because it is the branch with commercial value.
 */
const BRANCH_SPECIFICITY: Record<TriggerCondition, number> = {
  [TriggerCondition.REPLIED_INTERESTED]: 50,
  [TriggerCondition.REPLIED_NOT_INTERESTED]: 50,
  [TriggerCondition.REPLIED_QUESTION]: 40,
  [TriggerCondition.REPLIED_NEUTRAL]: 30,
  [TriggerCondition.REPLIED_ANY]: 10,
  // Not branch-selectable: these are decided by elapsed time or by being step one, so
  // they never compete with a reply for the same contact at the same moment.
  [TriggerCondition.NO_REPLY_48H]: 0,
  [TriggerCondition.NO_REPLY_120H]: 0,
  [TriggerCondition.INITIAL]: 0,
};

export function branchSpecificity(condition: TriggerCondition): number {
  return BRANCH_SPECIFICITY[condition] ?? 0;
}

/** How a raw `trigger_condition` string was understood. */
export type TriggerMatchKind =
  /** The stored value is already one of the canonical identifiers. */
  | 'canonical'
  /** A known synonym or a legacy identifier. */
  | 'alias'
  /** Interpreted from natural language the operator typed. */
  | 'phrase'
  /** Nothing in the text maps onto a condition the engine can act on. */
  | 'unrecognised';

export interface TriggerResolution {
  /** Null only when `matchedBy` is 'unrecognised'. */
  condition: TriggerCondition | null;
  matchedBy: TriggerMatchKind;
  /** The value as stored, unchanged, for logs and operator-facing messages. */
  raw: string;
  /**
   * Hours of silence required, for the no-reply family only.
   *
   * Authoritative for evaluation: the two enum members are the presets the UI offers,
   * but free text can name any interval ("no reply after 3 days"), and honouring what
   * the operator wrote beats snapping it to the nearest preset.
   */
  hours?: number;
  /** One line an operator can read, used by the API and the authoring UI. */
  description: string;
}

/**
 * Reduce a stored value to comparable words: lower case, identifier separators turned
 * into spaces, punctuation dropped, whitespace collapsed.
 *
 * Deliberately keeps digits, because the no-reply rules read an interval out of them,
 * and keeps `?` out of the way by handling question marks before stripping (see
 * `interpretPhrase`).
 */
function normalise(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Exact synonyms, matched after normalisation.
 *
 * Covers the canonical identifiers themselves plus the short forms that have appeared in
 * seeded campaigns, so they resolve without going through phrase interpretation.
 */
const ALIASES: Record<string, TriggerCondition> = {
  initial: TriggerCondition.INITIAL,
  first: TriggerCondition.INITIAL,
  'first message': TriggerCondition.INITIAL,
  opening: TriggerCondition.INITIAL,
  'opening message': TriggerCondition.INITIAL,
  immediate: TriggerCondition.INITIAL,
  always: TriggerCondition.INITIAL,

  replied: TriggerCondition.REPLIED_ANY,
  'replied any': TriggerCondition.REPLIED_ANY,
  reply: TriggerCondition.REPLIED_ANY,
  'any reply': TriggerCondition.REPLIED_ANY,
  'on reply': TriggerCondition.REPLIED_ANY,
  'after reply': TriggerCondition.REPLIED_ANY,
  'after they reply': TriggerCondition.REPLIED_ANY,

  'replied interested': TriggerCondition.REPLIED_INTERESTED,
  interested: TriggerCondition.REPLIED_INTERESTED,
  yes: TriggerCondition.REPLIED_INTERESTED,
  positive: TriggerCondition.REPLIED_INTERESTED,

  'replied not interested': TriggerCondition.REPLIED_NOT_INTERESTED,
  'not interested': TriggerCondition.REPLIED_NOT_INTERESTED,
  no: TriggerCondition.REPLIED_NOT_INTERESTED,
  negative: TriggerCondition.REPLIED_NOT_INTERESTED,

  'replied neutral': TriggerCondition.REPLIED_NEUTRAL,
  neutral: TriggerCondition.REPLIED_NEUTRAL,
  acknowledged: TriggerCondition.REPLIED_NEUTRAL,
  acknowledgement: TriggerCondition.REPLIED_NEUTRAL,
  thanks: TriggerCondition.REPLIED_NEUTRAL,

  'replied question': TriggerCondition.REPLIED_QUESTION,
  question: TriggerCondition.REPLIED_QUESTION,
  'asked a question': TriggerCondition.REPLIED_QUESTION,
};

/** Whole-word / whole-phrase containment. Avoids "no" matching inside "note". */
function hasPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(^|\\s)${phrase}($|\\s)`).test(text);
}

function hasAny(text: string, phrases: string[]): boolean {
  return phrases.some((p) => hasPhrase(text, p));
}

/** Affirmative / interest phrasing. Covers the live "If they say YES" row. */
const POSITIVE_PHRASES = [
  'yes',
  'yeah',
  'yep',
  'yup',
  'ya',
  'sure',
  'ok let s go',
  'interested',
  'keen',
  'agree',
  'agrees',
  'agreed',
  'accept',
  'accepts',
  'accepted',
  'positive',
  'want',
  'wants',
  'send details',
  'send me details',
  'tell me more',
  'go ahead',
  'sounds good',
  'confirm',
  'confirms',
  'confirmed',
  'book',
  'books',
  'booking',
];

/** Refusal phrasing. Covers the live "If they say NO" row. */
const NEGATIVE_PHRASES = [
  'no',
  'nope',
  'nah',
  'not interested',
  'uninterested',
  'decline',
  'declines',
  'declined',
  'refuse',
  'refuses',
  'refused',
  'reject',
  'rejects',
  'rejected',
  'negative',
  'don t want',
  'do not want',
  'not now',
  'pass',
  'stop',
  'unsubscribe',
  'opt out',
];

/**
 * Acknowledgement phrasing. Covers the live
 * "if they reply thankyou or anything" row — note the operator's spelling.
 */
const NEUTRAL_PHRASES = [
  'thank you',
  'thanks',
  'thankyou',
  'thanx',
  'thx',
  'ty',
  'noted',
  'ok',
  'okay',
  'okey',
  'acknowledge',
  'acknowledged',
  'acknowledgement',
  'neutral',
  'received',
  'got it',
];

/** Question phrasing. */
const QUESTION_PHRASES = [
  'question',
  'questions',
  'asks',
  'ask',
  'asked',
  'asking',
  'enquire',
  'enquires',
  'enquiry',
  'inquiry',
  'query',
  'queries',
  'wants to know',
  'asks something',
];

/** Any-reply phrasing, used when no sentiment word is present. */
const REPLY_PHRASES = [
  'reply',
  'replies',
  'replied',
  'replys',
  'responds',
  'respond',
  'responded',
  'response',
  'answers',
  'answered',
  'messages back',
  'message back',
  'writes back',
  'gets back',
  'hears back',
];

/** Silence phrasing, which must be recognised before any reply wording. */
const NO_REPLY_PHRASES = [
  'no reply',
  'no replies',
  'no response',
  'no answer',
  'not replied',
  'not reply',
  'not replying',
  'not respond',
  'not responded',
  'not responding',
  'not answer',
  'not answered',
  'doesn t reply',
  'does not reply',
  'didn t reply',
  'did not reply',
  'do not reply',
  'don t reply',
  'never replied',
  'never reply',
  'unanswered',
  'silent',
  'silence',
  'ignored',
  'no contact',
];

/** Default silence window when a no-reply phrase names no interval. */
const DEFAULT_NO_REPLY_HOURS = 48;

/**
 * Hours named by a normalised phrase, e.g. "no reply 48h", "no reply after 3 days".
 *
 * Returns null when no interval is stated, which the caller reads as "use the default"
 * rather than as a failure to understand the phrase.
 */
function parseHours(text: string): number | null {
  const hours = text.match(/(\d+)\s*(h|hr|hrs|hour|hours)(\s|$)/);
  if (hours) return Number(hours[1]);

  const days = text.match(/(\d+)\s*(d|day|days)(\s|$)/);
  if (days) return Number(days[1]) * 24;

  const weeks = text.match(/(\d+)\s*(w|week|weeks)(\s|$)/);
  if (weeks) return Number(weeks[1]) * 7 * 24;

  return null;
}

/** Sentiment-bearing interpretation of free text, or null when nothing matches. */
function interpretPhrase(text: string): { condition: TriggerCondition; hours?: number } | null {
  // Silence first. "if they do not reply" contains reply wording, and reading it as an
  // any-reply trigger would invert the operator's intent — the worst failure available
  // here, because it messages someone on exactly the condition they excluded.
  if (hasAny(text, NO_REPLY_PHRASES)) {
    const hours = parseHours(text) ?? DEFAULT_NO_REPLY_HOURS;
    return {
      condition: hours >= 120 ? TriggerCondition.NO_REPLY_120H : TriggerCondition.NO_REPLY_48H,
      hours,
    };
  }

  // Refusal before affirmation: a phrase carrying both ("yes or no") is ambiguous, so
  // the stricter branch wins the tie. Treating a refusal as interest would answer a no
  // with a sales message.
  if (hasAny(text, NEGATIVE_PHRASES)) {
    return { condition: TriggerCondition.REPLIED_NOT_INTERESTED };
  }

  if (hasAny(text, POSITIVE_PHRASES)) {
    return { condition: TriggerCondition.REPLIED_INTERESTED };
  }

  if (hasAny(text, NEUTRAL_PHRASES)) {
    return { condition: TriggerCondition.REPLIED_NEUTRAL };
  }

  if (hasAny(text, QUESTION_PHRASES)) {
    return { condition: TriggerCondition.REPLIED_QUESTION };
  }

  // Broadest reading last: reply wording with no sentiment attached means any reply.
  // This is the live row the operator wrote as "after reply".
  if (hasAny(text, REPLY_PHRASES)) {
    return { condition: TriggerCondition.REPLIED_ANY };
  }

  if (hasAny(text, ['initial', 'start', 'immediately', 'straight away', 'at once'])) {
    return { condition: TriggerCondition.INITIAL };
  }

  return null;
}

/** Hours a no-reply condition waits by default, for the two presets. */
function presetHours(condition: TriggerCondition): number | undefined {
  if (condition === TriggerCondition.NO_REPLY_120H) return 120;
  if (condition === TriggerCondition.NO_REPLY_48H) return 48;
  return undefined;
}

/** Operator-facing one-liner for a resolved condition. */
function describe(condition: TriggerCondition, hours?: number): string {
  if (
    condition === TriggerCondition.NO_REPLY_48H ||
    condition === TriggerCondition.NO_REPLY_120H
  ) {
    const h = hours ?? presetHours(condition) ?? DEFAULT_NO_REPLY_HOURS;
    const days = h / 24;
    return h >= 24 && h % 24 === 0
      ? `Fires when there has been no reply for ${days} day${days === 1 ? '' : 's'}`
      : `Fires when there has been no reply for ${h} hours`;
  }

  switch (condition) {
    case TriggerCondition.INITIAL:
      return 'Fires immediately as the first message';
    case TriggerCondition.REPLIED_ANY:
      return 'Fires when the contact replies, whatever they say';
    case TriggerCondition.REPLIED_INTERESTED:
      return 'Fires when the reply shows interest';
    case TriggerCondition.REPLIED_NOT_INTERESTED:
      return 'Fires when the reply is a no';
    case TriggerCondition.REPLIED_NEUTRAL:
      return 'Fires when the reply is an acknowledgement';
    case TriggerCondition.REPLIED_QUESTION:
      return 'Fires when the reply asks a question';
  }
}

/**
 * Interpret a stored `trigger_condition` into something the engine can act on.
 *
 * Never throws and never guesses beyond the rules above: a value it cannot read comes
 * back as `unrecognised`, so the caller can say so loudly instead of dropping the step
 * without a trace — which is the behaviour being fixed.
 */
export function resolveTriggerCondition(raw: string | null | undefined): TriggerResolution {
  const original = String(raw ?? '');
  const exact = original.trim().toLowerCase();
  const text = normalise(original);

  // An empty condition matches the column default's intent: the opening message.
  if (!text) {
    return {
      condition: TriggerCondition.INITIAL,
      matchedBy: 'alias',
      raw: original,
      description: describe(TriggerCondition.INITIAL),
    };
  }

  // Compared before normalisation, because normalising turns the underscores in the
  // canonical identifiers into spaces and they would no longer match themselves.
  if ((Object.values(TriggerCondition) as string[]).includes(exact)) {
    const condition = exact as TriggerCondition;
    const hours = presetHours(condition);
    return {
      condition,
      matchedBy: 'canonical',
      raw: original,
      ...(hours !== undefined ? { hours } : {}),
      description: describe(condition, hours),
    };
  }

  const alias = ALIASES[text];
  if (alias) {
    const hours = presetHours(alias);
    return {
      condition: alias,
      matchedBy: 'alias',
      raw: original,
      ...(hours !== undefined ? { hours } : {}),
      description: describe(alias, hours),
    };
  }

  const phrase = interpretPhrase(text);
  if (phrase) {
    return {
      condition: phrase.condition,
      matchedBy: 'phrase',
      raw: original,
      ...(phrase.hours !== undefined ? { hours: phrase.hours } : {}),
      description: describe(phrase.condition, phrase.hours),
    };
  }

  return {
    condition: null,
    matchedBy: 'unrecognised',
    raw: original,
    description:
      `"${original}" is not understood, so this step will never send — ` +
      'pick one of the listed conditions.',
  };
}

/** True when a stored value will actually do something. Used by the authoring UI. */
export function isUnderstoodTriggerCondition(raw: string | null | undefined): boolean {
  return resolveTriggerCondition(raw).matchedBy !== 'unrecognised';
}

/** The vocabulary the authoring UI offers, served by `GET /engine/trigger-conditions`. */
export function listTriggerConditions(): {
  value: TriggerCondition;
  label: string;
  description: string;
}[] {
  return Object.values(TriggerCondition).map((value) => ({
    value,
    label: TRIGGER_CONDITION_LABELS[value],
    description: describe(value, presetHours(value)),
  }));
}

/**
 * Confidence below which a classification is not trusted for branch selection.
 *
 * Lower than `AI_REPLY_MIN_CONFIDENCE` (0.6) because the stakes differ: that gate
 * decides whether to put generated words in front of a prospect, this one only picks
 * which pre-written template an operator already approved. Below the floor the keyword
 * fallback runs instead, so a shaky classification degrades to a literal reading of what
 * the contact actually wrote rather than to no message at all.
 */
export const TRIGGER_MIN_CONFIDENCE = 0.5;

/** What the engine believes about a reply, and where that belief came from. */
export interface ReplySignals {
  /** False means no inbound reply exists, so no reply-triggered branch can fire. */
  replied: boolean;
  sentiment: 'interested' | 'not_interested' | 'neutral';
  /**
   * Tracked separately from `sentiment` because the two are independent: an enthusiastic
   * prospect can also be asking something, and collapsing them would make one of the two
   * branches unreachable.
   */
  isQuestion: boolean;
  source: 'ai_analysis' | 'keywords' | 'reply_presence';
  /** Human-readable justification, logged whenever a branch is chosen. */
  detail: string;
}

/** The subset of an `AIAnalysisResult` branch selection reads. */
export interface AnalysisLike {
  intent?: string | null;
  interest_level?: string | null;
  confidence?: number | null;
  opt_out?: boolean | null;
  questions?: string[] | null;
}

/** Intents that mean the contact has said no, regardless of scored interest. */
const REFUSING_INTENTS = new Set(['not_interested', 'opt_out', 'unsubscribe', 'complaint']);

/** Intents that mean the contact asked something. */
const QUESTIONING_INTENTS = new Set(['question', 'request_info', 'pricing_enquiry', 'enquiry']);

/** Intents that carry positive commercial signal even when interest was not scored high. */
const POSITIVE_INTENTS = new Set([
  'interested',
  'ready_to_book',
  'booking',
  'booking_request',
  'positive',
]);

/** Intents that are engagement without direction — a greeting or a plain thank-you. */
const NEUTRAL_INTENTS = new Set([
  'greeting',
  'acknowledgement',
  'thanks',
  'out_of_office',
  'unclear',
  'other',
]);

/** Reply-text words used only when the analysis is missing or not confident enough. */
const TEXT_POSITIVE = /\b(yes|yeah|yep|yup|sure|interested|keen|please\s+(send|share)|go\s+ahead|sounds\s+good|definitely|absolutely|let'?s\s+(do|go)|book(ing)?)\b/i;
/**
 * "no problem" and "no worries" are excluded: both are acknowledgements, and the bare
 * `\bno\b` inside them would otherwise route a friendly reply down the rejection branch.
 */
const TEXT_NEGATIVE = /\b(no(?!\s+(problem|worries|issue|probs))|nope|nah|not\s+interested|don'?t\s+(want|need)|do\s+not\s+(want|need)|stop|unsubscribe|remove\s+me|leave\s+me|not\s+now|maybe\s+later)\b/i;
const TEXT_NEUTRAL = /\b(thanks|thank\s*you|thankyou|thanx|thx|ty|noted|ok(ay)?|got\s+it|received|no\s+(problem|worries))\b/i;
const TEXT_QUESTION = /\?|\b(how|what|when|where|which|why|who|can\s+you|could\s+you|do\s+you|is\s+it|price|cost|rates?|quote|available|availability)\b/i;

/**
 * Decide what a reply means, preferring the classification the AI already produced.
 *
 * The AI runs on every inbound message and reads intent, interest and confidence out of
 * the whole conversation, so it separates "no, not this trip, but send me next season's"
 * from a flat refusal in a way word lists cannot. Keywords are the fallback, not the
 * plan: they run only when there is no analysis or the model was below
 * `TRIGGER_MIN_CONFIDENCE`, so an unavailable model degrades branch selection rather
 * than stopping the sequence.
 *
 * `replied: false` is returned when there is nothing to read at all, which keeps every
 * reply-triggered branch shut instead of guessing.
 */
export function classifyReply(input: {
  analysis?: AnalysisLike | null;
  replyText?: string | null;
  hasReplied: boolean;
}): ReplySignals {
  const { analysis, replyText, hasReplied } = input;

  if (!hasReplied) {
    return {
      replied: false,
      sentiment: 'neutral',
      isQuestion: false,
      source: 'reply_presence',
      detail: 'contact has not replied',
    };
  }

  const confidence = typeof analysis?.confidence === 'number' ? analysis.confidence : 0;
  const usable = !!analysis && (analysis.intent || analysis.interest_level) && confidence >= TRIGGER_MIN_CONFIDENCE;

  if (usable) {
    const intent = String(analysis!.intent ?? '').toLowerCase();
    const interest = String(analysis!.interest_level ?? '').toLowerCase();
    const isQuestion =
      QUESTIONING_INTENTS.has(intent) || (analysis!.questions?.length ?? 0) > 0;

    // Opt-out and refusal are checked first and unconditionally: a contact who asked to
    // stop must never be read as interested because the score happened to be high.
    if (analysis!.opt_out === true || REFUSING_INTENTS.has(intent)) {
      return {
        replied: true,
        sentiment: 'not_interested',
        isQuestion,
        source: 'ai_analysis',
        detail: `intent '${intent}'${analysis!.opt_out ? ' with opt-out' : ''}, confidence ${confidence}`,
      };
    }

    if (interest === 'high' || interest === 'medium' || POSITIVE_INTENTS.has(intent)) {
      return {
        replied: true,
        sentiment: 'interested',
        isQuestion,
        source: 'ai_analysis',
        detail: `interest '${interest}', intent '${intent}', confidence ${confidence}`,
      };
    }

    if (isQuestion || NEUTRAL_INTENTS.has(intent) || interest === 'low' || interest === 'none') {
      return {
        replied: true,
        sentiment: 'neutral',
        isQuestion,
        source: 'ai_analysis',
        detail: `interest '${interest}', intent '${intent}', confidence ${confidence}`,
      };
    }

    return {
      replied: true,
      sentiment: 'neutral',
      isQuestion,
      source: 'ai_analysis',
      detail: `unmapped intent '${intent}' with interest '${interest}' read as neutral`,
    };
  }

  const text = String(replyText ?? '');
  if (text.trim()) {
    const isQuestion = TEXT_QUESTION.test(text);
    // Same precedence as the phrase rules above, and for the same reason: a refusal
    // misread as interest is the expensive direction.
    if (TEXT_NEGATIVE.test(text)) {
      return {
        replied: true,
        sentiment: 'not_interested',
        isQuestion,
        source: 'keywords',
        detail: 'no usable AI analysis; reply text reads as a refusal',
      };
    }
    if (TEXT_POSITIVE.test(text)) {
      return {
        replied: true,
        sentiment: 'interested',
        isQuestion,
        source: 'keywords',
        detail: 'no usable AI analysis; reply text reads as affirmative',
      };
    }
    if (TEXT_NEUTRAL.test(text) || isQuestion) {
      return {
        replied: true,
        sentiment: 'neutral',
        isQuestion,
        source: 'keywords',
        detail: 'no usable AI analysis; reply text reads as neutral',
      };
    }
  }

  // A reply exists but says nothing the engine can classify. Neutral, not negative:
  // the contact engaged, and only the any-reply and acknowledgement branches should see
  // it. Reading silence-of-meaning as a refusal would suppress the wrong branch.
  return {
    replied: true,
    sentiment: 'neutral',
    isQuestion: false,
    source: 'keywords',
    detail: 'reply could not be classified; treated as neutral',
  };
}

/** Whether a reply-triggered condition is satisfied by these signals. */
export function conditionMatchesReply(
  condition: TriggerCondition,
  signals: ReplySignals,
): boolean {
  if (!signals.replied) return false;

  switch (condition) {
    case TriggerCondition.REPLIED_ANY:
      return true;
    case TriggerCondition.REPLIED_INTERESTED:
      return signals.sentiment === 'interested';
    case TriggerCondition.REPLIED_NOT_INTERESTED:
      return signals.sentiment === 'not_interested';
    case TriggerCondition.REPLIED_QUESTION:
      return signals.isQuestion;
    case TriggerCondition.REPLIED_NEUTRAL:
      return signals.sentiment === 'neutral';
    default:
      // Time-based and `initial` conditions are not decided by a reply.
      return false;
  }
}

/** A template as branch selection needs to see it. */
export interface BranchCandidate {
  id: string;
  name?: string;
  sequence_order: number;
  trigger_condition: string;
}

export interface BranchChoice<T extends BranchCandidate> {
  chosen: T | null;
  resolution: TriggerResolution | null;
  /** Everything considered at this step, so the decision can be logged in full. */
  considered: { template: T; resolution: TriggerResolution; matched: boolean }[];
}

/**
 * Pick the single branch to send from the templates sharing one sequence step.
 *
 * A step is a set of alternatives, not a single message: the live campaign has a YES
 * branch, a NO branch and a neutral branch all at `sequence_order = 1`. Evaluating only
 * "the next template by sequence_order" therefore made every branch but one unreachable
 * even after the conditions themselves worked.
 *
 * Exactly one winner, chosen by `BRANCH_SPECIFICITY` and then by id so the result is
 * stable across processes: two branches sent to the same prospect for the same step is a
 * worse outcome than a step that does not fire, and ties must not be broken by whatever
 * order the database happened to return.
 */
export function selectBranch<T extends BranchCandidate>(
  candidates: T[],
  signals: ReplySignals,
): BranchChoice<T> {
  const considered = candidates.map((template) => {
    const resolution = resolveTriggerCondition(template.trigger_condition);
    const matched =
      resolution.condition !== null &&
      isReplyTriggered(resolution.condition) &&
      conditionMatchesReply(resolution.condition, signals);
    return { template, resolution, matched };
  });

  const winners = considered.filter((c) => c.matched);
  if (!winners.length) return { chosen: null, resolution: null, considered };

  winners.sort((a, b) => {
    const rank = branchSpecificity(b.resolution.condition!) - branchSpecificity(a.resolution.condition!);
    if (rank !== 0) return rank;
    return String(a.template.id).localeCompare(String(b.template.id));
  });

  return { chosen: winners[0].template, resolution: winners[0].resolution, considered };
}

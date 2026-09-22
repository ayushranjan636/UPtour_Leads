/**
 * Shared AI interfaces — single source of truth for AI response shapes.
 */
export interface AIAnalysisResult {
  intent: string;
  interest_level: string;
  product_interest: string | null;
  destination_interest: string[] | null;
  travel_period: string | null;
  traveller_count: string | null;
  requirements: string | null;
  questions: string[] | null;
  needs_human: boolean;
  opt_out: boolean;
  confidence: number;
  lead_score: number;
  reasoning: string;
}

/**
 * A generated reply, ready to send.
 *
 * Separate from AIAnalysisResult because the two calls answer different questions:
 * analysis classifies an inbound message for routing and lead scoring, this composes
 * the outbound text a prospect reads.
 */
export interface AIReplyResult {
  /** Message text, already length-capped and sanitised. */
  body: string;
  /** Only set when a media URL was also resolved; otherwise null. */
  mediaType: 'image' | 'video' | 'document' | null;
  mediaUrl: string | null;
  /**
   * True when a person should take over — pricing, booking confirmation, complaints,
   * opt-outs, or anything the model was not confident about.
   */
  needsHuman: boolean;
  confidence: number;
}

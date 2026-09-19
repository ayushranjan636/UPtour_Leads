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

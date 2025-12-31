/**
 * Synthesis Module Type Definitions
 *
 * Types for the synthesis phase (Stage 4) that generates LinkedIn posts
 * from grounded claims using various LLM providers.
 */

import type { SynthesisResult } from '../schemas/index.js';
import type { GroundedClaim } from './claims.js';
import type { PostStyle } from '../types/index.js';

// ============================================
// Model Configuration
// ============================================

/**
 * Available models for synthesis.
 *
 * | Model   | Provider   | Model ID                        | Use Case               |
 * |---------|------------|--------------------------------|------------------------|
 * | gpt     | OpenAI     | gpt-5.2                        | Default, best quality  |
 * | gemini  | Google     | gemini-3-flash-preview         | Fast, cost-effective   |
 * | claude  | Anthropic  | claude-sonnet-4-20250514     | Balanced reasoning     |
 * | kimi2   | OpenRouter | moonshotai/kimi-k2-thinking    | Deep reasoning         |
 */
export type SynthesisModel = 'gpt' | 'gemini' | 'claude' | 'kimi2';

/**
 * Valid synthesis model values for validation
 */
export const SYNTHESIS_MODELS: readonly SynthesisModel[] = [
  'gpt',
  'gemini',
  'claude',
  'kimi2',
] as const;

/**
 * Model ID mapping for each synthesis model provider
 */
export const SYNTHESIS_MODEL_IDS: Record<SynthesisModel, string> = {
  gpt: 'gpt-5.2',
  gemini: 'gemini-3-flash-preview',
  claude: 'claude-sonnet-4-20250514',
  kimi2: 'moonshotai/kimi-k2-thinking',
} as const;

// ============================================
// Synthesis Options
// ============================================

/**
 * Options passed to all synthesizer functions.
 *
 * This is the standard options interface that all models accept.
 * Model-specific configurations are handled internally by each synthesizer.
 */
export interface SynthesisOptions {
  /** Number of posts to generate (1-3) */
  postCount: number;

  /** Post style for multi-post generation */
  postStyle: PostStyle;

  /** Enable verbose logging */
  verbose?: boolean;

  /** Timeout in milliseconds (default: 300000 = 5 min) */
  timeoutMs?: number;
}

/**
 * Default synthesis options
 */
export const DEFAULT_SYNTHESIS_OPTIONS: SynthesisOptions = {
  postCount: 1,
  postStyle: 'variations',
  verbose: false,
  timeoutMs: 300000,
};

// ============================================
// Function Types
// ============================================

/**
 * Function signature for model-specific synthesizers.
 *
 * All synthesizers (GPT, Gemini, Claude, Kimi) implement this interface.
 * This ensures consistent calling convention across all models.
 *
 * CRIT-5/CRIT-6 Resolution:
 * - All synthesizers now use this exact signature
 * - Returns SynthesisResult directly (not wrapped)
 * - Accepts SynthesisOptions (not model-specific options)
 *
 * @param prompt - The user's original topic/prompt
 * @param claims - Array of grounded claims with source URLs
 * @param options - Synthesis options (postCount, postStyle, etc.)
 * @returns Promise resolving to validated SynthesisResult
 *
 * @example
 * ```typescript
 * const synthesizer = selectSynthesizer('gemini').synthesizer;
 * const result = await synthesizer(prompt, claims, { postCount: 1, postStyle: 'variations' });
 * ```
 */
export type SynthesizerFn = (
  prompt: string,
  claims: GroundedClaim[],
  options: SynthesisOptions
) => Promise<SynthesisResult>;

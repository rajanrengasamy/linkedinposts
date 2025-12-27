/**
 * Cost Estimator
 *
 * Provides cost estimation and tracking for API usage.
 * All costs are in USD.
 */

import type { CostBreakdown } from '../schemas/index.js';
import type { PipelineConfig, ImageResolution } from '../types/index.js';
import { createEmptyCostBreakdown } from '../schemas/index.js';

// ============================================
// API Pricing (as of Dec 2025)
// ============================================

/**
 * Cost per million tokens for each API
 */
export const TOKEN_COSTS = {
  perplexity: {
    inputPerMillion: 3.0, // sonar-reasoning-pro input
    outputPerMillion: 15.0, // sonar-reasoning-pro output
  },
  gemini: {
    inputPerMillion: 0.5, // Gemini 3 Flash input
    outputPerMillion: 3.0, // Gemini 3 Flash output
  },
  openai: {
    inputPerMillion: 10.0, // GPT-5.2 Thinking input
    outputPerMillion: 30.0, // GPT-5.2 Thinking output
  },
} as const;

/**
 * Image generation costs
 */
export const IMAGE_COSTS: Record<ImageResolution, number> = {
  '2k': 0.139, // Nano Banana Pro 2K
  '4k': 0.24, // Nano Banana Pro 4K
};

// ============================================
// Token Estimation
// ============================================

/**
 * Estimated tokens per item for each stage
 * These are rough estimates based on typical content
 */
const TOKENS_PER_ITEM = {
  // Collection: search query + response parsing
  collection: {
    perQuery: 500, // input: search query construction
    perResult: 1500, // output: extracted content per result
  },
  // Validation: cross-checking each item
  validation: {
    input: 1000, // item content + verification prompt
    output: 500, // verification result
  },
  // Scoring: batch scoring
  scoring: {
    inputPerItem: 800, // item content for scoring
    outputPerItem: 200, // score + reasoning
  },
  // Synthesis: final post generation
  synthesis: {
    input: 5000, // all claims + prompt
    output: 2000, // post + metadata
  },
} as const;

/**
 * Estimate number of queries needed for collection
 */
function estimateCollectionQueries(config: PipelineConfig): number {
  // Base: 3-5 sub-queries per prompt for web
  let queries = 4;

  // Add queries for each additional source
  if (config.sources.includes('linkedin')) queries += 2;
  if (config.sources.includes('x')) queries += 2;

  return queries;
}

/**
 * Estimate items that will go through validation
 */
function estimateValidationItems(config: PipelineConfig): number {
  if (config.skipValidation) return 0;

  // Estimate based on maxTotal, but cap at reasonable amount
  return Math.min(config.maxTotal, 50);
}

/**
 * Estimate items that will go through scoring
 */
function estimateScoringItems(config: PipelineConfig): number {
  if (config.skipScoring) return 0;

  // Score validated items
  return Math.min(config.maxTotal, 50);
}

// ============================================
// Cost Calculation
// ============================================

/**
 * Calculate cost for token usage
 */
function calculateTokenCost(
  inputTokens: number,
  outputTokens: number,
  pricing: { inputPerMillion: number; outputPerMillion: number }
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

/**
 * Estimate Perplexity costs for collection + validation
 */
function estimatePerplexityCost(config: PipelineConfig): number {
  // Collection costs
  const queries = estimateCollectionQueries(config);
  const collectionInput = queries * TOKENS_PER_ITEM.collection.perQuery;
  const collectionOutput = config.maxTotal * TOKENS_PER_ITEM.collection.perResult;

  // Validation costs (if enabled)
  const validationItems = estimateValidationItems(config);
  const validationInput = validationItems * TOKENS_PER_ITEM.validation.input;
  const validationOutput = validationItems * TOKENS_PER_ITEM.validation.output;

  const totalInput = collectionInput + validationInput;
  const totalOutput = collectionOutput + validationOutput;

  return calculateTokenCost(totalInput, totalOutput, TOKEN_COSTS.perplexity);
}

/**
 * Estimate Gemini costs for scoring
 */
function estimateGeminiCost(config: PipelineConfig): number {
  if (config.skipScoring) return 0;

  const items = estimateScoringItems(config);
  const inputTokens = items * TOKENS_PER_ITEM.scoring.inputPerItem;
  const outputTokens = items * TOKENS_PER_ITEM.scoring.outputPerItem;

  return calculateTokenCost(inputTokens, outputTokens, TOKEN_COSTS.gemini);
}

/**
 * Estimate OpenAI costs for synthesis
 */
function estimateOpenAICost(_config: PipelineConfig): number {
  // Synthesis always runs (required stage)
  const inputTokens = TOKENS_PER_ITEM.synthesis.input;
  const outputTokens = TOKENS_PER_ITEM.synthesis.output;

  return calculateTokenCost(inputTokens, outputTokens, TOKEN_COSTS.openai);
}

/**
 * Estimate Nano Banana costs for image generation
 */
function estimateNanaBananaCost(config: PipelineConfig): number {
  if (config.skipImage) return 0;
  return IMAGE_COSTS[config.imageResolution];
}

// ============================================
// Public API
// ============================================

/**
 * Estimate total cost for a pipeline run before execution.
 *
 * This provides a rough estimate based on configuration.
 * Actual costs may vary based on content and API responses.
 *
 * @param config - Pipeline configuration
 * @returns Estimated cost breakdown
 */
export function estimateCost(config: PipelineConfig): CostBreakdown {
  const perplexity = estimatePerplexityCost(config);
  const gemini = estimateGeminiCost(config);
  const openai = estimateOpenAICost(config);
  const nanoBanana = estimateNanaBananaCost(config);

  const total = perplexity + gemini + openai + nanoBanana;

  return {
    perplexity: Math.round(perplexity * 10000) / 10000,
    gemini: Math.round(gemini * 10000) / 10000,
    openai: Math.round(openai * 10000) / 10000,
    nanoBanana: Math.round(nanoBanana * 10000) / 10000,
    total: Math.round(total * 10000) / 10000,
  };
}

/**
 * Token usage tracking for actual cost calculation
 */
export interface TokenUsage {
  perplexity?: { inputTokens: number; outputTokens: number };
  gemini?: { inputTokens: number; outputTokens: number };
  openai?: { inputTokens: number; outputTokens: number };
  imageGenerated?: boolean;
  imageResolution?: ImageResolution;
}

/**
 * Calculate actual cost from tracked token usage.
 *
 * Call this after pipeline execution with actual usage data.
 *
 * @param usage - Actual token usage from API calls
 * @returns Actual cost breakdown
 */
export function calculateActualCost(usage: TokenUsage): CostBreakdown {
  let perplexity = 0;
  let gemini = 0;
  let openai = 0;
  let nanoBanana = 0;

  if (usage.perplexity) {
    perplexity = calculateTokenCost(
      usage.perplexity.inputTokens,
      usage.perplexity.outputTokens,
      TOKEN_COSTS.perplexity
    );
  }

  if (usage.gemini) {
    gemini = calculateTokenCost(
      usage.gemini.inputTokens,
      usage.gemini.outputTokens,
      TOKEN_COSTS.gemini
    );
  }

  if (usage.openai) {
    openai = calculateTokenCost(
      usage.openai.inputTokens,
      usage.openai.outputTokens,
      TOKEN_COSTS.openai
    );
  }

  if (usage.imageGenerated && usage.imageResolution) {
    nanoBanana = IMAGE_COSTS[usage.imageResolution];
  }

  const total = perplexity + gemini + openai + nanoBanana;

  return {
    perplexity: Math.round(perplexity * 10000) / 10000,
    gemini: Math.round(gemini * 10000) / 10000,
    openai: Math.round(openai * 10000) / 10000,
    nanoBanana: Math.round(nanoBanana * 10000) / 10000,
    total: Math.round(total * 10000) / 10000,
  };
}

/**
 * Token usage accumulator for tracking across pipeline stages
 */
export class CostTracker {
  private usage: TokenUsage = {};

  /**
   * Add Perplexity token usage
   */
  addPerplexity(inputTokens: number, outputTokens: number): void {
    if (!this.usage.perplexity) {
      this.usage.perplexity = { inputTokens: 0, outputTokens: 0 };
    }
    this.usage.perplexity.inputTokens += inputTokens;
    this.usage.perplexity.outputTokens += outputTokens;
  }

  /**
   * Add Gemini token usage
   */
  addGemini(inputTokens: number, outputTokens: number): void {
    if (!this.usage.gemini) {
      this.usage.gemini = { inputTokens: 0, outputTokens: 0 };
    }
    this.usage.gemini.inputTokens += inputTokens;
    this.usage.gemini.outputTokens += outputTokens;
  }

  /**
   * Add OpenAI token usage
   */
  addOpenAI(inputTokens: number, outputTokens: number): void {
    if (!this.usage.openai) {
      this.usage.openai = { inputTokens: 0, outputTokens: 0 };
    }
    this.usage.openai.inputTokens += inputTokens;
    this.usage.openai.outputTokens += outputTokens;
  }

  /**
   * Record image generation
   */
  addImage(resolution: ImageResolution): void {
    this.usage.imageGenerated = true;
    this.usage.imageResolution = resolution;
  }

  /**
   * Get current usage
   */
  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  /**
   * Calculate current cost
   */
  getCost(): CostBreakdown {
    return calculateActualCost(this.usage);
  }

  /**
   * Reset tracker
   */
  reset(): void {
    this.usage = {};
  }
}

/**
 * Format cost for display
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Get cost estimate summary string
 */
export function getCostSummary(config: PipelineConfig): string {
  const estimate = estimateCost(config);

  const parts: string[] = [];
  if (estimate.perplexity > 0) parts.push(`Perplexity: ${formatCost(estimate.perplexity)}`);
  if (estimate.gemini > 0) parts.push(`Gemini: ${formatCost(estimate.gemini)}`);
  if (estimate.openai > 0) parts.push(`OpenAI: ${formatCost(estimate.openai)}`);
  if (estimate.nanoBanana > 0) parts.push(`Image: ${formatCost(estimate.nanoBanana)}`);

  return `Estimated cost: ${formatCost(estimate.total)} (${parts.join(', ')})`;
}

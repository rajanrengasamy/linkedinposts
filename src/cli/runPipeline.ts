/**
 * Pipeline Orchestration
 *
 * Main pipeline execution function that orchestrates all stages:
 * 1. Collection - Gather content from sources
 * 2. Validation - Verify quotes and claims
 * 3. Scoring - Score and rank content
 * 4. Synthesis - Generate LinkedIn post
 * 5. Image - Generate infographic (optional)
 *
 * This module focuses on the happy path - errors propagate to the
 * error handler (errorHandler.ts) for centralized handling.
 *
 * @see docs/PRD-v2.md Section 12 for full requirements
 */

import type {
  PipelineConfig,
  PipelineResult,
  PipelineStatus,
  SynthesisResult,
  SourceReference,
  CostBreakdown,
} from '../types/index.js';

// Stage imports
import { collectAll } from '../collectors/index.js';
import { validateItems } from '../validation/perplexity.js';
import { scoreItems } from '../scoring/index.js';
import { extractGroundedClaims, synthesize, buildSourceReferences } from '../synthesis/index.js';
import { generateInfographic } from '../image/index.js';

// Utility imports
import { createOutputWriter, createOutputWriterFromDir, type OutputWriter } from '../utils/fileWriter.js';
import {
  logStage,
  logSuccess,
  logWarning,
  logInfo,
  logVerbose,
  logCost,
  logPipelineResult,
  setVerbose,
} from '../utils/logger.js';

// ============================================
// Types
// ============================================

/**
 * Internal tracking for pipeline execution.
 * Used to maintain state across stages.
 */
interface PipelineState {
  startTime: number;
  outputWriter: OutputWriter;
  currentStage: string;
  synthesis?: SynthesisResult;
  sources?: SourceReference[];
  costs?: CostBreakdown;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Create success status for pipeline completion.
 */
function createSuccessStatus(
  config: PipelineConfig,
  startTime: number,
  costs?: CostBreakdown
): PipelineStatus {
  const now = Date.now();
  return {
    success: true,
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date(now).toISOString(),
    durationMs: now - startTime,
    config,
    costs,
  };
}

/**
 * Get number of top items to use for synthesis.
 * Defaults to 50 if not specified in config.
 */
function getTopScoredCount(config: PipelineConfig): number {
  return config.topScored ?? 50;
}

// ============================================
// Main Pipeline Function
// ============================================

/**
 * Options for pipeline execution.
 */
export interface PipelineOptions {
  /** Pre-created output directory path. If provided, skips directory creation. */
  outputDir?: string;
}

/**
 * Execute the full pipeline.
 *
 * Orchestrates all pipeline stages in order:
 * 1. Collection - Gather content from sources
 * 2. Validation - Verify quotes and claims
 * 3. Scoring - Score and rank content
 * 4. Synthesis - Generate LinkedIn post
 * 5. Image - Generate infographic (optional)
 *
 * @param prompt - User's topic/prompt for content generation
 * @param config - Pipeline configuration with all options
 * @param options - Optional pipeline execution options
 * @returns Pipeline result with outputs and metadata
 * @throws Error if any required stage fails (errors propagate to errorHandler)
 */
export async function runPipeline(
  prompt: string,
  config: PipelineConfig,
  options?: PipelineOptions
): Promise<PipelineResult> {
  // Enable verbose logging if configured
  setVerbose(config.verbose);

  // Initialize pipeline state
  const startTime = Date.now();
  // Use pre-created output directory if provided, otherwise create new one
  const outputWriter = options?.outputDir
    ? await createOutputWriterFromDir(options.outputDir)
    : await createOutputWriter(config.outputDir);

  const state: PipelineState = {
    startTime,
    outputWriter,
    currentStage: 'initialization',
  };

  logInfo(`Pipeline started for: "${prompt}"`);
  logVerbose(`Output directory: ${outputWriter.outputDir}`);

  // Stage 1: Collection
  const collection = await collectAll(prompt, config);

  if (config.saveRaw) {
    await state.outputWriter.writeRawData(collection.items);
    logVerbose('Saved raw_data.json');
  }

  // Stage 2: Validation
  state.currentStage = 'validation';
  const validatedItems = await validateItems(collection.items, prompt, config);
  await state.outputWriter.writeValidatedData(validatedItems);
  logVerbose(`Validated ${validatedItems.length} items`);

  // Stage 3: Scoring
  state.currentStage = 'scoring';
  logStage('Scoring');
  const scoredItems = await scoreItems(validatedItems, prompt, config);
  await state.outputWriter.writeScoredData(scoredItems);

  const topCount = getTopScoredCount(config);
  const topItems = scoredItems.slice(0, topCount);
  await state.outputWriter.writeTop50(topItems);
  logVerbose(`Scored ${scoredItems.length} items, top ${topItems.length} saved`);

  // Stage 4: Synthesis
  state.currentStage = 'synthesis';
  logStage('Synthesis');

  const claims = extractGroundedClaims(topItems);
  logVerbose(`Extracted ${claims.length} grounded claims`);

  if (claims.length === 0) {
    logWarning('No grounded claims extracted - synthesis may produce limited output');
  }

  const synthesis = await synthesize(claims, prompt, config);
  await state.outputWriter.writeSynthesis(synthesis);
  await state.outputWriter.writeLinkedInPost(synthesis.linkedinPost);
  logSuccess(`Generated LinkedIn post (${synthesis.linkedinPost.length} characters)`);

  state.synthesis = synthesis;
  state.costs = synthesis.metadata.estimatedCost;

  // Stage 5: Image Generation (optional, non-blocking)
  if (!config.skipImage) {
    state.currentStage = 'image';
    logStage('Image Generation');

    const image = await generateInfographic(synthesis.infographicBrief, config);

    if (image) {
      await state.outputWriter.writeInfographic(image);
      logSuccess(`Generated infographic (${image.length} bytes)`);
    } else {
      logWarning('Image generation returned null - continuing without infographic');
    }
  }

  // Write Provenance
  state.currentStage = 'provenance';
  const sources = buildSourceReferences(scoredItems, synthesis);
  await state.outputWriter.writeSources(sources);
  logVerbose(`Wrote provenance for ${sources.length} sources`);

  state.sources = sources;

  // Write Final Status
  const status = createSuccessStatus(config, startTime, state.costs);
  await state.outputWriter.writeStatus(status);

  // Log completion
  const durationMs = Date.now() - startTime;
  logPipelineResult(true, durationMs, outputWriter.outputDir);

  // Log costs if available
  if (state.costs) {
    logCost(state.costs);
  }

  // Return result with SourcesFile structure
  return {
    status,
    outputDir: outputWriter.outputDir,
    synthesis,
    sources: {
      schemaVersion: '1.0.0' as const,
      generatedAt: new Date().toISOString(),
      totalSources: sources.length,
      sources,
    },
  };
}

// Note: PipelineState is intentionally NOT exported - it is an internal
// implementation detail used only within runPipeline(). External code
// should use PipelineResult or PipelineStatus from types/index.ts instead.

/**
 * Pipeline Orchestration
 *
 * Main pipeline execution function that orchestrates all stages:
 * 0. Refinement - Analyze and optimize user prompt (optional)
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

import { readFileSync, existsSync } from 'fs';
import type {
  PipelineConfig,
  PipelineResult,
  PipelineStatus,
  SynthesisResult,
  SourceReference,
  CostBreakdown,
  ScoredItem,
} from '../types/index.js';
import type { LinkedInPost } from '../schemas/index.js';

// Stage imports
import { refinePrompt } from '../refinement/index.js';
import { collectAll } from '../collectors/index.js';
import { validateItems } from '../validation/perplexity.js';
import { score } from '../scoring/index.js';
import { extractGroundedClaims, synthesize, buildSourceReferences } from '../synthesis/index.js';
import { generateInfographic, generateMultipleInfographics } from '../image/index.js';

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

/**
 * Load scored items from a JSON file.
 * Used for resuming pipeline from scored_data.json.
 *
 * @param filePath - Path to scored_data.json
 * @returns Array of scored items
 * @throws Error if file doesn't exist or is invalid
 */
function loadScoredData(filePath: string): ScoredItem[] {
  if (!existsSync(filePath)) {
    throw new Error(`FATAL: Scored data file not found: ${filePath}`);
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as ScoredItem[];

    if (!Array.isArray(data)) {
      throw new Error('Scored data must be an array');
    }

    if (data.length === 0) {
      throw new Error('Scored data is empty');
    }

    logVerbose(`Loaded ${data.length} items from ${filePath}`);
    return data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`FATAL: Invalid JSON in scored data file: ${filePath}`);
    }
    throw error;
  }
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
 * 0. Refinement - Analyze and optimize user prompt (optional)
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

  // Make prompt mutable for potential refinement
  let currentPrompt = prompt;

  // Variables for pipeline stages
  let scoredItems: ScoredItem[];
  let topItems: ScoredItem[];
  const topCount = getTopScoredCount(config);

  // Check if resuming from scored data
  if (config.fromScored) {
    // Resume mode: skip stages 0-3, load scored data directly
    logInfo(`Resuming from scored data: ${config.fromScored}`);
    logStage('Loading Scored Data');

    scoredItems = loadScoredData(config.fromScored);
    topItems = scoredItems.slice(0, topCount);

    logSuccess(`Loaded ${scoredItems.length} scored items, using top ${topItems.length}`);
    logVerbose('Skipped: refinement, collection, validation, scoring');
  } else {
    // Normal mode: run all stages

    // Stage 0: Prompt Refinement
    if (!config.refinement.skip) {
      state.currentStage = 'refinement';
      logStage('Prompt Refinement');

      try {
        const refinementResult = await refinePrompt(prompt, config.refinement);
        currentPrompt = refinementResult.refinedPrompt;

        if (refinementResult.wasRefined) {
          logVerbose(`Prompt refined in ${refinementResult.processingTimeMs}ms`);
          logVerbose(`Original: "${refinementResult.originalPrompt}"`);
          logVerbose(`Refined: "${currentPrompt}"`);
        } else {
          logVerbose('Prompt used as-is (no refinement applied)');
        }
      } catch (error) {
        logWarning(`Refinement failed: ${error instanceof Error ? error.message : String(error)}`);
        logWarning('Continuing with original prompt');
        // Don't throw - refinement failure is non-fatal
      }
    }

    // Stage 1: Collection
    const collection = await collectAll(currentPrompt, config);

    if (config.saveRaw) {
      await state.outputWriter.writeRawData(collection.items);
      logVerbose('Saved raw_data.json');
    }

    // Stage 2: Validation
    state.currentStage = 'validation';
    const validatedItems = await validateItems(collection.items, currentPrompt, config);
    await state.outputWriter.writeValidatedData(validatedItems);
    logVerbose(`Validated ${validatedItems.length} items`);

    // Stage 3: Scoring
    state.currentStage = 'scoring';
    logStage('Scoring');
    scoredItems = await score(validatedItems, currentPrompt, config);
    await state.outputWriter.writeScoredData(scoredItems);

    topItems = scoredItems.slice(0, topCount);
    await state.outputWriter.writeTop50(topItems);
    logVerbose(`Scored ${scoredItems.length} items, top ${topItems.length} saved`);
  }

  // Stage 4: Synthesis (runs for both normal and resume modes)
  state.currentStage = 'synthesis';
  logStage('Synthesis');

  const claims = extractGroundedClaims(topItems);
  logVerbose(`Extracted ${claims.length} grounded claims`);

  if (claims.length === 0) {
    logWarning('No grounded claims extracted - synthesis may produce limited output');
  }

  const synthesis = await synthesize(claims, currentPrompt, config);
  await state.outputWriter.writeSynthesis(synthesis);

  // Handle post output based on multi-post mode
  if (synthesis.posts && synthesis.posts.length > 1) {
    await state.outputWriter.writeLinkedInPosts(synthesis.posts);
    logSuccess(`Generated ${synthesis.posts.length} LinkedIn posts`);
  } else {
    await state.outputWriter.writeLinkedInPost(synthesis.linkedinPost);
    logSuccess(`Generated LinkedIn post (${synthesis.linkedinPost.length} characters)`);
  }

  state.synthesis = synthesis;
  state.costs = synthesis.metadata.estimatedCost;

  // Stage 5: Image Generation (optional, non-blocking)
  if (!config.skipImage) {
    state.currentStage = 'image';
    logStage('Image Generation');

    if (synthesis.posts && synthesis.posts.length > 1) {
      // Multi-post: generate multiple infographics
      const imageResults = await generateMultipleInfographics(synthesis.posts, config);
      await state.outputWriter.writeInfographics(imageResults);

      const successCount = imageResults.filter((r) => r !== null).length;
      if (successCount > 0) {
        logSuccess(`Generated ${successCount}/${synthesis.posts.length} infographics`);
      } else {
        logWarning('All infographic generations failed');
      }
    } else {
      // Single post: backward compatible
      const image = await generateInfographic(synthesis.infographicBrief, config);

      if (image) {
        await state.outputWriter.writeInfographic(image);
        logSuccess(`Generated infographic (${image.length} bytes)`);
      } else {
        logWarning('Image generation returned null');
      }
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

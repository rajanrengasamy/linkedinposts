/**
 * Collector Orchestrator
 *
 * Main entry point for the data collection stage.
 * Runs collectors in parallel, handles partial failures,
 * and returns deduplicated results.
 *
 * See PRD Section 7.4
 */

import { searchWeb } from './web.js';
import { searchLinkedIn } from './linkedin.js';
import { searchTwitter } from './twitter.js';
import type { RawItem } from '../schemas/rawItem.js';
import type {
  PipelineConfig,
  CollectionResult,
  CollectionMetadata,
  SourceOption,
} from '../types/index.js';
import { deduplicate, type DeduplicationResult } from '../processing/dedup.js';
import {
  logStage,
  logProgress,
  logWarning,
  logVerbose,
  logSuccess,
  logInfo,
} from '../utils/logger.js';

// ============================================
// Types
// ============================================

/**
 * Collector function signature
 */
type CollectorFn = (query: string, config: PipelineConfig) => Promise<RawItem[]>;

/**
 * Collector definition with name and function
 */
interface Collector {
  name: SourceOption;
  fn: CollectorFn;
}

/**
 * Result from a single collector execution
 */
interface CollectorResult {
  name: SourceOption;
  items: RawItem[];
  error?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Apply maxPerSource limit to collector results.
 * Takes the first N items (collectors should return items in priority order).
 */
function applyMaxPerSource(items: RawItem[], limit: number): RawItem[] {
  if (limit <= 0 || items.length <= limit) {
    return items;
  }
  return items.slice(0, limit);
}

/**
 * Build list of collectors to run based on config.sources
 */
function buildCollectorList(config: PipelineConfig): Collector[] {
  const collectors: Collector[] = [];

  if (config.sources.includes('web')) {
    collectors.push({ name: 'web', fn: searchWeb });
  }

  if (config.sources.includes('linkedin')) {
    collectors.push({ name: 'linkedin', fn: searchLinkedIn });
  }

  if (config.sources.includes('x')) {
    collectors.push({ name: 'x', fn: searchTwitter });
  }

  return collectors;
}

/**
 * Process Promise.allSettled results into CollectorResult array.
 * Extracts items from fulfilled promises and errors from rejected ones.
 */
function processSettledResults(
  collectors: Collector[],
  results: PromiseSettledResult<RawItem[]>[]
): CollectorResult[] {
  return results.map((result, index) => {
    const collector = collectors[index];

    if (result.status === 'fulfilled') {
      return {
        name: collector.name,
        items: result.value,
      };
    } else {
      // Rejected - extract error message
      const errorMessage =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      return {
        name: collector.name,
        items: [],
        error: errorMessage,
      };
    }
  });
}

/**
 * Count items by source type
 */
function countBySource(items: RawItem[], source: SourceOption): number {
  return items.filter((item) => item.source === source).length;
}

// ============================================
// Main Orchestrator
// ============================================

/**
 * Collect data from all configured sources.
 *
 * Execution flow:
 * 1. Determine which collectors to run based on config.sources
 * 2. Run collectors in PARALLEL using Promise.allSettled
 * 3. Handle failures:
 *    - Web fails -> FATAL: throw error (required source)
 *    - LinkedIn/X fails -> log warning, continue with other sources
 * 4. Apply maxPerSource limit to each collector result BEFORE merging
 * 5. Merge results (each item already has source field from collector)
 * 6. Deduplicate merged results
 * 7. Apply maxTotal limit AFTER deduplication
 * 8. Return CollectionResult with items and metadata
 *
 * @param query - Search query / topic
 * @param config - Pipeline configuration
 * @returns Collection result with items and metadata
 * @throws Error if web collector fails (required source)
 */
export async function collectAll(
  query: string,
  config: PipelineConfig
): Promise<CollectionResult> {
  logStage('Data Collection');

  // Build list of sources for logging
  const sourceNames = config.sources.join(', ');
  logInfo(`Collecting from: ${sourceNames}`);

  const errors: string[] = [];
  const collectors = buildCollectorList(config);

  if (collectors.length === 0) {
    throw new Error('No sources configured. At least one source must be specified.');
  }

  // Log which collectors we're running
  logVerbose(`Running ${collectors.length} collector(s): ${collectors.map((c) => c.name).join(', ')}`);

  // Run all collectors in parallel
  const settledResults = await Promise.allSettled(
    collectors.map((collector) => collector.fn(query, config))
  );

  // Process results
  const collectorResults = processSettledResults(collectors, settledResults);

  // Check for web failure (FATAL) and process results
  const allItems: RawItem[] = [];

  for (const result of collectorResults) {
    if (result.error) {
      // Handle error based on source type
      if (result.name === 'web') {
        // Web is required - FATAL error
        const errorMsg = `Web collector failed: ${result.error}`;
        logWarning(errorMsg);
        throw new Error(errorMsg);
      } else {
        // LinkedIn/X are optional - log warning and continue
        const errorMsg = `${result.name} collector failed: ${result.error}`;
        logWarning(errorMsg);
        errors.push(errorMsg);
      }
    } else {
      // Apply maxPerSource limit before merging
      const limitedItems = applyMaxPerSource(result.items, config.maxPerSource);

      logProgress(
        limitedItems.length,
        result.items.length,
        `${result.name}: ${limitedItems.length} items (limited from ${result.items.length})`
      );

      allItems.push(...limitedItems);
    }
  }

  logVerbose(`Total items before deduplication: ${allItems.length}`);

  // Deduplicate merged results
  const dedupResult: DeduplicationResult = deduplicate(allItems);
  const duplicatesRemoved = dedupResult.totalRemoved;

  logVerbose(
    `Deduplication removed ${duplicatesRemoved} items (${dedupResult.hashDuplicatesRemoved} hash, ${dedupResult.similarityDuplicatesRemoved} similarity)`
  );

  // Apply maxTotal limit after deduplication
  let finalItems = dedupResult.items;
  if (config.maxTotal > 0 && finalItems.length > config.maxTotal) {
    logVerbose(`Applying maxTotal limit: ${finalItems.length} -> ${config.maxTotal}`);
    finalItems = finalItems.slice(0, config.maxTotal);
  }

  // CRITICAL: Fail if no valid items collected (PRD requirement: "All fail -> Exit with clear error")
  if (finalItems.length === 0) {
    const errorDetails =
      errors.length > 0
        ? `Collector errors: ${errors.join('; ')}`
        : 'All items failed schema validation';
    throw new Error(`No valid items collected. ${errorDetails}`);
  }

  // Update counts to reflect final items (after dedup and maxTotal)
  const finalWebCount = countBySource(finalItems, 'web');
  const finalLinkedinCount = countBySource(finalItems, 'linkedin');
  const finalXCount = countBySource(finalItems, 'x');

  // Build metadata
  const metadata: CollectionMetadata = {
    webCount: finalWebCount,
    linkedinCount: finalLinkedinCount,
    xCount: finalXCount,
    duplicatesRemoved,
    errors,
  };

  // Log final counts
  logSuccess(
    `Collection complete: ${finalItems.length} items (web: ${finalWebCount}, linkedin: ${finalLinkedinCount}, x: ${finalXCount})`
  );

  if (duplicatesRemoved > 0) {
    logInfo(`Duplicates removed: ${duplicatesRemoved}`);
  }

  if (errors.length > 0) {
    logInfo(`Non-fatal errors: ${errors.length}`);
  }

  return {
    items: finalItems,
    metadata,
  };
}

// ============================================
// Re-exports
// ============================================

// Re-export individual collectors for testing
export { searchWeb } from './web.js';
export { searchLinkedIn } from './linkedin.js';
export { searchTwitter } from './twitter.js';

// Re-export types (already defined in types/index.ts, just re-exporting for convenience)
export type { CollectionResult, CollectionMetadata };

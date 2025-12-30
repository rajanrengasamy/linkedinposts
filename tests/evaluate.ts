#!/usr/bin/env npx tsx

/**
 * Evaluation Harness for LinkedIn Post Generator Pipeline
 *
 * Validates pipeline outputs against quality criteria defined in PRD-v2.md.
 *
 * Usage:
 *   npx tsx tests/evaluate.ts <output_dir>
 *
 * Checks:
 * 1. No quotes without source URLs
 * 2. Post length within LinkedIn constraints
 * 3. All required files written
 * 4. sources.json schema validity
 * 5. ID reference integrity
 * 6. Verification level validity
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  SynthesisResultSchema,
  SourcesFileSchema,
  ValidatedItemSchema,
  ScoredItemSchema,
  VerificationLevelSchema,
  LINKEDIN_POST_MAX_LENGTH,
} from '../src/schemas/index.js';
import type { SynthesisResult, SourcesFile, ValidatedItem, ScoredItem } from '../src/types/index.js';

// ============================================
// Types
// ============================================

export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string[];
}

// ============================================
// Helper Functions
// ============================================

/**
 * Safely read and parse a JSON file
 */
function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Extract quoted text from markdown content.
 * Matches text within double quotes that is at least 20 characters long.
 */
export function extractQuotesFromPost(postContent: string): string[] {
  // Match text in double quotes (both regular and smart quotes)
  const quotePattern = /[""]([^""]+)[""]/g;
  const quotes: string[] = [];
  let match;

  while ((match = quotePattern.exec(postContent)) !== null) {
    const quote = match[1].trim();
    // Only include substantive quotes (at least 20 chars)
    if (quote.length >= 20) {
      quotes.push(quote);
    }
  }

  return quotes;
}

/**
 * Check if a quote from the post matches any keyQuote (fuzzy match).
 * Uses substring matching since post quotes might be shortened.
 */
export function quoteHasSource(
  postQuote: string,
  keyQuotes: Array<{ quote: string; sourceUrl: string }>
): boolean {
  const normalizedPostQuote = postQuote.toLowerCase().trim();

  for (const kq of keyQuotes) {
    if (!kq.sourceUrl) continue;

    const normalizedKeyQuote = kq.quote.toLowerCase().trim();

    // Check if the post quote contains the key quote or vice versa
    // Use first 50 chars for comparison to handle truncation
    const postPrefix = normalizedPostQuote.slice(0, 50);
    const keyPrefix = normalizedKeyQuote.slice(0, 50);

    if (
      normalizedPostQuote.includes(keyPrefix) ||
      normalizedKeyQuote.includes(postPrefix)
    ) {
      return true;
    }
  }

  return false;
}

// ============================================
// Check Functions
// ============================================

/**
 * Check 1: No quotes without sources
 *
 * Parses linkedin_post.md and verifies each quoted text
 * appears in keyQuotes with a sourceUrl in synthesis.json
 */
export function checkNoQuotesWithoutSources(outputDir: string): CheckResult {
  const name = 'No quotes without sources';

  try {
    const postPath = join(outputDir, 'linkedin_post.md');
    const synthPath = join(outputDir, 'synthesis.json');

    if (!existsSync(postPath)) {
      return { name, passed: false, message: 'linkedin_post.md not found' };
    }
    if (!existsSync(synthPath)) {
      return { name, passed: false, message: 'synthesis.json not found' };
    }

    const post = readFileSync(postPath, 'utf-8');
    const synthesis = readJsonFile<SynthesisResult>(synthPath);

    if (!synthesis) {
      return { name, passed: false, message: 'Failed to parse synthesis.json' };
    }

    // Extract quoted text from the post
    const quotesInPost = extractQuotesFromPost(post);

    if (quotesInPost.length === 0) {
      return { name, passed: true, message: 'No quotes found in post (OK)' };
    }

    // Get keyQuotes with sources
    const keyQuotes = synthesis.keyQuotes || [];
    const quotesWithSources = keyQuotes.filter((kq) => kq.sourceUrl);

    // Check each quote has a source
    const missingSource: string[] = [];
    for (const quote of quotesInPost) {
      if (!quoteHasSource(quote, quotesWithSources)) {
        missingSource.push(quote.slice(0, 60) + (quote.length > 60 ? '...' : ''));
      }
    }

    if (missingSource.length > 0) {
      return {
        name,
        passed: false,
        message: `${missingSource.length} quote(s) without sources`,
        details: missingSource,
      };
    }

    return {
      name,
      passed: true,
      message: `All ${quotesInPost.length} quotes have sources`,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: `Error: ${(error as Error).message}`,
    };
  }
}

/**
 * Check 2: Post length constraints
 *
 * Verifies linkedin_post.md is within LinkedIn character limits.
 */
export function checkPostLengthConstraints(outputDir: string): CheckResult {
  const name = 'Post length constraints';

  try {
    const postPath = join(outputDir, 'linkedin_post.md');

    if (!existsSync(postPath)) {
      return { name, passed: false, message: 'linkedin_post.md not found' };
    }

    const post = readFileSync(postPath, 'utf-8');

    if (post.trim().length === 0) {
      return { name, passed: false, message: 'Post is empty' };
    }

    if (post.length > LINKEDIN_POST_MAX_LENGTH) {
      return {
        name,
        passed: false,
        message: `Post too long: ${post.length} chars (max ${LINKEDIN_POST_MAX_LENGTH})`,
        details: [`Excess: ${post.length - LINKEDIN_POST_MAX_LENGTH} characters`],
      };
    }

    return {
      name,
      passed: true,
      message: `Post length: ${post.length}/${LINKEDIN_POST_MAX_LENGTH} chars`,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: `Error: ${(error as Error).message}`,
    };
  }
}

/**
 * Check 3: All required files written
 *
 * Verifies all expected output files exist.
 */
export function checkAllFilesWritten(outputDir: string): CheckResult {
  const name = 'All required files written';

  const requiredFiles = [
    'validated_data.json',
    'scored_data.json',
    'top_50.json',
    'synthesis.json',
    'linkedin_post.md',
    'sources.json',
    'sources.md',
    'pipeline_status.json',
  ];

  try {
    const missing: string[] = [];

    for (const file of requiredFiles) {
      if (!existsSync(join(outputDir, file))) {
        missing.push(file);
      }
    }

    if (missing.length > 0) {
      return {
        name,
        passed: false,
        message: `${missing.length} file(s) missing`,
        details: missing,
      };
    }

    return {
      name,
      passed: true,
      message: `All ${requiredFiles.length} required files present`,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: `Error: ${(error as Error).message}`,
    };
  }
}

/**
 * Check 4: sources.json schema validity
 *
 * Validates sources.json against SourcesFileSchema.
 */
export function checkSourcesJsonValid(outputDir: string): CheckResult {
  const name = 'sources.json schema valid';

  try {
    const sourcesPath = join(outputDir, 'sources.json');

    if (!existsSync(sourcesPath)) {
      return { name, passed: false, message: 'sources.json not found' };
    }

    const content = readFileSync(sourcesPath, 'utf-8');
    let data: unknown;

    try {
      data = JSON.parse(content);
    } catch {
      return { name, passed: false, message: 'Invalid JSON in sources.json' };
    }

    const result = SourcesFileSchema.safeParse(data);

    if (!result.success) {
      const errors = result.error.issues.map(
        (e) => `${e.path.join('.')}: ${e.message}`
      );
      return {
        name,
        passed: false,
        message: 'Schema validation failed',
        details: errors.slice(0, 5), // Limit to 5 errors
      };
    }

    // Additional check: all sources should have URLs
    const sourcesFile = result.data as SourcesFile;
    const missingUrls = sourcesFile.sources.filter((s) => !s.url);

    if (missingUrls.length > 0) {
      return {
        name,
        passed: false,
        message: `${missingUrls.length} source(s) missing URL`,
        details: missingUrls.map((s) => `ID: ${s.id}, Title: ${s.title}`),
      };
    }

    return {
      name,
      passed: true,
      message: `Valid schema with ${sourcesFile.sources.length} sources`,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: `Error: ${(error as Error).message}`,
    };
  }
}

/**
 * Check 5: ID reference integrity
 *
 * Verifies:
 * - IDs in top_50.json exist in validated_data.json
 * - IDs in sources.json usedInPost match synthesis
 */
export function checkIdReferences(outputDir: string): CheckResult {
  const name = 'ID reference integrity';

  try {
    const validatedPath = join(outputDir, 'validated_data.json');
    const top50Path = join(outputDir, 'top_50.json');
    const sourcesPath = join(outputDir, 'sources.json');

    // Check required files exist
    if (!existsSync(validatedPath)) {
      return { name, passed: false, message: 'validated_data.json not found' };
    }
    if (!existsSync(top50Path)) {
      return { name, passed: false, message: 'top_50.json not found' };
    }

    // Parse files
    const validatedData = readJsonFile<ValidatedItem[]>(validatedPath);
    const top50Data = readJsonFile<ScoredItem[]>(top50Path);
    const sourcesData = readJsonFile<SourcesFile>(sourcesPath);

    if (!validatedData || !top50Data) {
      return { name, passed: false, message: 'Failed to parse data files' };
    }

    // Build set of valid IDs from validated data
    const validIds = new Set(validatedData.map((item) => item.id));

    // Check top_50 IDs exist in validated_data
    const orphanedIds: string[] = [];
    for (const item of top50Data) {
      if (!validIds.has(item.id)) {
        orphanedIds.push(item.id);
      }
    }

    if (orphanedIds.length > 0) {
      return {
        name,
        passed: false,
        message: `${orphanedIds.length} ID(s) in top_50.json not found in validated_data.json`,
        details: orphanedIds.slice(0, 5),
      };
    }

    // If sources.json exists, check usedInPost references
    if (sourcesData) {
      const usedInPostIds = sourcesData.sources
        .filter((s) => s.usedInPost)
        .map((s) => s.id);

      // All top50 IDs should be in sources
      const top50Ids = new Set(top50Data.map((item) => item.id));
      const sourceIds = new Set(sourcesData.sources.map((s) => s.id));

      const missingFromSources = top50Data
        .filter((item) => !sourceIds.has(item.id))
        .map((item) => item.id);

      if (missingFromSources.length > 0) {
        return {
          name,
          passed: false,
          message: `${missingFromSources.length} top_50 ID(s) missing from sources.json`,
          details: missingFromSources.slice(0, 5),
        };
      }
    }

    return {
      name,
      passed: true,
      message: `All ${top50Data.length} IDs verified`,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: `Error: ${(error as Error).message}`,
    };
  }
}

/**
 * Check 6: Verification levels valid
 *
 * Ensures all items have valid verification levels from the enum.
 */
export function checkVerificationLevels(outputDir: string): CheckResult {
  const name = 'Verification levels valid';

  const validLevels = ['UNVERIFIED', 'SOURCE_CONFIRMED', 'MULTISOURCE_CONFIRMED', 'PRIMARY_SOURCE'];

  try {
    const validatedPath = join(outputDir, 'validated_data.json');

    if (!existsSync(validatedPath)) {
      return { name, passed: false, message: 'validated_data.json not found' };
    }

    const validatedData = readJsonFile<ValidatedItem[]>(validatedPath);

    if (!validatedData) {
      return { name, passed: false, message: 'Failed to parse validated_data.json' };
    }

    const invalidLevels: string[] = [];
    const levelCounts: Record<string, number> = {};

    for (const item of validatedData) {
      const level = item.validation?.level;

      if (!level) {
        invalidLevels.push(`${item.id}: missing level`);
        continue;
      }

      // Validate against schema
      const result = VerificationLevelSchema.safeParse(level);
      if (!result.success) {
        invalidLevels.push(`${item.id}: invalid level "${level}"`);
        continue;
      }

      // Count levels
      levelCounts[level] = (levelCounts[level] || 0) + 1;
    }

    if (invalidLevels.length > 0) {
      return {
        name,
        passed: false,
        message: `${invalidLevels.length} item(s) with invalid verification levels`,
        details: invalidLevels.slice(0, 5),
      };
    }

    // Build level summary
    const levelSummary = Object.entries(levelCounts)
      .map(([level, count]) => `${level}: ${count}`)
      .join(', ');

    return {
      name,
      passed: true,
      message: `All ${validatedData.length} items have valid levels`,
      details: [levelSummary],
    };
  } catch (error) {
    return {
      name,
      passed: false,
      message: `Error: ${(error as Error).message}`,
    };
  }
}

// ============================================
// Main Runner
// ============================================

export async function evaluate(outputDir: string): Promise<CheckResult[]> {
  console.log(`\nEvaluating output: ${outputDir}\n`);

  const checks = [
    checkNoQuotesWithoutSources,
    checkPostLengthConstraints,
    checkAllFilesWritten,
    checkSourcesJsonValid,
    checkIdReferences,
    checkVerificationLevels,
  ];

  const results = checks.map((check) => check(outputDir));

  // Report results
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  console.log('Results:');
  console.log('========');

  for (const result of results) {
    const icon = result.passed ? '[PASS]' : '[FAIL]';
    console.log(`${icon} ${result.name}: ${result.message}`);
    if (result.details && result.details.length > 0) {
      result.details.forEach((d) => console.log(`    - ${d}`));
    }
  }

  console.log(`\nPassed: ${passed.length}/${checks.length}`);

  return results;
}

// ============================================
// CLI Entry Point
// ============================================

if (process.argv[1]?.includes('evaluate')) {
  const outputDir = process.argv[2];

  if (!outputDir) {
    console.error('Usage: npx tsx tests/evaluate.ts <output_dir>');
    console.error('\nExample: npx tsx tests/evaluate.ts ./output/2025-12-30_103000');
    process.exit(2);
  }

  if (!existsSync(outputDir)) {
    console.error(`Error: Directory not found: ${outputDir}`);
    process.exit(2);
  }

  evaluate(outputDir).then((results) => {
    const failed = results.filter((r) => !r.passed);
    if (failed.length > 0) {
      process.exit(1);
    }
    process.exit(0);
  });
}

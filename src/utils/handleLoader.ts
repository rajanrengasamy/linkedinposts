/**
 * X/Twitter Handle Loader
 *
 * Parses X handles from a markdown file for the Twitter collector.
 * Supports category extraction and topic-based selection.
 *
 * File format: @handle (Display Name, description/tags)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { logVerbose, logWarning } from './logger.js';

// ============================================
// Types
// ============================================

/**
 * Parsed X/Twitter handle with metadata
 */
export interface XHandle {
  /** Handle without @ prefix (e.g., "karpathy") */
  handle: string;
  /** Display name (e.g., "Andrej Karpathy") */
  displayName: string;
  /** Description from the file (e.g., "ex-OpenAI/Tesla, deep learning expert") */
  description: string;
  /** Auto-extracted categories based on description keywords */
  categories: string[];
}

// ============================================
// Constants
// ============================================

/** Default path to X handles file */
export const DEFAULT_X_HANDLES_PATH = 'ref/x-handles.md';

/**
 * Category extraction rules
 * Maps keywords (case-insensitive) to category names
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  ai: ['ai', 'ml', 'llm', 'deep learning', 'machine learning', 'neural', 'gpt', 'transformer'],
  business: ['ceo', 'founder', 'president', 'executive', 'investor', 'business', 'entrepreneur'],
  research: ['researcher', 'professor', 'scientist', 'phd', 'academic', 'university', 'mit', 'stanford', 'berkeley'],
  industry: ['openai', 'anthropic', 'google', 'microsoft', 'meta', 'nvidia', 'deepmind', 'tesla', 'hugging face'],
  media: ['podcaster', 'influencer', 'author', 'communicator', 'educator'],
};

/**
 * Regex pattern to parse handle lines
 * Matches: @handle (Display Name, description)
 * Groups: 1=handle, 2=displayName, 3=description
 */
const HANDLE_LINE_REGEX = /^@(\w+)\s*\(([^,]+),\s*(.+)\)$/;

// ============================================
// Cache
// ============================================

/** Cache for loaded handles to avoid re-reading file */
const handleCache = new Map<string, XHandle[]>();

// ============================================
// Category Extraction
// ============================================

/**
 * Extract categories from a description string based on keyword matching.
 *
 * @param description - The description text to analyze
 * @returns Array of matched category names
 */
function extractCategories(description: string): string[] {
  const lowerDesc = description.toLowerCase();
  const categories: string[] = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerDesc.includes(keyword.toLowerCase())) {
        categories.push(category);
        break; // Only add each category once
      }
    }
  }

  return categories;
}

// ============================================
// Parsing
// ============================================

/**
 * Parse a single line from the handles file.
 *
 * @param line - Line to parse
 * @param lineNum - Line number for error reporting
 * @returns Parsed XHandle or null if line is invalid/comment
 */
function parseLine(line: string, lineNum: number): XHandle | null {
  const trimmed = line.trim();

  // Skip empty lines and comments
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const match = trimmed.match(HANDLE_LINE_REGEX);

  if (!match) {
    logWarning(`Skipping malformed line ${lineNum}: "${trimmed.substring(0, 50)}..."`);
    return null;
  }

  const [, handle, displayName, description] = match;
  const categories = extractCategories(description);

  return {
    handle: handle.trim(),
    displayName: displayName.trim(),
    description: description.trim(),
    categories,
  };
}

// ============================================
// Main Functions
// ============================================

/**
 * Load X handles from a markdown file.
 *
 * Uses synchronous file read for simplicity (handle files are small).
 * Results are cached to avoid re-reading the file on repeated calls.
 *
 * @param filepath - Path to the handles file (default: ref/x-handles.md)
 * @returns Array of parsed XHandle objects, empty if file doesn't exist
 */
export function loadXHandles(filepath?: string): XHandle[] {
  const resolvedPath = resolve(process.cwd(), filepath ?? DEFAULT_X_HANDLES_PATH);

  // Check cache first
  if (handleCache.has(resolvedPath)) {
    logVerbose(`Using cached handles from: ${resolvedPath}`);
    return handleCache.get(resolvedPath)!;
  }

  // Check if file exists
  if (!existsSync(resolvedPath)) {
    logWarning(`X handles file not found: ${resolvedPath}`);
    return [];
  }

  // Read and parse file
  const content = readFileSync(resolvedPath, 'utf-8');
  const lines = content.split('\n');
  const handles: XHandle[] = [];

  for (let i = 0; i < lines.length; i++) {
    const handle = parseLine(lines[i], i + 1);
    if (handle) {
      handles.push(handle);
    }
  }

  // Cache results
  handleCache.set(resolvedPath, handles);

  logVerbose(`Loaded ${handles.length} X handles from: ${resolvedPath}`);

  // Log category distribution in verbose mode
  const categoryCount = new Map<string, number>();
  for (const h of handles) {
    for (const cat of h.categories) {
      categoryCount.set(cat, (categoryCount.get(cat) ?? 0) + 1);
    }
  }
  const categoryInfo = Array.from(categoryCount.entries())
    .map(([cat, count]) => `${cat}:${count}`)
    .join(', ');
  if (categoryInfo) {
    logVerbose(`Handle categories: ${categoryInfo}`);
  }

  return handles;
}

/**
 * Clear the handle cache.
 * Useful for testing or when the file has been modified.
 */
export function clearHandleCache(): void {
  handleCache.clear();
  logVerbose('Handle cache cleared');
}

// ============================================
// Selection
// ============================================

/**
 * Calculate relevance score for a handle based on query.
 * Higher score = more relevant.
 *
 * @param handle - Handle to score
 * @param queryTerms - Lowercase query terms to match
 * @returns Relevance score (0 = no match)
 */
function calculateRelevance(handle: XHandle, queryTerms: string[]): number {
  let score = 0;
  const searchText = `${handle.displayName} ${handle.description}`.toLowerCase();

  for (const term of queryTerms) {
    // Direct text match
    if (searchText.includes(term)) {
      score += 2;
    }

    // Category match (check if term relates to any category)
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((kw) => kw.includes(term) || term.includes(kw))) {
        if (handle.categories.includes(category)) {
          score += 3; // Category match is weighted higher
        }
      }
    }
  }

  return score;
}

/**
 * Select handles most relevant to a given topic/query.
 *
 * Uses keyword matching and category analysis to rank handles
 * by relevance to the query.
 *
 * @param handles - Array of handles to select from
 * @param query - Topic or search query (e.g., "AI trends in healthcare")
 * @param maxHandles - Maximum number of handles to return (default: 10)
 * @returns Array of handles sorted by relevance, limited to maxHandles
 */
export function selectHandlesByTopic(
  handles: XHandle[],
  query: string,
  maxHandles: number = 10
): XHandle[] {
  if (handles.length === 0) {
    return [];
  }

  // Tokenize query into terms
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2); // Skip short words like "in", "the", etc.

  if (queryTerms.length === 0) {
    // No meaningful query terms, return first N handles
    logVerbose(`No meaningful query terms, returning first ${maxHandles} handles`);
    return handles.slice(0, maxHandles);
  }

  // Score all handles
  const scored = handles.map((handle) => ({
    handle,
    score: calculateRelevance(handle, queryTerms),
  }));

  // Sort by score descending, then by handle name for stability
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.handle.handle.localeCompare(b.handle.handle);
  });

  // Filter to only those with positive scores, or fall back to all if none match
  const withScores = scored.filter((s) => s.score > 0);
  const selected = withScores.length > 0 ? withScores : scored;

  // Return limited results
  const result = selected.slice(0, maxHandles).map((s) => s.handle);

  logVerbose(
    `Selected ${result.length} handles for query "${query}": ${result.map((h) => '@' + h.handle).join(', ')}`
  );

  return result;
}

/**
 * Get handles by specific category.
 *
 * @param handles - Array of handles to filter
 * @param category - Category to filter by (e.g., "ai", "business")
 * @returns Handles that have the specified category
 */
export function getHandlesByCategory(handles: XHandle[], category: string): XHandle[] {
  const lowerCategory = category.toLowerCase();
  return handles.filter((h) => h.categories.includes(lowerCategory));
}

/**
 * Get all unique categories from a set of handles.
 *
 * @param handles - Array of handles
 * @returns Array of unique category names
 */
export function getAllCategories(handles: XHandle[]): string[] {
  const categories = new Set<string>();
  for (const handle of handles) {
    for (const cat of handle.categories) {
      categories.add(cat);
    }
  }
  return Array.from(categories).sort();
}

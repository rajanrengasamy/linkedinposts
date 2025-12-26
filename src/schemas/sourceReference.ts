import { z } from 'zod';
import { SCHEMA_VERSION } from './rawItem.js';
import { VerificationLevelSchema, type VerificationLevel } from './validatedItem.js';
import type { ScoredItem } from './scoredItem.js';

/**
 * SourceReference Schema - Provenance tracking for outputs
 *
 * Each source used in the pipeline is tracked with its verification
 * status and whether it was used in the final LinkedIn post.
 * This enables full traceability from output back to original sources.
 */
export const SourceReferenceSchema = z.object({
  /** References RawItem.id - stable across pipeline */
  id: z.string(),

  /** Original URL where content was found */
  url: z.string().url(),

  /** Title of the source content */
  title: z.string(),

  /** Author of the source (if known) */
  author: z.string().optional(),

  /** When the content was originally published (ISO 8601) */
  publishedAt: z.string().datetime().optional(),

  /** When the content was retrieved by our pipeline (ISO 8601) */
  retrievedAt: z.string().datetime(),

  /** Verification level achieved for this source */
  verificationLevel: VerificationLevelSchema,

  /** Whether this source was quoted in the final LinkedIn post */
  usedInPost: z.boolean(),
});

export type SourceReference = z.infer<typeof SourceReferenceSchema>;

/**
 * Sources file schema for sources.json output
 */
export const SourcesFileSchema = z.object({
  /** Schema version */
  schemaVersion: z.literal(SCHEMA_VERSION),

  /** When the sources file was generated (ISO 8601) */
  generatedAt: z.string().datetime(),

  /** Total number of sources */
  totalSources: z.number().int().min(0),

  /** All sources with provenance data */
  sources: z.array(SourceReferenceSchema),
});

export type SourcesFile = z.infer<typeof SourcesFileSchema>;

/**
 * Build SourceReference from a ScoredItem
 */
export function buildSourceReference(
  item: ScoredItem,
  usedInPost: boolean
): SourceReference {
  return {
    id: item.id,
    url: item.sourceUrl,
    title: item.title || 'Untitled',
    author: item.author,
    publishedAt: item.publishedAt,
    retrievedAt: item.retrievedAt,
    verificationLevel: item.validation.level,
    usedInPost,
  };
}

/**
 * Group sources by verification level for display
 */
export function groupSourcesByLevel(
  sources: SourceReference[]
): Record<VerificationLevel, SourceReference[]> {
  const groups: Record<VerificationLevel, SourceReference[]> = {
    PRIMARY_SOURCE: [],
    MULTISOURCE_CONFIRMED: [],
    SOURCE_CONFIRMED: [],
    UNVERIFIED: [],
  };

  for (const source of sources) {
    groups[source.verificationLevel].push(source);
  }

  return groups;
}

/**
 * Generate markdown format for sources.md
 */
export function formatSourcesMarkdown(sourcesFile: SourcesFile): string {
  const lines: string[] = [
    '# Sources',
    '',
    `Generated: ${new Date(sourcesFile.generatedAt).toUTCString()}`,
    `Total Sources: ${sourcesFile.totalSources}`,
    `Used in Post: ${sourcesFile.sources.filter((s) => s.usedInPost).length}`,
    '',
  ];

  const grouped = groupSourcesByLevel(sourcesFile.sources);

  const levelLabels: Record<VerificationLevel, string> = {
    PRIMARY_SOURCE: 'Primary Sources',
    MULTISOURCE_CONFIRMED: 'Multi-Source Confirmed',
    SOURCE_CONFIRMED: 'Source Confirmed',
    UNVERIFIED: 'Unverified',
  };

  const levels: VerificationLevel[] = [
    'PRIMARY_SOURCE',
    'MULTISOURCE_CONFIRMED',
    'SOURCE_CONFIRMED',
    'UNVERIFIED',
  ];

  for (const level of levels) {
    const sources = grouped[level];
    if (sources.length === 0) continue;

    lines.push(`## ${levelLabels[level]} (${sources.length})`);
    lines.push('');

    sources.forEach((source, idx) => {
      const dateStr = source.publishedAt
        ? ` (${new Date(source.publishedAt).toLocaleDateString()})`
        : '';
      const authorStr = source.author ? ` - ${source.author}` : '';
      const usedStr = source.usedInPost ? ' *' : '';

      lines.push(`${idx + 1}. [${source.title}](${source.url})${authorStr}${dateStr}${usedStr}`);
    });

    lines.push('');
  }

  lines.push('---');
  lines.push('*\\* = Used in final LinkedIn post*');

  return lines.join('\n');
}

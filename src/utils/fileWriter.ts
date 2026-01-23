/**
 * File Writer with Provenance
 *
 * Handles all file output operations with optional schema validation.
 * Creates timestamped output directories for each pipeline run.
 *
 * SECURITY: Includes path traversal protection to prevent writing outside cwd.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import type { z } from 'zod';
import type { SourceReference, SourcesFile, LinkedInPost } from '../schemas/index.js';
import type { PipelineStatus } from '../types/index.js';
import {
  formatSourcesMarkdown,
  SourcesFileSchema,
  PipelineStatusSchema,
  SCHEMA_VERSION,
} from '../schemas/index.js';
import { logVerbose, logError } from './logger.js';
import { stripImageMetadata } from './imageMetadata.js';

// ============================================
// Path Security
// ============================================

/**
 * Validate that an output directory path does not escape the working directory.
 *
 * SECURITY: Prevents path traversal attacks where malicious input like
 * `../../sensitive-area` or absolute paths outside cwd could write files
 * to unintended locations.
 *
 * Allowed paths:
 * - Relative paths within cwd (e.g., './output', 'output/subdir')
 * - Absolute paths that resolve to within cwd or its subdirectories
 *
 * Rejected paths:
 * - Paths that escape cwd (e.g., '../outside', '../../etc')
 * - Absolute paths outside cwd (e.g., '/etc/passwd', '/tmp/malicious')
 *
 * @param userPath - The path provided by the user
 * @returns The validated path (unchanged if valid)
 * @throws Error if path traversal is detected
 */
export function validateOutputDir(userPath: string): string {
  const cwd = process.cwd();
  const absolutePath = resolve(cwd, userPath);
  const relativeToCwd = relative(cwd, absolutePath);

  // Check if path escapes cwd:
  // - Starts with '..' means it goes above cwd
  // - isAbsolute check catches edge cases on Windows
  if (relativeToCwd.startsWith('..') || isAbsolute(relativeToCwd)) {
    throw new Error(
      `Invalid output directory: path traversal detected. ` +
        `Path must be within the current working directory. ` +
        `Received: "${userPath}"`
    );
  }

  return userPath;
}

// ============================================
// Directory Management
// ============================================

/**
 * Generate a timestamped directory name
 * Format: YYYYMMDDTHHMMSS (UTC)
 */
function generateTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
}

/**
 * Ensure output directory exists, creating timestamped subdirectory.
 *
 * SECURITY: Validates the path to prevent path traversal attacks
 * before creating any directories.
 *
 * @param basePath - Base output directory (e.g., './output')
 * @returns Full path to the created timestamped directory
 * @throws Error if path traversal is detected
 */
export async function ensureOutputDir(basePath: string): Promise<string> {
  // SECURITY: Validate path before creating directory
  validateOutputDir(basePath);

  const timestamp = generateTimestamp();
  const outputDir = join(basePath, `session_${timestamp}`);

  await mkdir(outputDir, { recursive: true });
  logVerbose(`Created output directory: ${outputDir}`);

  return outputDir;
}

/**
 * Ensure parent directory exists for a file path
 */
async function ensureParentDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}

// ============================================
// JSON Writing
// ============================================

/**
 * Write JSON data to file with optional schema validation.
 *
 * @param filePath - Full path to output file
 * @param data - Data to write
 * @param schema - Optional Zod schema to validate before writing
 * @throws Error if validation fails or write fails
 */
export async function writeJSON<T>(
  filePath: string,
  data: T,
  schema?: z.ZodSchema<T>
): Promise<void> {
  // Validate if schema provided
  if (schema) {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = result.error.issues
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      throw new Error(`Validation failed before writing ${filePath}: ${errors}`);
    }
  }

  await ensureParentDir(filePath);

  const content = JSON.stringify(data, null, 2);
  await writeFile(filePath, content, 'utf-8');

  logVerbose(`Wrote JSON: ${filePath} (${content.length} bytes)`);
}

// ============================================
// Markdown Writing
// ============================================

/**
 * Write markdown content to file.
 *
 * @param filePath - Full path to output file
 * @param content - Markdown content to write
 */
export async function writeMarkdown(filePath: string, content: string): Promise<void> {
  await ensureParentDir(filePath);
  await writeFile(filePath, content, 'utf-8');

  logVerbose(`Wrote Markdown: ${filePath} (${content.length} bytes)`);
}

// ============================================
// Multi-Post Writing
// ============================================

/**
 * Format combined posts for multi-post output file.
 *
 * @param posts - Array of LinkedIn posts to combine
 * @returns Formatted markdown string with all posts
 */
function formatCombinedPosts(posts: LinkedInPost[]): string {
  const header = `# LinkedIn Posts\n\nGenerated: ${new Date().toISOString()}\nTotal: ${posts.length} posts\n\n---\n\n`;

  const sections = posts.map((post) => {
    const title = post.seriesTitle
      ? `## ${post.seriesTitle} - Part ${post.postNumber}/${post.totalPosts}`
      : `## Post ${post.postNumber} of ${post.totalPosts}`;
    return `${title}\n\n${post.linkedinPost}`;
  });

  return header + sections.join('\n\n---\n\n');
}

/**
 * Write LinkedIn posts to files.
 * Single post: linkedin_post.md
 * Multiple posts: linkedin_post_1.md, linkedin_post_2.md, linkedin_posts_combined.md
 *
 * @param outputDir - Directory to write files to
 * @param posts - Array of LinkedIn posts to write
 */
export async function writeLinkedInPosts(
  outputDir: string,
  posts: LinkedInPost[]
): Promise<void> {
  if (posts.length === 0) {
    logVerbose('No posts to write');
    return;
  }

  if (posts.length === 1) {
    await writeMarkdown(join(outputDir, 'linkedin_post.md'), posts[0].linkedinPost);
    return;
  }

  // Write individual files
  for (const post of posts) {
    await writeMarkdown(
      join(outputDir, `linkedin_post_${post.postNumber}.md`),
      post.linkedinPost
    );
  }

  // Write combined file
  const combined = formatCombinedPosts(posts);
  await writeMarkdown(join(outputDir, 'linkedin_posts_combined.md'), combined);

  logVerbose(`Wrote ${posts.length} LinkedIn posts`);
}

// ============================================
// Binary Writing
// ============================================

/**
 * Write binary PNG image to file.
 * Automatically strips metadata (EXIF, IPTC, etc.) to prevent AI-generation detection.
 *
 * @param filePath - Full path to output file
 * @param buffer - Image data as Buffer
 */
export async function writePNG(filePath: string, buffer: Buffer): Promise<void> {
  await ensureParentDir(filePath);

  // Strip metadata before writing to prevent AI-generation detection
  const cleanedBuffer = stripImageMetadata(buffer);

  await writeFile(filePath, cleanedBuffer);

  const originalSize = buffer.length;
  const cleanedSize = cleanedBuffer.length;
  const savedBytes = originalSize - cleanedSize;

  if (savedBytes > 0) {
    logVerbose(
      `Wrote PNG: ${filePath} (${cleanedSize} bytes, stripped ${savedBytes} bytes metadata)`
    );
  } else {
    logVerbose(`Wrote PNG: ${filePath} (${cleanedSize} bytes)`);
  }
}

/**
 * Write infographic images to files.
 * Single: infographic.png
 * Multiple: infographic_1.png, infographic_2.png, etc.
 *
 * @param outputDir - Directory to write files to
 * @param results - Array of infographic results (null entries are skipped)
 */
export async function writeInfographics(
  outputDir: string,
  results: Array<{ postNumber: number; buffer: Buffer } | null>
): Promise<void> {
  const valid = results.filter(
    (r): r is { postNumber: number; buffer: Buffer } => r !== null
  );

  if (valid.length === 0) {
    logVerbose('No infographics to write');
    return;
  }

  if (results.length === 1 && valid.length === 1) {
    await writePNG(join(outputDir, 'infographic.png'), valid[0].buffer);
    return;
  }

  for (const result of valid) {
    await writePNG(join(outputDir, `infographic_${result.postNumber}.png`), result.buffer);
  }

  logVerbose(`Wrote ${valid.length} infographics`);
}

// ============================================
// Provenance Files
// ============================================

/**
 * Write sources.json provenance file.
 *
 * @param filePath - Full path to sources.json
 * @param sources - Array of source references
 */
export async function writeSourcesJson(
  filePath: string,
  sources: SourceReference[]
): Promise<void> {
  const sourcesFile: SourcesFile = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    totalSources: sources.length,
    sources,
  };

  await writeJSON(filePath, sourcesFile, SourcesFileSchema);
}

/**
 * Write sources.md human-readable provenance file.
 *
 * @param filePath - Full path to sources.md
 * @param sources - Array of source references
 */
export async function writeSourcesMd(
  filePath: string,
  sources: SourceReference[]
): Promise<void> {
  // formatSourcesMarkdown expects a SourcesFile object
  const sourcesFile: SourcesFile = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    totalSources: sources.length,
    sources,
  };
  const markdown = formatSourcesMarkdown(sourcesFile);
  await writeMarkdown(filePath, markdown);
}

// ============================================
// Pipeline Status
// ============================================

/**
 * Write pipeline_status.json with run metadata.
 *
 * Validates the status object against PipelineStatusSchema before writing
 * to ensure consistent, debuggable output.
 *
 * @param filePath - Full path to pipeline_status.json
 * @param status - Pipeline status object
 */
export async function writePipelineStatus(
  filePath: string,
  status: PipelineStatus
): Promise<void> {
  await writeJSON(filePath, status, PipelineStatusSchema);
}

// ============================================
// Convenience Wrapper
// ============================================

/**
 * Output writer that manages paths within a run's output directory.
 */
export interface OutputWriter {
  readonly outputDir: string;

  writeRawData: <T>(data: T) => Promise<void>;
  writeValidatedData: <T>(data: T) => Promise<void>;
  writeScoredData: <T>(data: T) => Promise<void>;
  writeTop50: <T>(data: T) => Promise<void>;
  writeSynthesis: <T>(data: T) => Promise<void>;
  writeLinkedInPost: (content: string) => Promise<void>;
  writeInfographic: (buffer: Buffer) => Promise<void>;
  writeSources: (sources: SourceReference[]) => Promise<void>;
  writeStatus: (status: PipelineStatus) => Promise<void>;
  writeLinkedInPosts: (posts: LinkedInPost[]) => Promise<void>;
  writeInfographics: (results: Array<{ postNumber: number; buffer: Buffer } | null>) => Promise<void>;
}

/**
 * Create an output writer from an existing directory path.
 * Use this when the output directory has already been created.
 *
 * @param outputDir - Already-created output directory path
 * @returns OutputWriter with methods for each output file
 */
export function createOutputWriterFromDir(outputDir: string): OutputWriter {
  return {
    outputDir,

    writeRawData: async <T>(data: T) => {
      await writeJSON(join(outputDir, 'raw_data.json'), data);
    },

    writeValidatedData: async <T>(data: T) => {
      await writeJSON(join(outputDir, 'validated_data.json'), data);
    },

    writeScoredData: async <T>(data: T) => {
      await writeJSON(join(outputDir, 'scored_data.json'), data);
    },

    writeTop50: async <T>(data: T) => {
      await writeJSON(join(outputDir, 'top_50.json'), data);
    },

    writeSynthesis: async <T>(data: T) => {
      await writeJSON(join(outputDir, 'synthesis.json'), data);
    },

    writeLinkedInPost: async (content: string) => {
      await writeMarkdown(join(outputDir, 'linkedin_post.md'), content);
    },

    writeInfographic: async (buffer: Buffer) => {
      await writePNG(join(outputDir, 'infographic.png'), buffer);
    },

    writeSources: async (sources: SourceReference[]) => {
      await writeSourcesJson(join(outputDir, 'sources.json'), sources);
      await writeSourcesMd(join(outputDir, 'sources.md'), sources);
    },

    writeStatus: async (status: PipelineStatus) => {
      await writePipelineStatus(join(outputDir, 'pipeline_status.json'), status);
    },

    writeLinkedInPosts: async (posts: LinkedInPost[]) => {
      await writeLinkedInPosts(outputDir, posts);
    },

    writeInfographics: async (results: Array<{ postNumber: number; buffer: Buffer } | null>) => {
      await writeInfographics(outputDir, results);
    },
  };
}

/**
 * Create an output writer for a pipeline run.
 *
 * @param basePath - Base output directory
 * @returns OutputWriter with methods for each output file
 */
export async function createOutputWriter(basePath: string): Promise<OutputWriter> {
  const outputDir = await ensureOutputDir(basePath);
  return createOutputWriterFromDir(outputDir);
}

/**
 * Safe write wrapper that logs errors but doesn't throw.
 * Use for non-critical writes that shouldn't fail the pipeline.
 */
export async function safeWrite(
  writeFn: () => Promise<void>,
  description: string
): Promise<boolean> {
  try {
    await writeFn();
    return true;
  } catch (error) {
    const err = error as Error;
    logError(`Failed to write ${description}: ${err.message}`);
    return false;
  }
}

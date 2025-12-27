import { z } from 'zod';
import { CostBreakdownSchema } from './synthesisResult.js';

/**
 * Pipeline Status Schema
 *
 * Validates pipeline_status.json output for restartability and debugging.
 * Ensures all required fields are present and correctly typed.
 */

// ============================================
// Quality Profile Schema
// ============================================

export const QualityProfileSchema = z.enum(['fast', 'default', 'thorough']);
export type QualityProfile = z.infer<typeof QualityProfileSchema>;

// ============================================
// Image Resolution Schema
// ============================================

export const ImageResolutionSchema = z.enum(['2k', '4k']);
export type ImageResolution = z.infer<typeof ImageResolutionSchema>;

// ============================================
// Source Option Schema
// ============================================

export const SourceOptionSchema = z.enum(['web', 'linkedin', 'x']);
export type SourceOption = z.infer<typeof SourceOptionSchema>;

// ============================================
// Pipeline Config Schema
// ============================================

/**
 * Schema for PipelineConfig - validates the full configuration object
 */
export const PipelineConfigSchema = z.object({
  /** Data sources to query */
  sources: z.array(SourceOptionSchema),

  /** Skip Perplexity validation stage */
  skipValidation: z.boolean(),

  /** Skip Gemini scoring (use fallback heuristics) */
  skipScoring: z.boolean(),

  /** Skip infographic generation */
  skipImage: z.boolean(),

  /** Quality profile (affects limits and stages) */
  qualityProfile: QualityProfileSchema,

  /** Maximum items per source */
  maxPerSource: z.number().int().positive(),

  /** Maximum total items after deduplication */
  maxTotal: z.number().int().positive(),

  /** Batch size for validation requests */
  validationBatchSize: z.number().int().positive(),

  /** Batch size for scoring requests */
  scoringBatchSize: z.number().int().positive(),

  /** Pipeline timeout in seconds */
  timeoutSeconds: z.number().int().positive(),

  /** Image resolution for infographic */
  imageResolution: ImageResolutionSchema,

  /** Output directory path */
  outputDir: z.string().min(1),

  /** Save raw API responses */
  saveRaw: z.boolean(),

  /** Enable verbose logging */
  verbose: z.boolean(),

  /** Validate config and exit without running */
  dryRun: z.boolean(),
});

export type PipelineConfigValidated = z.infer<typeof PipelineConfigSchema>;

// ============================================
// Pipeline Status Schema
// ============================================

/**
 * Schema for pipeline_status.json
 *
 * Stores run metadata for:
 * - Debugging failed runs
 * - Resuming partial runs
 * - Cost analysis
 * - Reproducibility
 */
export const PipelineStatusSchema = z.object({
  /** Whether the pipeline completed successfully */
  success: z.boolean(),

  /** When the pipeline started (ISO 8601) */
  startedAt: z.string().datetime(),

  /** When the pipeline completed (ISO 8601, optional for failed runs) */
  completedAt: z.string().datetime().optional(),

  /** Total duration in milliseconds */
  durationMs: z.number().int().nonnegative().optional(),

  /** Current/last stage when pipeline stopped */
  stage: z.string().optional(),

  /** Error message if pipeline failed */
  error: z.string().optional(),

  /** Full resolved configuration used for this run */
  config: PipelineConfigSchema,

  /** Cost breakdown if available */
  costs: CostBreakdownSchema.optional(),
});

export type PipelineStatusValidated = z.infer<typeof PipelineStatusSchema>;

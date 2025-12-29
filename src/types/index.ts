/**
 * Type Definitions
 *
 * Re-exports all Zod-inferred types from schemas
 * and defines pipeline configuration interfaces.
 */

// ============================================
// Re-export all schema types
// ============================================

export type {
  // RawItem types
  SourceType,
  Engagement,
  RawItem,

  // ValidatedItem types
  VerificationLevel,
  QuoteVerified,
  Validation,
  ValidatedItem,

  // ScoredItem types
  Scores,
  ScoredItem,

  // SynthesisResult types
  InfographicStyle,
  KeyQuote,
  InfographicBrief,
  FactCheckSummary,
  CostBreakdown,
  SynthesisMetadata,
  SynthesisResult,

  // SourceReference types
  SourceReference,
  SourcesFile,

  // Validation result types
  ValidationResult,
  ParseResult,
} from '../schemas/index.js';

// ============================================
// Re-export Perplexity API types
// ============================================

export {
  PERPLEXITY_API_URL,
  PERPLEXITY_MODEL,
  type PerplexityResponse,
  type PerplexityRequestOptions,
} from './perplexity.js';

// ============================================
// Re-export Image Generation types
// ============================================

export {
  // Constants
  IMAGE_MODEL,
  IMAGE_MODEL_FALLBACK,
  RESOLUTION_TO_IMAGE_SIZE,
  // Types
  type ImageSizeOption,
  type ImageGenerationConfig,
  type GenerateInfographicOptions,
  type GeminiImageResponse,
} from './image.js';

// Re-export IMAGE_COSTS from authoritative source (utils/cost.ts)
export { IMAGE_COSTS } from '../utils/cost.js';

// ============================================
// Pipeline Configuration
// ============================================

/**
 * Quality profile names
 */
export type QualityProfile = 'fast' | 'default' | 'thorough';

/**
 * Image resolution options
 */
export type ImageResolution = '2k' | '4k';

/**
 * Source types that can be enabled
 */
export type SourceOption = 'web' | 'linkedin' | 'x';

/**
 * Pipeline configuration - parsed from CLI options
 */
export interface PipelineConfig {
  /** Data sources to query */
  sources: SourceOption[];

  /** Skip Perplexity validation stage */
  skipValidation: boolean;

  /** Skip Gemini scoring (use fallback heuristics) */
  skipScoring: boolean;

  /** Skip infographic generation */
  skipImage: boolean;

  /** Quality profile (affects limits and stages) */
  qualityProfile: QualityProfile;

  /** Maximum items per source */
  maxPerSource: number;

  /** Maximum total items after deduplication */
  maxTotal: number;

  /** Batch size for validation requests */
  validationBatchSize: number;

  /** Batch size for scoring requests */
  scoringBatchSize: number;

  /** Pipeline timeout in seconds */
  timeoutSeconds: number;

  /** Image resolution for infographic */
  imageResolution: ImageResolution;

  /** Output directory path */
  outputDir: string;

  /** Save raw API responses */
  saveRaw: boolean;

  /** Enable verbose logging */
  verbose: boolean;

  /** Validate config and exit without running */
  dryRun: boolean;

  /** Number of top-scored items to return (default: 50) */
  topScored?: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: PipelineConfig = {
  sources: ['web'],
  skipValidation: false,
  skipScoring: false,
  skipImage: false,
  qualityProfile: 'default',
  maxPerSource: 25,
  maxTotal: 75,
  validationBatchSize: 10,
  scoringBatchSize: 25,
  timeoutSeconds: 180,
  imageResolution: '2k',
  outputDir: './output',
  saveRaw: false,
  verbose: false,
  dryRun: false,
};

/**
 * Quality profile presets
 */
export const QUALITY_PROFILES: Record<QualityProfile, Partial<PipelineConfig>> = {
  fast: {
    maxTotal: 30,
    skipValidation: true,
    skipScoring: true,
    skipImage: true,
  },
  default: {
    maxTotal: 75,
    skipValidation: false,
    skipScoring: false,
    skipImage: false,
  },
  thorough: {
    maxTotal: 150,
    skipValidation: false,
    skipScoring: false,
    skipImage: false,
    imageResolution: '4k',
  },
};

// ============================================
// Pipeline Result Types
// ============================================

/**
 * Stage execution result
 */
export type StageResult<T> =
  | { success: true; data: T; durationMs: number }
  | { success: false; error: string; durationMs: number };

/**
 * Collection stage metadata
 *
 * Note: Uses 'xCount' to match source enum ('x'), not 'twitterCount'
 */
export interface CollectionMetadata {
  webCount: number;
  linkedinCount: number;
  xCount: number;
  duplicatesRemoved: number;
  errors: string[];
}

/**
 * Collection stage result
 */
export interface CollectionResult {
  items: import('../schemas/index.js').RawItem[];
  metadata: CollectionMetadata;
}

/**
 * Pipeline status for pipeline_status.json
 *
 * Stores the FULL resolved PipelineConfig (not Partial) to ensure:
 * 1. Runs are fully reproducible from saved status
 * 2. Debugging has complete context (quality profile, limits, flags)
 * 3. Cost analysis can correlate with exact settings used
 */
export interface PipelineStatus {
  success: boolean;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  stage?: string;
  error?: string;
  config: PipelineConfig;
  costs?: import('../schemas/index.js').CostBreakdown;
}

/**
 * Complete pipeline result
 */
export interface PipelineResult {
  status: PipelineStatus;
  outputDir: string;
  synthesis?: import('../schemas/index.js').SynthesisResult;
  sources?: import('../schemas/index.js').SourcesFile;
}

// ============================================
// API Concurrency Limits
// ============================================

/**
 * Maximum concurrent requests per API
 */
export const API_CONCURRENCY_LIMITS = {
  perplexity: 3,
  scrapeCreators: 5,
  gemini: 2,
  openai: 1,
  nanoBanana: 1,
} as const;

/**
 * Stage timeout in milliseconds
 */
export const STAGE_TIMEOUT_MS = 60000; // 60 seconds

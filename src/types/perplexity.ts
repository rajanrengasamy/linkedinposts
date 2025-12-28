/**
 * Perplexity API Types and Constants
 *
 * Shared definitions for Perplexity API interactions used by both
 * collectors (web.ts) and validation (perplexity.ts).
 */

// ============================================
// Constants
// ============================================

/**
 * Perplexity API endpoint for chat completions
 */
export const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

/**
 * Default model for Perplexity API requests
 * sonar-reasoning-pro provides web search with citations
 */
export const PERPLEXITY_MODEL = 'sonar-reasoning-pro';

// ============================================
// Types
// ============================================

/**
 * Perplexity API response structure for chat completions.
 *
 * This interface represents the response from the Perplexity API
 * when making chat completion requests with the sonar models.
 */
export interface PerplexityResponse {
  /** Unique response identifier */
  id: string;

  /** Model used for generation */
  model: string;

  /** Response choices array */
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;

  /** Citation URLs from the response (if any) */
  citations?: string[];

  /** Token usage statistics */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Options for Perplexity API requests.
 *
 * Configuration for making requests to the Perplexity API,
 * including timeout and logging options.
 */
export interface PerplexityRequestOptions {
  /** Request timeout in milliseconds (default: 60000) */
  timeoutMs?: number;

  /** Operation name for logging */
  operationName?: string;
}

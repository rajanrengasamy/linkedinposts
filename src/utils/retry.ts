/**
 * Retry with Exponential Backoff
 *
 * Provides robust retry logic for API calls with:
 * - Exponential backoff with jitter
 * - Rate limit (429) detection
 * - Configurable retry conditions
 * - Verbose logging support
 */

import { logVerbose, logWarning } from './logger.js';

// ============================================
// Types
// ============================================

/**
 * Options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;

  /** Initial delay in milliseconds (default: 1000) */
  baseDelayMs: number;

  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;

  /**
   * Function to determine if an error should trigger a retry.
   * Default: retries on rate limits (429) and server errors (5xx)
   */
  retryOn?: (error: Error) => boolean;

  /** Operation name for logging */
  operationName?: string;
}

/**
 * Default retry options
 */
export const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'operationName'>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryOn: defaultRetryCondition,
};

/**
 * Result of a retry operation
 */
export type RetryResult<T> =
  | { success: true; data: T; attempts: number }
  | { success: false; error: Error; attempts: number };

// ============================================
// Error Detection
// ============================================

/**
 * Check if an error is a rate limit error (HTTP 429)
 */
export function isRateLimitError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Check for common rate limit indicators
  if (message.includes('429') || message.includes('rate limit')) {
    return true;
  }

  // Check for axios/fetch style error objects
  const anyError = error as unknown as Record<string, unknown>;
  if (anyError.status === 429 || anyError.statusCode === 429) {
    return true;
  }

  // Check nested response objects
  if (
    anyError.response &&
    typeof anyError.response === 'object' &&
    (anyError.response as Record<string, unknown>).status === 429
  ) {
    return true;
  }

  return false;
}

/**
 * Check if an error is a server error (5xx)
 */
export function isServerError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Check for common 5xx patterns
  if (/\b5\d{2}\b/.test(message) || message.includes('server error')) {
    return true;
  }

  // Check for axios/fetch style error objects
  const anyError = error as unknown as Record<string, unknown>;
  const status = (anyError.status ?? anyError.statusCode) as number | undefined;
  if (status && status >= 500 && status < 600) {
    return true;
  }

  // Check nested response
  if (anyError.response && typeof anyError.response === 'object') {
    const respStatus = (anyError.response as Record<string, unknown>).status as number | undefined;
    if (respStatus && respStatus >= 500 && respStatus < 600) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an error is a network/connection error
 */
export function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();

  const networkPatterns = [
    'econnrefused',
    'enotfound',
    'econnreset',
    'etimedout',
    'network',
    'socket hang up',
    'fetch failed',
  ];

  return networkPatterns.some((pattern) => message.includes(pattern));
}

/**
 * Default retry condition: retry on rate limits, server errors, and network errors
 */
function defaultRetryCondition(error: Error): boolean {
  return isRateLimitError(error) || isServerError(error) || isNetworkError(error);
}

// ============================================
// Delay Calculation
// ============================================

/**
 * Calculate delay with exponential backoff and jitter.
 *
 * Formula: min(maxDelay, baseDelay * 2^attempt * (1 + random jitter))
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay cap
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  // Exponential: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // Add jitter (±25%)
  const jitter = 0.75 + Math.random() * 0.5;
  const delayWithJitter = exponentialDelay * jitter;

  // Cap at maxDelay
  return Math.min(delayWithJitter, maxDelayMs);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// Main Retry Function
// ============================================

/**
 * Execute a function with retry logic and exponential backoff.
 *
 * @param fn - Async function to execute
 * @param options - Retry options
 * @returns Promise with result or error after all retries exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchFromApi(url),
 *   { maxRetries: 3, operationName: 'API fetch' }
 * );
 *
 * if (result.success) {
 *   console.log('Data:', result.data);
 * } else {
 *   console.error('Failed after retries:', result.error);
 * }
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<RetryResult<T>> {
  const opts: Required<Omit<RetryOptions, 'operationName'>> & { operationName?: string } = {
    ...DEFAULT_RETRY_OPTIONS,
    ...options,
  };

  const { maxRetries, baseDelayMs, maxDelayMs, retryOn, operationName } = opts;
  const opName = operationName ?? 'operation';

  let lastError: Error = new Error('No attempts made');
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;

    try {
      const result = await fn();
      return { success: true, data: result, attempts };
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      const shouldRetry = attempt < maxRetries && retryOn(lastError);

      if (!shouldRetry) {
        // Either max retries reached or error not retryable
        if (attempt >= maxRetries) {
          logVerbose(`${opName}: Max retries (${maxRetries}) reached`);
        } else {
          logVerbose(`${opName}: Error not retryable: ${lastError.message}`);
        }
        break;
      }

      // Calculate and apply backoff delay
      const delay = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs);

      // Log retry attempt
      const isRateLimit = isRateLimitError(lastError);
      if (isRateLimit) {
        logWarning(
          `${opName}: Rate limited (429). Retrying in ${Math.round(delay / 1000)}s... ` +
            `(attempt ${attempt + 1}/${maxRetries + 1})`
        );
      } else {
        logVerbose(
          `${opName}: Attempt ${attempt + 1} failed: ${lastError.message}. ` +
            `Retrying in ${Math.round(delay)}ms...`
        );
      }

      await sleep(delay);
    }
  }

  return { success: false, error: lastError, attempts };
}

/**
 * Execute a function with retry, throwing on failure.
 * Use this when you want exceptions rather than result types.
 *
 * @param fn - Async function to execute
 * @param options - Retry options
 * @returns Promise with result
 * @throws Error if all retries fail
 */
export async function withRetryThrow<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  const result = await withRetry(fn, options);

  if (result.success) {
    return result.data;
  }

  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  throw new Error(
    `${opts.operationName ?? 'Operation'} failed after ${result.attempts} attempts: ${result.error.message}`
  );
}

// ============================================
// Specialized Retry Presets
// ============================================

/**
 * Retry options optimized for rate-limited APIs
 * - Longer delays
 * - More retries
 * - Only retries on rate limits
 */
export const RATE_LIMIT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 5,
  baseDelayMs: 5000,
  maxDelayMs: 60000,
  retryOn: isRateLimitError,
};

/**
 * Retry options for quick operations
 * - Fewer retries
 * - Shorter delays
 */
export const QUICK_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  retryOn: defaultRetryCondition,
};

/**
 * Retry options for critical operations
 * - More retries
 * - Moderate delays
 */
export const CRITICAL_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 5,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
  retryOn: defaultRetryCondition,
};

// ============================================
// Timeout Utilities
// ============================================

/**
 * Custom error class for timeout failures
 */
export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs: number
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Result of a timeout-wrapped operation
 */
export type TimeoutResult<T> =
  | { success: true; data: T; durationMs: number }
  | { success: false; error: TimeoutError; durationMs: number };

/**
 * Execute a function with a timeout.
 *
 * If the function completes within the timeout, returns the result.
 * If the timeout expires, rejects with a TimeoutError.
 *
 * IMPORTANT: This does NOT abort the underlying operation - it only
 * stops waiting for it. For true cancellation, the operation must
 * support AbortController/AbortSignal.
 *
 * @param fn - Async function to execute
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param operationName - Name for error messages
 * @returns Promise with the function result
 * @throws TimeoutError if timeout expires
 *
 * @example
 * ```typescript
 * try {
 *   const result = await withTimeout(
 *     () => fetchData(url),
 *     60000,
 *     'Data fetch'
 *   );
 * } catch (error) {
 *   if (error instanceof TimeoutError) {
 *     console.log('Operation timed out after', error.timeoutMs, 'ms');
 *   }
 * }
 * ```
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  operationName?: string
): Promise<T> {
  const opName = operationName ?? 'Operation';

  return new Promise<T>((resolve, reject) => {
    let completed = false;
    const startTime = Date.now();

    // Set up the timeout
    const timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        reject(
          new TimeoutError(
            `${opName} timed out after ${timeoutMs}ms`,
            timeoutMs
          )
        );
      }
    }, timeoutMs);

    // Execute the function
    fn()
      .then((result) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          resolve(result);
        }
      })
      .catch((error) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          reject(error);
        }
      });
  });
}

/**
 * Execute a function with timeout, returning a result type instead of throwing.
 *
 * @param fn - Async function to execute
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param operationName - Name for error messages
 * @returns TimeoutResult with either data or timeout error
 */
export async function withTimeoutResult<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  operationName?: string
): Promise<TimeoutResult<T>> {
  const startTime = Date.now();

  try {
    const data = await withTimeout(fn, timeoutMs, operationName);
    return {
      success: true,
      data,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof TimeoutError) {
      return {
        success: false,
        error,
        durationMs: Date.now() - startTime,
      };
    }
    // Re-throw non-timeout errors
    throw error;
  }
}

/**
 * Combine retry logic with timeout.
 *
 * Each individual attempt is subject to the timeout.
 * Retries continue if timeout occurs and retry conditions are met.
 *
 * @param fn - Async function to execute
 * @param timeoutMs - Timeout per attempt in milliseconds
 * @param retryOptions - Retry configuration
 * @returns Promise with retry result
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  retryOptions?: Partial<RetryOptions>
): Promise<RetryResult<T>> {
  // Wrap the function with timeout
  const timedFn = () => withTimeout(fn, timeoutMs, retryOptions?.operationName);

  // Configure retry to also retry on timeout errors
  const opts: Partial<RetryOptions> = {
    ...retryOptions,
    retryOn: (error: Error) => {
      // Retry on timeout
      if (error instanceof TimeoutError) {
        return true;
      }
      // Also use default retry condition
      const defaultCheck = retryOptions?.retryOn ?? defaultRetryCondition;
      return defaultCheck(error);
    },
  };

  return withRetry(timedFn, opts);
}

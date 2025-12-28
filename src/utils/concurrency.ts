/**
 * Concurrency Control Utilities
 *
 * Generic utilities for managing concurrent async operations
 * with configurable limits and order preservation.
 */

/**
 * Process items with concurrency control.
 *
 * Limits the number of concurrent async operations while preserving
 * the original order of results. Useful for managing API rate limits
 * and resource constraints.
 *
 * @template T - Type of input items
 * @template R - Type of result items
 * @param items - Array of items to process
 * @param fn - Async function to apply to each item
 * @param concurrency - Maximum number of concurrent operations (default: 3)
 * @returns Promise resolving to array of results in original order
 *
 * @example
 * ```typescript
 * const urls = ['url1', 'url2', 'url3', 'url4', 'url5'];
 * const results = await processWithConcurrency(
 *   urls,
 *   async (url) => fetch(url).then(r => r.json()),
 *   2 // Max 2 concurrent requests
 * );
 * // Results are in same order as input urls
 * ```
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = 3
): Promise<R[]> {
  // Handle edge cases
  if (items.length === 0) {
    return [];
  }

  // Ensure concurrency is at least 1
  const effectiveConcurrency = Math.max(1, concurrency);

  // Pre-allocate results array to preserve order
  const results: R[] = new Array(items.length);

  // Shared index for worker coordination
  let currentIndex = 0;

  /**
   * Worker function that processes items until none remain.
   * Each worker grabs the next available item atomically.
   */
  async function processNext(): Promise<void> {
    while (currentIndex < items.length) {
      // Atomically grab the next index
      const index = currentIndex++;
      // Process the item and store result at original position
      results[index] = await fn(items[index]);
    }
  }

  // Start concurrent workers up to the concurrency limit
  const workerCount = Math.min(effectiveConcurrency, items.length);
  const workers = Array(workerCount)
    .fill(null)
    .map(() => processNext());

  // Wait for all workers to complete
  await Promise.all(workers);

  return results;
}

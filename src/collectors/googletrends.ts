/**
 * Google Trends Collector - PyTrends Subprocess
 *
 * OPTIONAL data source with WARNING mechanism. Non-fatal on failure.
 * Spawns a Python subprocess that uses PyTrends to collect trend data.
 *
 * Collects: daily trends, related queries, top queries.
 *
 * Prerequisites:
 *   pip install pytrends
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { RawItemSchema } from '../schemas/rawItem.js';
import type { RawItem } from '../schemas/rawItem.js';
import type { PipelineConfig } from '../types/index.js';
import { logVerbose, logWarning, logInfo } from '../utils/logger.js';

// ============================================
// Constants
// ============================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.resolve(__dirname, '../../python/trends_collector.py');
const TIMEOUT_MS = 60000; // 60 seconds
const DEFAULT_GEO = 'US';

// ============================================
// Types
// ============================================

interface PyTrendsRequest {
  query: string;
  geo: string;
  maxResults: number;
}

interface PyTrendsResponse {
  items: unknown[];
  error?: string;
}

// ============================================
// Subprocess Communication
// ============================================

/**
 * Call the Python trends collector script via subprocess.
 * Sends request via stdin, receives response via stdout.
 */
async function callPythonScript(request: PyTrendsRequest): Promise<PyTrendsResponse> {
  return new Promise((resolve) => {
    // Try python3 first, then fall back to python
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    const python = spawn(pythonCmd, [PYTHON_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // Timeout handler
    const timeout = setTimeout(() => {
      python.kill('SIGTERM');
      resolve({ items: [], error: 'PyTrends timeout after 60s' });
    }, TIMEOUT_MS);

    python.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    python.on('close', (code: number | null) => {
      clearTimeout(timeout);

      if (code !== 0) {
        logVerbose(`PyTrends stderr: ${stderr}`);
        resolve({
          items: [],
          error: `Process exited with code ${code}${stderr ? ': ' + stderr.slice(0, 200) : ''}`,
        });
        return;
      }

      try {
        const response = JSON.parse(stdout) as PyTrendsResponse;
        resolve(response);
      } catch {
        logVerbose(`PyTrends invalid JSON output: ${stdout.slice(0, 200)}`);
        resolve({ items: [], error: 'Invalid JSON response from Python script' });
      }
    });

    python.on('error', (err: Error) => {
      clearTimeout(timeout);
      logVerbose(`PyTrends spawn error: ${err.message}`);

      if (err.message.includes('ENOENT')) {
        resolve({
          items: [],
          error: `Python not found. Ensure python3 is installed and in PATH.`,
        });
      } else {
        resolve({ items: [], error: `Spawn error: ${err.message}` });
      }
    });

    // Send request via stdin and close
    python.stdin.write(JSON.stringify(request));
    python.stdin.end();
  });
}

// ============================================
// Main Export
// ============================================

/**
 * Collect data from Google Trends using PyTrends subprocess.
 *
 * OPTIONAL data source with WARNING mechanism. Non-fatal on failure.
 * If collection fails, logs a warning and returns empty array.
 *
 * The Python script (python/trends_collector.py) handles:
 * - Trending searches (current hot topics)
 * - Rising queries (rapidly increasing searches)
 * - Top related queries (established related searches)
 *
 * @param query - Search query/topic
 * @param config - Pipeline configuration
 * @returns Array of RawItem objects validated against schema
 */
export async function searchGoogleTrends(
  query: string,
  config: PipelineConfig
): Promise<RawItem[]> {
  // Gate check: Only run if googletrends is in sources
  if (!config.sources.includes('googletrends')) {
    logVerbose('GoogleTrends: Source not enabled, skipping');
    return [];
  }

  logInfo(`GoogleTrends: Fetching trends for "${query}" via PyTrends subprocess`);

  const response = await callPythonScript({
    query,
    geo: DEFAULT_GEO,
    maxResults: config.maxPerSource,
  });

  // Handle errors gracefully
  if (response.error) {
    logWarning(`⚠ Google Trends failed: ${response.error}`);
    logWarning('  Pipeline will continue with other sources.');
    return [];
  }

  // Validate each item with Zod
  const validItems: RawItem[] = [];
  for (const item of response.items) {
    const result = RawItemSchema.safeParse(item);
    if (result.success) {
      validItems.push(result.data);
    } else {
      logVerbose(`GoogleTrends: Item failed validation: ${result.error.message}`);
    }
  }

  logVerbose(`GoogleTrends: Retrieved ${validItems.length} valid items`);
  return validItems;
}

export { searchGoogleTrends as default };

/**
 * CLI Tool Detection Utilities
 *
 * Detects which CLI tools (claude, gemini, codex, opencode) are available
 * on the system. Uses environment variables for custom paths, falls back
 * to PATH lookup.
 *
 * Results are cached for the session duration.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import type { CLITool, CLIDetectionResult } from './types.js';
import { CLI_PATH_ENV_VARS, CLI_MODE_ENV_VARS } from './types.js';
import { logVerbose, logWarning } from '../utils/logger.js';

// ============================================
// Detection Cache
// ============================================

/**
 * Cache for CLI detection results to avoid repeated lookups.
 */
const detectionCache = new Map<CLITool, CLIDetectionResult>();

// ============================================
// Version Flag Constants
// ============================================

/**
 * Version flags for each CLI tool.
 */
const VERSION_FLAGS: Record<CLITool, string> = {
  claude: '--version',
  gemini: '--version',
  codex: '--version',
  opencode: '--version',
};

// ============================================
// Internal Helper Functions
// ============================================

/**
 * Find CLI executable path.
 * 1. Check environment variable for custom path
 * 2. Fall back to `which` command for PATH lookup
 *
 * @param tool - CLI tool to find
 * @returns Absolute path to CLI or null if not found
 */
function findCLIPath(tool: CLITool): string | null {
  // Check env var first
  const envVar = CLI_PATH_ENV_VARS[tool];
  const envPath = process.env[envVar];

  if (envPath && existsSync(envPath)) {
    logVerbose(`Found ${tool} CLI at custom path: ${envPath}`);
    return envPath;
  }

  if (envPath && !existsSync(envPath)) {
    logWarning(`${envVar} set to '${envPath}' but file does not exist`);
  }

  // Fall back to PATH lookup
  try {
    const result = execSync(`which ${tool}`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (result && existsSync(result)) {
      logVerbose(`Found ${tool} CLI in PATH: ${result}`);
      return result;
    }
  } catch {
    // which command failed - CLI not in PATH
  }

  return null;
}

/**
 * Get CLI version by running --version flag.
 *
 * @param path - Absolute path to CLI executable
 * @param tool - CLI tool identifier
 * @returns Version string or null if unable to determine
 */
function getVersionString(path: string, tool: CLITool): string | null {
  try {
    const flag = VERSION_FLAGS[tool];
    const result = execSync(`"${path}" ${flag}`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Extract version number (first line, or first match of semver-like pattern)
    const firstLine = result.split('\n')[0];
    const versionMatch = firstLine.match(/\d+\.\d+(\.\d+)?/);
    return versionMatch ? versionMatch[0] : firstLine.slice(0, 50);
  } catch {
    return null;
  }
}

// ============================================
// Public Detection Functions
// ============================================

/**
 * Detect if a specific CLI tool is available.
 * Results are cached for session duration.
 *
 * @param tool - CLI tool to detect
 * @returns Detection result with availability status
 */
export function detectCLI(tool: CLITool): CLIDetectionResult {
  // Return cached result if available
  if (detectionCache.has(tool)) {
    return detectionCache.get(tool)!;
  }

  const path = findCLIPath(tool);

  if (!path) {
    const result: CLIDetectionResult = {
      available: false,
      path: null,
      version: null,
      error: `CLI '${tool}' not found`,
    };
    detectionCache.set(tool, result);
    return result;
  }

  const version = getVersionString(path, tool);

  const result: CLIDetectionResult = {
    available: true,
    path,
    version,
  };

  detectionCache.set(tool, result);
  logVerbose(`Detected ${tool} CLI: v${version || 'unknown'} at ${path}`);
  return result;
}

/**
 * Detect all CLI tools and return results.
 *
 * @returns Record of detection results for all CLI tools
 */
export function detectAllCLIs(): Record<CLITool, CLIDetectionResult> {
  const tools: CLITool[] = ['claude', 'gemini', 'codex', 'opencode'];
  const results = {} as Record<CLITool, CLIDetectionResult>;

  for (const tool of tools) {
    results[tool] = detectCLI(tool);
  }

  return results;
}

/**
 * Check if a CLI tool is available.
 *
 * @param tool - CLI tool to check
 * @returns true if available, false otherwise
 */
export function isCLIAvailable(tool: CLITool): boolean {
  return detectCLI(tool).available;
}

/**
 * Get CLI path if available.
 *
 * @param tool - CLI tool
 * @returns Absolute path to CLI or null if not available
 */
export function getCLIPath(tool: CLITool): string | null {
  return detectCLI(tool).path;
}

/**
 * Get CLI version if available.
 *
 * @param tool - CLI tool
 * @returns Version string or null if not available
 */
export function getCLIVersion(tool: CLITool): string | null {
  return detectCLI(tool).version;
}

/**
 * Check if CLI mode is enabled via environment variable.
 *
 * Default behavior:
 * - opencode: disabled (false) - must be explicitly enabled
 * - claude/gemini/codex: enabled (true) - can be explicitly disabled
 *
 * @param tool - CLI tool to check
 * @returns true if enabled, false if disabled
 */
export function isCLIModeEnabled(tool: CLITool): boolean {
  const envVar = CLI_MODE_ENV_VARS[tool];
  const value = process.env[envVar];

  // Default: opencode is false, others are true
  const defaultValue = tool === 'opencode' ? false : true;

  if (value === undefined || value === '') {
    return defaultValue;
  }

  return value.toLowerCase() === 'true';
}

/**
 * Clear the detection cache.
 * Useful for testing or when environment changes.
 */
export function clearDetectionCache(): void {
  detectionCache.clear();
}

/**
 * Alias for clearDetectionCache for backward compatibility.
 * @deprecated Use clearDetectionCache instead
 */
export const clearCLICache = clearDetectionCache;

/**
 * Log status of all CLI tools to console.
 * Useful for debugging and status display.
 */
export function logCLIStatus(): void {
  const results = detectAllCLIs();

  console.log('\nCLI Tool Status:');
  for (const [tool, result] of Object.entries(results)) {
    const status = result.available ? '[OK]' : '[  ]';
    const version = result.version ? `v${result.version}` : '';
    const enabled = isCLIModeEnabled(tool as CLITool) ? '(enabled)' : '(disabled)';
    console.log(`  ${tool}: ${status} ${version} ${enabled}`);
  }
}

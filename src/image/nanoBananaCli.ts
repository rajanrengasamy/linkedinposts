/**
 * Nano Banana CLI Wrapper
 *
 * Wraps the Gemini CLI with the Nano Banana /generate extension for
 * subscription-based image generation without per-request API costs.
 *
 * Command pattern: gemini "/generate PROMPT" --yolo -o json
 *
 * Features:
 * - CLI detection using shared cli-detector module
 * - Environment scrubbing (passes through NANOBANANA_GEMINI_API_KEY or GOOGLE_API_KEY)
 * - JSON output parsing for structured responses
 * - Automatic output directory management
 * - Image file discovery and extraction
 *
 * @see https://github.com/google-gemini/gemini-cli
 */

import { spawn } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  copyFileSync,
} from 'fs';
import { join, basename } from 'path';
import { detectCLI, getCLIPath } from '../llm/cli-detector.js';
import { logVerbose, logWarning } from '../utils/logger.js';
import {
  NanoBananaError,
  NanoBananaNotFoundError,
  NanoBananaAuthError,
  NanoBananaTimeoutError,
  NanoBananaGenerationError,
  DEFAULT_NANO_BANANA_MODEL,
  DEFAULT_CLI_TIMEOUT_MS,
  NANO_BANANA_OUTPUT_DIR,
  type NanoBananaCliResponse,
} from './types.js';

// ============================================
// Constants
// ============================================

/**
 * Keys to pass through to the CLI environment.
 * These may be used by the Nano Banana extension for authentication.
 */
const PASSTHROUGH_KEYS = ['NANOBANANA_GEMINI_API_KEY', 'GOOGLE_API_KEY'];

/**
 * Keys to remove from environment to force subscription auth.
 */
const SCRUB_KEYS = [
  'GOOGLE_AI_API_KEY',
  'GOOGLE_GENAI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'PERPLEXITY_API_KEY',
];

// ============================================
// NanoBananaCLIWrapper Class
// ============================================

/**
 * Wrapper class for the Gemini CLI with Nano Banana /generate extension.
 *
 * Provides a simple interface for generating images using the CLI,
 * with automatic output directory management and file discovery.
 *
 * @example
 * ```typescript
 * const wrapper = new NanoBananaCLIWrapper();
 * const result = await wrapper.generateImage('A futuristic city skyline');
 *
 * if (result.success && result.imagePath) {
 *   console.log(`Image saved to: ${result.imagePath}`);
 * }
 * ```
 */
export class NanoBananaCLIWrapper {
  private model: string;
  private timeout: number;
  private workingDir: string;
  private outputDir: string;

  /**
   * Create a new NanoBananaCLIWrapper instance.
   *
   * @param options - Configuration options
   * @param options.model - Model to use for generation (default: DEFAULT_NANO_BANANA_MODEL)
   * @param options.timeout - Timeout in milliseconds (default: DEFAULT_CLI_TIMEOUT_MS)
   * @param options.workingDir - Working directory for CLI execution (default: process.cwd())
   * @throws NanoBananaNotFoundError if Gemini CLI is not available
   */
  constructor(options?: {
    model?: string;
    timeout?: number;
    workingDir?: string;
  }) {
    this.model = options?.model ?? DEFAULT_NANO_BANANA_MODEL;
    this.timeout = options?.timeout ?? DEFAULT_CLI_TIMEOUT_MS;
    this.workingDir = options?.workingDir ?? process.cwd();
    this.outputDir = join(this.workingDir, NANO_BANANA_OUTPUT_DIR);

    // Verify CLI is available at construction time
    const detection = detectCLI('gemini');
    if (!detection.available) {
      throw new NanoBananaNotFoundError();
    }

    // Create output directory if it doesn't exist
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
      logVerbose(`Created Nano Banana output directory: ${this.outputDir}`);
    }

    logVerbose(
      `NanoBananaCLIWrapper initialized: model=${this.model}, timeout=${this.timeout}ms`
    );
    if (detection.version) {
      logVerbose(`Gemini CLI version: ${detection.version}`);
    }
  }

  /**
   * Scrub environment to control authentication behavior.
   *
   * - Passes through NANOBANANA_GEMINI_API_KEY or GOOGLE_API_KEY if set
   * - Sets NANOBANANA_MODEL to the configured model
   * - Ensures HOME is set for CLI auth token storage
   * - Removes other API keys to prevent accidental usage
   *
   * @returns Scrubbed environment variables
   */
  private scrubEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    // Pass through allowed keys
    for (const key of PASSTHROUGH_KEYS) {
      if (process.env[key]) {
        env[key] = process.env[key];
      }
    }

    // Set model for Nano Banana extension
    env.NANOBANANA_MODEL = this.model;

    // Ensure HOME is set for CLI auth
    if (!env.HOME) {
      env.HOME = process.env.HOME || '~';
    }

    // Remove other API keys to force subscription auth
    for (const key of SCRUB_KEYS) {
      delete env[key];
    }

    return env;
  }

  /**
   * Sanitize a prompt string to create a safe filename.
   *
   * @param prompt - The prompt to sanitize
   * @returns Safe filename string
   */
  private sanitizeFilename(prompt: string): string {
    return prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }

  /**
   * Find the most recently generated PNG in the output directory.
   *
   * Sorts all PNG files by modification time and returns the newest one.
   * This is used to find the image generated by the CLI.
   *
   * @returns Path to the most recent PNG, or null if none found
   */
  private findGeneratedImage(): string | null {
    if (!existsSync(this.outputDir)) {
      return null;
    }

    try {
      const files = readdirSync(this.outputDir)
        .filter((f) => f.toLowerCase().endsWith('.png'))
        .map((f) => ({
          name: f,
          path: join(this.outputDir, f),
          mtime: statSync(join(this.outputDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        logVerbose(`Found ${files.length} PNG files, newest: ${files[0].name}`);
        return files[0].path;
      }
    } catch (error) {
      logWarning(
        `Error scanning output directory: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return null;
  }

  /**
   * Parse CLI JSON output.
   *
   * The Gemini CLI outputs JSON with structure:
   * {
   *   "session_id": "...",
   *   "response": "...",
   *   "stats": { ... }
   * }
   *
   * @param stdout - Raw stdout from CLI
   * @returns Parsed session_id and response, or null values if parsing fails
   */
  private parseCLIOutput(stdout: string): {
    sessionId: string | null;
    response: string | null;
  } {
    const output = stdout.trim();

    if (!output) {
      return { sessionId: null, response: null };
    }

    try {
      const data = JSON.parse(output);
      return {
        sessionId: data.session_id ?? null,
        response: data.response ?? null,
      };
    } catch {
      // Not JSON, return raw text as response
      logVerbose('CLI output is not JSON, treating as plain text');
      return { sessionId: null, response: output };
    }
  }

  /**
   * Check for specific error types in CLI output.
   *
   * @param text - Text to check for error patterns
   * @throws NanoBananaAuthError if authentication error detected
   */
  private checkForErrors(text: string): void {
    const lower = text.toLowerCase();

    if (
      lower.includes('auth') ||
      lower.includes('unauthorized') ||
      lower.includes('login') ||
      lower.includes('not logged in')
    ) {
      throw new NanoBananaAuthError(text.slice(0, 200));
    }
  }

  /**
   * Execute the Gemini CLI with the /generate command.
   *
   * @param prompt - The image generation prompt
   * @returns Promise resolving to stdout and stderr
   * @throws NanoBananaNotFoundError if CLI not found
   * @throws NanoBananaTimeoutError if execution times out
   * @throws NanoBananaAuthError if authentication fails
   * @throws NanoBananaError for other failures
   */
  private async executeCLI(
    prompt: string
  ): Promise<{ stdout: string; stderr: string }> {
    const cliPath = getCLIPath('gemini');

    if (!cliPath) {
      throw new NanoBananaNotFoundError();
    }

    // Build command: gemini "/generate PROMPT" --yolo -o json
    // The /generate is a slash command that invokes the Nano Banana extension
    const generatePrompt = `/generate ${prompt}`;
    const args = [generatePrompt, '--yolo', '-o', 'json'];

    logVerbose(`Executing: gemini ${args.map((a) => `"${a.slice(0, 50)}..."`).join(' ')}`);
    logVerbose(`Prompt length: ${prompt.length} chars`);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn(cliPath, args, {
        env: this.scrubEnvironment(),
        cwd: this.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
        reject(new NanoBananaTimeoutError(this.timeout));
      }, this.timeout);

      // Close stdin immediately (we don't need to send input)
      proc.stdin.end();

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code: number | null) => {
        clearTimeout(timeoutId);

        if (timedOut) return;

        if (code !== 0 && code !== null) {
          // Check for specific error types
          try {
            this.checkForErrors(stderr || stdout);
          } catch (err) {
            reject(err);
            return;
          }
          reject(
            new NanoBananaError(
              `CLI exited with code ${code}: ${stderr || stdout}`,
              code
            )
          );
          return;
        }

        resolve({ stdout, stderr });
      });

      proc.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        reject(
          new NanoBananaError(`Failed to spawn CLI: ${err.message}`)
        );
      });
    });
  }

  /**
   * Generate an image using the Nano Banana CLI.
   *
   * Executes the CLI with the /generate command and locates the
   * generated image file. Optionally copies to a specified output path.
   *
   * @param prompt - The image generation prompt
   * @param outputPath - Optional path to copy the generated image to
   * @returns Promise resolving to NanoBananaCliResponse
   *
   * @example
   * ```typescript
   * const wrapper = new NanoBananaCLIWrapper();
   *
   * // Generate with default output location
   * const result1 = await wrapper.generateImage('A sunset over mountains');
   *
   * // Generate and copy to specific path
   * const result2 = await wrapper.generateImage(
   *   'A futuristic cityscape',
   *   '/path/to/output/cityscape.png'
   * );
   * ```
   */
  async generateImage(
    prompt: string,
    outputPath?: string
  ): Promise<NanoBananaCliResponse> {
    const response: NanoBananaCliResponse = {
      success: false,
      imagePath: null,
      outputDir: this.outputDir,
      prompt,
      model: this.model,
    };

    try {
      // Record files before generation to detect new ones
      const filesBefore = new Set(
        existsSync(this.outputDir)
          ? readdirSync(this.outputDir).filter((f) =>
              f.toLowerCase().endsWith('.png')
            )
          : []
      );

      // Execute CLI
      const { stdout, stderr } = await this.executeCLI(prompt);
      response.rawOutput = stdout;

      // Parse output
      const { sessionId } = this.parseCLIOutput(stdout);
      if (sessionId) {
        logVerbose(`CLI session: ${sessionId}`);
      }

      // Check stderr for warnings
      if (stderr) {
        logVerbose(`CLI stderr: ${stderr.slice(0, 200)}`);
      }

      // Find the generated image
      // First, check for new files
      const filesAfter = existsSync(this.outputDir)
        ? readdirSync(this.outputDir).filter((f) =>
            f.toLowerCase().endsWith('.png')
          )
        : [];

      const newFiles = filesAfter.filter((f) => !filesBefore.has(f));

      let imagePath: string | null = null;

      if (newFiles.length > 0) {
        // Use the first new file
        imagePath = join(this.outputDir, newFiles[0]);
        logVerbose(`New image file: ${newFiles[0]}`);
      } else {
        // Fall back to most recent file
        imagePath = this.findGeneratedImage();
      }

      if (!imagePath || !existsSync(imagePath)) {
        throw new NanoBananaGenerationError('No image file generated');
      }

      // Copy to output path if specified
      if (outputPath) {
        copyFileSync(imagePath, outputPath);
        logVerbose(`Copied image to: ${outputPath}`);
        response.imagePath = outputPath;
      } else {
        response.imagePath = imagePath;
      }

      response.success = true;
      response.message = `Image generated successfully: ${basename(response.imagePath)}`;

      return response;
    } catch (error) {
      if (error instanceof NanoBananaError) {
        response.message = error.message;
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      response.message = errorMessage;
      throw new NanoBananaGenerationError(errorMessage);
    }
  }

  /**
   * Generate an image and return the bytes as a Buffer.
   *
   * Convenience method that generates an image and reads it into memory.
   *
   * @param prompt - The image generation prompt
   * @returns Promise resolving to Buffer containing image data, or null on failure
   *
   * @example
   * ```typescript
   * const wrapper = new NanoBananaCLIWrapper();
   * const buffer = await wrapper.generateImageBytes('A beautiful landscape');
   *
   * if (buffer) {
   *   fs.writeFileSync('landscape.png', buffer);
   * }
   * ```
   */
  async generateImageBytes(prompt: string): Promise<Buffer | null> {
    try {
      const result = await this.generateImage(prompt);

      if (!result.success || !result.imagePath) {
        return null;
      }

      const buffer = readFileSync(result.imagePath);
      logVerbose(`Read image: ${buffer.length} bytes`);
      return buffer;
    } catch (error) {
      logWarning(
        `Image generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Factory function to get a Nano Banana CLI client.
 *
 * Returns null if the CLI is not available, allowing for graceful
 * fallback to other image generation methods.
 *
 * @param options - Configuration options
 * @param options.model - Model to use (default: DEFAULT_NANO_BANANA_MODEL)
 * @param options.timeout - Timeout in ms (default: DEFAULT_CLI_TIMEOUT_MS)
 * @returns NanoBananaCLIWrapper instance or null if unavailable
 *
 * @example
 * ```typescript
 * const client = getNanoBananaCLIClient({ timeout: 180_000 });
 *
 * if (client) {
 *   const buffer = await client.generateImageBytes('...');
 * } else {
 *   // Fall back to API-based generation
 * }
 * ```
 */
export function getNanoBananaCLIClient(options?: {
  model?: string;
  timeout?: number;
}): NanoBananaCLIWrapper | null {
  try {
    return new NanoBananaCLIWrapper(options);
  } catch (err) {
    if (err instanceof NanoBananaNotFoundError) {
      logWarning('Nano Banana CLI not found, wrapper unavailable');
      return null;
    }
    throw err;
  }
}

/**
 * Check if the Nano Banana CLI is available on the system.
 *
 * @returns true if Gemini CLI is installed and accessible
 *
 * @example
 * ```typescript
 * if (isNanoBananaCliAvailable()) {
 *   console.log('CLI available - using subscription billing');
 * } else {
 *   console.log('CLI unavailable - using API billing');
 * }
 * ```
 */
export function isNanoBananaCliAvailable(): boolean {
  return detectCLI('gemini').available;
}

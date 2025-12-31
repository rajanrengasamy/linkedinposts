/**
 * Shared sanitization utilities for LLM prompt security
 *
 * Used by both scoring (Gemini) and validation (Perplexity) modules.
 */

/** Patterns that could be used for prompt injection attacks */
export const INJECTION_PATTERNS = [
  // MAJ-5: Strengthened delimiter patterns to catch partial delimiters
  /<<<[^>]*>>?/gi,  // Catch partial closing: <<<foo>, <<<foo>>
  /<<?<[^>]*>>>/gi, // Catch partial opening: <<foo>>>, <foo>>>
  /<<<.*>>>/gi,     // Original: full delimiter <<<foo>>>
  /\{%.*%\}/gi,
  /\{\{.*\}\}/gi,
  /<script[^>]*>.*<\/script>/gi,
  /ignore (previous|above|all) instructions/gi,
  /disregard (previous|above|all)/gi,
  /system:\s*$/gim,
  /assistant:\s*$/gim,
  /user:\s*$/gim,
];

/** Patterns indicating sensitive data (API keys, tokens) */
export const SENSITIVE_PATTERNS = [
  /AIza[a-zA-Z0-9_-]{30,}/gi, // Google API keys
  /sk-[a-zA-Z0-9]{40,}/gi, // OpenAI keys
  /pplx-[a-zA-Z0-9]{40,}/gi, // Perplexity keys
  /[a-f0-9]{32,}/gi, // Long hex strings
];

/**
 * Sanitize content to prevent prompt injection.
 * Removes dangerous patterns and enforces length limit.
 */
export function sanitizePromptContent(
  content: string,
  maxLength: number = 500
): string {
  let sanitized = content;
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REMOVED]');
  }
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength) + '...';
  }
  return sanitized.trim();
}

/**
 * Sanitize error messages to prevent API key exposure.
 */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(sanitized)) {
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
  }
  return sanitized;
}

/**
 * Create a safe error without exposing sensitive stack traces.
 */
export function createSafeError(
  operationName: string,
  originalError: unknown
): Error {
  const message =
    originalError instanceof Error
      ? sanitizeErrorMessage(originalError.message)
      : String(originalError);
  return new Error(`${operationName}: ${message}`);
}

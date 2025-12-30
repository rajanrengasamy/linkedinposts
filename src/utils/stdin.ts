/**
 * CLI Stdin Utilities
 *
 * Readline utilities for interactive CLI prompts used in the
 * Prompt Refinement Phase. Provides consistent user interaction
 * patterns with proper formatting and color styling.
 */

import * as readline from 'readline';
import chalk from 'chalk';

// ============================================
// Readline Interface
// ============================================

/**
 * Create a readline interface for CLI interaction.
 *
 * @returns Configured readline.Interface for stdin/stdout
 */
export function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
}

/**
 * Close the readline interface.
 *
 * @param rl - The readline interface to close
 */
export function closeReadline(rl: readline.Interface): void {
  rl.close();
}

// ============================================
// Question Utilities
// ============================================

/**
 * Ask user a question and get response.
 *
 * @param rl - Readline interface
 * @param question - Question text to display
 * @returns User's answer (trimmed)
 */
export async function askQuestion(
  rl: readline.Interface,
  question: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(chalk.cyan(question), (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Ask user yes/no question with default.
 *
 * Accepts: Y, y, yes, N, n, no (case-insensitive)
 * Empty input uses the default value.
 *
 * @param rl - Readline interface
 * @param question - Question text (will have Y/n or y/N appended)
 * @param defaultValue - Default when user presses Enter (default: true)
 * @returns true for yes, false for no
 */
export async function askYesNo(
  rl: readline.Interface,
  question: string,
  defaultValue: boolean = true
): Promise<boolean> {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const formattedQuestion = `${question} ${chalk.gray(hint)}: `;

  return new Promise((resolve) => {
    rl.question(chalk.cyan(formattedQuestion), (answer) => {
      const trimmed = answer.trim().toLowerCase();

      // Empty input uses default
      if (trimmed === '') {
        resolve(defaultValue);
        return;
      }

      // Check for explicit yes/no
      if (trimmed === 'y' || trimmed === 'yes') {
        resolve(true);
        return;
      }
      if (trimmed === 'n' || trimmed === 'no') {
        resolve(false);
        return;
      }

      // Any other input uses default
      resolve(defaultValue);
    });
  });
}

/**
 * User action result from Accept/Reject/Feedback prompt.
 */
export interface AcceptRejectFeedbackResult {
  /** User's chosen action */
  action: 'accept' | 'reject' | 'feedback';
  /** Optional feedback text (when action is 'feedback') */
  feedback?: string;
}

/**
 * Ask user a choice question: Accept/Reject/Feedback.
 *
 * Accepts:
 * - Y/y/yes/Enter: accept
 * - N/n/no: reject
 * - F/f/feedback or any other text: feedback (with text as feedback)
 *
 * @param rl - Readline interface
 * @returns Action and optional feedback text
 */
export async function askAcceptRejectFeedback(
  rl: readline.Interface
): Promise<AcceptRejectFeedbackResult> {
  const hint = chalk.gray('[Y/n/feedback]');
  const prompt = chalk.cyan(`Accept this refined prompt? ${hint}: `);

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      const trimmed = answer.trim();
      const lower = trimmed.toLowerCase();

      // Accept: Y, y, yes, or empty (default)
      if (lower === '' || lower === 'y' || lower === 'yes') {
        resolve({ action: 'accept' });
        return;
      }

      // Reject: N, n, no
      if (lower === 'n' || lower === 'no') {
        resolve({ action: 'reject' });
        return;
      }

      // Feedback: f, feedback, or any other text (treated as feedback)
      if (lower === 'f' || lower === 'feedback') {
        // Need to ask for feedback text
        rl.question(chalk.cyan('Enter your feedback: '), (feedbackAnswer) => {
          resolve({
            action: 'feedback',
            feedback: feedbackAnswer.trim() || undefined,
          });
        });
        return;
      }

      // Any other input is treated as direct feedback
      resolve({
        action: 'feedback',
        feedback: trimmed || undefined,
      });
    });
  });
}

// ============================================
// Display Utilities
// ============================================

/**
 * Display the refined prompt with formatting.
 *
 * Shows the refined prompt in a visually distinct box format.
 *
 * @param prompt - The refined prompt to display
 */
export function displayRefinedPrompt(prompt: string): void {
  const line = chalk.gray('─'.repeat(60));
  console.log('');
  console.log(chalk.cyan.bold('Refined prompt:'));
  console.log(line);
  console.log(chalk.white(`  "${prompt}"`));
  console.log(line);
  console.log('');
}

/**
 * Display clarifying questions.
 *
 * Shows a numbered list of questions for the user to answer.
 *
 * @param questions - Array of question strings
 */
export function displayClarifyingQuestions(questions: string[]): void {
  console.log('');
  console.log(chalk.yellow.bold('I need some clarification:'));
  console.log('');
  questions.forEach((question, index) => {
    console.log(chalk.white(`  ${index + 1}. ${question}`));
  });
  console.log('');
}

/**
 * Collect answers to clarifying questions.
 *
 * Prompts the user for each question and collects their responses.
 * Returns a record mapping question numbers to answers.
 *
 * @param rl - Readline interface
 * @param questions - Array of questions to ask
 * @returns Record mapping "1", "2", etc. to user's answers
 */
export async function collectAnswers(
  rl: readline.Interface,
  questions: string[]
): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};

  console.log(chalk.cyan.bold('Your answers:'));

  for (let i = 0; i < questions.length; i++) {
    const questionNum = String(i + 1);
    const prompt = chalk.cyan(`${questionNum}: `);

    const answer = await new Promise<string>((resolve) => {
      rl.question(prompt, (response) => {
        resolve(response.trim());
      });
    });

    answers[questionNum] = answer;
  }

  console.log('');
  return answers;
}

// ============================================
// Additional Display Helpers
// ============================================

/**
 * Display analyzing message.
 */
export function displayAnalyzing(): void {
  console.log('');
  console.log(chalk.gray('Analyzing prompt...'));
}

/**
 * Display a success message.
 *
 * @param message - Success message to display
 */
export function displaySuccess(message: string): void {
  console.log(chalk.green(`  ${message}`));
}

/**
 * Display a warning message.
 *
 * @param message - Warning message to display
 */
export function displayWarning(message: string): void {
  console.log(chalk.yellow(`  ${message}`));
}

/**
 * Display skipping refinement message.
 *
 * @param reason - Reason for skipping (optional)
 */
export function displaySkipping(reason?: string): void {
  const msg = reason
    ? `Skipping prompt refinement: ${reason}`
    : 'Skipping prompt refinement';
  console.log(chalk.gray(`  ${msg}`));
}

/**
 * Display original prompt usage message.
 */
export function displayUsingOriginal(): void {
  console.log(chalk.gray('  Using original prompt'));
}

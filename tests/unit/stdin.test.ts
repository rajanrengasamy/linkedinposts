/**
 * Stdin Utilities Unit Tests
 *
 * Tests for CLI readline utilities used in the Prompt Refinement Phase.
 *
 * @see docs/PRD-v2.md Section 18.9 - Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as readline from 'readline';

// Mock readline module before importing stdin utilities
vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock chalk to avoid color output in tests
// Create chainable functions that return the input string
const createChalkFn = () => {
  const fn = (str: string) => str;
  fn.bold = (str: string) => str;
  return fn;
};

vi.mock('chalk', () => ({
  default: {
    cyan: Object.assign((str: string) => str, { bold: (str: string) => str }),
    gray: (str: string) => str,
    green: (str: string) => str,
    yellow: Object.assign((str: string) => str, { bold: (str: string) => str }),
    white: (str: string) => str,
  },
}));

import {
  createReadlineInterface,
  closeReadline,
  askQuestion,
  askYesNo,
  askAcceptRejectFeedback,
  displayAnalyzing,
  displaySuccess,
  displayWarning,
  displaySkipping,
  displayRefinedPrompt,
  displayClarifyingQuestions,
  displayUsingOriginal,
  collectAnswers,
} from '../../src/utils/stdin.js';

// ============================================
// createReadlineInterface Tests
// ============================================

describe('createReadlineInterface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call readline.createInterface', () => {
    createReadlineInterface();
    expect(readline.createInterface).toHaveBeenCalled();
  });

  it('should configure interface with stdin/stdout', () => {
    createReadlineInterface();
    expect(readline.createInterface).toHaveBeenCalledWith(
      expect.objectContaining({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      })
    );
  });

  it('should return an object with question method', () => {
    const rl = createReadlineInterface();
    expect(rl).toHaveProperty('question');
    expect(typeof rl.question).toBe('function');
  });

  it('should return an object with close method', () => {
    const rl = createReadlineInterface();
    expect(rl).toHaveProperty('close');
    expect(typeof rl.close).toBe('function');
  });
});

// ============================================
// closeReadline Tests
// ============================================

describe('closeReadline', () => {
  it('should call close on the readline interface', () => {
    const mockRl = {
      question: vi.fn(),
      close: vi.fn(),
    } as unknown as readline.Interface;

    closeReadline(mockRl);
    expect(mockRl.close).toHaveBeenCalled();
  });
});

// ============================================
// askQuestion Tests
// ============================================

describe('askQuestion', () => {
  it('should prompt user and return trimmed answer', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('  test answer  ');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const answer = await askQuestion(mockRl, 'What is your name?');
    expect(answer).toBe('test answer');
  });

  it('should pass the question text to readline', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('answer');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    await askQuestion(mockRl, 'Test question');
    expect(mockRl.question).toHaveBeenCalledWith(
      expect.stringContaining('Test question'),
      expect.any(Function)
    );
  });

  it('should handle empty input', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const answer = await askQuestion(mockRl, 'Question?');
    expect(answer).toBe('');
  });

  it('should handle whitespace-only input', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('   \t\n  ');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const answer = await askQuestion(mockRl, 'Question?');
    expect(answer).toBe('');
  });
});

// ============================================
// askYesNo Tests
// ============================================

describe('askYesNo', () => {
  it('should return true for Y', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('Y');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?');
    expect(result).toBe(true);
  });

  it('should return true for y', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('y');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?');
    expect(result).toBe(true);
  });

  it('should return true for yes', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('yes');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?');
    expect(result).toBe(true);
  });

  it('should return true for Yes', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('Yes');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?');
    expect(result).toBe(true);
  });

  it('should return true for YES', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('YES');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?');
    expect(result).toBe(true);
  });

  it('should return false for N', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('N');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?');
    expect(result).toBe(false);
  });

  it('should return false for n', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('n');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?');
    expect(result).toBe(false);
  });

  it('should return false for no', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('no');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?');
    expect(result).toBe(false);
  });

  it('should return false for No', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('No');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?');
    expect(result).toBe(false);
  });

  it('should return false for NO', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('NO');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?');
    expect(result).toBe(false);
  });

  it('should return default value (true) for empty input', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?', true);
    expect(result).toBe(true);
  });

  it('should return default value (false) for empty input when default is false', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?', false);
    expect(result).toBe(false);
  });

  it('should return default value for invalid input', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('maybe');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?', true);
    expect(result).toBe(true);
  });

  it('should handle whitespace-only input as empty', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('   ');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askYesNo(mockRl, 'Continue?', false);
    expect(result).toBe(false);
  });

  it('should include hint in prompt based on default value', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    await askYesNo(mockRl, 'Continue?', true);
    expect(mockRl.question).toHaveBeenCalledWith(
      expect.stringContaining('[Y/n]'),
      expect.any(Function)
    );
  });

  it('should show [y/N] hint when default is false', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    await askYesNo(mockRl, 'Continue?', false);
    expect(mockRl.question).toHaveBeenCalledWith(
      expect.stringContaining('[y/N]'),
      expect.any(Function)
    );
  });
});

// ============================================
// askAcceptRejectFeedback Tests
// ============================================

describe('askAcceptRejectFeedback', () => {
  it('should return accept for Y', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('Y');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askAcceptRejectFeedback(mockRl);
    expect(result).toEqual({ action: 'accept' });
  });

  it('should return accept for y', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('y');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askAcceptRejectFeedback(mockRl);
    expect(result).toEqual({ action: 'accept' });
  });

  it('should return accept for yes', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('yes');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askAcceptRejectFeedback(mockRl);
    expect(result).toEqual({ action: 'accept' });
  });

  it('should return accept for empty input (default)', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askAcceptRejectFeedback(mockRl);
    expect(result).toEqual({ action: 'accept' });
  });

  it('should return reject for N', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('N');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askAcceptRejectFeedback(mockRl);
    expect(result).toEqual({ action: 'reject' });
  });

  it('should return reject for n', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('n');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askAcceptRejectFeedback(mockRl);
    expect(result).toEqual({ action: 'reject' });
  });

  it('should return reject for no', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('no');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askAcceptRejectFeedback(mockRl);
    expect(result).toEqual({ action: 'reject' });
  });

  it('should ask for feedback when f is entered', async () => {
    let callCount = 0;
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callCount++;
        if (callCount === 1) {
          callback('f');
        } else {
          callback('Make it shorter');
        }
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askAcceptRejectFeedback(mockRl);
    expect(result).toEqual({ action: 'feedback', feedback: 'Make it shorter' });
    expect(mockRl.question).toHaveBeenCalledTimes(2);
  });

  it('should ask for feedback when feedback is entered', async () => {
    let callCount = 0;
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callCount++;
        if (callCount === 1) {
          callback('feedback');
        } else {
          callback('Add more context');
        }
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askAcceptRejectFeedback(mockRl);
    expect(result).toEqual({ action: 'feedback', feedback: 'Add more context' });
  });

  it('should treat any other input as direct feedback', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('This is my direct feedback');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askAcceptRejectFeedback(mockRl);
    expect(result).toEqual({ action: 'feedback', feedback: 'This is my direct feedback' });
  });

  it('should return undefined feedback when f is entered but no feedback provided', async () => {
    let callCount = 0;
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callCount++;
        if (callCount === 1) {
          callback('f');
        } else {
          callback('');
        }
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const result = await askAcceptRejectFeedback(mockRl);
    expect(result).toEqual({ action: 'feedback', feedback: undefined });
  });
});

// ============================================
// Display Helper Tests
// ============================================

describe('displayAnalyzing', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should output analyzing message', () => {
    displayAnalyzing();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Analyzing'));
  });
});

describe('displaySuccess', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should output success message', () => {
    displaySuccess('Operation completed');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Operation completed'));
  });
});

describe('displayWarning', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should output warning message', () => {
    displayWarning('Potential issue detected');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Potential issue detected'));
  });
});

describe('displaySkipping', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should output skipping message without reason', () => {
    displaySkipping();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping'));
  });

  it('should output skipping message with reason', () => {
    displaySkipping('User requested');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('User requested'));
  });
});

describe('displayRefinedPrompt', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should output the refined prompt', () => {
    displayRefinedPrompt('My refined prompt');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('My refined prompt'));
  });

  it('should include header text', () => {
    displayRefinedPrompt('Test prompt');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Refined'));
  });
});

describe('displayClarifyingQuestions', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should output numbered questions', () => {
    const questions = ['Question 1?', 'Question 2?'];
    displayClarifyingQuestions(questions);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1. Question 1?'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('2. Question 2?'));
  });

  it('should include clarification header', () => {
    displayClarifyingQuestions(['Question?']);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('clarification'));
  });
});

describe('displayUsingOriginal', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should output original prompt usage message', () => {
    displayUsingOriginal();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('original'));
  });
});

// ============================================
// collectAnswers Tests
// ============================================

describe('collectAnswers', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should collect answers for all questions', async () => {
    let callCount = 0;
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callCount++;
        callback(`Answer ${callCount}`);
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const questions = ['Question 1?', 'Question 2?', 'Question 3?'];
    const answers = await collectAnswers(mockRl, questions);

    expect(answers).toEqual({
      '1': 'Answer 1',
      '2': 'Answer 2',
      '3': 'Answer 3',
    });
  });

  it('should return empty object for empty questions array', async () => {
    const mockRl = {
      question: vi.fn(),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const answers = await collectAnswers(mockRl, []);
    expect(answers).toEqual({});
    expect(mockRl.question).not.toHaveBeenCalled();
  });

  it('should trim answers', async () => {
    const mockRl = {
      question: vi.fn((prompt: string, callback: (answer: string) => void) => {
        callback('  trimmed answer  ');
      }),
      close: vi.fn(),
    } as unknown as readline.Interface;

    const answers = await collectAnswers(mockRl, ['Question?']);
    expect(answers['1']).toBe('trimmed answer');
  });
});

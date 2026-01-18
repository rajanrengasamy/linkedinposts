/**
 * Prompt Export Tests
 *
 * Tests for the prompt export module that generates image generation
 * prompts and branding assets for manual Gemini image generation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { readFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  exportPromptAssets,
  exportMultiplePromptAssets,
} from '../../src/image/promptExport.js';
import type { InfographicBrief, LinkedInPost } from '../../src/schemas/synthesisResult.js';
import type { PipelineConfig } from '../../src/types/index.js';
import { DEFAULT_CONFIG } from '../../src/types/index.js';

// ============================================
// Test Fixtures
// ============================================

function createMockBrief(overrides?: Partial<InfographicBrief>): InfographicBrief {
  return {
    title: 'Test Infographic Title',
    keyPoints: ['Point 1', 'Point 2', 'Point 3'],
    suggestedStyle: 'minimal',
    ...overrides,
  };
}

function createMockPost(postNumber: number, overrides?: Partial<LinkedInPost>): LinkedInPost {
  return {
    postNumber,
    content: `Post ${postNumber} content`,
    hook: `Hook for post ${postNumber}`,
    infographicBrief: createMockBrief({
      title: `Infographic ${postNumber} Title`,
    }),
    ...overrides,
  };
}

function createMockConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return {
    ...DEFAULT_CONFIG,
    imageResolution: '2k',
    imageMode: 'export',
    synthesisModel: 'gpt',
    postStyle: 'variations',
    postCount: 1,
    ...overrides,
  };
}

// ============================================
// Test Setup
// ============================================

let testOutputDir: string;

beforeEach(async () => {
  // Create a unique temp directory for each test
  testOutputDir = join(tmpdir(), `prompt-export-test-${Date.now()}`);
  await mkdir(testOutputDir, { recursive: true });
});

afterEach(async () => {
  // Clean up temp directory
  if (testOutputDir && existsSync(testOutputDir)) {
    await rm(testOutputDir, { recursive: true, force: true });
  }
});

// ============================================
// exportPromptAssets Tests
// ============================================

describe('exportPromptAssets', () => {
  it('should create image-assets directory', async () => {
    const brief = createMockBrief();
    const config = createMockConfig();

    const result = await exportPromptAssets(brief, 'test topic', config, testOutputDir);

    expect(existsSync(result.outputDir)).toBe(true);
    expect(result.outputDir).toContain('image-assets');
  });

  it('should create branding-book.md', async () => {
    const brief = createMockBrief();
    const config = createMockConfig();

    const result = await exportPromptAssets(brief, 'test topic', config, testOutputDir);

    expect(existsSync(result.files.brandingBookMd)).toBe(true);

    const content = await readFile(result.files.brandingBookMd, 'utf-8');
    expect(content).toContain('# LinkedIn Infographic Branding Guide');
    expect(content).toContain('test topic');
  });

  it('should create branding-book.json', async () => {
    const brief = createMockBrief();
    const config = createMockConfig();

    const result = await exportPromptAssets(brief, 'test topic', config, testOutputDir);

    expect(existsSync(result.files.brandingBookJson)).toBe(true);

    const content = await readFile(result.files.brandingBookJson, 'utf-8');
    const data = JSON.parse(content);
    expect(data.schemaVersion).toBe('1.0.0');
    expect(data.topic).toBe('test topic');
  });

  it('should create metadata.json', async () => {
    const brief = createMockBrief();
    const config = createMockConfig();

    const result = await exportPromptAssets(brief, 'test topic', config, testOutputDir);

    expect(existsSync(result.files.metadataJson)).toBe(true);

    const content = await readFile(result.files.metadataJson, 'utf-8');
    const data = JSON.parse(content);
    expect(data.schemaVersion).toBe('1.0.0');
    expect(data.topic).toBe('test topic');
    expect(data.prompts).toHaveLength(1);
    expect(data.resolution.configured).toBe('2k');
  });

  it('should create README.md', async () => {
    const brief = createMockBrief();
    const config = createMockConfig();

    const result = await exportPromptAssets(brief, 'test topic', config, testOutputDir);

    expect(existsSync(result.files.readmeMd)).toBe(true);

    const content = await readFile(result.files.readmeMd, 'utf-8');
    expect(content).toContain('# Image Generation Assets');
    expect(content).toContain('Quick Start');
    expect(content).toContain('gemini.google.com');
  });

  it('should create prompt file', async () => {
    const brief = createMockBrief({ title: 'AI Trends 2025' });
    const config = createMockConfig();

    const result = await exportPromptAssets(brief, 'AI trends', config, testOutputDir);

    expect(result.files.prompts).toHaveLength(1);
    expect(existsSync(result.files.prompts[0])).toBe(true);

    const content = await readFile(result.files.prompts[0], 'utf-8');
    expect(content).toContain('AI Trends 2025');
    expect(content.length).toBeGreaterThan(100);
  });

  it('should return correct prompt count', async () => {
    const brief = createMockBrief();
    const config = createMockConfig();

    const result = await exportPromptAssets(brief, 'test', config, testOutputDir);

    expect(result.promptCount).toBe(1);
  });

  it('should include infographic brief in metadata', async () => {
    const brief = createMockBrief({
      title: 'Custom Title',
      keyPoints: ['Custom point 1', 'Custom point 2'],
      suggestedStyle: 'data-heavy',
      accentColor: 'coral',
    });
    const config = createMockConfig();

    const result = await exportPromptAssets(brief, 'test', config, testOutputDir);

    const metadata = JSON.parse(await readFile(result.files.metadataJson, 'utf-8'));
    expect(metadata.prompts[0].infographicBrief.title).toBe('Custom Title');
    expect(metadata.prompts[0].infographicBrief.suggestedStyle).toBe('data-heavy');
    expect(metadata.prompts[0].infographicBrief.accentColor).toBe('coral');
  });
});

// ============================================
// exportMultiplePromptAssets Tests
// ============================================

describe('exportMultiplePromptAssets', () => {
  it('should create image-assets directory', async () => {
    const posts = [createMockPost(1), createMockPost(2)];
    const config = createMockConfig({ postCount: 2 });

    const result = await exportMultiplePromptAssets(posts, 'test topic', config, testOutputDir);

    expect(existsSync(result.outputDir)).toBe(true);
    expect(result.outputDir).toContain('image-assets');
  });

  it('should create prompt file for each post', async () => {
    const posts = [createMockPost(1), createMockPost(2), createMockPost(3)];
    const config = createMockConfig({ postCount: 3 });

    const result = await exportMultiplePromptAssets(posts, 'test topic', config, testOutputDir);

    expect(result.files.prompts).toHaveLength(3);
    expect(result.promptCount).toBe(3);

    for (const promptPath of result.files.prompts) {
      expect(existsSync(promptPath)).toBe(true);
    }
  });

  it('should name prompts sequentially', async () => {
    const posts = [createMockPost(1), createMockPost(2)];
    const config = createMockConfig({ postCount: 2 });

    const result = await exportMultiplePromptAssets(posts, 'test', config, testOutputDir);

    expect(result.files.prompts[0]).toContain('infographic-1.txt');
    expect(result.files.prompts[1]).toContain('infographic-2.txt');
  });

  it('should include all posts in metadata', async () => {
    const posts = [
      createMockPost(1, { infographicBrief: createMockBrief({ title: 'Post 1 Title' }) }),
      createMockPost(2, { infographicBrief: createMockBrief({ title: 'Post 2 Title' }) }),
    ];
    const config = createMockConfig({ postCount: 2 });

    const result = await exportMultiplePromptAssets(posts, 'test', config, testOutputDir);

    const metadata = JSON.parse(await readFile(result.files.metadataJson, 'utf-8'));
    expect(metadata.prompts).toHaveLength(2);
    expect(metadata.prompts[0].postNumber).toBe(1);
    expect(metadata.prompts[1].postNumber).toBe(2);
    expect(metadata.prompts[0].infographicBrief.title).toBe('Post 1 Title');
    expect(metadata.prompts[1].infographicBrief.title).toBe('Post 2 Title');
  });

  it('should create single branding book for all posts', async () => {
    const posts = [createMockPost(1), createMockPost(2)];
    const config = createMockConfig({ postCount: 2 });

    const result = await exportMultiplePromptAssets(posts, 'shared topic', config, testOutputDir);

    // Should only have one branding book (shared)
    expect(existsSync(result.files.brandingBookMd)).toBe(true);
    expect(existsSync(result.files.brandingBookJson)).toBe(true);

    const content = await readFile(result.files.brandingBookMd, 'utf-8');
    expect(content).toContain('shared topic');
  });

  it('should include multi-post instructions in README', async () => {
    const posts = [createMockPost(1), createMockPost(2)];
    const config = createMockConfig({ postCount: 2 });

    const result = await exportMultiplePromptAssets(posts, 'test', config, testOutputDir);

    const readme = await readFile(result.files.readmeMd, 'utf-8');
    expect(readme).toContain('2 posts');
    expect(readme).toContain('infographic-1.txt');
    expect(readme).toContain('infographic-2.txt');
  });

  it('should use first post brief for branding book', async () => {
    const posts = [
      createMockPost(1, { infographicBrief: createMockBrief({ accentColor: 'lime' }) }),
      createMockPost(2, { infographicBrief: createMockBrief({ accentColor: 'coral' }) }),
    ];
    const config = createMockConfig({ postCount: 2 });

    const result = await exportMultiplePromptAssets(posts, 'test', config, testOutputDir);

    const brandingData = JSON.parse(await readFile(result.files.brandingBookJson, 'utf-8'));
    expect(brandingData.recommendedAccent.color).toBe('lime');
  });
});

// ============================================
// Resolution Tests
// ============================================

describe('resolution handling', () => {
  it('should include 2k resolution in metadata', async () => {
    const brief = createMockBrief();
    const config = createMockConfig({ imageResolution: '2k' });

    const result = await exportPromptAssets(brief, 'test', config, testOutputDir);

    const metadata = JSON.parse(await readFile(result.files.metadataJson, 'utf-8'));
    expect(metadata.resolution.configured).toBe('2k');
    expect(metadata.resolution.recommendedPixels).toBe('1080x1080');
  });

  it('should include 4k resolution in metadata', async () => {
    const brief = createMockBrief();
    const config = createMockConfig({ imageResolution: '4k' });

    const result = await exportPromptAssets(brief, 'test', config, testOutputDir);

    const metadata = JSON.parse(await readFile(result.files.metadataJson, 'utf-8'));
    expect(metadata.resolution.configured).toBe('4k');
    expect(metadata.resolution.recommendedPixels).toBe('2160x2160');
  });
});

// ============================================
// Error Handling Tests
// ============================================

describe('error handling', () => {
  it('should throw on invalid output directory', async () => {
    const brief = createMockBrief();
    const config = createMockConfig();
    const invalidDir = '/nonexistent/path/that/should/not/exist';

    // This should throw because mkdir will fail on the nonexistent parent
    await expect(
      exportPromptAssets(brief, 'test', config, invalidDir)
    ).rejects.toThrow();
  });
});

/**
 * Direct Test for Stage 6 Export Functions
 *
 * Tests exportPromptAssets() directly without running the full pipeline.
 * Uses existing synthesis.json from a previous run.
 */

import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { exportPromptAssets } from '../src/image/promptExport.js';
import { DEFAULT_CONFIG } from '../src/types/index.js';
import type { InfographicBrief, SynthesisResult } from '../src/schemas/synthesisResult.js';

// Test configuration
const SYNTHESIS_PATH = 'output/2025-12-30_22-22-21/synthesis.json';
const TEST_OUTPUT_DIR = 'output/test-stage6-direct';

async function main() {
  console.log('='.repeat(60));
  console.log('Stage 6 Direct Export Test');
  console.log('='.repeat(60));

  // Load synthesis.json
  console.log('\n[1/5] Loading synthesis data...');
  const synthesisRaw = await readFile(SYNTHESIS_PATH, 'utf-8');
  const synthesis: SynthesisResult = JSON.parse(synthesisRaw);
  console.log(`  Topic: ${synthesis.prompt}`);
  console.log(`  Generated: ${synthesis.generatedAt}`);

  // Extract infographic brief
  console.log('\n[2/5] Extracting infographic brief...');
  const brief: InfographicBrief = synthesis.infographicBrief;
  console.log(`  Title: ${brief.title}`);
  console.log(`  Style: ${brief.suggestedStyle}`);
  console.log(`  Key Points: ${brief.keyPoints.length}`);
  brief.keyPoints.forEach((point, i) => {
    console.log(`    ${i + 1}. ${point}`);
  });

  // Clean up test output directory if it exists
  console.log('\n[3/5] Preparing test output directory...');
  try {
    await rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
    console.log(`  Cleaned: ${TEST_OUTPUT_DIR}`);
  } catch {
    console.log(`  Directory does not exist, creating fresh`);
  }

  // Call exportPromptAssets
  console.log('\n[4/5] Calling exportPromptAssets()...');
  const startTime = Date.now();
  const result = await exportPromptAssets(
    brief,
    synthesis.prompt,
    DEFAULT_CONFIG,
    TEST_OUTPUT_DIR
  );
  const duration = Date.now() - startTime;
  console.log(`  Completed in ${duration}ms`);

  // Verify output
  console.log('\n[5/5] Verifying output files...');
  console.log(`  Output directory: ${result.outputDir}`);
  console.log(`  Prompt count: ${result.promptCount}`);
  console.log('\n  Files created:');

  const files = [
    { label: 'Branding Book (MD)', path: result.files.brandingBookMd },
    { label: 'Branding Book (JSON)', path: result.files.brandingBookJson },
    { label: 'Metadata', path: result.files.metadataJson },
    { label: 'README', path: result.files.readmeMd },
    ...result.files.prompts.map((p, i) => ({
      label: `Prompt ${i + 1}`,
      path: p,
    })),
  ];

  let allFilesExist = true;
  for (const file of files) {
    try {
      const stats = await stat(file.path);
      const size = stats.size;
      console.log(`    [OK] ${file.label}: ${file.path} (${size} bytes)`);
    } catch {
      console.log(`    [FAIL] ${file.label}: ${file.path} - NOT FOUND`);
      allFilesExist = false;
    }
  }

  // Read and display prompt content summary
  console.log('\n  Prompt content preview:');
  const promptContent = await readFile(result.files.prompts[0], 'utf-8');
  const promptLines = promptContent.split('\n');
  console.log(`    Total characters: ${promptContent.length}`);
  console.log(`    Total lines: ${promptLines.length}`);
  console.log(`    First line: ${promptLines[0].substring(0, 80)}...`);

  // Read metadata to verify structure
  console.log('\n  Metadata structure:');
  const metadataContent = await readFile(result.files.metadataJson, 'utf-8');
  const metadata = JSON.parse(metadataContent);
  console.log(`    Schema version: ${metadata.schemaVersion}`);
  console.log(`    Post count: ${metadata.postCount}`);
  console.log(`    Resolution: ${metadata.resolution.configured} (${metadata.resolution.recommendedPixels})`);
  console.log(`    Synthesis model: ${metadata.pipeline.synthesisModel}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  if (allFilesExist) {
    console.log('TEST PASSED: All files created successfully');
    console.log(`Output location: ${result.outputDir}`);
  } else {
    console.log('TEST FAILED: Some files were not created');
    process.exit(1);
  }
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Test failed with error:', error);
  process.exit(1);
});

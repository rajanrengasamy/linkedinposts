/**
 * Unit Tests for Handle Loader
 *
 * Tests for LinkedIn profile loading functions from src/utils/handleLoader.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import {
  loadLinkedInProfiles,
  clearLinkedInCache,
  selectLinkedInProfiles,
  type LinkedInProfile,
} from '../../src/utils/handleLoader.js';

// Mock fs module
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

// ============================================
// LinkedIn Profile Loader Tests
// ============================================

describe('LinkedIn Profile Loader', () => {
  beforeEach(() => {
    clearLinkedInCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadLinkedInProfiles', () => {
    it('parses valid LinkedIn profile lines', () => {
      const mockContent = `## Section Header
Sean Kochel: linkedin.com/in/sean-kochel
Matt Maher: linkedin.com/in/mattmaher14
`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const profiles = loadLinkedInProfiles();

      expect(profiles).toHaveLength(2);
      expect(profiles[0]).toEqual({
        slug: 'sean-kochel',
        displayName: 'Sean Kochel',
      });
      expect(profiles[1]).toEqual({
        slug: 'mattmaher14',
        displayName: 'Matt Maher',
      });
    });

    it('skips section headers and empty lines', () => {
      const mockContent = `
## Header 1
Profile One: linkedin.com/in/profile1

## Header 2
Profile Two: linkedin.com/in/profile2

`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const profiles = loadLinkedInProfiles();

      expect(profiles).toHaveLength(2);
      expect(profiles[0].slug).toBe('profile1');
      expect(profiles[1].slug).toBe('profile2');
    });

    it('handles URLs with https:// prefix', () => {
      const mockContent = `John Doe: https://linkedin.com/in/johndoe
Jane Smith: https://www.linkedin.com/in/janesmith`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const profiles = loadLinkedInProfiles();

      expect(profiles).toHaveLength(2);
      expect(profiles[0].slug).toBe('johndoe');
      expect(profiles[1].slug).toBe('janesmith');
    });

    it('returns empty array when file not found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const profiles = loadLinkedInProfiles();

      expect(profiles).toEqual([]);
    });

    it('caches results on repeated calls', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('Test User: linkedin.com/in/testuser');

      loadLinkedInProfiles();
      loadLinkedInProfiles();
      loadLinkedInProfiles();

      // File should only be read once due to caching
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('handles profiles with hyphens in slug', () => {
      const mockContent = `First Last-Name: linkedin.com/in/first-last-name`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const profiles = loadLinkedInProfiles();

      expect(profiles).toHaveLength(1);
      expect(profiles[0].slug).toBe('first-last-name');
    });

    it('handles profiles with numbers in slug', () => {
      const mockContent = `John Smith: linkedin.com/in/johnsmith123`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const profiles = loadLinkedInProfiles();

      expect(profiles).toHaveLength(1);
      expect(profiles[0].slug).toBe('johnsmith123');
    });

    it('skips lines that do not match profile format', () => {
      const mockContent = `## Header
Valid Profile: linkedin.com/in/validprofile
Just some random text
Another random line without URL`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const profiles = loadLinkedInProfiles();

      expect(profiles).toHaveLength(1);
      expect(profiles[0].slug).toBe('validprofile');
    });
  });

  describe('clearLinkedInCache', () => {
    it('clears the cache allowing fresh reads', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('Test: linkedin.com/in/test');

      // First call - should read file
      loadLinkedInProfiles();
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      loadLinkedInProfiles();
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);

      // Clear cache
      clearLinkedInCache();

      // Third call - should read file again
      loadLinkedInProfiles();
      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('selectLinkedInProfiles', () => {
    const mockProfiles: LinkedInProfile[] = [
      { slug: 'profile1', displayName: 'Profile One' },
      { slug: 'profile2', displayName: 'Profile Two' },
      { slug: 'profile3', displayName: 'Profile Three' },
      { slug: 'profile4', displayName: 'Profile Four' },
      { slug: 'profile5', displayName: 'Profile Five' },
    ];

    it('returns limited profiles when limit is less than total', () => {
      const result = selectLinkedInProfiles(mockProfiles, 2);

      expect(result).toHaveLength(2);
      expect(result[0].slug).toBe('profile1');
      expect(result[1].slug).toBe('profile2');
    });

    it('returns all profiles when limit exceeds count', () => {
      const result = selectLinkedInProfiles(mockProfiles, 10);

      expect(result).toHaveLength(5);
    });

    it('returns empty array for empty input', () => {
      const result = selectLinkedInProfiles([], 10);

      expect(result).toEqual([]);
    });

    it('uses default limit of 10 when not specified', () => {
      const manyProfiles: LinkedInProfile[] = Array.from({ length: 15 }, (_, i) => ({
        slug: `profile${i}`,
        displayName: `Profile ${i}`,
      }));

      const result = selectLinkedInProfiles(manyProfiles);

      expect(result).toHaveLength(10);
    });

    it('returns exact count when profiles equal limit', () => {
      const result = selectLinkedInProfiles(mockProfiles, 5);

      expect(result).toHaveLength(5);
    });
  });
});

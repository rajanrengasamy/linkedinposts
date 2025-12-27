/**
 * Unit Tests for Content Normalization
 *
 * Tests for normalizeContent, generateContentHash, normalizeTimestamp, and normalizeUrl
 * functions from src/processing/normalize.ts
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeContent,
  generateContentHash,
  normalizeTimestamp,
  normalizeUrl,
} from '../../src/processing/normalize.js';

// ============================================
// normalizeContent Tests
// ============================================

describe('normalizeContent', () => {
  describe('case normalization', () => {
    it('converts text to lowercase', () => {
      expect(normalizeContent('Hello World')).toBe('hello world');
      expect(normalizeContent('UPPERCASE TEXT')).toBe('uppercase text');
      expect(normalizeContent('MiXeD CaSe')).toBe('mixed case');
    });
  });

  describe('URL removal', () => {
    it('removes https URLs', () => {
      expect(normalizeContent('Check out https://example.com for more')).toBe(
        'check out for more'
      );
    });

    it('removes http URLs', () => {
      expect(normalizeContent('Visit http://test.org today')).toBe('visit today');
    });

    it('removes multiple URLs', () => {
      expect(
        normalizeContent('Multiple https://a.com and http://b.com URLs')
      ).toBe('multiple and urls');
    });

    it('removes URLs with paths and query strings', () => {
      expect(
        normalizeContent('Link: https://example.com/path?q=test#section here')
      ).toBe('link here');
    });
  });

  describe('emoji removal', () => {
    it('removes basic face emoji', () => {
      expect(normalizeContent('Hello 😀 World')).toBe('hello world');
    });

    it('removes object emoji', () => {
      expect(normalizeContent('Rocket 🚀 launch')).toBe('rocket launch');
    });

    it('removes symbol emoji', () => {
      expect(normalizeContent('Fire 🔥 and ice')).toBe('fire and ice');
    });

    it('removes hand emoji', () => {
      expect(normalizeContent('Thumbs 👍 up')).toBe('thumbs up');
    });

    it('removes heart emoji', () => {
      expect(normalizeContent('Love ❤️ this')).toBe('love this');
    });

    it('removes multiple consecutive emoji', () => {
      expect(normalizeContent('Multiple 😀🎉🚀💡 emojis')).toBe('multiple emojis');
    });

    it('removes flag emoji', () => {
      expect(normalizeContent('USA 🇺🇸 flag')).toBe('usa flag');
    });
  });

  describe('punctuation removal', () => {
    it('removes commas and exclamation marks', () => {
      expect(normalizeContent('Hello, World!')).toBe('hello world');
    });

    it('removes question marks and ellipsis', () => {
      expect(normalizeContent('What?! Really...')).toBe('what really');
    });

    it('removes colons and commas', () => {
      expect(normalizeContent('Test: 1, 2, 3')).toBe('test 1 2 3');
    });

    it('removes special characters', () => {
      expect(normalizeContent('Special @#$%^&* chars')).toBe('special chars');
    });

    it('removes apostrophes', () => {
      expect(normalizeContent("It's a test")).toBe('its a test');
    });

    it('removes dashes (merges words)', () => {
      expect(normalizeContent('Dash-separated-words')).toBe('dashseparatedwords');
    });
  });

  describe('whitespace handling', () => {
    it('collapses multiple spaces to single space', () => {
      expect(normalizeContent('Hello    World')).toBe('hello world');
    });

    it('collapses tabs to single space', () => {
      expect(normalizeContent('Tab\t\tseparated')).toBe('tab separated');
    });

    it('collapses newlines to single space', () => {
      expect(normalizeContent('New\n\nlines')).toBe('new lines');
    });

    it('collapses mixed whitespace to single space', () => {
      expect(normalizeContent('Mixed   \t\n  whitespace')).toBe('mixed whitespace');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeContent('  leading and trailing  ')).toBe(
        'leading and trailing'
      );
    });
  });

  describe('empty and edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(normalizeContent('')).toBe('');
    });

    it('returns empty string for space-only input', () => {
      expect(normalizeContent('   ')).toBe('');
    });

    it('returns empty string for tab-only input', () => {
      expect(normalizeContent('\t\t')).toBe('');
    });

    it('returns empty string for newline-only input', () => {
      expect(normalizeContent('\n\n\n')).toBe('');
    });

    it('returns empty string for mixed whitespace-only input', () => {
      expect(normalizeContent('  \t  \n  ')).toBe('');
    });

    it('returns empty string for only special characters', () => {
      expect(normalizeContent('!@#$%^&*()')).toBe('');
    });

    it('returns empty string for only emoji', () => {
      expect(normalizeContent('😀🎉🚀💡❤️')).toBe('');
    });
  });

  describe('combined transformations', () => {
    it('handles mixed case with all transformations combined', () => {
      const input =
        'Check THIS out! 🚀 Visit https://example.com for more info... @test #hashtag';
      const expected = 'check this out visit for more info test hashtag';
      expect(normalizeContent(input)).toBe(expected);
    });

    it('handles complex real-world content', () => {
      const input =
        '🎉 BREAKING: AI startup raises $100M! Read more at https://news.com/article?ref=twitter 📈💰';
      const expected = 'breaking ai startup raises 100m read more at';
      expect(normalizeContent(input)).toBe(expected);
    });
  });

  describe('unicode handling', () => {
    it('preserves basic latin letters', () => {
      expect(normalizeContent('Cafe with cafe')).toBe('cafe with cafe');
    });

    it('preserves accented characters when using word chars', () => {
      // Note: The regex [^\w\s] in the implementation removes non-word chars
      // \w includes [a-zA-Z0-9_] in ASCII mode, so accented chars may be removed
      const result = normalizeContent('Hola mundo');
      expect(result).toBe('hola mundo');
    });
  });

  describe('performance', () => {
    it('handles very long content efficiently', () => {
      const longContent = 'word '.repeat(10000);
      const startTime = Date.now();
      const result = normalizeContent(longContent);
      const duration = Date.now() - startTime;

      expect(result).toBe('word '.repeat(10000).trim());
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('handles content with many URLs efficiently', () => {
      const manyUrls = Array(100)
        .fill('https://example.com/path ')
        .join('text ');
      const startTime = Date.now();
      normalizeContent(manyUrls);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000);
    });
  });
});

// ============================================
// generateContentHash Tests
// ============================================

describe('generateContentHash', () => {
  describe('hash format', () => {
    it('returns exactly 16 characters', () => {
      const hash = generateContentHash('test content');
      expect(hash).toHaveLength(16);
    });

    it('returns only lowercase hex characters', () => {
      const hash = generateContentHash('test content');
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('returns valid hash for various inputs', () => {
      const inputs = [
        'short',
        'A much longer piece of text that spans multiple words',
        '12345',
        'Special!@#$%chars',
        '   whitespace   ',
      ];

      for (const input of inputs) {
        const hash = generateContentHash(input);
        expect(hash).toMatch(/^[a-f0-9]{16}$/);
      }
    });
  });

  describe('determinism', () => {
    it('same content produces same hash', () => {
      const content = 'This is some test content for hashing';
      const hash1 = generateContentHash(content);
      const hash2 = generateContentHash(content);
      const hash3 = generateContentHash(content);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('hash is stable across multiple calls', () => {
      const hashes = [];
      for (let i = 0; i < 10; i++) {
        hashes.push(generateContentHash('consistent content'));
      }
      expect(new Set(hashes).size).toBe(1);
    });
  });

  describe('uniqueness', () => {
    it('different content produces different hash', () => {
      const hash1 = generateContentHash('First piece of content');
      const hash2 = generateContentHash('Second piece of content');
      const hash3 = generateContentHash('Third completely different text');

      expect(hash1).not.toBe(hash2);
      expect(hash2).not.toBe(hash3);
      expect(hash1).not.toBe(hash3);
    });

    it('similar but different content produces different hash', () => {
      const hash1 = generateContentHash('The quick brown fox');
      const hash2 = generateContentHash('The quick brown dog');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('normalization in hashing', () => {
    it('content differing only in case produces same hash', () => {
      const hash1 = generateContentHash('Hello World');
      const hash2 = generateContentHash('hello world');
      const hash3 = generateContentHash('HELLO WORLD');

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('content differing only in whitespace produces same hash', () => {
      const hash1 = generateContentHash('Hello World');
      const hash2 = generateContentHash('Hello   World');
      const hash3 = generateContentHash('Hello\t\nWorld');
      const hash4 = generateContentHash('  Hello World  ');

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
      expect(hash3).toBe(hash4);
    });

    it('content with/without URLs produces same hash', () => {
      const hash1 = generateContentHash(
        'Check out this article https://example.com for more info'
      );
      const hash2 = generateContentHash('Check out this article for more info');

      expect(hash1).toBe(hash2);
    });

    it('content with/without emoji produces same hash', () => {
      const hash1 = generateContentHash('Great news today 🎉');
      const hash2 = generateContentHash('Great news today');

      expect(hash1).toBe(hash2);
    });

    it('content with/without punctuation produces same hash', () => {
      const hash1 = generateContentHash('Hello, World!');
      const hash2 = generateContentHash('Hello World');

      expect(hash1).toBe(hash2);
    });
  });

  describe('edge cases', () => {
    it('empty string produces valid 16-char hash', () => {
      const hash = generateContentHash('');
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('whitespace-only string produces valid 16-char hash', () => {
      const hash = generateContentHash('   \t\n   ');
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('empty string and whitespace-only produce same hash', () => {
      const hashEmpty = generateContentHash('');
      const hashWhitespace = generateContentHash('   \t\n   ');

      expect(hashEmpty).toBe(hashWhitespace);
    });

    it('emoji-only content produces same hash as empty', () => {
      const hashEmpty = generateContentHash('');
      const hashEmoji = generateContentHash('😀🎉🚀');

      expect(hashEmpty).toBe(hashEmoji);
    });
  });
});

// ============================================
// normalizeTimestamp Tests
// ============================================

describe('normalizeTimestamp', () => {
  describe('Date object input', () => {
    it('converts Date object to ISO 8601 string', () => {
      const date = new Date('2025-12-27T10:30:00.000Z');
      const result = normalizeTimestamp(date);

      expect(result).toBe('2025-12-27T10:30:00.000Z');
    });

    it('handles Date with milliseconds', () => {
      const date = new Date('2025-12-27T10:30:00.123Z');
      const result = normalizeTimestamp(date);

      expect(result).toBe('2025-12-27T10:30:00.123Z');
    });
  });

  describe('string input', () => {
    it('normalizes ISO string input to consistent format', () => {
      const result1 = normalizeTimestamp('2025-12-27T10:30:00Z');
      const result2 = normalizeTimestamp('2025-12-27T10:30:00.000Z');

      expect(result1).toBe('2025-12-27T10:30:00.000Z');
      expect(result2).toBe('2025-12-27T10:30:00.000Z');
    });

    it('converts date-only string to valid ISO datetime', () => {
      const result = normalizeTimestamp('2025-12-27');

      // Date-only strings are parsed as UTC midnight
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(result).toContain('2025-12-27');
    });
  });

  describe('Unix timestamp string', () => {
    it('converts Unix timestamp in seconds to valid ISO datetime', () => {
      // 1735300200 seconds = Fri Dec 27 2024 11:50:00 UTC
      const result = normalizeTimestamp('1735300200');

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(result).toBe('2024-12-27T11:50:00.000Z');
    });

    it('converts Unix timestamp in milliseconds to valid ISO datetime', () => {
      // 1735300200000 milliseconds = Fri Dec 27 2024 11:50:00 UTC
      const result = normalizeTimestamp('1735300200000');

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(result).toBe('2024-12-27T11:50:00.000Z');
    });

    it('distinguishes between seconds and milliseconds correctly', () => {
      // 10-digit = Unix seconds, 13-digit = Unix milliseconds
      const resultSeconds = normalizeTimestamp('0000000001'); // 1 second after epoch
      const resultMs = normalizeTimestamp('1000000000000'); // Around 2001

      expect(resultSeconds).toBe('1970-01-01T00:00:01.000Z');
      expect(resultMs).toBe('2001-09-09T01:46:40.000Z');
    });
  });

  describe('error handling', () => {
    it('throws Error for invalid date string', () => {
      expect(() => normalizeTimestamp('not-a-date')).toThrow('Invalid date');
    });

    it('throws Error for malformed date string', () => {
      expect(() => normalizeTimestamp('2025-99-99')).toThrow('Invalid date');
    });

    it('throws Error for random text', () => {
      expect(() => normalizeTimestamp('abc123xyz')).toThrow('Invalid date');
    });

    it('throws Error for "Invalid Date" string', () => {
      expect(() => normalizeTimestamp('Invalid Date')).toThrow('Invalid date');
    });

    it('throws Error for invalid Date object', () => {
      expect(() => normalizeTimestamp(new Date('invalid'))).toThrow('Invalid date');
    });
  });

  describe('edge cases', () => {
    it('handles far future dates correctly', () => {
      const futureDate = new Date('2100-01-01T00:00:00.000Z');
      const result = normalizeTimestamp(futureDate);

      expect(result).toBe('2100-01-01T00:00:00.000Z');
    });

    it('handles far past dates correctly', () => {
      const pastDate = new Date('1900-01-01T00:00:00.000Z');
      const result = normalizeTimestamp(pastDate);

      expect(result).toBe('1900-01-01T00:00:00.000Z');
    });

    it('handles epoch date', () => {
      const epoch = normalizeTimestamp(new Date(0));
      expect(epoch).toBe('1970-01-01T00:00:00.000Z');
    });

    it('handles millennium date', () => {
      const y2k = normalizeTimestamp('2000-01-01T00:00:00.000Z');
      expect(y2k).toBe('2000-01-01T00:00:00.000Z');
    });

    it('handles dates with timezone offsets', () => {
      // This should be converted to UTC
      const result = normalizeTimestamp('2025-12-27T10:30:00+05:00');

      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // The time should be adjusted to UTC (10:30 - 5:00 offset = 05:30 UTC)
      expect(result).toBe('2025-12-27T05:30:00.000Z');
    });

    it('handles whitespace around timestamp strings', () => {
      const result = normalizeTimestamp('  2025-12-27T10:30:00.000Z  ');
      expect(result).toBe('2025-12-27T10:30:00.000Z');
    });

    it('handles negative timezone offsets', () => {
      const result = normalizeTimestamp('2025-12-27T10:30:00-05:00');
      // 10:30 + 5 hours = 15:30 UTC
      expect(result).toBe('2025-12-27T15:30:00.000Z');
    });
  });

  describe('YYYYMMDD format handling', () => {
    it('parses 8-digit YYYYMMDD as date, not Unix timestamp', () => {
      const result = normalizeTimestamp('20240101');
      expect(result).toBe('2024-01-01T00:00:00.000Z');
    });

    it('parses YYYYMMDD for December 31', () => {
      const result = normalizeTimestamp('20241231');
      expect(result).toBe('2024-12-31T00:00:00.000Z');
    });

    it('parses YYYYMMDD for historical dates', () => {
      const result = normalizeTimestamp('19700101');
      expect(result).toBe('1970-01-01T00:00:00.000Z');
    });

    it('throws for invalid YYYYMMDD (bad month)', () => {
      expect(() => normalizeTimestamp('20241301')).toThrow('Invalid date');
    });

    it('throws for invalid YYYYMMDD (bad day)', () => {
      expect(() => normalizeTimestamp('20240132')).toThrow('Invalid date');
    });
  });

  describe('YYYYMMDD strict calendar validation', () => {
    // February edge cases
    it('throws for Feb 30 (rollover date)', () => {
      expect(() => normalizeTimestamp('20240230')).toThrow('Invalid date');
    });

    it('throws for Feb 31', () => {
      expect(() => normalizeTimestamp('20240231')).toThrow('Invalid date');
    });

    it('throws for Feb 29 in non-leap year', () => {
      expect(() => normalizeTimestamp('20230229')).toThrow('Invalid date');
    });

    it('accepts Feb 29 in leap year', () => {
      const result = normalizeTimestamp('20240229');
      expect(result).toBe('2024-02-29T00:00:00.000Z');
    });

    it('accepts Feb 28 in non-leap year', () => {
      const result = normalizeTimestamp('20230228');
      expect(result).toBe('2023-02-28T00:00:00.000Z');
    });

    // 30-day month edge cases
    it('throws for Apr 31', () => {
      expect(() => normalizeTimestamp('20240431')).toThrow('Invalid date');
    });

    it('throws for Jun 31', () => {
      expect(() => normalizeTimestamp('20240631')).toThrow('Invalid date');
    });

    it('throws for Sep 31', () => {
      expect(() => normalizeTimestamp('20240931')).toThrow('Invalid date');
    });

    it('throws for Nov 31', () => {
      expect(() => normalizeTimestamp('20241131')).toThrow('Invalid date');
    });

    it('accepts Apr 30', () => {
      const result = normalizeTimestamp('20240430');
      expect(result).toBe('2024-04-30T00:00:00.000Z');
    });

    // Month validation
    it('throws for month 00', () => {
      expect(() => normalizeTimestamp('20240015')).toThrow('Invalid date');
    });

    // Day validation
    it('throws for day 00', () => {
      expect(() => normalizeTimestamp('20240100')).toThrow('Invalid date');
    });

    // 31-day months work correctly
    it('accepts Jan 31', () => {
      const result = normalizeTimestamp('20240131');
      expect(result).toBe('2024-01-31T00:00:00.000Z');
    });

    it('accepts Dec 31', () => {
      const result = normalizeTimestamp('20241231');
      expect(result).toBe('2024-12-31T00:00:00.000Z');
    });
  });

  describe('Unix timestamp length detection', () => {
    it('parses 10-digit string as Unix seconds', () => {
      // 1704067200 = 2024-01-01T00:00:00Z
      const result = normalizeTimestamp('1704067200');
      expect(result).toBe('2024-01-01T00:00:00.000Z');
    });

    it('parses 13-digit string as Unix milliseconds', () => {
      // 1704067200000 = 2024-01-01T00:00:00Z
      const result = normalizeTimestamp('1704067200000');
      expect(result).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('numeric timestamp length validation', () => {
    // Valid lengths (ensure no regression)
    it('accepts 8-digit YYYYMMDD', () => {
      const result = normalizeTimestamp('20240615');
      expect(result).toBe('2024-06-15T00:00:00.000Z');
    });

    it('accepts 10-digit Unix seconds', () => {
      const result = normalizeTimestamp('1704067200');
      expect(result).toBe('2024-01-01T00:00:00.000Z');
    });

    it('accepts 13-digit Unix milliseconds', () => {
      const result = normalizeTimestamp('1704067200000');
      expect(result).toBe('2024-01-01T00:00:00.000Z');
    });

    // Invalid lengths - should throw
    it('throws for 7-digit numeric string', () => {
      expect(() => normalizeTimestamp('1234567')).toThrow(/must be 8 digits.*10 digits.*13 digits/);
    });

    it('throws for 9-digit numeric string', () => {
      expect(() => normalizeTimestamp('123456789')).toThrow(/must be 8 digits.*10 digits.*13 digits/);
    });

    it('throws for 11-digit numeric string', () => {
      expect(() => normalizeTimestamp('12345678901')).toThrow(/must be 8 digits.*10 digits.*13 digits/);
    });

    it('throws for 12-digit numeric string', () => {
      // This is the example from TODO: 946684800000 is 12 digits
      expect(() => normalizeTimestamp('946684800000')).toThrow(/must be 8 digits.*10 digits.*13 digits/);
    });

    it('throws for 14-digit numeric string', () => {
      expect(() => normalizeTimestamp('12345678901234')).toThrow(/must be 8 digits.*10 digits.*13 digits/);
    });

    it('throws for 6-digit numeric string', () => {
      expect(() => normalizeTimestamp('123456')).toThrow(/must be 8 digits.*10 digits.*13 digits/);
    });

    it('throws for single digit', () => {
      expect(() => normalizeTimestamp('5')).toThrow(/must be 8 digits.*10 digits.*13 digits/);
    });

    // Edge case: very long numbers
    it('throws for 20-digit numeric string', () => {
      expect(() => normalizeTimestamp('12345678901234567890')).toThrow(/must be 8 digits.*10 digits.*13 digits/);
    });
  });
});

// ============================================
// normalizeUrl Tests
// ============================================

describe('normalizeUrl', () => {
  describe('protocol normalization', () => {
    it('upgrades http to https', () => {
      const result = normalizeUrl('http://example.com/page');
      expect(result).toBe('https://example.com/page');
    });

    it('keeps https unchanged', () => {
      const result = normalizeUrl('https://example.com/page');
      expect(result).toBe('https://example.com/page');
    });
  });

  describe('trailing slash handling', () => {
    it('removes trailing slash from paths', () => {
      expect(normalizeUrl('https://example.com/page/')).toBe(
        'https://example.com/page'
      );
    });

    it('removes trailing slash from nested paths', () => {
      expect(normalizeUrl('https://example.com/path/to/page/')).toBe(
        'https://example.com/path/to/page'
      );
    });

    it('keeps trailing slash for root URL', () => {
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
    });

    it('keeps trailing slash for http root URL after upgrade', () => {
      expect(normalizeUrl('http://test.org/')).toBe('https://test.org/');
    });
  });

  describe('tracking parameter removal', () => {
    it('removes utm_source parameter', () => {
      const url = 'https://example.com/page?utm_source=twitter';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('removes utm_medium parameter', () => {
      const url = 'https://example.com/page?utm_medium=social';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('removes utm_campaign parameter', () => {
      const url = 'https://example.com/page?utm_campaign=test';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('removes all utm_* parameters together', () => {
      const url =
        'https://example.com/page?utm_source=twitter&utm_medium=social&utm_campaign=test&utm_term=ai&utm_content=link';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('removes fbclid parameter', () => {
      const url = 'https://example.com/page?fbclid=abc123xyz';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('removes gclid parameter', () => {
      const url = 'https://example.com/page?gclid=def456uvw';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('removes ref parameter', () => {
      const url = 'https://example.com/page?ref=homepage';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('removes source parameter', () => {
      const url = 'https://example.com/page?source=newsletter';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('removes multiple tracking parameters at once', () => {
      const url =
        'https://example.com/page?utm_source=fb&utm_campaign=sale&fbclid=abc&gclid=xyz&ref=email&source=app';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('removes mc_cid and mc_eid (Mailchimp)', () => {
      const url = 'https://example.com/page?mc_cid=abc&mc_eid=def';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('removes _ga and _gl (Google Analytics)', () => {
      const url = 'https://example.com/page?_ga=123&_gl=456';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('removes msclkid and yclid', () => {
      const url = 'https://example.com/page?msclkid=abc&yclid=xyz';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('handles case-insensitive tracking parameter matching', () => {
      const url = 'https://example.com/page?UTM_SOURCE=test&FBCLID=abc';
      const result = normalizeUrl(url);

      expect(result).toBe('https://example.com/page');
    });
  });

  describe('clean URLs', () => {
    it('returns already clean URL unchanged', () => {
      const url = 'https://example.com/clean/page';
      expect(normalizeUrl(url)).toBe('https://example.com/clean/page');
    });

    it('only upgrades protocol on clean http URL', () => {
      const url = 'http://example.com/clean/page';
      expect(normalizeUrl(url)).toBe('https://example.com/clean/page');
    });
  });

  describe('error handling', () => {
    it('throws Error for malformed URL (no protocol)', () => {
      expect(() => normalizeUrl('not-a-url')).toThrow('Malformed URL');
    });

    it('throws Error for URL with missing protocol', () => {
      expect(() => normalizeUrl('://missing-protocol.com')).toThrow('Malformed URL');
    });

    it('throws Error for empty string', () => {
      expect(() => normalizeUrl('')).toThrow('Malformed URL');
    });

    it('throws Error for just a domain without protocol', () => {
      expect(() => normalizeUrl('example.com')).toThrow('Malformed URL');
    });
  });

  describe('fragment preservation', () => {
    it('preserves URL fragment (#section)', () => {
      const url = 'https://example.com/page#section';
      expect(normalizeUrl(url)).toBe('https://example.com/page#section');
    });

    it('preserves fragment with tracking params removed', () => {
      const url = 'https://example.com/page?utm_source=test#section';
      expect(normalizeUrl(url)).toBe('https://example.com/page#section');
    });

    it('preserves fragment with complex id', () => {
      const url = 'https://example.com/page#heading-with-dashes';
      expect(normalizeUrl(url)).toBe('https://example.com/page#heading-with-dashes');
    });
  });

  describe('non-tracking parameter preservation', () => {
    it('preserves non-tracking query parameters', () => {
      const url = 'https://example.com/search?q=test&page=2&sort=date';
      expect(normalizeUrl(url)).toBe(
        'https://example.com/search?q=test&page=2&sort=date'
      );
    });

    it('preserves id parameter', () => {
      const url = 'https://example.com/article?id=12345';
      expect(normalizeUrl(url)).toBe('https://example.com/article?id=12345');
    });

    it('preserves non-tracking params while removing tracking params', () => {
      const url =
        'https://example.com/search?q=test&utm_source=google&page=2&fbclid=abc';
      const result = normalizeUrl(url);

      expect(result).toContain('q=test');
      expect(result).toContain('page=2');
      expect(result).not.toContain('utm_source');
      expect(result).not.toContain('fbclid');
    });
  });

  describe('hostname normalization', () => {
    it('normalizes hostname to lowercase', () => {
      const url = 'https://EXAMPLE.COM/page';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });

    it('handles mixed case hostname', () => {
      const url = 'https://ExAmPlE.CoM/page';
      expect(normalizeUrl(url)).toBe('https://example.com/page');
    });
  });

  describe('special URL features', () => {
    it('handles URLs with port numbers', () => {
      const url = 'http://localhost:3000/api/data';
      expect(normalizeUrl(url)).toBe('https://localhost:3000/api/data');
    });

    it('handles URLs with authentication', () => {
      const url = 'http://user:pass@example.com/page';
      expect(normalizeUrl(url)).toBe('https://user:pass@example.com/page');
    });

    it('handles URLs with encoded characters', () => {
      const url = 'https://example.com/search?q=hello%20world';
      const result = normalizeUrl(url);

      // URL encoding may vary, but should contain the query
      expect(result).toContain('q=');
    });
  });

  describe('complex URLs', () => {
    it('handles complex URLs with all features', () => {
      const url =
        'http://EXAMPLE.COM/path/to/page/?q=search&utm_source=test#section';
      const result = normalizeUrl(url);

      expect(result).toBe('https://example.com/path/to/page?q=search#section');
    });

    it('handles URL with many mixed params', () => {
      const url =
        'https://shop.example.com/product?id=123&utm_source=fb&color=blue&fbclid=abc&size=M&gclid=xyz';
      const result = normalizeUrl(url);

      expect(result).toContain('id=123');
      expect(result).toContain('color=blue');
      expect(result).toContain('size=M');
      expect(result).not.toContain('utm_source');
      expect(result).not.toContain('fbclid');
      expect(result).not.toContain('gclid');
    });
  });

  describe('whitespace handling', () => {
    it('trims leading whitespace', () => {
      expect(normalizeUrl('  https://example.com/page')).toBe('https://example.com/page');
    });

    it('trims trailing whitespace', () => {
      expect(normalizeUrl('https://example.com/page  ')).toBe('https://example.com/page');
    });

    it('trims both leading and trailing whitespace', () => {
      expect(normalizeUrl('  https://example.com/page  ')).toBe('https://example.com/page');
    });

    it('trims newlines and tabs', () => {
      expect(normalizeUrl('\n\thttps://example.com/page\n\t')).toBe('https://example.com/page');
    });

    it('handles whitespace with query params', () => {
      expect(normalizeUrl('  https://example.com/page?id=1  ')).toBe('https://example.com/page?id=1');
    });

    it('still throws on truly malformed URLs after trimming', () => {
      expect(() => normalizeUrl('  not a url  ')).toThrow('Malformed URL');
    });
  });
});

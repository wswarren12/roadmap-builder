import { describe, expect, it } from 'vitest';
import {
  isValidEmail,
  normalizeEmail,
  slugify,
  validateDatesWithin,
  validateMilestoneDate,
  validateRoadmapRange,
} from '@/lib/validate';

describe('validateRoadmapRange (AC-1.1, AC-1.3)', () => {
  it('accepts 3–12 month ranges', () => {
    expect(validateRoadmapRange('2026-07-01', '2026-09-01')).toBeNull();
    expect(validateRoadmapRange('2026-07-01', '2027-06-01')).toBeNull();
  });

  it('rejects 2-month and 13-month ranges', () => {
    expect(validateRoadmapRange('2026-07-01', '2026-08-01')).not.toBeNull();
    expect(validateRoadmapRange('2026-07-01', '2027-07-01')).not.toBeNull();
  });

  it('rejects inverted and malformed ranges', () => {
    expect(validateRoadmapRange('2026-07-01', '2026-05-01')).not.toBeNull();
    expect(validateRoadmapRange('2026-07-15', '2026-10-01')).not.toBeNull(); // not first-of-month
    expect(validateRoadmapRange(undefined, '2026-10-01')).not.toBeNull();
  });
});

describe('validateDatesWithin (AC-2.6, AC-4.4)', () => {
  const span = { start: '2026-07-01', end: '2026-12-31' };

  it('accepts dates inside the span', () => {
    expect(validateDatesWithin('2026-08-01', '2026-09-15', span.start, span.end, 'x')).toBeNull();
  });

  it('rejects start > end', () => {
    expect(validateDatesWithin('2026-09-01', '2026-08-01', span.start, span.end, 'x')).not.toBeNull();
  });

  it('rejects dates outside the span', () => {
    expect(validateDatesWithin('2026-06-30', '2026-08-01', span.start, span.end, 'x')).not.toBeNull();
    expect(validateDatesWithin('2026-08-01', '2027-01-01', span.start, span.end, 'x')).not.toBeNull();
  });
});

describe('validateMilestoneDate (AC-2.4)', () => {
  it('allows empty milestone dates', () => {
    expect(validateMilestoneDate(null, '2026-07-01', '2026-08-01')).toBeNull();
    expect(validateMilestoneDate('', '2026-07-01', '2026-08-01')).toBeNull();
  });

  it('requires the milestone inside the item span', () => {
    expect(validateMilestoneDate('2026-07-15', '2026-07-01', '2026-08-01')).toBeNull();
    expect(validateMilestoneDate('2026-09-01', '2026-07-01', '2026-08-01')).not.toBeNull();
  });
});

describe('email handling (AC-6.1, AC-6.5)', () => {
  it('validates format', () => {
    expect(isValidEmail('teammate@company.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('normalizes case-insensitively', () => {
    expect(normalizeEmail('  TeamMate@Company.COM ')).toBe('teammate@company.com');
  });
});

describe('slugify (AC-8 filenames)', () => {
  it('slugifies titles', () => {
    expect(slugify('H2 2026 Platform Roadmap')).toBe('h2-2026-platform-roadmap');
    expect(slugify('  Weird — Chars! ')).toBe('weird-chars');
    expect(slugify('')).toBe('untitled');
  });
});

import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayOffsetInSpan,
  daysBetween,
  daysInMonth,
  isValidISODate,
  mondayIndex,
  monthColumns,
  monthsInclusive,
  rangeEndDate,
  rangeTotalDays,
  weekColumns,
} from '@/lib/dates';

describe('date primitives', () => {
  it('validates ISO dates strictly', () => {
    expect(isValidISODate('2026-07-22')).toBe(true);
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-7-2')).toBe(false);
    expect(isValidISODate('nope')).toBe(false);
    expect(isValidISODate(null)).toBe(false);
  });

  it('adds days across month/year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('adds months clamping to shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01');
  });

  it('computes inclusive month counts', () => {
    expect(monthsInclusive('2026-07-01', '2026-09-01')).toBe(3);
    expect(monthsInclusive('2026-07-01', '2027-06-01')).toBe(12);
    expect(monthsInclusive('2026-07-01', '2026-07-01')).toBe(1);
  });

  it('knows month lengths incl. leap years', () => {
    expect(daysInMonth('2026-02-01')).toBe(28);
    expect(daysInMonth('2028-02-01')).toBe(29);
    expect(daysInMonth('2026-07-01')).toBe(31);
  });

  it('computes range end and total days', () => {
    expect(rangeEndDate('2026-12-01')).toBe('2026-12-31');
    expect(rangeTotalDays('2026-07-01', '2026-09-01')).toBe(31 + 31 + 30);
  });
});

describe('monthColumns', () => {
  it('renders one column per month with cumulative offsets (AC-1.1)', () => {
    const cols = monthColumns('2026-07-01', '2026-10-01');
    expect(cols.map((c) => c.label)).toEqual(['Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026']);
    expect(cols.map((c) => c.startOffset)).toEqual([0, 31, 62, 92]);
  });
});

describe('weekColumns (AC-3.1)', () => {
  it('covers exactly the span with partial edge weeks', () => {
    // Mar 10 2026 is a Tuesday; May 20 2026 is a Wednesday.
    const cols = weekColumns('2026-03-10', '2026-05-20');
    expect(cols[0].start).toBe('2026-03-10');
    expect(cols[0].partial).toBe(true);
    expect(cols[0].days).toBe(6); // Tue..Sun
    expect(cols[cols.length - 1].end).toBe('2026-05-20');
    expect(cols[cols.length - 1].partial).toBe(true);
    // Interior weeks are full Mon-Sun.
    for (const col of cols.slice(1, -1)) {
      expect(col.days).toBe(7);
      expect(mondayIndex(col.start)).toBe(0);
    }
    // Continuous coverage, no gaps.
    const total = cols.reduce((sum, c) => sum + c.days, 0);
    expect(total).toBe(daysBetween('2026-03-10', '2026-05-20') + 1);
  });

  it('handles a span within a single week', () => {
    const cols = weekColumns('2026-07-22', '2026-07-24');
    expect(cols).toHaveLength(1);
    expect(cols[0].days).toBe(3);
  });

  it('starts weeks on Monday', () => {
    // 2026-07-20 is a Monday.
    expect(mondayIndex('2026-07-20')).toBe(0);
    expect(mondayIndex('2026-07-26')).toBe(6);
    const cols = weekColumns('2026-07-20', '2026-08-02');
    expect(cols).toHaveLength(2);
    expect(cols.every((c) => c.days === 7)).toBe(true);
  });
});

describe('dayOffsetInSpan (today line math, AC-9.1)', () => {
  it('returns offset inside the span and null outside', () => {
    expect(dayOffsetInSpan('2026-07-01', '2026-07-31', '2026-07-22')).toBe(21);
    expect(dayOffsetInSpan('2026-07-01', '2026-07-31', '2026-08-01')).toBeNull();
    expect(dayOffsetInSpan('2026-07-01', '2026-07-31', '2026-06-30')).toBeNull();
  });
});

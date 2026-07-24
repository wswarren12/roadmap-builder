import {
  isValidISODate,
  monthsInclusive,
  rangeEndDate,
  toUTC,
} from './dates';

export const MAX_INITIATIVES = 5;
export const MIN_MONTHS = 3;
export const MAX_MONTHS = 12;

export interface ValidationError {
  field: string;
  message: string;
}

export function validateRoadmapRange(
  startMonth: unknown,
  endMonth: unknown,
): ValidationError | null {
  if (!isValidISODate(startMonth) || !startMonth.endsWith('-01')) {
    return { field: 'startMonth', message: 'Start month must be a valid month' };
  }
  if (!isValidISODate(endMonth) || !endMonth.endsWith('-01')) {
    return { field: 'endMonth', message: 'End month must be a valid month' };
  }
  if (toUTC(endMonth) < toUTC(startMonth)) {
    return { field: 'endMonth', message: 'End month must be after start month' };
  }
  const months = monthsInclusive(startMonth, endMonth);
  if (months < MIN_MONTHS || months > MAX_MONTHS) {
    return {
      field: 'endMonth',
      message: `Roadmap must cover 3–12 months (this range covers ${months})`,
    };
  }
  return null;
}

/** Validates a start/end pair falls inside an allowed span (inclusive). */
export function validateDatesWithin(
  startDate: unknown,
  endDate: unknown,
  spanStart: string,
  spanEndInclusive: string,
  spanName: string,
): ValidationError | null {
  if (!isValidISODate(startDate)) {
    return { field: 'startDate', message: 'Start date is required (YYYY-MM-DD)' };
  }
  if (!isValidISODate(endDate)) {
    return { field: 'endDate', message: 'End date is required (YYYY-MM-DD)' };
  }
  if (toUTC(startDate) > toUTC(endDate)) {
    return { field: 'endDate', message: 'End date must be on or after start date' };
  }
  if (toUTC(startDate) < toUTC(spanStart) || toUTC(endDate) > toUTC(spanEndInclusive)) {
    return {
      field: 'startDate',
      message: `Dates must fall within ${spanName}`,
    };
  }
  return null;
}

export function validateMilestoneDate(
  milestoneDate: unknown,
  startDate: string,
  endDate: string,
): ValidationError | null {
  if (milestoneDate == null || milestoneDate === '') return null;
  if (!isValidISODate(milestoneDate)) {
    return { field: 'milestoneDate', message: 'Milestone date must be a valid date' };
  }
  if (toUTC(milestoneDate) < toUTC(startDate) || toUTC(milestoneDate) > toUTC(endDate)) {
    return {
      field: 'milestoneDate',
      message: 'Milestone date must fall within the item dates',
    };
  }
  return null;
}

export function roadmapSpan(roadmap: { startMonth: string; endMonth: string }) {
  return { start: roadmap.startMonth, end: rangeEndDate(roadmap.endMonth) };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled'
  );
}

export function requireNonEmpty(value: unknown, field: string): ValidationError | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { field, message: `${field} is required` };
  }
  return null;
}

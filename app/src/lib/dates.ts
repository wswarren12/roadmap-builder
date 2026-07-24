// Pure date math on ISO strings ('YYYY-MM-DD'). All arithmetic uses UTC to
// avoid DST drift; only todayISO() reads the local clock (the calendar is a
// local-time concept for the person looking at it).

const DAY_MS = 86_400_000;

export function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromUTC(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isValidISODate(iso: unknown): iso is string {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const ms = toUTC(iso);
  return !Number.isNaN(ms) && fromUTC(ms) === iso;
}

export function addDays(iso: string, days: number): string {
  return fromUTC(toUTC(iso) + days * DAY_MS);
}

/** Whole days from a to b (positive when b is after a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return fromUTC(Date.UTC(ny, nm, nd));
}

export function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function daysInMonth(monthISO: string): number {
  const [y, m] = monthISO.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Inclusive count of months from startMonth to endMonth (both 'YYYY-MM-01'). */
export function monthsInclusive(startMonth: string, endMonth: string): number {
  const [sy, sm] = startMonth.split('-').map(Number);
  const [ey, em] = endMonth.split('-').map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

export interface MonthColumn {
  monthISO: string; // 'YYYY-MM-01'
  label: string; // 'Jul 2026'
  days: number;
  startOffset: number; // days from range start
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function monthLabel(monthISO: string): string {
  const [y, m] = monthISO.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Month columns spanning startMonth..endMonth inclusive. */
export function monthColumns(startMonth: string, endMonth: string): MonthColumn[] {
  const count = monthsInclusive(startMonth, endMonth);
  const cols: MonthColumn[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const monthISO = firstOfMonth(addMonths(startMonth, i));
    const days = daysInMonth(monthISO);
    cols.push({ monthISO, label: monthLabel(monthISO), days, startOffset: offset });
    offset += days;
  }
  return cols;
}

/** Last calendar day of the roadmap range. */
export function rangeEndDate(endMonth: string): string {
  return addDays(addMonths(endMonth, 1), -1);
}

/** Total days covered by a roadmap range. */
export function rangeTotalDays(startMonth: string, endMonth: string): number {
  return daysBetween(startMonth, rangeEndDate(endMonth)) + 1;
}

export interface WeekColumn {
  start: string; // clipped to span
  end: string; // inclusive, clipped to span
  days: number;
  startOffset: number; // days from span start
  label: string; // 'Mar 10'
  partial: boolean;
}

/** ISO weekday, Monday = 0. */
export function mondayIndex(iso: string): number {
  return (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
}

/**
 * Week columns (Monday-start) covering exactly start..end inclusive.
 * Partial first/last weeks are clipped to the span (AC-3.1).
 */
export function weekColumns(start: string, end: string): WeekColumn[] {
  const cols: WeekColumn[] = [];
  let cursor = start;
  while (toUTC(cursor) <= toUTC(end)) {
    const weekStartFull = addDays(cursor, -mondayIndex(cursor));
    const weekEndFull = addDays(weekStartFull, 6);
    const colEnd = toUTC(weekEndFull) <= toUTC(end) ? weekEndFull : end;
    const days = daysBetween(cursor, colEnd) + 1;
    const [, m, d] = cursor.split('-').map(Number);
    cols.push({
      start: cursor,
      end: colEnd,
      days,
      startOffset: daysBetween(start, cursor),
      label: `${MONTH_NAMES[m - 1]} ${d}`,
      partial: days < 7,
    });
    cursor = addDays(colEnd, 1);
  }
  return cols;
}

export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Day offset of `date` within a span starting at `spanStart`, or null if outside. */
export function dayOffsetInSpan(
  spanStart: string,
  spanEndInclusive: string,
  date: string,
): number | null {
  const off = daysBetween(spanStart, date);
  if (off < 0 || off > daysBetween(spanStart, spanEndInclusive)) return null;
  return off;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

export function formatRange(start: string, end: string): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

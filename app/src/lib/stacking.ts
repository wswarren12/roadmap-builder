import { toUTC } from './dates';

export interface Spannable {
  id: string;
  startDate: string;
  endDate: string;
}

export interface StackResult {
  lanes: Map<string, number>;
  laneCount: number;
}

/**
 * Greedy interval-graph lane assignment (PRD §9): sort by start date (ties by
 * end date, then id for determinism), place each bar in the lowest lane whose
 * last bar ends strictly before this bar starts. Dates are inclusive, so bars
 * sharing a day overlap.
 */
export function assignLanes(items: Spannable[]): StackResult {
  const sorted = [...items].sort((a, b) => {
    const s = toUTC(a.startDate) - toUTC(b.startDate);
    if (s !== 0) return s;
    const e = toUTC(a.endDate) - toUTC(b.endDate);
    if (e !== 0) return e;
    return a.id < b.id ? -1 : 1;
  });

  const lanes = new Map<string, number>();
  const laneEnds: number[] = []; // last occupied end (UTC ms) per lane

  for (const item of sorted) {
    const start = toUTC(item.startDate);
    let lane = laneEnds.findIndex((end) => end < start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(toUTC(item.endDate));
    } else {
      laneEnds[lane] = toUTC(item.endDate);
    }
    lanes.set(item.id, lane);
  }

  return { lanes, laneCount: Math.max(1, laneEnds.length) };
}

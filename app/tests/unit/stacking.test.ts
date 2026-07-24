import { describe, expect, it } from 'vitest';
import { assignLanes } from '@/lib/stacking';

const bar = (id: string, startDate: string, endDate: string) => ({ id, startDate, endDate });

describe('assignLanes (AC-2.2, AC-4.2)', () => {
  it('gives non-overlapping bars the same lane', () => {
    const { lanes, laneCount } = assignLanes([
      bar('a', '2026-07-01', '2026-07-10'),
      bar('b', '2026-07-11', '2026-07-20'),
    ]);
    expect(lanes.get('a')).toBe(0);
    expect(lanes.get('b')).toBe(0);
    expect(laneCount).toBe(1);
  });

  it('stacks overlapping bars into separate lanes', () => {
    const { lanes, laneCount } = assignLanes([
      bar('a', '2026-07-01', '2026-07-15'),
      bar('b', '2026-07-10', '2026-07-25'),
      bar('c', '2026-07-14', '2026-07-16'),
    ]);
    expect(lanes.get('a')).toBe(0);
    expect(lanes.get('b')).toBe(1);
    expect(lanes.get('c')).toBe(2);
    expect(laneCount).toBe(3);
  });

  it('treats same-day touch as overlap (inclusive dates)', () => {
    const { laneCount } = assignLanes([
      bar('a', '2026-07-01', '2026-07-10'),
      bar('b', '2026-07-10', '2026-07-20'),
    ]);
    expect(laneCount).toBe(2);
  });

  it('reuses freed lanes greedily', () => {
    const { lanes } = assignLanes([
      bar('a', '2026-07-01', '2026-07-05'),
      bar('b', '2026-07-03', '2026-07-20'),
      bar('c', '2026-07-07', '2026-07-09'), // lane 0 free again
    ]);
    expect(lanes.get('c')).toBe(0);
  });

  it('is deterministic regardless of input order', () => {
    const items = [
      bar('a', '2026-07-01', '2026-07-15'),
      bar('b', '2026-07-10', '2026-07-25'),
      bar('c', '2026-07-20', '2026-07-30'),
    ];
    const forward = assignLanes(items);
    const reversed = assignLanes([...items].reverse());
    for (const id of ['a', 'b', 'c']) {
      expect(forward.lanes.get(id)).toBe(reversed.lanes.get(id));
    }
  });

  it('reports at least one lane for empty rows', () => {
    expect(assignLanes([]).laneCount).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { columnFor, movePatch } from '@/components/BoardView';
import { ITEM_STATUSES } from '@/lib/types';

describe('board column mapping', () => {
  it('puts each item in its status column, completed outranks status', () => {
    for (const status of ITEM_STATUSES) {
      expect(columnFor({ status, completedAt: null })).toBe(status);
      expect(columnFor({ status, completedAt: '2026-08-01' })).toBe('completed');
    }
  });

  it('round-trips: moving into a column yields an item that maps back to that column', () => {
    for (const col of [...ITEM_STATUSES, 'completed' as const]) {
      const patch = movePatch(col);
      const moved = { status: 'red' as const, completedAt: null, ...patch };
      expect(columnFor(moved)).toBe(col);
    }
    // Leaving Completed clears the completion date rather than keeping a done item in a status column.
    expect(movePatch('yellow')).toEqual({ status: 'yellow', completedAt: null });
  });
});

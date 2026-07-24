import { describe, expect, it } from 'vitest';
import { ITEM_PALETTE, SPRINT_COLOR, itemColor } from '@/lib/colors';

describe('color assignment (AC-2.1, AC-4.1)', () => {
  it('has 10 distinct palette entries', () => {
    expect(ITEM_PALETTE).toHaveLength(10);
    expect(new Set(ITEM_PALETTE).size).toBe(10);
  });

  it('assigns deterministically and cycles past the palette length', () => {
    expect(itemColor(0)).toBe(ITEM_PALETTE[0]);
    expect(itemColor(9)).toBe(ITEM_PALETTE[9]);
    expect(itemColor(10)).toBe(ITEM_PALETTE[0]);
    expect(itemColor(23)).toBe(ITEM_PALETTE[3]);
  });

  it('uses the PL brand blue as the uniform sprint color', () => {
    expect(SPRINT_COLOR).toBe('#1B4CFE');
  });
});

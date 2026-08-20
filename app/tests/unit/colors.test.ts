import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE_ID,
  ITEM_PALETTE,
  PALETTES,
  barColor,
  completedColor,
  getPalette,
  itemColor,
  sprintColor,
} from '@/lib/colors';

describe('color palettes (AC-2.1, AC-4.1)', () => {
  it('offers exactly 3 palettes with distinct hues each', () => {
    expect(PALETTES).toHaveLength(3);
    for (const p of PALETTES) {
      expect(new Set(p.colors).size).toBe(p.colors.length);
      expect(p.colors).not.toContain(p.completed);
    }
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(3);
  });

  it('defaults to the PL palette (blues + PL green for completed)', () => {
    expect(DEFAULT_PALETTE_ID).toBe('pl');
    expect(getPalette(undefined).id).toBe('pl');
    expect(getPalette(null).id).toBe('pl');
    expect(getPalette('nonsense').id).toBe('pl');
    expect(getPalette('pl').colors[0]).toBe('#1B4CFE'); // PL brand blue
    expect(getPalette('pl').completed).toBe('#067647'); // PL green
  });

  it('every palette has a green-ish completed color', () => {
    for (const p of PALETTES) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(p.completed.slice(i, i + 2), 16));
      expect(g).toBeGreaterThan(r); // green channel dominates
      expect(g).toBeGreaterThan(b);
    }
  });

  it('assigns deterministically and cycles past the palette length', () => {
    const n = ITEM_PALETTE.length;
    expect(itemColor(0)).toBe(ITEM_PALETTE[0]);
    expect(itemColor(n - 1)).toBe(ITEM_PALETTE[n - 1]);
    expect(itemColor(n)).toBe(ITEM_PALETTE[0]);
    expect(itemColor(2, 'sunset')).toBe(getPalette('sunset').colors[2]);
  });

  it('uses the palette green for completed bars, the hue otherwise', () => {
    expect(barColor({ colorIndex: 1, completedAt: null }, 'pl')).toBe(itemColor(1, 'pl'));
    expect(barColor({ colorIndex: 1, completedAt: '2026-08-01' }, 'pl')).toBe(
      completedColor('pl'),
    );
    expect(barColor({ colorIndex: 0, completedAt: '2026-08-01' }, 'sunset')).toBe(
      getPalette('sunset').completed,
    );
  });

  it('keeps the PL brand blue as the uniform sprint color on the default palette', () => {
    expect(sprintColor('pl')).toBe('#1B4CFE');
    expect(sprintColor(undefined)).toBe('#1B4CFE');
  });
});

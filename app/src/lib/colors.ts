/**
 * Roadmap color palettes. Each roadmap picks one at creation (default 'pl'):
 * `colors` are the item-bar hues assigned deterministically by color_index
 * (creation order % length, cycling past the end), `completed` is the
 * green-ish color that replaces an item/sprint bar's hue once it is marked
 * complete. All colors keep AA contrast for white bar text.
 */
export interface Palette {
  id: string;
  name: string;
  /** Item-bar hues, cycled by colorIndex. */
  colors: readonly string[];
  /** Green-ish bar color for completed items/sprints. */
  completed: string;
}

export const PALETTES: readonly Palette[] = [
  {
    // Default: Protocol Labs blues + the PL green for completed work.
    id: 'pl',
    name: 'PL Blues',
    colors: ['#1B4CFE', '#0369A1', '#1D4ED8', '#0E7490', '#1E3A8A', '#3538CD'],
    completed: '#067647', // PL green
  },
  {
    // Warm reds/oranges/pinks; forest green marks completed.
    id: 'sunset',
    name: 'Sunset',
    colors: ['#B42318', '#B54708', '#BE185D', '#7C2D12', '#9F1239', '#92400E'],
    completed: '#15803D',
  },
  {
    // Purples & magentas; emerald marks completed.
    id: 'orchid',
    name: 'Orchid',
    colors: ['#6941C6', '#A21CAF', '#5B21B6', '#7C3AED', '#86198F', '#4338CA'],
    completed: '#047857',
  },
];

export const DEFAULT_PALETTE_ID = 'pl';

/** Unknown/missing palette ids fall back to the default PL palette. */
export function getPalette(paletteId?: string | null): Palette {
  return PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0];
}

/** Modulo base for assigning color_index at item creation (PRD §9). */
export const ITEM_PALETTE = PALETTES[0].colors;

export function itemColor(colorIndex: number, paletteId?: string | null): string {
  const colors = getPalette(paletteId).colors;
  return colors[((colorIndex % colors.length) + colors.length) % colors.length];
}

/** Bar color for a roadmap item: its palette hue, or green once completed. */
export function barColor(
  item: { colorIndex: number; completedAt: string | null },
  paletteId?: string | null,
): string {
  return item.completedAt ? completedColor(paletteId) : itemColor(item.colorIndex, paletteId);
}

/** Green-ish color used for completed items/sprints. */
export function completedColor(paletteId?: string | null): string {
  return getPalette(paletteId).completed;
}

/** Uniform color shared by ALL non-completed sprint bars (PRD req 16). */
export function sprintColor(paletteId?: string | null): string {
  return getPalette(paletteId).colors[0];
}

export const STATUS_COLORS = {
  green: '#12B76A',
  yellow: '#F79009',
  red: '#F04438',
} as const;

/**
 * Fixed accessible palette for roadmap item bars (PRD req 15): 10 distinct
 * hues, all AA-contrast for white bar text. Assigned deterministically by
 * color_index (creation order % length), cycling past the end.
 */
export const ITEM_PALETTE: readonly string[] = [
  '#1B4CFE', // brand blue
  '#0F766E', // teal
  '#7C3AED', // violet
  '#B42318', // red
  '#B54708', // orange
  '#3F6212', // olive
  '#BE185D', // magenta
  '#0369A1', // sky
  '#6941C6', // purple
  '#854D0E', // bronze
];

/** Uniform color shared by ALL sprint bars (PRD req 16, amended): the PL
 *  brand blue. Sprint bars are visually uniform; only item bars cycle hues. */
export const SPRINT_COLOR = '#1B4CFE';

export function itemColor(colorIndex: number): string {
  return ITEM_PALETTE[((colorIndex % ITEM_PALETTE.length) + ITEM_PALETTE.length) % ITEM_PALETTE.length];
}

export const STATUS_COLORS = {
  green: '#12B76A',
  yellow: '#F79009',
  red: '#F04438',
} as const;

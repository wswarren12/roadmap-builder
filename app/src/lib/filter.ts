/**
 * Roadmap view filters (swimlane focus + person). Pure, client-side: they
 * narrow what is rendered and never touch records. `dris` and
 * `responsibleTeam` stay separate fields — a person filter reports WHICH one
 * matched so the UI can label it.
 */
export type PersonMatch = 'dri' | 'team';

const norm = (s: string) => s.trim().toLowerCase();

/** Names in a DRI field. Single-person today; legacy rows may hold "A, B". */
export function driNames(dris: string): string[] {
  return dris.split(',').map((n) => n.trim()).filter(Boolean);
}

export function personMatch(
  item: { dris: string; responsibleTeam: string },
  person: string,
): PersonMatch | null {
  const p = norm(person);
  if (!p) return null;
  if (driNames(item.dris).some((n) => norm(n) === p)) return 'dri';
  if (norm(item.responsibleTeam) === p) return 'team';
  return null;
}

/**
 * Filter choices: `people` = roster names plus any DRI names already on items
 * (legacy free-typed values are never hidden); `teams` = distinct responsible
 * team values not already listed as a person. One control, two groups.
 */
export function personOptions(
  team: { name: string }[],
  items: { dris: string; responsibleTeam: string }[],
): { people: string[]; teams: string[] } {
  const seen = new Map<string, string>();
  for (const name of [...team.map((m) => m.name), ...items.flatMap((i) => driNames(i.dris))]) {
    if (!seen.has(norm(name))) seen.set(norm(name), name);
  }
  const people = [...seen.values()].sort((a, b) => a.localeCompare(b));
  const teams = new Map<string, string>();
  for (const t of items.map((i) => i.responsibleTeam.trim()).filter(Boolean)) {
    if (!seen.has(norm(t)) && !teams.has(norm(t))) teams.set(norm(t), t);
  }
  return { people, teams: [...teams.values()].sort((a, b) => a.localeCompare(b)) };
}

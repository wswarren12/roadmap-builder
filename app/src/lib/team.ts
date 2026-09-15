import type { TeamMember } from './types';

/** "Maria Garcia" → "MG", "Ada" → "A". Used for avatar chips (F-13). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * LabOS portal origin. Profile pages follow the portal's documented entity
 * routes (`/members/:uid`, `/teams/:uid` — see pl-design-system/README.md
 * "Detail view"). The app is framed by this origin, so profile links open in a
 * new tab rather than navigating the iframe away from the roadmap.
 */
export const LABOS_PORTAL = 'https://os.pl.xyz';

/** Profile URL for a LabOS member uid, or null when the person has no uid. */
export function memberProfileUrl(uid: string | null | undefined): string | null {
  return uid ? `${LABOS_PORTAL}/members/${encodeURIComponent(uid)}` : null;
}

/** Profile URL for a LabOS team uid, or null when the team is free text. */
export function teamProfileUrl(uid: string | null | undefined): string | null {
  return uid ? `${LABOS_PORTAL}/teams/${encodeURIComponent(uid)}` : null;
}

export interface DriAvatar {
  name: string;
  image: string | null;
  /** LabOS member uid when this person is a linked profile, else null. */
  uid: string | null;
  /** Roster row id when the name resolved to a roster entry, else null. */
  memberId: string | null;
}

/**
 * Resolve an item's DRI for display.
 *
 * `driMemberId` is the stable assignment: it names one roster row, so two
 * people with the same display name stay distinguishable and a rename does
 * not silently re-point the assignment. The legacy path (no id, or an id
 * whose roster row is gone) still resolves the saved text by name so existing
 * saved assignments keep rendering.
 */
export function driAvatars(
  dris: string,
  members: TeamMember[],
  driMemberId?: string | null,
): DriAvatar[] {
  const assigned = driMemberId ? members.find((m) => m.id === driMemberId) : undefined;
  if (assigned) {
    return [
      {
        name: assigned.name,
        image: assigned.image,
        uid: assigned.memberUid,
        memberId: assigned.id,
      },
    ];
  }
  return dris
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name) => {
      const matches = members.filter((m) => m.name.toLowerCase() === name.toLowerCase());
      // An ambiguous name (two roster rows) resolves to no profile rather than
      // guessing one of them — the picker records an id to disambiguate.
      const match = matches.length === 1 ? matches[0] : undefined;
      return {
        name: match?.name ?? name,
        image: match?.image ?? null,
        uid: match?.memberUid ?? null,
        memberId: match?.id ?? null,
      };
    });
}

/**
 * Display label for a roster entry inside a picker. Duplicate display names
 * are disambiguated by their LabOS uid so an editor can tell two people apart;
 * people with no linked profile are marked instead.
 */
export function pickerLabel(member: TeamMember, roster: TeamMember[]): string {
  const sameName = roster.filter(
    (m) => m.name.trim().toLowerCase() === member.name.trim().toLowerCase(),
  );
  if (!member.memberUid) return `${member.name} · no LabOS profile`;
  if (sameName.length > 1) return `${member.name} · LabOS ${member.memberUid}`;
  return `${member.name} · LabOS`;
}

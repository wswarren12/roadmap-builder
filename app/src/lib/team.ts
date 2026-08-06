import type { TeamMember } from './types';

/** "Maria Garcia" → "MG", "Ada" → "A". Used for avatar chips (F-13). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

export interface DriAvatar {
  name: string;
  image: string | null;
}

/**
 * Resolve a DRI field ("Ada, Maria Garcia") against the team roster:
 * roster matches (case-insensitive name) contribute their profile image;
 * unknown names fall back to initials-only avatars.
 */
export function driAvatars(dris: string, members: TeamMember[]): DriAvatar[] {
  return dris
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name) => {
      const match = members.find((m) => m.name.toLowerCase() === name.toLowerCase());
      return { name: match?.name ?? name, image: match?.image ?? null };
    });
}

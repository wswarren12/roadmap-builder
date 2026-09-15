import type { Store } from './store/types';

/**
 * Assignment identity validation (F-13b).
 *
 * A DRI assignment is stored as a roadmap_team_members row id, so it must
 * belong to THIS roadmap's roster — a foreign id would point an assignment at
 * a person on someone else's roadmap. The saved `dris` text is kept in sync
 * with the roster row's name so existing name-based rendering, filters and
 * PDF export keep working unchanged.
 */
export const TEAM_UID_MAX = 128;

export interface AssignmentPatch {
  dris?: string;
  driMemberId?: string | null;
  responsibleTeam?: string;
  responsibleTeamUid?: string | null;
}

export type AssignmentError = { field: string; message: string };

/**
 * Resolve the assignment fields of a request body against a roadmap's roster.
 * Returns either the normalized patch or a single field error. `undefined`
 * fields are left untouched so unrelated PATCHes never clear an assignment.
 */
export async function resolveAssignment(
  store: Store,
  roadmapId: string,
  body: Record<string, unknown>,
  keys: { dri: 'dris' | 'dri'; team?: boolean } = { dri: 'dris', team: true },
): Promise<{ patch: Record<string, unknown> } | { error: AssignmentError }> {
  const patch: Record<string, unknown> = {};

  if (body.driMemberId !== undefined) {
    const raw = body.driMemberId;
    if (raw === null || raw === '') {
      // Explicit clear: drop both the pointer and the display text.
      patch.driMemberId = null;
      patch[keys.dri] = '';
    } else if (typeof raw !== 'string') {
      return { error: { field: 'driMemberId', message: 'Invalid DRI selection' } };
    } else {
      const roster = await store.listTeamMembers(roadmapId);
      const member = roster.find((m) => m.id === raw);
      if (!member) {
        return {
          error: {
            field: 'driMemberId',
            message: 'That person is not on this roadmap’s team',
          },
        };
      }
      patch.driMemberId = member.id;
      // The roster row is the identity; its name is the display text.
      patch[keys.dri] = member.name;
    }
  } else if (body[keys.dri] !== undefined) {
    // Free-typed text without a picked identity: keep it, clear the pointer.
    patch[keys.dri] = String(body[keys.dri] ?? '');
    patch.driMemberId = null;
  }

  if (keys.team !== false) {
    if (body.responsibleTeamUid !== undefined) {
      const raw = body.responsibleTeamUid;
      if (raw === null || raw === '') {
        patch.responsibleTeamUid = null;
        if (body.responsibleTeam === undefined) patch.responsibleTeam = '';
      } else if (typeof raw !== 'string' || raw.length > TEAM_UID_MAX) {
        return { error: { field: 'responsibleTeamUid', message: 'Invalid team selection' } };
      } else {
        patch.responsibleTeamUid = raw;
      }
    }
    if (body.responsibleTeam !== undefined) {
      patch.responsibleTeam = String(body.responsibleTeam ?? '');
      // Team name typed free-hand with no uid supplied: unlink the profile.
      if (body.responsibleTeamUid === undefined) patch.responsibleTeamUid = null;
    }
  }

  return { patch };
}

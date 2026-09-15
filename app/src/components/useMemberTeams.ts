'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';

/**
 * The signed-in member's own LabOS teams (uid + name), used as the
 * responsible-team picker's options (F-13b). The member-context API only
 * returns the caller's own profile — there is no directory of arbitrary teams
 * — so this is the supported source. Signed out or unavailable resolves to an
 * empty list and the picker says so; it never blocks the form.
 */
export function useMemberTeams(): { uid: string; name: string }[] {
  const [teams, setTeams] = useState<{ uid: string; name: string }[]>([]);
  useEffect(() => {
    api<{ user: { teams?: { uid: string; name: string }[] } }>('/api/me')
      .then((res) => setTeams(res.user.teams ?? []))
      .catch(() => setTeams([]));
  }, []);
  return teams;
}

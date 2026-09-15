import { describe, expect, it } from 'vitest';
import {
  driAvatars,
  memberProfileUrl,
  pickerLabel,
  teamProfileUrl,
  LABOS_PORTAL,
} from '@/lib/team';
import type { TeamMember } from '@/lib/types';

/**
 * Unit scenarios — assignment identity resolution and link destinations
 * (F-13b). These cover what the display components render: which profile an
 * assignment resolves to, and where its link points.
 */

const member = (over: Partial<TeamMember> & { id: string; name: string }): TeamMember => ({
  roadmapId: 'r1',
  memberUid: null,
  image: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const ada = member({
  id: 'tm-ada',
  name: 'Ada Lovelace',
  memberUid: 'u-ada',
  image: 'https://labos.example/ada.png',
});
const alexOne = member({ id: 'tm-a1', name: 'Alex Smith', memberUid: 'u-alex-1' });
const alexTwo = member({ id: 'tm-a2', name: 'Alex Smith', memberUid: 'u-alex-2' });
const manual = member({ id: 'tm-kim', name: 'Contractor Kim' });
const roster = [ada, alexOne, alexTwo, manual];

describe('profile link destinations', () => {
  it('points at the LabOS portal entity routes', () => {
    expect(memberProfileUrl('u-ada')).toBe(`${LABOS_PORTAL}/members/u-ada`);
    expect(teamProfileUrl('t-platform')).toBe(`${LABOS_PORTAL}/teams/t-platform`);
    expect(LABOS_PORTAL).toBe('https://os.pl.xyz');
  });

  it('has no link for an unavailable profile, and escapes odd uids', () => {
    expect(memberProfileUrl(null)).toBeNull();
    expect(memberProfileUrl('')).toBeNull();
    expect(teamProfileUrl(undefined)).toBeNull();
    expect(memberProfileUrl('a/b?c')).toBe(`${LABOS_PORTAL}/members/a%2Fb%3Fc`);
  });
});

describe('DRI resolution', () => {
  it('resolves the stored identity, not the name', () => {
    const [a] = driAvatars('Ada Lovelace', roster, 'tm-ada');
    expect(a).toMatchObject({ name: 'Ada Lovelace', uid: 'u-ada', memberId: 'tm-ada' });
    expect(memberProfileUrl(a.uid)).toBe(`${LABOS_PORTAL}/members/u-ada`);
  });

  it('distinguishes two people who share a display name', () => {
    const [first] = driAvatars('Alex Smith', roster, 'tm-a1');
    const [second] = driAvatars('Alex Smith', roster, 'tm-a2');
    expect(first.uid).toBe('u-alex-1');
    expect(second.uid).toBe('u-alex-2');
    expect(memberProfileUrl(first.uid)).not.toBe(memberProfileUrl(second.uid));
  });

  it('refuses to guess when an ambiguous name has no stored identity', () => {
    const [a] = driAvatars('Alex Smith', roster);
    expect(a.name).toBe('Alex Smith');
    expect(a.uid).toBeNull();
    expect(memberProfileUrl(a.uid)).toBeNull();
  });

  it('keeps a stale identity readable by falling back to the saved text', () => {
    const [a] = driAvatars('Ada Lovelace', roster, 'tm-deleted');
    expect(a.name).toBe('Ada Lovelace');
    expect(a.uid).toBe('u-ada'); // unique name still resolves
    const [b] = driAvatars('Someone Gone', roster, 'tm-deleted');
    expect(b).toMatchObject({ name: 'Someone Gone', uid: null, memberId: null });
  });

  it('gives a roster person without a LabOS profile no link', () => {
    const [a] = driAvatars('Contractor Kim', roster, 'tm-kim');
    expect(a.memberId).toBe('tm-kim');
    expect(a.uid).toBeNull();
    expect(memberProfileUrl(a.uid)).toBeNull();
  });

  it('still renders legacy free-typed names', () => {
    expect(driAvatars('Ada Lovelace, Nobody', roster)).toHaveLength(2);
    expect(driAvatars('', roster)).toHaveLength(0);
  });
});

describe('picker labels', () => {
  it('disambiguates duplicate names by uid and flags unlinked people', () => {
    expect(pickerLabel(ada, roster)).toBe('Ada Lovelace · LabOS');
    expect(pickerLabel(alexOne, roster)).toBe('Alex Smith · LabOS u-alex-1');
    expect(pickerLabel(alexTwo, roster)).toBe('Alex Smith · LabOS u-alex-2');
    expect(pickerLabel(manual, roster)).toBe('Contractor Kim · no LabOS profile');
  });
});

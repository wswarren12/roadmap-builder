import { describe, expect, it } from 'vitest';
import { driAvatars, initials } from '@/lib/team';
import type { TeamMember } from '@/lib/types';

const member = (name: string, image: string | null = null): TeamMember => ({
  id: name,
  roadmapId: 'r1',
  memberUid: null,
  name,
  image,
  createdAt: '',
});

describe('initials (F-13)', () => {
  it('uses first and last word', () => {
    expect(initials('Maria Garcia')).toBe('MG');
    expect(initials('Ada')).toBe('A');
    expect(initials('  jean claude van damme ')).toBe('JD');
    expect(initials('')).toBe('?');
  });
});

describe('driAvatars (F-13)', () => {
  it('matches roster names case-insensitively and keeps unknown names', () => {
    const members = [member('Maria Garcia', 'https://img/mg.png'), member('Ada')];
    const avatars = driAvatars('maria garcia, Ada, Grace Hopper', members);
    expect(avatars).toEqual([
      { name: 'Maria Garcia', image: 'https://img/mg.png' },
      { name: 'Ada', image: null },
      { name: 'Grace Hopper', image: null },
    ]);
  });

  it('handles empty and whitespace-only fields', () => {
    expect(driAvatars('', [])).toEqual([]);
    expect(driAvatars('  ,  ', [])).toEqual([]);
  });
});

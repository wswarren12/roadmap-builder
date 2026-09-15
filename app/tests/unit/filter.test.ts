import { describe, expect, it } from 'vitest';
import { driNames, personMatch, personOptions } from '@/lib/filter';

describe('person filter', () => {
  it('reports DRI vs team matches, case-insensitively, DRI winning when both match', () => {
    expect(personMatch({ dris: 'Ada Lovelace', responsibleTeam: 'Platform' }, 'ada lovelace')).toBe('dri');
    expect(personMatch({ dris: 'Ada Lovelace', responsibleTeam: 'Platform' }, 'Platform')).toBe('team');
    expect(personMatch({ dris: 'Ada', responsibleTeam: 'Ada' }, 'Ada')).toBe('dri');
    expect(personMatch({ dris: 'Ada', responsibleTeam: 'Platform' }, 'Grace')).toBeNull();
    expect(personMatch({ dris: '', responsibleTeam: '' }, '')).toBeNull();
  });

  it('keeps legacy multi-name DRI values matchable without rewriting them', () => {
    expect(driNames('Ada, Grace Hopper')).toEqual(['Ada', 'Grace Hopper']);
    expect(personMatch({ dris: 'Ada, Grace Hopper', responsibleTeam: '' }, 'Grace Hopper')).toBe('dri');
  });

  it('offers roster names plus DRIs already on items, deduped and sorted; teams listed separately', () => {
    expect(
      personOptions(
        [{ name: 'Maria Garcia' }, { name: 'Ada' }],
        [
          { dris: 'ada', responsibleTeam: 'Platform' },
          { dris: 'Zed, Maria Garcia', responsibleTeam: 'ada' },
          { dris: '', responsibleTeam: ' Growth ' },
        ],
      ),
    ).toEqual({ people: ['Ada', 'Maria Garcia', 'Zed'], teams: ['Growth', 'Platform'] });
  });
});

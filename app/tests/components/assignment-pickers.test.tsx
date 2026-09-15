// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriSelect, TeamSelect } from '@/components/ItemFormModal';
import { PersonLink, TeamLink } from '@/components/ProfileLink';
import type { TeamMember } from '@/lib/types';

afterEach(cleanup);

const member = (over: Partial<TeamMember> & { id: string; name: string }): TeamMember => ({
  roadmapId: 'r1',
  memberUid: null,
  image: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const ada = member({ id: 'tm-ada', name: 'Ada Lovelace', memberUid: 'u-ada' });
const alexOne = member({ id: 'tm-a1', name: 'Alex Smith', memberUid: 'u-alex-1' });
const alexTwo = member({ id: 'tm-a2', name: 'Alex Smith', memberUid: 'u-alex-2' });
const kim = member({ id: 'tm-kim', name: 'Contractor Kim' });
const roster = [ada, alexOne, alexTwo, kim];

describe('DRI picker (F-13b)', () => {
  it('selects a person by identity, not by name', () => {
    const onChange = vi.fn();
    render(<DriSelect id="item-dri" value="" team={roster} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('item-dri'), { target: { value: 'tm-ada' } });
    expect(onChange).toHaveBeenCalledWith('Ada Lovelace', 'tm-ada');
  });

  it('lets an editor tell two same-named people apart and pick either', () => {
    const onChange = vi.fn();
    render(<DriSelect id="item-dri" value="" team={roster} onChange={onChange} />);
    const select = screen.getByTestId('item-dri') as HTMLSelectElement;
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toContain('Alex Smith · LabOS u-alex-1');
    expect(labels).toContain('Alex Smith · LabOS u-alex-2');

    fireEvent.change(select, { target: { value: 'tm-a2' } });
    expect(onChange).toHaveBeenCalledWith('Alex Smith', 'tm-a2');
  });

  it('changes and clears an existing assignment', () => {
    const onChange = vi.fn();
    render(
      <DriSelect id="item-dri" value="Ada Lovelace" memberId="tm-ada" team={roster} onChange={onChange} />,
    );
    const select = screen.getByTestId('item-dri') as HTMLSelectElement;
    expect(select.value).toBe('tm-ada');

    fireEvent.change(select, { target: { value: 'tm-kim' } });
    expect(onChange).toHaveBeenLastCalledWith('Contractor Kim', 'tm-kim');

    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('', null);
  });

  it('says so when the picked person has no LabOS profile', () => {
    render(
      <DriSelect id="item-dri" value="Contractor Kim" memberId="tm-kim" team={roster} onChange={vi.fn()} />,
    );
    expect(screen.getByTestId('item-dri-unlinked').textContent).toContain('no LabOS profile');
  });

  it('keeps a legacy free-typed value selectable instead of dropping it', () => {
    const onChange = vi.fn();
    render(<DriSelect id="item-dri" value="Old Name" team={roster} onChange={onChange} />);
    const select = screen.getByTestId('item-dri') as HTMLSelectElement;
    expect(select.value).toBe('legacy:Old Name');
    expect(within(select).getByText('Old Name (no linked profile)')).toBeTruthy();
  });
});

describe('responsible-team picker (F-13b)', () => {
  const options = [
    { uid: 't-platform', name: 'Platform' },
    { uid: 't-growth', name: 'Growth' },
  ];

  it('selects one of the member’s LabOS teams', () => {
    const onChange = vi.fn();
    render(<TeamSelect id="item-responsible-team" value="" options={options} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('item-responsible-team'), {
      target: { value: 't-growth' },
    });
    expect(onChange).toHaveBeenCalledWith('Growth', 't-growth');
  });

  it('is a separate field from the DRI and clears independently', () => {
    const onChange = vi.fn();
    render(
      <TeamSelect
        id="item-responsible-team"
        value="Platform"
        uid="t-platform"
        options={options}
        onChange={onChange}
      />,
    );
    const select = screen.getByTestId('item-responsible-team') as HTMLSelectElement;
    expect(select.value).toBe('t-platform');
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('', null);
  });

  it('keeps a team saved by someone else selected rather than dropping it', () => {
    render(
      <TeamSelect
        id="item-responsible-team"
        value="Research"
        uid="t-research"
        options={options}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByTestId('item-responsible-team') as HTMLSelectElement;
    expect(select.value).toBe('t-research');
    expect(within(select).getByText('Research · LabOS')).toBeTruthy();
  });

  it('explains when no LabOS teams are available', () => {
    render(<TeamSelect id="item-responsible-team" value="" options={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId('item-responsible-team-none')).toBeTruthy();
  });
});

describe('assignment display links (F-13b)', () => {
  it('links an assigned person’s avatar and name to their LabOS profile', () => {
    render(<PersonLink name="Ada Lovelace" image={null} uid="u-ada" testId="dri" />);
    const link = screen.getByTestId('dri') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.href).toBe('https://os.pl.xyz/members/u-ada');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    // The avatar sits inside the link, so the avatar itself is clickable.
    expect(within(link).getByTitle('Ada Lovelace')).toBeTruthy();
    expect(link.textContent).toContain('Ada Lovelace');
  });

  it('renders an unavailable profile as plain text, not a dead link', () => {
    render(<PersonLink name="Contractor Kim" image={null} uid={null} testId="dri" />);
    const el = screen.getByTestId('dri');
    expect(el.tagName).not.toBe('A');
    expect(el.getAttribute('data-linked')).toBe('false');
    expect(el.getAttribute('title')).toContain('no linked LabOS profile');
  });

  it('links the responsible team to its LabOS team page', () => {
    render(<TeamLink name="Platform" uid="t-platform" testId="team" />);
    const link = screen.getByTestId('team') as HTMLAnchorElement;
    expect(link.href).toBe('https://os.pl.xyz/teams/t-platform');
    render(<TeamLink name="Legacy team" uid={null} testId="team-plain" />);
    expect(screen.getByTestId('team-plain').tagName).not.toBe('A');
  });
});

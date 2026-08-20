// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SprintCard } from '@/components/SprintCard';
import type { SprintItem } from '@/lib/types';

afterEach(cleanup);

const sprint: SprintItem = {
  id: 's1',
  roadmapItemId: 'i1',
  name: 'Sprint 1 — API scaffolding',
  description: 'Build the endpoints',
  startDate: '2026-08-03',
  endDate: '2026-08-14',
  milestoneText: 'API freeze',
  milestoneDate: '2026-08-12',
  kpi: 'All routes green',
  dri: 'Ada',
  completedAt: null,
  syncGroupId: null,
  createdAt: '',
  updatedAt: '',
};

describe('SprintCard (AC-4.3, AC-4.5)', () => {
  it('shows every field', () => {
    render(
      <SprintCard
        sprint={sprint}
        editable
        onOpenChange={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onPromote={() => {}}
      />,
    );
    expect(screen.getByText('Sprint 1 — API scaffolding')).toBeTruthy();
    expect(screen.getByText('Build the endpoints')).toBeTruthy();
    expect(screen.getByText(/Aug 3, 2026 – Aug 14, 2026/)).toBeTruthy();
    expect(screen.getByText(/API freeze — Aug 12, 2026/)).toBeTruthy();
    expect(screen.getByText('All routes green')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByTestId('sprint-card-edit')).toBeTruthy();
    expect(screen.getByTestId('sprint-card-delete')).toBeTruthy();
    expect(screen.getByTestId('sprint-card-promote')).toBeTruthy();
  });

  it('hides edit/delete/promote for viewers', () => {
    render(
      <SprintCard
        sprint={sprint}
        editable={false}
        onOpenChange={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onPromote={() => {}}
      />,
    );
    expect(screen.queryByTestId('sprint-card-edit')).toBeNull();
    expect(screen.queryByTestId('sprint-card-delete')).toBeNull();
    expect(screen.queryByTestId('sprint-card-promote')).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BacklogView } from '@/components/BacklogView';
import { SubcalendarView } from '@/components/SubcalendarView';
import { ToastProvider } from '@/components/Toasts';

const routerPush = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }));

const sprint = {
  name: 'Build API', description: 'Sprint body', startPosition: 0.1, endPosition: 0.5,
  milestoneText: 'Schema ready', milestonePosition: 0.3, kpi: '42%', dri: 'Ada',
};
const item = {
  id: 'b1', ownerUid: 'u1', title: 'Plan launch', description: 'Unscheduled', milestoneText: '', milestonePosition: null,
  okrs: '', dris: '', responsibleTeam: '', status: 'green', kpi: '', colorIndex: 0, sprints: [], createdAt: 'x', updatedAt: 'x',
};
const itemWithSprint = { ...item, sprints: [sprint] };
const initiative = { id: 'n1', roadmapId: 'r1', name: 'Initiative A', description: '', position: 1, createdAt: 'x' };
const response = (body: unknown, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
function view() { return render(<ToastProvider><BacklogView /></ToastProvider>); }
async function chooseDropdown(testId: string, option: string) {
  await userEvent.click(screen.getByTestId(testId));
  await userEvent.click(await screen.findByRole('menuitem', { name: option }));
}

afterEach(() => {
  cleanup();
  routerPush.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BacklogView', () => {
  it('shows the signed-out state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => response({ error: 'signed out' }, 401)));
    view();
    expect(await screen.findByText(/Open this app from the PL Infra/i)).toBeTruthy();
  });

  it('shows a retryable generic load error', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ error: 'unavailable' }, 500))
      .mockImplementationOnce(() => response({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Your backlog is empty')).toBeTruthy();
  });

  it('shows loading then an empty state and creates an item', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ items: [] }))
      .mockImplementationOnce(() => response({ item }, 201))
      .mockImplementationOnce(() => response({ items: [item] }));
    vi.stubGlobal('fetch', fetchMock);
    view();
    expect(screen.getByText('Loading backlog…')).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: 'Create backlog item' }));
    await userEvent.type(screen.getByTestId('backlog-title'), 'Plan launch');
    await userEvent.click(screen.getByTestId('save-backlog-item'));
    expect(await screen.findByText('Plan launch')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/backlog', expect.objectContaining({ method: 'POST' }));
  });

  it('keeps a failed save open with a retryable error', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ items: [] }))
      .mockImplementationOnce(() => response({ error: 'Save unavailable' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Create backlog item' }));
    await userEvent.type(screen.getByTestId('backlog-title'), 'Plan launch');
    await userEvent.click(screen.getByTestId('save-backlog-item'));
    expect((await screen.findByRole('alert')).textContent).toContain('Save unavailable');
    expect(screen.getByTestId('backlog-title')).toBeTruthy();
  });

  it('supports inspect/edit, exposes preserved sprint content, and confirms delete', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ items: [itemWithSprint] }))
      .mockImplementationOnce(() => response({ item: { ...itemWithSprint, title: 'Updated' } }))
      .mockImplementationOnce(() => response({ items: [{ ...itemWithSprint, title: 'Updated' }] }))
      .mockImplementationOnce(() => response(null, 204))
      .mockImplementationOnce(() => response({ items: [] }));
    vi.stubGlobal('fetch', fetchMock); view();
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect / edit' }));
    expect(screen.getByRole('heading', { name: 'Preserved sprint items' })).toBeTruthy();
    expect(screen.getByText('Build API')).toBeTruthy();
    expect(screen.getByText('Sprint body')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
    const title = screen.getByTestId('backlog-title');
    fireEvent.change(title, { target: { value: 'Updated' } });
    await userEvent.click(screen.getByTestId('save-backlog-item'));
    expect(await screen.findByText('Updated')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByTestId('confirm-delete'));
    expect(await screen.findByText('Your backlog is empty')).toBeTruthy();
  });

  it('reports a failed delete without removing the item', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ items: [item] }))
      .mockImplementationOnce(() => response({ error: 'unavailable' }, 500));
    vi.stubGlobal('fetch', fetchMock); view();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByTestId('confirm-delete'));
    expect(await screen.findByText('Delete failed — please retry')).toBeTruthy();
    expect(screen.getByText('Plan launch')).toBeTruthy();
  });

  it('requires destination and dates before import', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ items: [item] }))
      .mockImplementationOnce(() => response({ owned: [], shared: [] }));
    vi.stubGlobal('fetch', fetchMock); view();
    await userEvent.click(await screen.findByRole('button', { name: 'Add to roadmap' }));
    await userEvent.click(screen.getByTestId('confirm-backlog-import'));
    expect((await screen.findByRole('alert')).textContent).toContain('Roadmap, initiative, and dates are required');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('imports successfully into a chosen roadmap and initiative', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ items: [item] }))
      .mockImplementationOnce(() => response({ owned: [{ id: 'r1', title: 'Roadmap', role: 'owner' }], shared: [] }))
      .mockImplementationOnce(() => response({ initiatives: [initiative] }))
      .mockImplementationOnce(() => response({ item: { id: 'i1', roadmapId: 'r1' } }, 201))
      .mockImplementationOnce(() => response({ items: [] }));
    vi.stubGlobal('fetch', fetchMock); view();
    await userEvent.click(await screen.findByRole('button', { name: 'Add to roadmap' }));
    await chooseDropdown('backlog-roadmap', 'Roadmap');
    await chooseDropdown('backlog-initiative', 'Initiative A');
    await userEvent.type(screen.getByLabelText('Start date'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('End date'), '2026-10-20');
    await userEvent.click(screen.getByTestId('confirm-backlog-import'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/backlog/b1/import', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('Your backlog is empty')).toBeTruthy();
  });

  it('keeps the import form open when the import fails', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response({ items: [item] }))
      .mockImplementationOnce(() => response({ owned: [{ id: 'r1', title: 'Roadmap', role: 'owner' }], shared: [] }))
      .mockImplementationOnce(() => response({ initiatives: [initiative] }))
      .mockImplementationOnce(() => response({ error: 'Import unavailable' }, 500));
    vi.stubGlobal('fetch', fetchMock); view();
    await userEvent.click(await screen.findByRole('button', { name: 'Add to roadmap' }));
    await chooseDropdown('backlog-roadmap', 'Roadmap');
    await chooseDropdown('backlog-initiative', 'Initiative A');
    await userEvent.type(screen.getByLabelText('Start date'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('End date'), '2026-10-20');
    await userEvent.click(screen.getByTestId('confirm-backlog-import'));
    expect((await screen.findByRole('alert')).textContent).toContain('Import unavailable');
    expect(screen.getByTestId('confirm-backlog-import')).toBeTruthy();
  });

  it('exposes and completes the owner-only move-to-backlog entry point', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const data = {
      item: {
        id: 'i1', roadmapId: 'r1', initiativeId: 'n1', title: 'Scheduled item', description: '',
        startDate: '2026-08-01', endDate: '2026-09-01', milestoneText: '', milestoneDate: null,
        okrs: '', dris: '', responsibleTeam: '', status: 'green', kpi: '', completedAt: null,
        colorIndex: 0, syncGroupId: null, createdAt: 'x', updatedAt: 'x',
      },
      sprints: [],
      roadmap: {
        id: 'r1', ownerUid: 'u1', ownerEmail: '', title: 'Roadmap', description: '',
        startMonth: '2026-08-01', endMonth: '2026-12-01', palette: 'pl', createdAt: 'x', updatedAt: 'x',
      },
      initiativeName: 'Initiative A', initiatives: [initiative], role: 'owner',
    };
    const fetchMock = vi.fn((path: string, options?: RequestInit) => {
      if (path === '/api/items/i1') return response(data);
      if (path === '/api/roadmaps/r1/team') return response({ members: [] });
      if (path === '/api/items/i1/backlog' && options?.method === 'POST') return response({ item: itemWithSprint }, 201);
      return response({ error: 'unexpected request' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ToastProvider><SubcalendarView roadmapId="r1" itemId="i1" /></ToastProvider>);
    await userEvent.click(await screen.findByTestId('move-to-backlog'));
    expect(screen.getByText('Move item to your backlog?')).toBeTruthy();
    await userEvent.click(screen.getByTestId('confirm-delete'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/items/i1/backlog', expect.objectContaining({ method: 'POST' })));
    expect(routerPush).toHaveBeenCalledWith('/backlog');
  });
});

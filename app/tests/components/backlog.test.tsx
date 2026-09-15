import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BacklogView } from '@/components/BacklogView';
import { SubcalendarView } from '@/components/SubcalendarView';
import { ToastProvider } from '@/components/Toasts';

const routerPush = vi.hoisted(() => vi.fn());
const routerReplace = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useSearchParams: () => searchParams.value,
}));

const sprint = {
  name: 'Build API', description: 'Sprint body', startPosition: 0.1, endPosition: 0.5,
  milestoneText: 'Schema ready', milestonePosition: 0.3, kpi: '42%', dri: 'Ada',
};
const entry = {
  id: 'e1', title: 'Plan launch', description: 'Unscheduled', milestoneText: '', milestonePosition: null,
  okrs: '', dris: '', responsibleTeam: '', status: 'green', kpi: '', colorIndex: 0, sprints: [], createdAt: 'x',
};
const entryWithSprint = { ...entry, sprints: [sprint] };
const initiative = { id: 'n1', roadmapId: 'r1', name: 'Initiative A', description: '', position: 1, createdAt: 'x' };
const roadmap = (id: string, title: string, backlog: unknown[]) => ({
  id, ownerUid: 'u1', ownerEmail: '', title, description: '', startMonth: '2026-07-01', endMonth: '2026-12-01',
  palette: 'pl', backlog, createdAt: 'x', updatedAt: 'x',
});
const lists = { owned: [{ id: 'r1', title: 'Alpha', role: 'owner' }, { id: 'r2', title: 'Beta', role: 'owner' }], shared: [] };
const response = (body: unknown, status = 200) =>
  Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

/** Route-style fetch mock: the scoped view hits several endpoints, so match by path. */
function mockApi(overrides: Record<string, (init?: RequestInit) => Promise<Response>> = {}, state = { r1: [entry] as unknown[], r2: [] as unknown[], role: 'owner' }) {
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    if (overrides[key]) return overrides[key](init);
    if (key === 'GET /api/me/roadmaps') return response(lists);
    if (key === 'GET /api/me') return response({ lastRoadmapId: 'r1' });
    if (key === 'GET /api/backlog') return response({ items: [] });
    if (key === 'GET /api/roadmaps/r1') return response({ roadmap: roadmap('r1', 'Alpha', state.r1), initiatives: [initiative], items: [], role: state.role });
    if (key === 'GET /api/roadmaps/r2') return response({ roadmap: roadmap('r2', 'Beta', state.r2), initiatives: [], items: [], role: state.role });
    return response({ error: `unexpected ${key}` }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
function view() { return render(<ToastProvider><BacklogView /></ToastProvider>); }

afterEach(() => {
  cleanup();
  routerPush.mockReset();
  routerReplace.mockReset();
  searchParams.value = new URLSearchParams();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BacklogView (roadmap-scoped)', () => {
  it('shows the signed-out state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => response({ error: 'signed out' }, 401)));
    view();
    expect(await screen.findByText(/Open this app from the PL Infra/i)).toBeTruthy();
  });

  it('defaults to the last-visited roadmap and lists only its entries; ?roadmap= wins', async () => {
    mockApi({}, { r1: [entry], r2: [{ ...entry, id: 'e2', title: 'Beta only' }], role: 'owner' });
    view();
    expect(screen.getByText('Loading backlog…')).toBeTruthy();
    expect(await screen.findByText('Plan launch')).toBeTruthy();
    expect(screen.queryByText('Beta only')).toBeNull();
    expect((screen.getByTestId('backlog-roadmap-picker') as HTMLSelectElement).value).toBe('r1');
    cleanup();

    searchParams.value = new URLSearchParams('roadmap=r2');
    mockApi({}, { r1: [entry], r2: [{ ...entry, id: 'e2', title: 'Beta only' }], role: 'owner' });
    view();
    expect(await screen.findByText('Beta only')).toBeTruthy();
    expect(screen.queryByText('Plan launch')).toBeNull();
  });

  it('switching roadmaps refreshes without stale rows, even when the earlier response arrives last', async () => {
    let releaseR1: (() => void) | null = null;
    const slowR1 = new Promise<void>((resolve) => { releaseR1 = resolve; });
    mockApi({
      'GET /api/roadmaps/r1': () => slowR1.then(() => response({ roadmap: roadmap('r1', 'Alpha', [entry]), initiatives: [initiative], items: [], role: 'owner' })),
    }, { r1: [entry], r2: [{ ...entry, id: 'e2', title: 'Beta only' }], role: 'owner' });
    view();
    const picker = await screen.findByTestId('backlog-roadmap-picker');
    await userEvent.selectOptions(picker, 'r2');
    expect(await screen.findByText('Beta only')).toBeTruthy();
    releaseR1!();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Plan launch')).toBeNull(); // late r1 response ignored
    expect(screen.getByText('Beta only')).toBeTruthy();
    expect(routerReplace).toHaveBeenCalledWith('/backlog?roadmap=r2');
  });

  it('shows an empty state for a roadmap with no unscheduled work and creates into that roadmap', async () => {
    const fetchMock = mockApi({
      'POST /api/roadmaps/r1/backlog': () => response({ item: entry, backlog: [entry] }, 201),
    }, { r1: [], r2: [], role: 'owner' });
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Create backlog item' }));
    await userEvent.type(screen.getByTestId('backlog-title'), 'Plan launch');
    await userEvent.click(screen.getByTestId('save-backlog-item'));
    expect(await screen.findByText('Plan launch')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/roadmaps/r1/backlog', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/backlog', expect.objectContaining({ method: 'POST' }));
  });

  it('keeps a failed save open with a retryable error', async () => {
    mockApi({ 'POST /api/roadmaps/r1/backlog': () => response({ error: 'Backlog unavailable' }, 503) }, { r1: [], r2: [], role: 'owner' });
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Create backlog item' }));
    await userEvent.type(screen.getByTestId('backlog-title'), 'Plan launch');
    await userEvent.click(screen.getByTestId('save-backlog-item'));
    expect((await screen.findByRole('alert')).textContent).toContain('Backlog unavailable');
    expect(screen.getByTestId('save-backlog-item')).toBeTruthy();
  });

  it('edits (with preserved sprint content visible) and deletes through the roadmap route', async () => {
    const fetchMock = mockApi({
      'PATCH /api/roadmaps/r1/backlog': () => response({ item: { ...entryWithSprint, title: 'Updated' }, backlog: [{ ...entryWithSprint, title: 'Updated' }] }),
      'DELETE /api/roadmaps/r1/backlog?id=e1': () => response({ backlog: [] }),
    }, { r1: [entryWithSprint], r2: [], role: 'owner' });
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect / edit' }));
    expect(screen.getByRole('heading', { name: 'Preserved sprint items' })).toBeTruthy();
    expect(screen.getByText('Build API')).toBeTruthy();
    fireEvent.change(screen.getByTestId('backlog-title'), { target: { value: 'Updated' } });
    await userEvent.click(screen.getByTestId('save-backlog-item'));
    expect(await screen.findByText('Updated')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/roadmaps/r1/backlog', expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"id":"e1"') }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByTestId('confirm-delete'));
    expect(await screen.findByText("This roadmap's backlog is empty")).toBeTruthy();
  });

  it('reports a failed delete without removing the row', async () => {
    mockApi({ 'DELETE /api/roadmaps/r1/backlog?id=e1': () => response({ error: 'unavailable' }, 500) });
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByTestId('confirm-delete'));
    expect(await screen.findByText('Delete failed — please retry')).toBeTruthy();
    expect(screen.getByText('Plan launch')).toBeTruthy();
  });

  it('viewers get a read-only list: no create, schedule or delete', async () => {
    mockApi({}, { r1: [entry], r2: [], role: 'viewer' });
    view();
    expect(await screen.findByText('Plan launch')).toBeTruthy();
    expect(screen.getByTestId('backlog-readonly')).toBeTruthy();
    expect(screen.queryByTestId('new-backlog-item')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Schedule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(screen.queryByTestId('save-backlog-item')).toBeNull();
  });

  it('schedules an entry into the open roadmap via fromBacklogId and navigates to the item', async () => {
    const fetchMock = mockApi({
      'POST /api/roadmaps/r1/items': () => response({ item: { id: 'i9', roadmapId: 'r1' } }, 201),
    });
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Schedule' }));
    await userEvent.click(screen.getByTestId('confirm-backlog-schedule'));
    expect((await screen.findByRole('alert')).textContent).toContain('Initiative and dates are required');
    await userEvent.type(screen.getByLabelText('Start date'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('End date'), '2026-10-20');
    await userEvent.click(screen.getByTestId('confirm-backlog-schedule'));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/roadmaps/r1/items/i9'));
    const call = fetchMock.mock.calls.find(([p, i]) => p === '/api/roadmaps/r1/items' && i?.method === 'POST')!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body).toMatchObject({ fromBacklogId: 'e1', initiativeId: 'n1', startDate: '2026-10-01', endDate: '2026-10-20', title: 'Plan launch' });
  });

  it('lists legacy personal items separately and moves one into the open roadmap', async () => {
    const legacy = { ...entry, id: 'p1', title: 'Old personal', ownerUid: 'u1', updatedAt: 'x' };
    const fetchMock = mockApi({
      'GET /api/backlog': () => response({ items: [legacy] }),
      'POST /api/roadmaps/r1/backlog': () => response({ item: { ...entry, id: 'e7', title: 'Old personal' }, backlog: [entry, { ...entry, id: 'e7', title: 'Old personal' }] }, 201),
      'DELETE /api/backlog/p1': () => response(null, 204),
    });
    view();
    const section = await screen.findByTestId('backlog-legacy');
    await userEvent.click(within(section).getByRole('button', { name: 'Move into this roadmap' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/backlog/p1', expect.objectContaining({ method: 'DELETE' })));
    await waitFor(() => expect(screen.queryByTestId('backlog-legacy')).toBeNull());
    expect(screen.getAllByTestId('backlog-row')).toHaveLength(2);
  });
});

describe('SubcalendarView move-to-backlog', () => {
  it('moves the item into ITS roadmap backlog and opens that scoped backlog (owner only)', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const data = {
      item: {
        id: 'i1', roadmapId: 'r1', initiativeId: 'n1', title: 'Scheduled item', description: '',
        startDate: '2026-08-01', endDate: '2026-09-01', milestoneText: '', milestoneDate: null,
        okrs: '', dris: '', responsibleTeam: '', status: 'green', kpi: '', completedAt: null,
        colorIndex: 0, syncGroupId: null, createdAt: 'x', updatedAt: 'x',
      },
      sprints: [],
      roadmap: roadmap('r1', 'Roadmap', []),
      initiativeName: 'Initiative A', initiatives: [initiative], role: 'owner',
    };
    const fetchMock = vi.fn((path: string, options?: RequestInit) => {
      if (path === '/api/items/i1') return response(data);
      if (path === '/api/roadmaps/r1/team') return response({ members: [] });
      if (path === '/api/roadmaps/r1/backlog' && options?.method === 'POST') return response({ item: entryWithSprint, backlog: [entryWithSprint] }, 201);
      return response({ error: 'unexpected request' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ToastProvider><SubcalendarView roadmapId="r1" itemId="i1" /></ToastProvider>);
    await userEvent.click(await screen.findByTestId('move-to-backlog'));
    expect(screen.getByText("Move item to this roadmap's backlog?")).toBeTruthy();
    await userEvent.click(screen.getByTestId('confirm-delete'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/roadmaps/r1/backlog', expect.objectContaining({ method: 'POST', body: JSON.stringify({ fromItemId: 'i1' }) })));
    expect(routerPush).toHaveBeenCalledWith('/backlog?roadmap=r1');
  });
});

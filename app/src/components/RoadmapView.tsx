'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@pl/components/Button';
import { EmptyState } from '@pl/components/EmptyState';
import { ITEM_PALETTE, STATUS_BAR_COLORS, STATUS_COLORS, barColor, statusBarColor } from '@/lib/colors';
import {
  addDays,
  dayOffsetInSpan,
  daysBetween,
  formatDate,
  formatRange,
  monthColumns,
  rangeEndDate,
  rangeTotalDays,
  todayISO,
} from '@/lib/dates';
import { assignLanes } from '@/lib/stacking';
import { personMatch, personOptions } from '@/lib/filter';
import { driAvatars } from '@/lib/team';
import {
  ITEM_STATUSES,
  STATUS_LABELS,
  type Initiative,
  type Roadmap,
  type RoadmapBacklogItem,
  type Role,
  type RoadmapItem,
  type TeamMember,
} from '@/lib/types';
import { MAX_INITIATIVES } from '@/lib/validate';
import { ApiError, api } from '@/lib/client/api';
import { exportRoadmapPdf } from '@/lib/client/pdf';
import { AgentChat } from './AgentChat';
import { Bar } from './Bar';
import { BoardView } from './BoardView';
import { ConfirmModal } from './ConfirmModal';
import { PersonLink, TeamLink } from './ProfileLink';
import { useMemberTeams } from './useMemberTeams';
import { ItemFormModal, type ItemFormValues } from './ItemFormModal';
import { SharePanel } from './SharePanel';
import { SignedOutLanding } from './SignedOutLanding';
import { SuggestionsPanel, type SuggestionWithMeta } from './SuggestionsPanel';
import { TeamPanel } from './TeamPanel';
import { useToast } from './Toasts';

const LANE_H = 34;
const LANE_GAP = 6;
const MIN_PX_PER_DAY = 4.5;
const LABEL_W = 208;

/** Auto-size a textarea to its content so long text never scrolls inside it.
 *  Used as both a ref callback (sizes on mount/remount — the `key` props
 *  remount on server updates) and an onInput handler (sizes while typing). */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export type ItemWithCount = RoadmapItem & { sprintCount: number };

interface RoadmapData {
  roadmap: Roadmap;
  initiatives: Initiative[];
  items: ItemWithCount[];
  role: Role;
}

type LoadState = 'loading' | 'ok' | 'signedout' | 'forbidden' | 'notfound' | 'error';

export function RoadmapView({ roadmapId }: { roadmapId: string }) {
  const memberTeams = useMemberTeams();
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<RoadmapData | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(1200);

  // View mode + status-color mode are per-browser preferences (F-board).
  const [view, setView] = useState<'timeline' | 'board'>('timeline');
  const [statusColors, setStatusColors] = useState(false);
  useEffect(() => {
    setView(localStorage.getItem(`rm-view-${roadmapId}`) === 'board' ? 'board' : 'timeline');
    setStatusColors(localStorage.getItem(`rm-status-colors-${roadmapId}`) === '1');
  }, [roadmapId]);
  function switchView(next: 'timeline' | 'board') {
    setView(next);
    localStorage.setItem(`rm-view-${roadmapId}`, next);
  }
  function toggleStatusColors(on: boolean) {
    setStatusColors(on);
    localStorage.setItem(`rm-status-colors-${roadmapId}`, on ? '1' : '0');
  }

  // View filters: focus one swimlane and/or one person. Pure view state —
  // records, counts in confirms and the add-item flow all use the full data.
  const [focusId, setFocusId] = useState<string>('');
  const [person, setPerson] = useState<string>('');

  // Form / overlay state
  const [itemForm, setItemForm] = useState<{
    initial?: Partial<ItemFormValues>;
    editing?: ItemWithCount;
    /** Set when scheduling a board-backlog entry: removed once the item saves. */
    fromBacklogId?: string;
  } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionWithMeta[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [deletingRoadmap, setDeletingRoadmap] = useState(false);
  const [deletingInitiative, setDeletingInitiative] = useState<Initiative | null>(null);
  const [busy, setBusy] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const laneDown = useRef<{ x: number; y: number } | null>(null);

  // Drag targets: lane hover while an item bar drags (AC-2.8) and row hover
  // while an initiative row drags toward a convert drop (F-10).
  const [dragOverLaneId, setDragOverLaneId] = useState<string | null>(null);
  const [dragOverBarId, setDragOverBarId] = useState<string | null>(null);
  const [draggingInitiativeId, setDraggingInitiativeId] = useState<string | null>(null);
  const [rowDropId, setRowDropId] = useState<string | null>(null);
  const [convertRequest, setConvertRequest] = useState<{
    source: Initiative;
    target: Initiative;
  } | null>(null);
  const [sprintConvertRequest, setSprintConvertRequest] = useState<{
    source: ItemWithCount;
    target: ItemWithCount;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<RoadmapData>(`/api/roadmaps/${roadmapId}`);
      setData(res);
      setState('ok');
      // Roster loads best-effort alongside — bars fall back to initials.
      api<{ members: TeamMember[] }>(`/api/roadmaps/${roadmapId}/team`)
        .then((r) => setTeam(r.members))
        .catch(() => {});
      // Agent suggestions are reviewer-only (write tier); best-effort too.
      if (res.role === 'owner' || res.role === 'editor') {
        api<{ suggestions: SuggestionWithMeta[] }>(`/api/roadmaps/${roadmapId}/suggestions`)
          .then((r) => setSuggestions(r.suggestions))
          .catch(() => {});
      }
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) return setState('signedout');
        if (e.status === 403) return setState('forbidden');
        if (e.status === 404) return setState('notfound');
      }
      setState('error');
    }
  }, [roadmapId]);

  useEffect(() => {
    load();
  }, [load]);

  // Measure available width so the grid fits when it can (else scrolls).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setGridWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state, view]);

  // Auto-scroll to current month (F-9b) or restore prior position (AC-3.2).
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (state !== 'ok' || !data || scrolledOnce.current || view !== 'timeline') return;
    const el = scrollRef.current;
    if (!el) return;
    scrolledOnce.current = true;

    const saved = sessionStorage.getItem(`rm-scroll-${roadmapId}`);
    if (saved !== null) {
      el.scrollLeft = Number(saved);
      sessionStorage.removeItem(`rm-scroll-${roadmapId}`);
      return;
    }

    const span = { start: data.roadmap.startMonth, end: rangeEndDate(data.roadmap.endMonth) };
    const off = dayOffsetInSpan(span.start, span.end, todayISO());
    if (off !== null) {
      const totalDays = rangeTotalDays(data.roadmap.startMonth, data.roadmap.endMonth);
      const pxPerDay = Math.max((gridWidth - LABEL_W) / totalDays, MIN_PX_PER_DAY);
      const target = LABEL_W + off * pxPerDay - (gridWidth - LABEL_W) / 3;
      el.scrollLeft = Math.max(0, target - LABEL_W);
    }
  }, [state, data, gridWidth, roadmapId, view]);

  if (state === 'loading') {
    return (
      <div className="roadmap-page">
        <div className="skeleton" style={{ height: 120 }} />
        <div className="skeleton" style={{ height: 360 }} />
      </div>
    );
  }
  if (state === 'signedout') return <SignedOutLanding />;
  if (state === 'forbidden') {
    return (
      <div className="center-state">
        <EmptyState
          title="You don't have access"
          description="Ask the owner to share this roadmap with your email."
          primaryAction={
            <Button variant="primary" styleType="fill" onClick={() => router.push('/profile')}>
              Go home
            </Button>
          }
        />
      </div>
    );
  }
  if (state === 'notfound') {
    return (
      <div className="center-state">
        <EmptyState
          title="This roadmap no longer exists"
          description="It may have been deleted by its owner."
          primaryAction={
            <Button variant="primary" styleType="fill" onClick={() => router.push('/profile')}>
              Go home
            </Button>
          }
        />
      </div>
    );
  }
  if (state === 'error' || !data) {
    return (
      <div className="center-state">
        <EmptyState
          title="Couldn't load this roadmap"
          primaryAction={
            <Button variant="primary" styleType="fill" onClick={load}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const { roadmap, initiatives, items, role } = data;
  const editable = role === 'owner' || role === 'editor';
  const isOwner = role === 'owner';
  const spanStart = roadmap.startMonth;
  const spanEnd = rangeEndDate(roadmap.endMonth);
  const totalDays = rangeTotalDays(roadmap.startMonth, roadmap.endMonth);
  const pxPerDay = Math.max((gridWidth - LABEL_W) / totalDays, MIN_PX_PER_DAY);
  const months = monthColumns(roadmap.startMonth, roadmap.endMonth);
  const todayOff = dayOffsetInSpan(spanStart, spanEnd, todayISO());

  const totalSprints = items.reduce((sum, i) => sum + i.sprintCount, 0);

  const focus = initiatives.find((i) => i.id === focusId) ?? null;
  const filtersOn = focus !== null || person !== '';
  const visibleInitiatives = focus ? [focus] : initiatives;
  const matchOf = (item: { dris: string; responsibleTeam: string }) =>
    person ? personMatch(item, person) : null;
  const visibleItems = items.filter(
    (i) => (!focus || i.initiativeId === focus.id) && (!person || matchOf(i) !== null),
  );
  const people = personOptions(team, items);
  function clearFilters() {
    setFocusId('');
    setPerson('');
  }

  // Pending agent suggestions preview as dotted ghost bars (agent-links
  // design). Item-kind only here — sprint-kind previews belong to the
  // drill-down view and are out of v1 scope. Ghosts with dates the current
  // span can't place (roadmap changed since filing) are skipped at render.
  const pendingSuggestions = suggestions.filter((s) => s.status === 'pending');
  const ghostBars: Array<{
    id: string;
    initiativeId: string;
    title: string;
    startDate: string;
    endDate: string;
    rationale: string;
  }> = [];
  for (const s of pendingSuggestions) {
    const p = s.payload as Record<string, unknown>;
    if (s.kind === 'create_item') {
      if (
        typeof p.initiativeId === 'string' &&
        typeof p.startDate === 'string' &&
        typeof p.endDate === 'string'
      ) {
        ghostBars.push({
          id: s.id,
          initiativeId: p.initiativeId,
          title: String(p.title ?? 'New item'),
          startDate: p.startDate,
          endDate: p.endDate,
          rationale: s.rationale,
        });
      }
    } else if (s.kind === 'update_item') {
      const target = items.find((i) => i.id === s.targetId);
      if (!target || (p.startDate === undefined && p.endDate === undefined)) continue;
      ghostBars.push({
        id: s.id,
        initiativeId: typeof p.initiativeId === 'string' ? p.initiativeId : target.initiativeId,
        title: target.title,
        startDate: typeof p.startDate === 'string' ? p.startDate : target.startDate,
        endDate: typeof p.endDate === 'string' ? p.endDate : target.endDate,
        rationale: s.rationale,
      });
    }
  }

  // ── mutations ──────────────────────────────────────────────────────────────

  async function patchHeader(patch: Record<string, string>) {
    try {
      const res = await api<{ roadmap: Roadmap }>(`/api/roadmaps/${roadmap.id}`, {
        method: 'PATCH',
        body: patch,
      });
      setData((d) => (d ? { ...d, roadmap: res.roadmap } : d));
      setRangeError(null);
      return true;
    } catch (e) {
      if (patch.startMonth || patch.endMonth) {
        setRangeError(e instanceof ApiError ? e.message : 'Could not update the range');
      } else {
        toast('error', e instanceof ApiError ? e.message : 'Save failed — please retry');
      }
      return false;
    }
  }

  async function addInitiative() {
    try {
      const res = await api<{ initiative: Initiative }>(
        `/api/roadmaps/${roadmap.id}/initiatives`,
        { method: 'POST', body: { name: `Initiative ${initiatives.length + 1}` } },
      );
      setData((d) => (d ? { ...d, initiatives: [...d.initiatives, res.initiative] } : d));
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not add the initiative');
    }
  }

  async function renameInitiative(initiative: Initiative, name: string) {
    if (name.trim() === initiative.name || !name.trim()) return;
    try {
      await api(`/api/initiatives/${initiative.id}`, { method: 'PATCH', body: { name } });
      setData((d) =>
        d
          ? {
              ...d,
              initiatives: d.initiatives.map((i) =>
                i.id === initiative.id ? { ...i, name: name.trim() } : i,
              ),
            }
          : d,
      );
    } catch {
      toast('error', 'Rename failed — please retry');
    }
  }

  async function saveInitiativeDesc(initiative: Initiative, description: string) {
    if (description === initiative.description) return;
    try {
      await api(`/api/initiatives/${initiative.id}`, { method: 'PATCH', body: { description } });
      setData((d) =>
        d
          ? {
              ...d,
              initiatives: d.initiatives.map((i) =>
                i.id === initiative.id ? { ...i, description } : i,
              ),
            }
          : d,
      );
    } catch {
      toast('error', 'Could not save the description — please retry');
    }
  }

  async function moveInitiative(initiative: Initiative, dir: -1 | 1) {
    const idx = initiatives.findIndex((i) => i.id === initiative.id);
    const target = idx + dir;
    if (target < 0 || target >= initiatives.length) return;
    try {
      await api(`/api/initiatives/${initiative.id}`, {
        method: 'PATCH',
        body: { position: target + 1 },
      });
      await load();
    } catch {
      toast('error', 'Reorder failed — please retry');
    }
  }

  function requestDeleteInitiative(initiative: Initiative) {
    const hasItems = items.some((i) => i.initiativeId === initiative.id);
    if (hasItems) {
      toast('warning', "Move or delete this initiative's items first");
      return;
    }
    setDeletingInitiative(initiative);
  }

  async function confirmDeleteInitiative() {
    if (!deletingInitiative) return;
    setBusy(true);
    try {
      await api(`/api/initiatives/${deletingInitiative.id}`, { method: 'DELETE' });
      setData((d) =>
        d
          ? { ...d, initiatives: d.initiatives.filter((i) => i.id !== deletingInitiative.id) }
          : d,
      );
      setDeletingInitiative(null);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(values: ItemFormValues, editing?: ItemWithCount, fromBacklogId?: string) {
    if (editing) {
      const res = await api<{ item: ItemWithCount }>(`/api/items/${editing.id}`, {
        method: 'PATCH',
        body: values,
      });
      setData((d) =>
        d
          ? { ...d, items: d.items.map((i) => (i.id === editing.id ? res.item : i)) }
          : d,
      );
    } else {
      const res = await api<{ item: ItemWithCount }>(`/api/roadmaps/${roadmap.id}/items`, {
        method: 'POST',
        body: fromBacklogId ? { ...values, fromBacklogId } : values,
      });
      setData((d) =>
        d
          ? {
              ...d,
              items: [...d.items, res.item],
              roadmap: fromBacklogId
                ? { ...d.roadmap, backlog: d.roadmap.backlog.filter((b) => b.id !== fromBacklogId) }
                : d.roadmap,
            }
          : d,
      );
    }
  }

  /** Board card move: same PATCH as the item form, optimistic with revert. */
  async function moveItemStatus(
    item: RoadmapItem,
    patch: { status?: RoadmapItem['status']; completedAt?: string | null },
  ) {
    const prev = data!.items;
    setData((d) =>
      d ? { ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, ...patch } : i)) } : d,
    );
    try {
      const res = await api<{ item: ItemWithCount }>(`/api/items/${item.id}`, {
        method: 'PATCH',
        body: patch,
      });
      setData((d) =>
        d ? { ...d, items: d.items.map((i) => (i.id === item.id ? res.item : i)) } : d,
      );
    } catch (e) {
      setData((d) => (d ? { ...d, items: prev } : d));
      toast('error', e instanceof ApiError ? e.message : "Couldn't move the card");
    }
  }

  function setBacklog(backlog: RoadmapBacklogItem[]) {
    setData((d) => (d ? { ...d, roadmap: { ...d.roadmap, backlog } } : d));
  }

  /** Board → timeline: prefill the item form from a backlog entry. */
  function scheduleBacklogEntry(entry: RoadmapBacklogItem) {
    setItemForm({
      fromBacklogId: entry.id,
      initial: {
        title: entry.title,
        description: entry.description,
        status: entry.status,
        dris: entry.dris,
        responsibleTeam: entry.responsibleTeam,
        okrs: entry.okrs,
        kpi: entry.kpi,
        milestoneText: entry.milestoneText,
        colorIndex: entry.colorIndex,
        initiativeId: initiatives[0]?.id,
        startDate: spanStart,
        endDate: addDays(spanStart, 13),
      },
    });
  }

  /** Topmost element carrying the given data attribute under a point. */
  function dataIdAtPoint(
    x: number,
    y: number,
    key: 'initiativeId' | 'rowInitiativeId' | 'entityId',
    excludeValue?: string,
  ) {
    for (const el of document.elementsFromPoint(x, y)) {
      const value = (el as HTMLElement).dataset?.[key];
      if (value && value !== excludeValue) return value;
    }
    return null;
  }

  function handleItemDragMove(item: ItemWithCount, x: number, y: number) {
    // Hovering another item's bar wins over its lane: that drop converts
    // the dragged item into a sprint of the target (F-11).
    const overBar = dataIdAtPoint(x, y, 'entityId', item.id);
    if (overBar) {
      setDragOverBarId(overBar);
      setDragOverLaneId(null);
      return;
    }
    setDragOverBarId(null);
    const over = dataIdAtPoint(x, y, 'initiativeId');
    setDragOverLaneId(over && over !== item.initiativeId ? over : null);
  }

  async function commitItemDates(
    item: ItemWithCount,
    startDate: string,
    endDate: string,
    drop?: { x: number; y: number },
  ) {
    setDragOverLaneId(null);
    setDragOverBarId(null);

    // A drop onto another item's bar is a convert-to-sprint gesture (F-11) —
    // it consumes the drag; any date preview is discarded.
    const overBarId = drop ? dataIdAtPoint(drop.x, drop.y, 'entityId', item.id) : null;
    if (overBarId) {
      const target = items.find((i) => i.id === overBarId);
      if (target) {
        setSprintConvertRequest({ source: item, target });
        return true;
      }
    }

    // Otherwise the drop may land in another initiative's lanes (AC-2.8).
    const overId = drop ? dataIdAtPoint(drop.x, drop.y, 'initiativeId') : null;
    const initiativeId = overId && overId !== item.initiativeId ? overId : undefined;
    const datesChanged = startDate !== item.startDate || endDate !== item.endDate;
    if (!initiativeId && !datesChanged) return true;

    // Optimistic move with revert-on-failure (F-2 error states).
    const prev = data!.items;
    setData((d) =>
      d
        ? {
            ...d,
            items: d.items.map((i) =>
              i.id === item.id
                ? { ...i, startDate, endDate, initiativeId: initiativeId ?? i.initiativeId }
                : i,
            ),
          }
        : d,
    );
    try {
      const body: Record<string, string> = {};
      if (datesChanged) {
        body.startDate = startDate;
        body.endDate = endDate;
      }
      if (initiativeId) body.initiativeId = initiativeId;
      const res = await api<{ item: ItemWithCount }>(`/api/items/${item.id}`, {
        method: 'PATCH',
        body,
      });
      setData((d) =>
        d ? { ...d, items: d.items.map((i) => (i.id === item.id ? res.item : i)) } : d,
      );
      return true;
    } catch (e) {
      setData((d) => (d ? { ...d, items: prev } : d));
      toast('error', e instanceof ApiError ? e.message : "Couldn't save the change");
      return false;
    }
  }

  // Row drag → convert an initiative into an item of another one (F-10).
  function startInitiativeDrag(initiative: Initiative) {
    return (e: React.PointerEvent) => {
      if (!editable || e.button !== 0) return;
      e.preventDefault();
      const origin = { x: e.clientX, y: e.clientY, moved: false };

      const onMove = (ev: PointerEvent) => {
        if (
          !origin.moved &&
          Math.abs(ev.clientX - origin.x) < 4 &&
          Math.abs(ev.clientY - origin.y) < 4
        ) {
          return;
        }
        origin.moved = true;
        setDraggingInitiativeId(initiative.id);
        const over = dataIdAtPoint(ev.clientX, ev.clientY, 'rowInitiativeId');
        setRowDropId(over && over !== initiative.id ? over : null);
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setDraggingInitiativeId(null);
        setRowDropId(null);
        if (!origin.moved) return;
        const targetId = dataIdAtPoint(ev.clientX, ev.clientY, 'rowInitiativeId');
        const target = initiatives.find((i) => i.id === targetId);
        if (target && target.id !== initiative.id) {
          setConvertRequest({ source: initiative, target });
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
  }

  async function confirmConvert() {
    if (!convertRequest) return;
    setBusy(true);
    try {
      await api(`/api/initiatives/${convertRequest.source.id}/convert`, {
        method: 'POST',
        body: { targetInitiativeId: convertRequest.target.id },
      });
      toast(
        'success',
        `"${convertRequest.source.name}" is now an item of "${convertRequest.target.name}"`,
      );
      setConvertRequest(null);
      await load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Convert failed — please retry');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSprintConvert() {
    if (!sprintConvertRequest) return;
    setBusy(true);
    try {
      await api(`/api/items/${sprintConvertRequest.source.id}/convert`, {
        method: 'POST',
        body: { targetItemId: sprintConvertRequest.target.id },
      });
      toast(
        'success',
        `"${sprintConvertRequest.source.title}" is now a sprint item of "${sprintConvertRequest.target.title}"`,
      );
      setSprintConvertRequest(null);
      await load();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Convert failed — please retry');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRoadmap() {
    setBusy(true);
    try {
      await api(`/api/roadmaps/${roadmap.id}`, { method: 'DELETE' });
      toast('success', `Deleted "${roadmap.title}"`);
      router.push('/profile');
    } catch {
      toast('error', 'Delete failed — please retry');
      setBusy(false);
    }
  }

  function openItem(item: RoadmapItem) {
    sessionStorage.setItem(`rm-scroll-${roadmap.id}`, String(scrollRef.current?.scrollLeft ?? 0));
    router.push(`/roadmaps/${roadmap.id}/items/${item.id}`);
  }

  // Single-click on empty lane space creates an item at that spot. The
  // pointerdown position guards against drag-releases and clicks that
  // started on a bar (bars stop pointerdown propagation, so laneDown stays
  // null for them and the synthetic click that bubbles up is ignored).
  function handleLanePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    laneDown.current =
      e.target === e.currentTarget ? { x: e.clientX, y: e.clientY } : null;
  }

  function handleLaneClick(initiative: Initiative, e: React.MouseEvent<HTMLDivElement>) {
    const down = laneDown.current;
    laneDown.current = null;
    if (!editable || e.target !== e.currentTarget) return;
    if (!down || Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const day = Math.max(0, Math.min(totalDays - 1, Math.floor((e.clientX - rect.left) / pxPerDay)));
    const start = addDays(spanStart, day);
    const end = daysBetween(start, spanEnd) >= 13 ? addDays(start, 13) : spanEnd;
    setItemForm({ initial: { initiativeId: initiative.id, startDate: start, endDate: end } });
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="roadmap-page" data-testid="roadmap-view" data-role={role}>
      <header className="roadmap-header">
        <div className="roadmap-header-top">
          <input
            className="roadmap-title-input"
            defaultValue={roadmap.title}
            key={`title-${roadmap.updatedAt}`}
            disabled={!editable}
            aria-label="Roadmap title"
            data-testid="roadmap-title"
            onBlur={(e) => {
              if (editable && e.target.value.trim() && e.target.value.trim() !== roadmap.title) {
                patchHeader({ title: e.target.value.trim() });
              }
            }}
          />
          <div className="header-actions">
            {editable && pendingSuggestions.length > 0 && (
              <Button
                variant="secondary"
                styleType="light"
                onClick={() => setSuggestionsOpen(true)}
                data-testid="suggestions-badge"
              >
                {pendingSuggestions.length} suggestion{pendingSuggestions.length === 1 ? '' : 's'}
              </Button>
            )}
            <Button
              variant="secondary"
              styleType="border"
              onClick={() => router.push(`/backlog?roadmap=${roadmap.id}`)}
              data-testid="backlog-button"
            >
              Backlog{roadmap.backlog.length > 0 ? ` (${roadmap.backlog.length})` : ''}
            </Button>
            {editable && (
              <Button
                variant="secondary"
                styleType="border"
                onClick={() => setTeamOpen(true)}
                data-testid="team-button"
              >
                Team
              </Button>
            )}
            {editable && (
              <Button
                variant="secondary"
                styleType="border"
                onClick={() => setShareOpen(true)}
                data-testid="share-button"
              >
                Share
              </Button>
            )}
            <Button
              variant="secondary"
              styleType="border"
              onClick={() => {
                exportRoadmapPdf({ roadmap, initiatives, items }).catch(() =>
                  toast('error', 'PDF generation failed — please retry'),
                );
              }}
              data-testid="export-pdf"
            >
              Download PDF
            </Button>
            {isOwner && (
              <Button
                variant="error"
                styleType="light"
                onClick={() => setDeletingRoadmap(true)}
                data-testid="delete-roadmap"
              >
                Delete
              </Button>
            )}
          </div>
        </div>
        <textarea
          className="roadmap-desc-input"
          defaultValue={roadmap.description}
          key={`desc-${roadmap.updatedAt}`}
          rows={1}
          ref={autoGrow}
          onInput={(e) => autoGrow(e.currentTarget)}
          placeholder={editable ? 'Add a short description…' : undefined}
          disabled={!editable}
          aria-label="Roadmap description"
          onBlur={(e) => {
            if (editable && e.target.value !== roadmap.description) {
              patchHeader({ description: e.target.value });
            }
          }}
        />
        <div className="roadmap-meta">
          {editable ? (
            <span className="roadmap-range-inputs">
              <input
                type="month"
                value={roadmap.startMonth.slice(0, 7)}
                aria-label="Start month"
                data-testid="range-start"
                onChange={(e) =>
                  e.target.value && patchHeader({ startMonth: `${e.target.value}-01` })
                }
              />
              →
              <input
                type="month"
                value={roadmap.endMonth.slice(0, 7)}
                aria-label="End month"
                data-testid="range-end"
                onChange={(e) =>
                  e.target.value && patchHeader({ endMonth: `${e.target.value}-01` })
                }
              />
            </span>
          ) : (
            <span>{formatRange(spanStart, spanEnd)}</span>
          )}
          <span>
            {months.length} months ·{' '}
            {filtersOn ? `${visibleItems.length} of ${items.length}` : items.length} items
            {roadmap.backlog.length > 0 && ` · ${roadmap.backlog.length} in backlog`}
          </span>
          {role === 'viewer' && <span data-testid="viewer-badge">View only</span>}
          {role === 'editor' && <span data-testid="editor-badge">Can edit</span>}
          {rangeError && (
            <span className="range-error" data-testid="range-error">
              {rangeError}
            </span>
          )}
          <span className="view-controls">
            <select
              className="filter-select"
              aria-label="Focus swimlane"
              value={focusId}
              onChange={(e) => setFocusId(e.target.value)}
              data-testid="filter-swimlane"
            >
              <option value="">All swimlanes</option>
              {initiatives.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              aria-label="Filter by person"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              data-testid="filter-person"
            >
              <option value="">Everyone</option>
              <optgroup label="People">
                {people.people.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </optgroup>
              {people.teams.length > 0 && (
                <optgroup label="Responsible teams">
                  {people.teams.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {filtersOn && (
              <button className="view-toggle-btn view-toggle-btn--on" onClick={clearFilters} data-testid="filter-clear">
                Clear filters
              </button>
            )}
            <span className="view-toggle" role="tablist" aria-label="View">
              {(['timeline', 'board'] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  className={`view-toggle-btn${view === v ? ' view-toggle-btn--on' : ''}`}
                  onClick={() => switchView(v)}
                  data-testid={`view-${v}`}
                >
                  {v === 'timeline' ? 'Timeline' : 'Board'}
                </button>
              ))}
            </span>
            <label className="completed-toggle">
              <input
                type="checkbox"
                checked={statusColors}
                onChange={(e) => toggleStatusColors(e.target.checked)}
                data-testid="status-colors-toggle"
              />
              Status colors
            </label>
          </span>
        </div>
        {statusColors && (
          <div className="status-legend" data-testid="status-legend">
            {ITEM_STATUSES.map((s) => (
              <span key={s}>
                <i style={{ background: STATUS_BAR_COLORS[s] }} />
                {STATUS_LABELS[s]}
              </span>
            ))}
            <span>
              <i style={{ background: STATUS_BAR_COLORS.completed }} />
              Completed
            </span>
          </div>
        )}
      </header>

      {filtersOn && visibleItems.length === 0 && (
        <div className="filter-empty" data-testid="filter-empty">
          <EmptyState
            title="No items match these filters"
            description={
              person && focus
                ? `${person} has nothing in "${focus.name}".`
                : person
                  ? `${person} isn't the DRI or responsible team on any item here.`
                  : `"${focus?.name}" has no items yet.`
            }
            primaryAction={
              <Button variant="secondary" styleType="border" onClick={clearFilters}>
                Show all swimlanes and people
              </Button>
            }
          />
        </div>
      )}

      {view === 'board' && (
        <BoardView
          roadmap={roadmap}
          initiatives={initiatives}
          items={visibleItems}
          personFilter={person || null}
          team={team}
          editable={editable}
          statusColors={statusColors}
          onBacklogChange={setBacklog}
          onSchedule={scheduleBacklogEntry}
          onOpenItem={openItem}
          onMoveItem={moveItemStatus}
        />
      )}

      {view === 'timeline' && (
      <div className="timeline-card">
        <div className="timeline-scroll" ref={scrollRef} data-testid="timeline-scroll">
          <div className="timeline-inner" style={{ width: LABEL_W + totalDays * pxPerDay }}>
            <div className="timeline-head">
              <div className="timeline-label-spacer" />
              {months.map((m) => (
                <div key={m.monthISO} className="time-col" style={{ width: m.days * pxPerDay }}>
                  {m.label}
                </div>
              ))}
            </div>

            {visibleInitiatives.map((initiative) => {
              const rowItems = visibleItems.filter((i) => i.initiativeId === initiative.id);
              const { lanes, laneCount } = assignLanes(rowItems);
              // Ghosts stack in extra lanes below the real bars so a pending
              // proposal never collides with (or reflows) actual items.
              const rowGhosts = ghostBars.filter(
                (g) =>
                  g.initiativeId === initiative.id &&
                  dayOffsetInSpan(spanStart, spanEnd, g.startDate) !== null &&
                  dayOffsetInSpan(spanStart, spanEnd, g.endDate) !== null,
              );
              const ghostLanes = assignLanes(rowGhosts);
              const rowHeight =
                (laneCount + ghostLanes.laneCount) * (LANE_H + LANE_GAP) + LANE_GAP;
              return (
                <div
                  className={`swim-row${
                    rowDropId === initiative.id ? ' swim-row--drop-target' : ''
                  }${draggingInitiativeId === initiative.id ? ' swim-row--dragging' : ''}`}
                  key={initiative.id}
                  data-testid="initiative-row"
                  data-row-initiative-id={initiative.id}
                >
                  <div className="row-label" style={{ minHeight: rowHeight }}>
                    <div className="row-label-name">
                      {editable && (
                        <span
                          className="initiative-drag-handle"
                          data-testid="initiative-drag-handle"
                          title="Drag onto another initiative to turn this one into an item"
                          onPointerDown={startInitiativeDrag(initiative)}
                        >
                          ⋮⋮
                        </span>
                      )}
                      <textarea
                        className="row-name-input"
                        defaultValue={initiative.name}
                        key={`${initiative.id}-${initiative.name}`}
                        rows={1}
                        ref={autoGrow}
                        onInput={(e) => autoGrow(e.currentTarget)}
                        disabled={!editable}
                        aria-label="Initiative name"
                        data-testid="initiative-name"
                        onBlur={(e) => renameInitiative(initiative, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.target as HTMLTextAreaElement).blur();
                          }
                        }}
                      />
                    </div>
                    {editable ? (
                      <textarea
                        className="row-desc-input"
                        defaultValue={initiative.description}
                        key={`${initiative.id}-desc-${initiative.description}`}
                        rows={1}
                        ref={autoGrow}
                        onInput={(e) => autoGrow(e.currentTarget)}
                        placeholder="Add a theme description…"
                        aria-label="Initiative description"
                        data-testid="initiative-desc"
                        onBlur={(e) => saveInitiativeDesc(initiative, e.target.value)}
                      />
                    ) : (
                      initiative.description && (
                        <p className="row-desc-text" data-testid="initiative-desc">
                          {initiative.description}
                        </p>
                      )
                    )}
                    {editable && (
                      <div className="row-label-tools">
                        <Button
                          variant="secondary"
                          styleType="border"
                          size="xs"
                          onClick={() =>
                            setItemForm({
                              initial: {
                                initiativeId: initiative.id,
                                startDate: spanStart,
                                endDate: addDays(spanStart, 13),
                              },
                            })
                          }
                          data-testid="add-item"
                        >
                          + Item
                        </Button>
                        <span className="row-tools-spacer" />
                        <button
                          className="icon-btn"
                          aria-label="Move up"
                          disabled={initiative.position === initiatives[0].position}
                          onClick={() => moveInitiative(initiative, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="icon-btn"
                          aria-label="Move down"
                          disabled={
                            initiative.position === initiatives[initiatives.length - 1].position
                          }
                          onClick={() => moveInitiative(initiative, 1)}
                        >
                          ↓
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`Delete ${initiative.name}`}
                          onClick={() => requestDeleteInitiative(initiative)}
                          data-testid="delete-initiative"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                  <div
                    className={`lanes${
                      dragOverLaneId === initiative.id ? ' lanes--drop-target' : ''
                    }`}
                    style={{ height: rowHeight, width: totalDays * pxPerDay }}
                    onPointerDown={handleLanePointerDown}
                    onClick={(e) => handleLaneClick(initiative, e)}
                    data-testid="lanes"
                    data-initiative-id={initiative.id}
                  >
                    {months.slice(1).map((m) => (
                      <span
                        key={m.monthISO}
                        className="lane-grid-line"
                        style={{ left: m.startOffset * pxPerDay }}
                      />
                    ))}
                    {todayOff !== null && (
                      <span
                        className="today-line"
                        style={{ left: (todayOff + 0.5) * pxPerDay }}
                        data-testid="today-line"
                      >
                        <span className="today-line-dot" />
                      </span>
                    )}
                    {rowItems.map((item, idx) => (
                      <Bar
                        key={item.id}
                        testId="item-bar"
                        entityId={item.id}
                        title={item.title}
                        startDate={item.startDate}
                        endDate={item.endDate}
                        spanStart={spanStart}
                        pxPerDay={pxPerDay}
                        lane={lanes.get(item.id) ?? 0}
                        laneHeight={LANE_H}
                        laneGap={LANE_GAP}
                        color={
                          statusColors ? statusBarColor(item) : barColor(item, roadmap.palette)
                        }
                        editable={editable}
                        clampStart={spanStart}
                        clampEnd={spanEnd}
                        statusColor={statusColors ? undefined : STATUS_COLORS[item.status]}
                        milestoneDate={item.milestoneDate}
                        milestoneText={item.milestoneText}
                        enterIndex={idx}
                        tooltip={
                          <div>
                            <strong>{item.title}</strong>
                            <br />
                            {formatRange(item.startDate, item.endDate)}
                            <br />
                            Status: {STATUS_LABELS[item.status]}
                            {item.completedAt ? (
                              <>
                                <br />
                                Completed: {item.completedAt}
                              </>
                            ) : null}
                            {item.dris ? (
                              <>
                                <br />
                                DRI:{' '}
                                {driAvatars(item.dris, team, item.driMemberId).map((a) => (
                                  <PersonLink
                                    key={a.memberId ?? a.name}
                                    name={a.name}
                                    image={a.image}
                                    uid={a.uid}
                                    showAvatar={false}
                                    testId="bar-detail-dri"
                                  />
                                ))}
                              </>
                            ) : null}
                            {item.responsibleTeam ? (
                              <>
                                <br />
                                Team:{' '}
                                <TeamLink
                                  name={item.responsibleTeam}
                                  uid={item.responsibleTeamUid}
                                  testId="bar-detail-team"
                                />
                              </>
                            ) : null}
                          </div>
                        }
                        onOpen={() => openItem(item)}
                        onCommitDates={(s, e, drop) => commitItemDates(item, s, e, drop)}
                        onDragMove={(x, y) => handleItemDragMove(item, x, y)}
                        dropTarget={dragOverBarId === item.id}
                        avatars={driAvatars(item.dris, team, item.driMemberId)}
                        tag={matchOf(item) === 'dri' ? 'DRI' : matchOf(item) === 'team' ? 'Team' : undefined}
                      />
                    ))}
                    {rowGhosts.map((g) => {
                      const off = dayOffsetInSpan(spanStart, spanEnd, g.startDate)!;
                      const endOff = dayOffsetInSpan(spanStart, spanEnd, g.endDate)!;
                      const lane = laneCount + (ghostLanes.lanes.get(g.id) ?? 0);
                      return (
                        <div
                          key={g.id}
                          className="bar ghost-bar"
                          data-testid="ghost-bar"
                          title={`Suggested: ${g.rationale}`}
                          style={{
                            position: 'absolute',
                            left: off * pxPerDay,
                            width: (endOff - off + 1) * pxPerDay,
                            top: LANE_GAP + lane * (LANE_H + LANE_GAP),
                            height: LANE_H,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSuggestionsOpen(true);
                          }}
                        >
                          <span className="bar-title">{g.title}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {editable && (
              <div className="add-row">
                <Button
                  variant="secondary"
                  styleType="border"
                  size="sm"
                  disabled={initiatives.length >= MAX_INITIATIVES}
                  onClick={addInitiative}
                  data-testid="add-initiative"
                >
                  + Add initiative
                </Button>
                {initiatives.length >= MAX_INITIATIVES && (
                  <span className="max-hint" data-testid="max-initiatives-hint">
                    max {MAX_INITIATIVES} initiatives
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {itemForm && (
        <ItemFormModal
          memberTeams={memberTeams}
          open
          onOpenChange={(open) => !open && setItemForm(null)}
          roadmap={roadmap}
          initiatives={initiatives}
          initial={itemForm.initial}
          editing={itemForm.editing}
          defaultColorIndex={items.length % ITEM_PALETTE.length}
          team={team}
          onSave={async (values) => {
            await saveItem(values, itemForm.editing, itemForm.fromBacklogId);
            setItemForm(null);
          }}
          onImport={async (sourceItemId, initiativeId) => {
            const res = await api<{ item: ItemWithCount }>(
              `/api/roadmaps/${roadmap.id}/items/import`,
              { method: 'POST', body: { sourceItemId, initiativeId } },
            );
            setData((d) => (d ? { ...d, items: [...d.items, res.item] } : d));
            setItemForm(null);
            toast(
              'success',
              `Imported "${res.item.title}" — it stays in sync with the other roadmap`,
            );
          }}
        />
      )}

      {editable && (
        <SharePanel open={shareOpen} onOpenChange={setShareOpen} roadmapId={roadmap.id} />
      )}

      {editable && (
        <SuggestionsPanel
          open={suggestionsOpen}
          onOpenChange={setSuggestionsOpen}
          suggestions={suggestions}
          onResolved={load}
        />
      )}

      <TeamPanel
        open={teamOpen}
        onOpenChange={setTeamOpen}
        roadmapId={roadmap.id}
        editable={editable}
        onChanged={setTeam}
      />

      {editable && <AgentChat roadmapId={roadmap.id} onActionsApplied={load} />}

      <ConfirmModal
        open={deletingRoadmap}
        onOpenChange={setDeletingRoadmap}
        title="Delete roadmap?"
        message={`"${roadmap.title}" will be permanently deleted. This will also delete ${items.length} roadmap item${items.length === 1 ? '' : 's'}, ${totalSprints} sprint item${totalSprints === 1 ? '' : 's'}, and its share list.`}
        busy={busy}
        onConfirm={deleteRoadmap}
      />

      <ConfirmModal
        open={sprintConvertRequest !== null}
        onOpenChange={(open) => !open && setSprintConvertRequest(null)}
        title="Convert item into a sprint item?"
        confirmLabel="Convert"
        message={
          sprintConvertRequest
            ? `"${sprintConvertRequest.source.title}" will become a sprint item of "${sprintConvertRequest.target.title}"${
                sprintConvertRequest.source.sprintCount > 0
                  ? ` along with its ${sprintConvertRequest.source.sprintCount} sprint item${sprintConvertRequest.source.sprintCount === 1 ? '' : 's'}`
                  : ''
              }. "${sprintConvertRequest.target.title}" will stretch to cover its dates if needed.`
            : ''
        }
        busy={busy}
        onConfirm={confirmSprintConvert}
      />

      <ConfirmModal
        open={convertRequest !== null}
        onOpenChange={(open) => !open && setConvertRequest(null)}
        title="Convert initiative into an item?"
        confirmLabel="Convert"
        message={
          convertRequest
            ? (() => {
                const n = items.filter(
                  (i) => i.initiativeId === convertRequest.source.id,
                ).length;
                return `"${convertRequest.source.name}" will become a single item of "${convertRequest.target.name}". Its ${n} item${n === 1 ? '' : 's'} become sprint items of the new item.`;
              })()
            : ''
        }
        busy={busy}
        onConfirm={confirmConvert}
      />

      <ConfirmModal
        open={deletingInitiative !== null}
        onOpenChange={(open) => !open && setDeletingInitiative(null)}
        title="Delete initiative?"
        message={
          deletingInitiative
            ? `The initiative row "${deletingInitiative.name}" will be removed. It has no items.`
            : ''
        }
        busy={busy}
        onConfirm={confirmDeleteInitiative}
      />
    </div>
  );
}

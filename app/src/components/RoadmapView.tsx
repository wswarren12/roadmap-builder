'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@pl/components/Button';
import { EmptyState } from '@pl/components/EmptyState';
import { ITEM_PALETTE, STATUS_COLORS, itemColor } from '@/lib/colors';
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
import type { Initiative, ItemStatus, Roadmap, Role, RoadmapItem } from '@/lib/types';
import { MAX_INITIATIVES } from '@/lib/validate';
import { ApiError, api } from '@/lib/client/api';
import { exportRoadmapPdf } from '@/lib/client/pdf';
import { Bar } from './Bar';
import { ConfirmModal } from './ConfirmModal';
import { ItemFormModal, type ItemFormValues } from './ItemFormModal';
import { SharePanel } from './SharePanel';
import { SignedOutLanding } from './SignedOutLanding';
import { useToast } from './Toasts';

const LANE_H = 34;
const LANE_GAP = 6;
const MIN_PX_PER_DAY = 4.5;
const LABEL_W = 208;

export type ItemWithCount = RoadmapItem & { sprintCount: number };

interface RoadmapData {
  roadmap: Roadmap;
  initiatives: Initiative[];
  items: ItemWithCount[];
  role: Role;
}

type LoadState = 'loading' | 'ok' | 'signedout' | 'forbidden' | 'notfound' | 'error';

export function RoadmapView({ roadmapId }: { roadmapId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<RoadmapData | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(1200);

  // Form / overlay state
  const [itemForm, setItemForm] = useState<{
    initial?: Partial<ItemFormValues>;
    editing?: ItemWithCount;
  } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [deletingRoadmap, setDeletingRoadmap] = useState(false);
  const [deletingInitiative, setDeletingInitiative] = useState<Initiative | null>(null);
  const [busy, setBusy] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const laneDown = useRef<{ x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<RoadmapData>(`/api/roadmaps/${roadmapId}`);
      setData(res);
      setState('ok');
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
  }, [state]);

  // Auto-scroll to current month (F-9b) or restore prior position (AC-3.2).
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (state !== 'ok' || !data || scrolledOnce.current) return;
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
  }, [state, data, gridWidth, roadmapId]);

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
  const editable = role === 'owner';
  const spanStart = roadmap.startMonth;
  const spanEnd = rangeEndDate(roadmap.endMonth);
  const totalDays = rangeTotalDays(roadmap.startMonth, roadmap.endMonth);
  const pxPerDay = Math.max((gridWidth - LABEL_W) / totalDays, MIN_PX_PER_DAY);
  const months = monthColumns(roadmap.startMonth, roadmap.endMonth);
  const todayOff = dayOffsetInSpan(spanStart, spanEnd, todayISO());

  const totalSprints = items.reduce((sum, i) => sum + i.sprintCount, 0);

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

  async function saveItem(values: ItemFormValues, editing?: ItemWithCount) {
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
        body: values,
      });
      setData((d) => (d ? { ...d, items: [...d.items, res.item] } : d));
    }
  }

  async function commitItemDates(item: ItemWithCount, startDate: string, endDate: string) {
    // Optimistic move with revert-on-failure (F-2 error states).
    const prev = data!.items;
    setData((d) =>
      d
        ? {
            ...d,
            items: d.items.map((i) => (i.id === item.id ? { ...i, startDate, endDate } : i)),
          }
        : d,
    );
    try {
      const res = await api<{ item: ItemWithCount }>(`/api/items/${item.id}`, {
        method: 'PATCH',
        body: { startDate, endDate },
      });
      setData((d) =>
        d ? { ...d, items: d.items.map((i) => (i.id === item.id ? res.item : i)) } : d,
      );
      return true;
    } catch (e) {
      setData((d) => (d ? { ...d, items: prev } : d));
      toast('error', e instanceof ApiError ? e.message : "Couldn't save the new dates");
      return false;
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

  function openItem(item: ItemWithCount) {
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
            {editable && (
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
            {months.length} months · {items.length} items
          </span>
          {role === 'viewer' && <span data-testid="viewer-badge">View only</span>}
          {rangeError && (
            <span className="range-error" data-testid="range-error">
              {rangeError}
            </span>
          )}
        </div>
      </header>

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

            {initiatives.map((initiative) => {
              const rowItems = items.filter((i) => i.initiativeId === initiative.id);
              const { lanes, laneCount } = assignLanes(rowItems);
              const rowHeight = laneCount * (LANE_H + LANE_GAP) + LANE_GAP;
              return (
                <div className="swim-row" key={initiative.id} data-testid="initiative-row">
                  <div className="row-label" style={{ minHeight: rowHeight }}>
                    <div className="row-label-name">
                      <input
                        className="row-name-input"
                        defaultValue={initiative.name}
                        key={`${initiative.id}-${initiative.name}`}
                        disabled={!editable}
                        aria-label="Initiative name"
                        data-testid="initiative-name"
                        onBlur={(e) => renameInitiative(initiative, e.target.value)}
                        onKeyDown={(e) =>
                          e.key === 'Enter' && (e.target as HTMLInputElement).blur()
                        }
                      />
                    </div>
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
                    className="lanes"
                    style={{ height: rowHeight, width: totalDays * pxPerDay }}
                    onPointerDown={handleLanePointerDown}
                    onClick={(e) => handleLaneClick(initiative, e)}
                    data-testid="lanes"
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
                        color={itemColor(item.colorIndex)}
                        editable={editable}
                        clampStart={spanStart}
                        clampEnd={spanEnd}
                        statusColor={STATUS_COLORS[item.status as ItemStatus]}
                        milestoneDate={item.milestoneDate}
                        milestoneText={item.milestoneText}
                        enterIndex={idx}
                        tooltip={
                          <div>
                            <strong>{item.title}</strong>
                            <br />
                            {formatRange(item.startDate, item.endDate)}
                            <br />
                            Status: {item.status}
                            {item.dris ? (
                              <>
                                <br />
                                DRIs: {item.dris}
                              </>
                            ) : null}
                          </div>
                        }
                        onOpen={() => openItem(item)}
                        onCommitDates={(s, e) => commitItemDates(item, s, e)}
                      />
                    ))}
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
                    max 5 initiatives
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {itemForm && (
        <ItemFormModal
          open
          onOpenChange={(open) => !open && setItemForm(null)}
          roadmap={roadmap}
          initiatives={initiatives}
          initial={itemForm.initial}
          editing={itemForm.editing}
          onSave={async (values) => {
            await saveItem(values, itemForm.editing);
            setItemForm(null);
          }}
        />
      )}

      {editable && (
        <SharePanel open={shareOpen} onOpenChange={setShareOpen} roadmapId={roadmap.id} />
      )}

      <ConfirmModal
        open={deletingRoadmap}
        onOpenChange={setDeletingRoadmap}
        title="Delete roadmap?"
        message={`"${roadmap.title}" will be permanently deleted. This will also delete ${items.length} roadmap item${items.length === 1 ? '' : 's'}, ${totalSprints} sprint item${totalSprints === 1 ? '' : 's'}, and its share list.`}
        busy={busy}
        onConfirm={deleteRoadmap}
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

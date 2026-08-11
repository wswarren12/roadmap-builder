'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@pl/components/Button';
import { Badge } from '@pl/components/Badge';
import { EmptyState } from '@pl/components/EmptyState';
import { SPRINT_COLOR, itemColor } from '@/lib/colors';
import {
  addDays,
  dayOffsetInSpan,
  daysBetween,
  formatDate,
  formatRange,
  todayISO,
  weekColumns,
} from '@/lib/dates';
import { assignLanes } from '@/lib/stacking';
import { driAvatars } from '@/lib/team';
import type { Roadmap, RoadmapItem, Role, SprintItem, TeamMember } from '@/lib/types';
import { ApiError, api } from '@/lib/client/api';
import { exportItemPdf } from '@/lib/client/pdf';
import { Bar } from './Bar';
import { ConfirmModal } from './ConfirmModal';
import { ItemFormModal, type ItemFormValues } from './ItemFormModal';
import { SignedOutLanding } from './SignedOutLanding';
import { SprintCard } from './SprintCard';
import { SprintFormModal, type SprintFormValues } from './SprintFormModal';
import { useToast } from './Toasts';

const LANE_H = 34;
const LANE_GAP = 6;
const MIN_PX_PER_DAY = 16;

interface ItemData {
  item: RoadmapItem;
  sprints: SprintItem[];
  roadmap: Roadmap;
  initiativeName: string;
  role: Role;
}

type LoadState = 'loading' | 'ok' | 'signedout' | 'forbidden' | 'gone' | 'error';

const STATUS_BADGE: Record<string, 'green' | 'yellow' | 'red'> = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
};

/** Item drill-down (F-3): week columns over exactly the item's timeline,
 *  open Y-axis with free-stacking uniform-color sprint bars (F-4). */
export function SubcalendarView({
  roadmapId,
  itemId,
}: {
  roadmapId: string;
  itemId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<ItemData | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(1100);

  const [sprintForm, setSprintForm] = useState<{
    initial?: Partial<SprintFormValues>;
    editing?: SprintItem;
  } | null>(null);
  const [openSprintId, setOpenSprintId] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [deletingSprint, setDeletingSprint] = useState<SprintItem | null>(null);
  const [promotingSprint, setPromotingSprint] = useState<SprintItem | null>(null);
  const [editingItem, setEditingItem] = useState(false);
  const [deletingItem, setDeletingItem] = useState(false);
  const [busy, setBusy] = useState(false);
  const laneDown = useRef<{ x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<ItemData>(`/api/items/${itemId}`);
      setData(res);
      setState('ok');
      // Roster loads best-effort alongside — bars fall back to initials.
      api<{ members: TeamMember[] }>(`/api/roadmaps/${roadmapId}/team`)
        .then((r) => setTeam(r.members))
        .catch(() => {});
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) return setState('signedout');
        if (e.status === 403) return setState('forbidden');
        if (e.status === 404) return setState('gone');
      }
      setState('error');
    }
  }, [itemId, roadmapId]);

  useEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setGridWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  if (state === 'loading') {
    return (
      <div className="roadmap-page">
        <div className="skeleton" style={{ height: 160 }} />
        <div className="skeleton" style={{ height: 240 }} />
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
        />
      </div>
    );
  }
  if (state === 'gone') {
    return (
      <div className="center-state">
        <EmptyState
          title="This item no longer exists"
          description="It may have been deleted."
          primaryAction={
            <Button
              variant="primary"
              styleType="fill"
              onClick={() => router.push(`/roadmaps/${roadmapId}`)}
            >
              Back to the roadmap
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
          title="Couldn't load this item"
          primaryAction={
            <Button variant="primary" styleType="fill" onClick={load}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const { item, sprints, roadmap, initiativeName, role } = data;
  const editable = role === 'owner' || role === 'editor';
  const weeks = weekColumns(item.startDate, item.endDate);
  const totalDays = daysBetween(item.startDate, item.endDate) + 1;
  const pxPerDay = Math.max(gridWidth / totalDays, MIN_PX_PER_DAY);
  const { lanes, laneCount } = assignLanes(sprints);
  const lanesHeight = laneCount * (LANE_H + LANE_GAP) + LANE_GAP;
  const todayOff = dayOffsetInSpan(item.startDate, item.endDate, todayISO());
  const color = itemColor(item.colorIndex);
  const openSprint = sprints.find((s) => s.id === openSprintId) ?? null;

  async function saveSprint(values: SprintFormValues, editing?: SprintItem) {
    if (editing) {
      const res = await api<{ sprint: SprintItem }>(`/api/sprints/${editing.id}`, {
        method: 'PATCH',
        body: values,
      });
      setData((d) =>
        d
          ? { ...d, sprints: d.sprints.map((s) => (s.id === editing.id ? res.sprint : s)) }
          : d,
      );
    } else {
      const res = await api<{ sprint: SprintItem }>(`/api/items/${item.id}/sprints`, {
        method: 'POST',
        body: values,
      });
      setData((d) => (d ? { ...d, sprints: [...d.sprints, res.sprint] } : d));
    }
  }

  async function commitSprintDates(sprint: SprintItem, startDate: string, endDate: string) {
    // A purely vertical drag commits unchanged dates — nothing to save.
    if (startDate === sprint.startDate && endDate === sprint.endDate) return true;
    const prev = data!.sprints;
    setData((d) =>
      d
        ? {
            ...d,
            sprints: d.sprints.map((s) =>
              s.id === sprint.id ? { ...s, startDate, endDate } : s,
            ),
          }
        : d,
    );
    try {
      const res = await api<{ sprint: SprintItem }>(`/api/sprints/${sprint.id}`, {
        method: 'PATCH',
        body: { startDate, endDate },
      });
      setData((d) =>
        d
          ? { ...d, sprints: d.sprints.map((s) => (s.id === sprint.id ? res.sprint : s)) }
          : d,
      );
      return true;
    } catch (e) {
      setData((d) => (d ? { ...d, sprints: prev } : d));
      toast('error', e instanceof ApiError ? e.message : "Couldn't save the new dates");
      return false;
    }
  }

  async function confirmDeleteSprint() {
    if (!deletingSprint) return;
    setBusy(true);
    try {
      await api(`/api/sprints/${deletingSprint.id}`, { method: 'DELETE' });
      setData((d) =>
        d ? { ...d, sprints: d.sprints.filter((s) => s.id !== deletingSprint.id) } : d,
      );
      setOpenSprintId(null);
      setDeletingSprint(null);
    } catch {
      toast('error', 'Delete failed — please retry');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPromoteSprint() {
    if (!promotingSprint) return;
    setBusy(true);
    try {
      await api(`/api/sprints/${promotingSprint.id}/promote`, { method: 'POST' });
      toast(
        'success',
        `"${promotingSprint.name}" is now a roadmap item in this initiative`,
      );
      setData((d) =>
        d ? { ...d, sprints: d.sprints.filter((s) => s.id !== promotingSprint.id) } : d,
      );
      setOpenSprintId(null);
      setPromotingSprint(null);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Promote failed — please retry');
    } finally {
      setBusy(false);
    }
  }

  async function saveItemEdit(values: ItemFormValues) {
    const res = await api<{ item: RoadmapItem }>(`/api/items/${item.id}`, {
      method: 'PATCH',
      body: values,
    });
    setData((d) => (d ? { ...d, item: res.item } : d));
    setEditingItem(false);
  }

  async function confirmDeleteItem() {
    setBusy(true);
    try {
      await api(`/api/items/${item.id}`, { method: 'DELETE' });
      toast('success', `Deleted "${item.title}"`);
      router.push(`/roadmaps/${roadmapId}`);
    } catch {
      toast('error', 'Delete failed — please retry');
      setBusy(false);
    }
  }

  // Single-click on empty lane space creates a sprint at that spot; see the
  // matching guard rationale in RoadmapView.handleLaneClick.
  function handleLanePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    laneDown.current =
      e.target === e.currentTarget ? { x: e.clientX, y: e.clientY } : null;
  }

  function handleLaneClick(e: React.MouseEvent<HTMLDivElement>) {
    const down = laneDown.current;
    laneDown.current = null;
    if (!editable || e.target !== e.currentTarget) return;
    if (!down || Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const day = Math.max(0, Math.min(totalDays - 1, Math.floor((e.clientX - rect.left) / pxPerDay)));
    const start = addDays(item.startDate, day);
    const end = daysBetween(start, item.endDate) >= 4 ? addDays(start, 4) : item.endDate;
    setSprintForm({ initial: { startDate: start, endDate: end } });
  }

  return (
    <div className="roadmap-page" data-testid="subcalendar-view" data-role={role}>
      <header className="subcal-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link href={`/roadmaps/${roadmapId}`} data-testid="back-to-roadmap">
            ← {roadmap.title}
          </Link>
          <span>/</span>
          <span>{initiativeName}</span>
          <span>/</span>
          <span>{item.title}</span>
        </nav>
        <div className="subcal-title-row">
          <h1 className="subcal-title">
            <span className="subcal-color-chip" style={{ background: color }} />
            {item.title}
            <Badge color={STATUS_BADGE[item.status]} styleType="light" size="sm">
              {item.status}
            </Badge>
          </h1>
          <div className="header-actions">
            {editable && (
              <>
                <Button
                  variant="primary"
                  styleType="fill"
                  onClick={() => setSprintForm({ initial: {} })}
                  data-testid="add-sprint"
                >
                  + Sprint item
                </Button>
                <Button
                  variant="secondary"
                  styleType="border"
                  onClick={() => setEditingItem(true)}
                  data-testid="edit-item"
                >
                  Edit item
                </Button>
              </>
            )}
            <Button
              variant="secondary"
              styleType="border"
              onClick={() =>
                exportItemPdf({ roadmap, item, sprints, initiativeName }).catch(() =>
                  toast('error', 'PDF generation failed — please retry'),
                )
              }
              data-testid="export-item-pdf"
            >
              Download PDF
            </Button>
            {editable && (
              <Button
                variant="error"
                styleType="light"
                onClick={() => setDeletingItem(true)}
                data-testid="delete-item"
              >
                Delete
              </Button>
            )}
          </div>
        </div>
        <span className="roadmap-meta">{formatRange(item.startDate, item.endDate)}</span>
        {item.description && <p className="subcal-desc">{item.description}</p>}
        <div className="detail-grid">
          {item.milestoneText && (
            <div className="detail-field">
              <span className="detail-label">Milestone</span>
              <span className="detail-value">
                {item.milestoneText}
                {item.milestoneDate ? ` — ${formatDate(item.milestoneDate)}` : ''}
              </span>
            </div>
          )}
          {item.okrs && (
            <div className="detail-field">
              <span className="detail-label">Key Result</span>
              <span className="detail-value">{item.okrs}</span>
            </div>
          )}
          {item.dris && (
            <div className="detail-field">
              <span className="detail-label">DRI</span>
              <span className="detail-value">{item.dris}</span>
            </div>
          )}
          {item.responsibleTeam && (
            <div className="detail-field">
              <span className="detail-label">Responsible team</span>
              <span className="detail-value" data-testid="item-responsible-team-value">
                {item.responsibleTeam}
              </span>
            </div>
          )}
          {item.kpi && (
            <div className="detail-field">
              <span className="detail-label">KPI</span>
              <span className="detail-value">{item.kpi}</span>
            </div>
          )}
        </div>
      </header>

      <div className="timeline-card">
        <div className="timeline-scroll" ref={scrollRef}>
          <div className="timeline-inner" style={{ width: totalDays * pxPerDay }}>
            <div className="timeline-head">
              {weeks.map((w) => (
                <div
                  key={w.start}
                  className={`time-col${w.partial ? ' time-col--partial' : ''}`}
                  style={{ width: w.days * pxPerDay }}
                  data-testid="week-col"
                  data-start={w.start}
                  data-end={w.end}
                >
                  {w.label}
                </div>
              ))}
            </div>
            <div className="subcal-lanes-wrap">
              <div
                className="lanes"
                style={{ height: lanesHeight, width: totalDays * pxPerDay }}
                onPointerDown={handleLanePointerDown}
                onClick={handleLaneClick}
                data-testid="sprint-lanes"
              >
                {weeks.slice(1).map((w) => (
                  <span
                    key={w.start}
                    className="lane-grid-line"
                    style={{ left: w.startOffset * pxPerDay }}
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
                {sprints.length === 0 && (
                  <span
                    className="max-hint"
                    style={{ position: 'absolute', top: LANE_GAP + 8, left: 12, pointerEvents: 'none' }}
                  >
                    {editable
                      ? 'No sprint items yet — click the grid or use “+ Sprint item”.'
                      : 'No sprint items yet.'}
                  </span>
                )}
                {sprints.map((sprint, idx) => (
                  <Bar
                    key={sprint.id}
                    testId="sprint-bar"
                    entityId={sprint.id}
                    title={sprint.name}
                    startDate={sprint.startDate}
                    endDate={sprint.endDate}
                    spanStart={item.startDate}
                    pxPerDay={pxPerDay}
                    lane={lanes.get(sprint.id) ?? 0}
                    laneHeight={LANE_H}
                    laneGap={LANE_GAP}
                    color={SPRINT_COLOR}
                    editable={editable}
                    clampStart={item.startDate}
                    clampEnd={item.endDate}
                    milestoneDate={sprint.milestoneDate}
                    milestoneText={sprint.milestoneText}
                    enterIndex={idx}
                    tooltip={
                      <div>
                        <strong>{sprint.name}</strong>
                        <br />
                        {formatRange(sprint.startDate, sprint.endDate)}
                        {sprint.dri ? (
                          <>
                            <br />
                            DRI: {sprint.dri}
                          </>
                        ) : null}
                      </div>
                    }
                    onOpen={() => setOpenSprintId(sprint.id)}
                    onCommitDates={(s, e) => commitSprintDates(sprint, s, e)}
                    avatars={driAvatars(sprint.dri, team)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <SprintCard
        sprint={openSprint}
        editable={editable}
        onOpenChange={(open) => !open && setOpenSprintId(null)}
        onEdit={(sprint) => {
          setOpenSprintId(null);
          setSprintForm({ editing: sprint });
        }}
        onDelete={(sprint) => setDeletingSprint(sprint)}
        onPromote={(sprint) => setPromotingSprint(sprint)}
      />

      {sprintForm && (
        <SprintFormModal
          open
          onOpenChange={(open) => !open && setSprintForm(null)}
          item={item}
          initial={sprintForm.initial}
          editing={sprintForm.editing}
          driSuggestions={team.map((m) => m.name)}
          onSave={async (values) => {
            await saveSprint(values, sprintForm.editing);
            setSprintForm(null);
          }}
        />
      )}

      {editingItem && (
        <ItemFormModal
          open
          onOpenChange={(open) => !open && setEditingItem(false)}
          roadmap={roadmap}
          initiatives={[
            {
              id: item.initiativeId,
              roadmapId: roadmap.id,
              name: initiativeName,
              description: '',
              position: 1,
              createdAt: '',
            },
          ]}
          editing={item}
          onSave={saveItemEdit}
        />
      )}

      <ConfirmModal
        open={promotingSprint !== null}
        onOpenChange={(open) => !open && setPromotingSprint(null)}
        title="Promote to a roadmap item?"
        confirmLabel="Promote"
        message={
          promotingSprint
            ? `"${promotingSprint.name}" will leave "${item.title}" and become a full roadmap item in the "${initiativeName}" initiative, keeping its dates, milestone, KPI, and DRI.`
            : ''
        }
        busy={busy}
        onConfirm={confirmPromoteSprint}
      />

      <ConfirmModal
        open={deletingSprint !== null}
        onOpenChange={(open) => !open && setDeletingSprint(null)}
        title="Delete sprint item?"
        message={deletingSprint ? `"${deletingSprint.name}" will be permanently deleted.` : ''}
        busy={busy}
        onConfirm={confirmDeleteSprint}
      />

      <ConfirmModal
        open={deletingItem}
        onOpenChange={setDeletingItem}
        title="Delete roadmap item?"
        message={`"${item.title}" will be permanently deleted. This will also delete ${sprints.length} sprint item${sprints.length === 1 ? '' : 's'}.`}
        busy={busy}
        onConfirm={confirmDeleteItem}
      />
    </div>
  );
}

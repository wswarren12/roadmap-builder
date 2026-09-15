'use client';

import { useState } from 'react';
import { Badge } from '@pl/components/Badge';
import { Button } from '@pl/components/Button';
import { Input } from '@pl/components/Input';
import { barColor, statusBarColor } from '@/lib/colors';
import { formatRange, todayISO } from '@/lib/dates';
import { personMatch } from '@/lib/filter';
import { driAvatars } from '@/lib/team';
import {
  ITEM_STATUSES,
  STATUS_LABELS,
  type Initiative,
  type ItemInput,
  type ItemStatus,
  type Roadmap,
  type RoadmapBacklogItem,
  type RoadmapItem,
  type TeamMember,
} from '@/lib/types';
import { ApiError, api } from '@/lib/client/api';
import { Avatar } from './Avatar';
import { PersonLink, TeamLink } from './ProfileLink';
import { useToast } from './Toasts';

const BADGE: Record<ItemStatus, 'green' | 'yellow' | 'red' | 'gray'> = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  deprioritized: 'gray',
};

export function StatusBadge({ status, completed }: { status: ItemStatus; completed?: boolean }) {
  if (completed) {
    return (
      <Badge color="green" styleType="fill" size="sm">
        Completed
      </Badge>
    );
  }
  return (
    <Badge color={BADGE[status]} styleType="light" size="sm">
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** Kanban columns: the roadmap backlog, then one per existing item status,
 *  then Completed (the existing `completedAt` flag, which outranks status). */
type Column = 'backlog' | ItemStatus | 'completed';
const COLUMNS: { key: Column; title: string }[] = [
  { key: 'backlog', title: 'Backlog' },
  ...ITEM_STATUSES.map((s) => ({ key: s, title: STATUS_LABELS[s] })),
  { key: 'completed', title: 'Completed' },
];

export function columnFor(item: Pick<RoadmapItem, 'status' | 'completedAt'>): Column {
  return item.completedAt ? 'completed' : item.status;
}

/** Item PATCH body that moves a card into `col` (status columns clear completion). */
export function movePatch(col: Exclude<Column, 'backlog'>): Pick<ItemInput, 'status' | 'completedAt'> {
  return col === 'completed' ? { completedAt: todayISO() } : { status: col, completedAt: null };
}

/**
 * Board (Kanban) view over the same roadmap data as the timeline: scheduled
 * items sit in the column of their status (or Completed); editors drag a
 * card — or use its status select — to change it via the same item PATCH the
 * timeline uses. Unscheduled work lives in the roadmap's own Backlog column
 * until an editor schedules it onto the timeline.
 */
export function BoardView({
  roadmap,
  initiatives,
  items,
  team,
  editable,
  statusColors,
  personFilter = null,
  onBacklogChange,
  onSchedule,
  onOpenItem,
  onMoveItem,
}: {
  roadmap: Roadmap;
  initiatives: Initiative[];
  items: RoadmapItem[];
  team: TeamMember[];
  editable: boolean;
  statusColors: boolean;
  /** Active person filter: backlog entries narrow to it and cards show which field matched. */
  personFilter?: string | null;
  onBacklogChange: (backlog: RoadmapBacklogItem[]) => void;
  onSchedule: (entry: RoadmapBacklogItem) => void;
  onOpenItem: (item: RoadmapItem) => void;
  /** Persisted card move (status / completion); resolves to the saved item. */
  onMoveItem: (item: RoadmapItem, patch: Pick<ItemInput, 'status' | 'completedAt'>) => Promise<void>;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<Column | null>(null);
  const initiativeName = (id: string) => initiatives.find((i) => i.id === id)?.name ?? '';
  const accent = (item: RoadmapItem) =>
    statusColors ? statusBarColor(item) : barColor(item, roadmap.palette);

  async function addBacklog() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const res = await api<{ backlog: RoadmapBacklogItem[] }>(
        `/api/roadmaps/${roadmap.id}/backlog`,
        { method: 'POST', body: { title: title.trim() } },
      );
      onBacklogChange(res.backlog);
      setTitle('');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not add — please retry');
    } finally {
      setBusy(false);
    }
  }

  async function patchBacklog(id: string, patch: Partial<RoadmapBacklogItem>) {
    try {
      const res = await api<{ backlog: RoadmapBacklogItem[] }>(
        `/api/roadmaps/${roadmap.id}/backlog`,
        { method: 'PATCH', body: { id, ...patch } },
      );
      onBacklogChange(res.backlog);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Save failed — please retry');
    }
  }

  async function removeBacklog(id: string) {
    try {
      const res = await api<{ backlog: RoadmapBacklogItem[] }>(
        `/api/roadmaps/${roadmap.id}/backlog?id=${id}`,
        { method: 'DELETE' },
      );
      onBacklogChange(res.backlog);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Delete failed — please retry');
    }
  }

  async function moveTo(item: RoadmapItem, col: Column) {
    setDragId(null);
    setDropCol(null);
    if (col === 'backlog' || columnFor(item) === col) return;
    await onMoveItem(item, movePatch(col));
  }

  return (
    <div className="board" data-testid="board-view">
      {COLUMNS.map((col) => {
        const colItems = items.filter((i) => columnFor(i) === col.key);
        const backlog = personFilter
          ? roadmap.backlog.filter((b) => personMatch({ dris: b.dris, responsibleTeam: '' }, personFilter))
          : roadmap.backlog;
        const count = col.key === 'backlog' ? backlog.length : colItems.length;
        const droppable = editable && col.key !== 'backlog' && dragId !== null;
        return (
          <section
            className={`board-col${droppable && dropCol === col.key ? ' board-col--drop' : ''}`}
            key={col.key}
            data-testid={`board-col-${col.key}`}
            onDragOver={(e) => {
              if (!droppable) return;
              e.preventDefault();
              setDropCol(col.key);
            }}
            onDragLeave={() => dropCol === col.key && setDropCol(null)}
            onDrop={(e) => {
              if (!droppable) return;
              e.preventDefault();
              const item = items.find((i) => i.id === dragId);
              if (item) moveTo(item, col.key);
            }}
          >
            <header className="board-col-head">
              <span>{col.title}</span>
              <span className="board-col-count">{count}</span>
            </header>

            {col.key === 'backlog' && editable && (
              <div className="board-add">
                <Input
                  value={title}
                  placeholder="Unscheduled item…"
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addBacklog()}
                  data-testid="backlog-add-title"
                  fullWidth
                />
                <Button
                  variant="primary"
                  styleType="fill"
                  size="sm"
                  disabled={!title.trim() || busy}
                  onClick={addBacklog}
                  data-testid="backlog-add"
                >
                  Add
                </Button>
              </div>
            )}

            {col.key === 'backlog' &&
              backlog.map((entry) => (
                <article
                  className="board-card"
                  key={entry.id}
                  data-testid="backlog-card"
                  style={{ borderLeftColor: statusColors ? statusBarColor({ status: entry.status, completedAt: null }) : undefined }}
                >
                  <div className="board-card-top">
                    <strong>{entry.title}</strong>
                    <StatusBadge status={entry.status} />
                  </div>
                  {entry.dris && (
                    <div className="board-card-meta">
                      {driAvatars(entry.dris, team).map((a) => (
                        <Avatar key={a.name} name={a.name} image={a.image} size={20} />
                      ))}
                      <span>{entry.dris}</span>
                    </div>
                  )}
                  {editable && (
                    <div className="board-card-actions">
                      <select
                        className="board-status-select"
                        aria-label="Status"
                        value={entry.status}
                        onChange={(e) => patchBacklog(entry.id, { status: e.target.value as ItemStatus })}
                        data-testid="backlog-card-status"
                      >
                        {(Object.keys(STATUS_LABELS) as ItemStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="secondary"
                        styleType="border"
                        size="xs"
                        onClick={() => onSchedule(entry)}
                        data-testid="backlog-schedule"
                      >
                        Schedule
                      </Button>
                      <button
                        className="icon-btn"
                        aria-label={`Delete ${entry.title}`}
                        onClick={() => removeBacklog(entry.id)}
                        data-testid="backlog-delete"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </article>
              ))}

            {colItems.map((item) => (
              <article
                className={`board-card board-card--item${dragId === item.id ? ' board-card--dragging' : ''}`}
                key={item.id}
                data-testid="board-card"
                data-entity-id={item.id}
                style={{ borderLeftColor: accent(item) }}
                onClick={() => onOpenItem(item)}
                draggable={editable}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', item.id);
                  setDragId(item.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDropCol(null);
                }}
              >
                <div className="board-card-top">
                  <strong>{item.title}</strong>
                  <StatusBadge status={item.status} completed={item.completedAt !== null} />
                </div>
                <div className="board-card-meta">
                  <span>{initiativeName(item.initiativeId)}</span>
                  <span>·</span>
                  <span>{formatRange(item.startDate, item.endDate)}</span>
                </div>
                {personFilter && (
                  <div className="board-card-meta" data-testid="board-card-match">
                    <Badge color="blue" styleType="light" size="sm">
                      {personMatch(item, personFilter) === 'dri' ? 'DRI' : 'Responsible team'}
                    </Badge>
                  </div>
                )}
                {item.responsibleTeam && (
                  <div className="board-card-meta">
                    <span>Team: </span>
                    <TeamLink
                      name={item.responsibleTeam}
                      uid={item.responsibleTeamUid}
                      testId="board-card-team"
                    />
                  </div>
                )}
                {item.dris && (
                  <div className="board-card-meta">
                    {driAvatars(item.dris, team, item.driMemberId).map((a) => (
                      <PersonLink
                        key={a.memberId ?? a.name}
                        name={a.name}
                        image={a.image}
                        uid={a.uid}
                        size={20}
                        testId="board-card-dri"
                      />
                    ))}
                  </div>
                )}
                {editable && (
                  <div className="board-card-actions">
                    <select
                      className="board-status-select"
                      aria-label={`Move ${item.title}`}
                      value={columnFor(item)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => moveTo(item, e.target.value as Column)}
                      data-testid="board-card-move"
                    >
                      {COLUMNS.filter((c) => c.key !== 'backlog').map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </article>
            ))}

            {count === 0 && <p className="board-empty">Nothing here</p>}
          </section>
        );
      })}
    </div>
  );
}

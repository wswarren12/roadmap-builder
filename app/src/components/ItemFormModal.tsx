'use client';

import { useEffect, useState } from 'react';
import { Button } from '@pl/components/Button';
import { Input } from '@pl/components/Input';
import { Textarea } from '@pl/components/Textarea';
import { formatRange, rangeEndDate } from '@/lib/dates';
import type { Initiative, ItemStatus, Roadmap, RoadmapItem } from '@/lib/types';
import { ApiError, api } from '@/lib/client/api';
import { Modal } from './Modal';

export interface ItemFormValues {
  initiativeId: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  milestoneText: string;
  milestoneDate: string | null;
  okrs: string;
  dris: string;
  responsibleTeam: string;
  status: ItemStatus;
  kpi: string;
}

const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: 'green', label: 'Green' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'red', label: 'Red' },
];

/**
 * "Import from other roadmap" picker (F-15b): choose one of the member's
 * other roadmaps, then one of its items. The parent performs the import —
 * the created copy stays permanently in sync with the original.
 */
function ImportPicker({
  currentRoadmapId,
  initiatives,
  defaultInitiativeId,
  onImport,
  onBack,
}: {
  currentRoadmapId: string;
  /** The TARGET roadmap's initiatives — the source's categories are
   *  irrelevant; the member picks where the copy lands here. */
  initiatives: Initiative[];
  defaultInitiativeId: string;
  onImport: (sourceItemId: string, initiativeId: string) => Promise<void>;
  onBack: () => void;
}) {
  const [roadmaps, setRoadmaps] = useState<Roadmap[] | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [items, setItems] = useState<RoadmapItem[] | null>(null);
  const [targetInitiativeId, setTargetInitiativeId] = useState(
    defaultInitiativeId || initiatives[0]?.id || '',
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ owned: Roadmap[]; shared: Roadmap[] }>('/api/me/roadmaps')
      .then((res) =>
        setRoadmaps(
          [...res.owned, ...res.shared].filter((r) => r.id !== currentRoadmapId),
        ),
      )
      .catch(() => setError("Couldn't load your roadmaps — please retry"));
  }, [currentRoadmapId]);

  useEffect(() => {
    if (!sourceId) return setItems(null);
    setItems(null);
    api<{ items: RoadmapItem[] }>(`/api/roadmaps/${sourceId}`)
      .then((res) => setItems(res.items))
      .catch(() => setError("Couldn't load that roadmap's items — please retry"));
  }, [sourceId]);

  return (
    <div className="sprint-card-fields" data-testid="import-picker">
      <p className="confirm-message">
        Pick an item from another roadmap. The imported item stays linked:
        editing it on either roadmap updates both, so you need edit access on
        both roadmaps. The two roadmaps don&apos;t need matching initiatives —
        choose where the item lands here.
      </p>
      <div>
        <label className="form-label" htmlFor="import-initiative">
          Into initiative
        </label>
        <select
          id="import-initiative"
          className="row-name-input"
          value={targetInitiativeId}
          onChange={(e) => setTargetInitiativeId(e.target.value)}
          data-testid="import-initiative"
        >
          {initiatives.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="form-label" htmlFor="import-roadmap">
          Roadmap
        </label>
        <select
          id="import-roadmap"
          className="row-name-input"
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          data-testid="import-roadmap"
        >
          <option value="">
            {roadmaps === null ? 'Loading…' : 'Choose a roadmap…'}
          </option>
          {(roadmaps ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
      </div>
      {roadmaps !== null && roadmaps.length === 0 && (
        <span className="max-hint">You have no other roadmaps to import from.</span>
      )}
      {sourceId && items === null && <div className="skeleton" style={{ height: 60 }} />}
      {items !== null &&
        (items.length === 0 ? (
          <span className="max-hint">That roadmap has no items yet.</span>
        ) : (
          items.map((item) => (
            <div key={item.id} className="share-row" data-testid="import-item-row">
              <span>
                {item.title}
                <span className="max-hint"> · {formatRange(item.startDate, item.endDate)}</span>
              </span>
              <Button
                variant="primary"
                styleType="fill"
                size="xs"
                loading={busyId === item.id}
                onClick={async () => {
                  setError(null);
                  setBusyId(item.id);
                  try {
                    await onImport(item.id, targetInitiativeId);
                  } catch (e) {
                    setError(
                      e instanceof ApiError ? e.message : 'Import failed — please retry',
                    );
                  } finally {
                    setBusyId(null);
                  }
                }}
                data-testid="import-item"
              >
                Import
              </Button>
            </div>
          ))
        ))}
      {error && <span className="range-error">{error}</span>}
      <div className="share-add">
        <Button variant="secondary" styleType="border" onClick={onBack} data-testid="import-back">
          Back
        </Button>
      </div>
    </div>
  );
}

/** Roadmap-item create/edit form (F-2): full field set behind the bar. */
export function ItemFormModal({
  open,
  onOpenChange,
  roadmap,
  initiatives,
  initial,
  editing,
  driSuggestions = [],
  onSave,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roadmap: Roadmap;
  initiatives: Initiative[];
  /** Team roster names offered while typing DRIs (F-13). */
  driSuggestions?: string[];
  initial?: Partial<ItemFormValues>;
  editing?: RoadmapItem;
  onSave: (values: ItemFormValues) => Promise<void>;
  /** When set, shows "Import from other roadmap" (F-15b). Receives the source
   *  item id and the initiative currently selected in this form. */
  onImport?: (sourceItemId: string, initiativeId: string) => Promise<void>;
}) {
  const spanEnd = rangeEndDate(roadmap.endMonth);
  const source = editing ?? initial;
  const [values, setValues] = useState<ItemFormValues>({
    initiativeId: source?.initiativeId ?? initiatives[0]?.id ?? '',
    title: editing?.title ?? '',
    description: source?.description ?? '',
    startDate: source?.startDate ?? roadmap.startMonth,
    endDate: source?.endDate ?? spanEnd,
    milestoneText: source?.milestoneText ?? '',
    milestoneDate: source?.milestoneDate ?? null,
    okrs: source?.okrs ?? '',
    dris: source?.dris ?? '',
    responsibleTeam: source?.responsibleTeam ?? '',
    status: (source?.status as ItemStatus) ?? 'green',
    kpi: source?.kpi ?? '',
  });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  const set = <K extends keyof ItemFormValues>(key: K, value: ItemFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await onSave(values);
    } catch (e) {
      if (e instanceof ApiError) setError({ field: e.field, message: e.message });
      else setError({ message: 'Save failed — please retry' });
    } finally {
      setBusy(false);
    }
  }

  if (importing && onImport) {
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="Import from other roadmap"
        wide
      >
        <ImportPicker
          currentRoadmapId={roadmap.id}
          initiatives={initiatives}
          defaultInitiativeId={values.initiativeId}
          onImport={onImport}
          onBack={() => setImporting(false)}
        />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit roadmap item' : 'New roadmap item'}
      wide
      footer={
        <>
          <Button variant="secondary" styleType="border" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            styleType="fill"
            loading={busy}
            disabled={!values.title.trim()}
            onClick={submit}
            data-testid="save-item"
          >
            {editing ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
      {onImport && (
        <div className="share-add">
          <Button
            variant="secondary"
            styleType="border"
            size="sm"
            onClick={() => setImporting(true)}
            data-testid="open-import"
          >
            Import from other roadmap
          </Button>
        </div>
      )}
      <Input
        label="Title"
        value={values.title}
        onChange={(e) => set('title', e.target.value)}
        error={error?.field === 'title' ? error.message : undefined}
        fullWidth
        autoFocus
        data-testid="item-title"
      />
      <div>
        <label className="form-label" htmlFor="item-initiative">Initiative</label>
        <select
          id="item-initiative"
          className="row-name-input"
          value={values.initiativeId}
          onChange={(e) => set('initiativeId', e.target.value)}
          data-testid="item-initiative"
        >
          {initiatives.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </div>
      <Textarea
        label="Short description"
        value={values.description}
        onChange={(e) => set('description', e.target.value)}
        rows={2}
        fullWidth
      />
      <div className="form-row">
        <Input
          label="Start date"
          type="date"
          value={values.startDate}
          min={roadmap.startMonth}
          max={spanEnd}
          onChange={(e) => set('startDate', e.target.value)}
          error={error?.field === 'startDate' ? error.message : undefined}
          fullWidth
          data-testid="item-start"
        />
        <Input
          label="End date"
          type="date"
          value={values.endDate}
          min={roadmap.startMonth}
          max={spanEnd}
          onChange={(e) => set('endDate', e.target.value)}
          error={error?.field === 'endDate' ? error.message : undefined}
          fullWidth
          data-testid="item-end"
        />
      </div>
      <div className="form-row">
        <Input
          label="Milestone"
          value={values.milestoneText}
          onChange={(e) => set('milestoneText', e.target.value)}
          placeholder="e.g. Beta launch"
          fullWidth
        />
        <Input
          label="Milestone date (optional)"
          type="date"
          value={values.milestoneDate ?? ''}
          min={values.startDate}
          max={values.endDate}
          onChange={(e) => set('milestoneDate', e.target.value || null)}
          error={error?.field === 'milestoneDate' ? error.message : undefined}
          fullWidth
          data-testid="item-milestone-date"
        />
      </div>
      <Textarea
        label="Key Result"
        value={values.okrs}
        onChange={(e) => set('okrs', e.target.value)}
        rows={2}
        fullWidth
      />
      <div className="form-row">
        <Input
          label="DRI"
          value={values.dris}
          onChange={(e) => set('dris', e.target.value)}
          placeholder="Who's responsible"
          list="dri-suggestions"
          fullWidth
        />
        <datalist id="dri-suggestions">
          {driSuggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <Input
          label="KPI"
          value={values.kpi}
          onChange={(e) => set('kpi', e.target.value)}
          fullWidth
        />
      </div>
      <Input
        label="Responsible team"
        value={values.responsibleTeam}
        onChange={(e) => set('responsibleTeam', e.target.value)}
        placeholder="e.g. Platform, Growth"
        fullWidth
        data-testid="item-responsible-team"
      />
      <div>
        <span className="form-label">Status</span>
        <div className="status-group" role="radiogroup" aria-label="Status">
          {STATUS_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="xs"
              variant={
                opt.value === 'green' ? 'success' : opt.value === 'yellow' ? 'warning' : 'error'
              }
              styleType={values.status === opt.value ? 'fill' : 'light'}
              onClick={() => set('status', opt.value)}
              role="radio"
              aria-checked={values.status === opt.value}
              data-testid={`status-${opt.value}`}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
      {error && !error.field && <span className="range-error">{error.message}</span>}
      {error && error.field && !['title', 'startDate', 'endDate', 'milestoneDate'].includes(error.field) && (
        <span className="range-error">{error.message}</span>
      )}
    </Modal>
  );
}

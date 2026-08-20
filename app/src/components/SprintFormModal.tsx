'use client';

import { useState } from 'react';
import { Button } from '@pl/components/Button';
import { Input } from '@pl/components/Input';
import { Textarea } from '@pl/components/Textarea';
import { formatRange, todayISO } from '@/lib/dates';
import type { RoadmapItem, SprintItem } from '@/lib/types';
import { ApiError } from '@/lib/client/api';
import { Modal } from './Modal';

export interface SprintFormValues {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  milestoneText: string;
  milestoneDate: string | null;
  kpi: string;
  dri: string;
  completedAt: string | null;
}

/** Sprint-item create/edit form (F-4) — dates bounded by the parent item. */
export function SprintFormModal({
  open,
  onOpenChange,
  item,
  initial,
  editing,
  driSuggestions = [],
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: RoadmapItem;
  initial?: Partial<SprintFormValues>;
  editing?: SprintItem;
  /** Team roster names offered while typing the DRI (F-13). */
  driSuggestions?: string[];
  onSave: (values: SprintFormValues) => Promise<void>;
}) {
  const source = editing ?? initial;
  const [values, setValues] = useState<SprintFormValues>({
    name: editing?.name ?? '',
    description: source?.description ?? '',
    startDate: source?.startDate ?? item.startDate,
    endDate: source?.endDate ?? item.endDate,
    milestoneText: source?.milestoneText ?? '',
    milestoneDate: source?.milestoneDate ?? null,
    kpi: source?.kpi ?? '',
    dri: source?.dri ?? '',
    completedAt: source?.completedAt ?? null,
  });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof SprintFormValues>(key: K, value: SprintFormValues[K]) =>
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

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit sprint item' : 'New sprint item'}
      footer={
        <>
          <Button variant="secondary" styleType="border" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            styleType="fill"
            loading={busy}
            disabled={!values.name.trim()}
            onClick={submit}
            data-testid="save-sprint"
          >
            {editing ? 'Save changes' : 'Add sprint item'}
          </Button>
        </>
      }
    >
      <span className="max-hint">
        Must fall within the item&apos;s timeline: {formatRange(item.startDate, item.endDate)}
      </span>
      <Input
        label="Name"
        value={values.name}
        onChange={(e) => set('name', e.target.value)}
        error={error?.field === 'name' ? error.message : undefined}
        fullWidth
        autoFocus
        data-testid="sprint-name"
      />
      <Textarea
        label="Description"
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
          min={item.startDate}
          max={item.endDate}
          onChange={(e) => set('startDate', e.target.value)}
          error={error?.field === 'startDate' ? error.message : undefined}
          fullWidth
          data-testid="sprint-start"
        />
        <Input
          label="End date"
          type="date"
          value={values.endDate}
          min={item.startDate}
          max={item.endDate}
          onChange={(e) => set('endDate', e.target.value)}
          error={error?.field === 'endDate' ? error.message : undefined}
          fullWidth
          data-testid="sprint-end"
        />
      </div>
      <div className="form-row">
        <Input
          label="Milestone"
          value={values.milestoneText}
          onChange={(e) => set('milestoneText', e.target.value)}
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
        />
      </div>
      <div className="form-row">
        <Input
          label="KPI"
          value={values.kpi}
          onChange={(e) => set('kpi', e.target.value)}
          fullWidth
        />
        <Input
          label="DRI"
          value={values.dri}
          onChange={(e) => set('dri', e.target.value)}
          list="sprint-dri-suggestions"
          fullWidth
        />
        <datalist id="sprint-dri-suggestions">
          {driSuggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      <div className="completed-row">
        <label className="completed-toggle">
          <input
            type="checkbox"
            checked={values.completedAt !== null}
            onChange={(e) => set('completedAt', e.target.checked ? todayISO() : null)}
            data-testid="sprint-completed"
          />
          Mark as complete
        </label>
        {values.completedAt !== null && (
          <Input
            label="Completion date"
            type="date"
            value={values.completedAt}
            onChange={(e) => set('completedAt', e.target.value || todayISO())}
            error={error?.field === 'completedAt' ? error.message : undefined}
            fullWidth
            data-testid="sprint-completed-date"
          />
        )}
      </div>
      {error && !error.field && <span className="range-error">{error.message}</span>}
    </Modal>
  );
}

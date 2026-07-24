'use client';

import { useState } from 'react';
import { Button } from '@pl/components/Button';
import { Input } from '@pl/components/Input';
import { Textarea } from '@pl/components/Textarea';
import { rangeEndDate } from '@/lib/dates';
import type { Initiative, ItemStatus, Roadmap, RoadmapItem } from '@/lib/types';
import { ApiError } from '@/lib/client/api';
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
  status: ItemStatus;
  kpi: string;
}

const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: 'green', label: 'Green' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'red', label: 'Red' },
];

/** Roadmap-item create/edit form (F-2): full field set behind the bar. */
export function ItemFormModal({
  open,
  onOpenChange,
  roadmap,
  initiatives,
  initial,
  editing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roadmap: Roadmap;
  initiatives: Initiative[];
  initial?: Partial<ItemFormValues>;
  editing?: RoadmapItem;
  onSave: (values: ItemFormValues) => Promise<void>;
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
    status: (source?.status as ItemStatus) ?? 'green',
    kpi: source?.kpi ?? '',
  });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

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
        label="OKRs"
        value={values.okrs}
        onChange={(e) => set('okrs', e.target.value)}
        rows={2}
        fullWidth
      />
      <div className="form-row">
        <Input
          label="DRIs"
          value={values.dris}
          onChange={(e) => set('dris', e.target.value)}
          placeholder="Who's responsible"
          fullWidth
        />
        <Input
          label="KPI"
          value={values.kpi}
          onChange={(e) => set('kpi', e.target.value)}
          fullWidth
        />
      </div>
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

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@pl/components/Button';
import { Input } from '@pl/components/Input';
import { Textarea } from '@pl/components/Textarea';
import { ApiError, api } from '@/lib/client/api';
import { monthsInclusive } from '@/lib/dates';
import { Modal } from './Modal';
import { useToast } from './Toasts';

function defaultMonths(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const fmt = (yy: number, mm: number) =>
    `${yy + Math.floor(mm / 12)}-${String((mm % 12) + 1).padStart(2, '0')}`;
  return { start: fmt(y, m), end: fmt(y, m + 5) };
}

export function NewRoadmapModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const defaults = defaultMonths();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startMonth, setStartMonth] = useState(defaults.start);
  const [endMonth, setEndMonth] = useState(defaults.end);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const months =
    startMonth && endMonth ? monthsInclusive(`${startMonth}-01`, `${endMonth}-01`) : 0;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ roadmap: { id: string } }>('/api/roadmaps', {
        method: 'POST',
        body: {
          title,
          description,
          startMonth: `${startMonth}-01`,
          endMonth: `${endMonth}-01`,
        },
      });
      onOpenChange(false);
      router.push(`/roadmaps/${res.roadmap.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setError({ field: e.field, message: e.message });
      } else {
        toast('error', 'Could not create the roadmap — please retry');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New roadmap"
      footer={
        <>
          <Button variant="secondary" styleType="border" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            styleType="fill"
            loading={busy}
            disabled={!title.trim()}
            onClick={submit}
            data-testid="create-roadmap"
          >
            Create roadmap
          </Button>
        </>
      }
    >
      <Input
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="H2 2026 Platform Roadmap"
        error={error?.field === 'title' ? error.message : undefined}
        fullWidth
        autoFocus
        data-testid="roadmap-title-input"
      />
      <Textarea
        label="Short description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="What this roadmap covers"
        fullWidth
      />
      <div className="form-row">
        <div>
          <label className="form-label" htmlFor="start-month">Start month</label>
          <input
            id="start-month"
            type="month"
            value={startMonth}
            onChange={(e) => setStartMonth(e.target.value)}
            data-testid="start-month"
          />
        </div>
        <div>
          <label className="form-label" htmlFor="end-month">End month</label>
          <input
            id="end-month"
            type="month"
            value={endMonth}
            onChange={(e) => setEndMonth(e.target.value)}
            data-testid="end-month"
          />
        </div>
      </div>
      {months > 0 && (
        <span className={months < 3 || months > 12 ? 'range-error' : 'max-hint'}>
          {months} month{months === 1 ? '' : 's'} — roadmaps cover 3 to 12 months
        </span>
      )}
      {error && error.field !== 'title' && <span className="range-error">{error.message}</span>}
    </Modal>
  );
}

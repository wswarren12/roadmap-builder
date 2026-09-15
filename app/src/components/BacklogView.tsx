'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@pl/components/Badge';
import { Button } from '@pl/components/Button';
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from '@pl/components/Drawer';
import { Dropdown, DropdownItem } from '@pl/components/Dropdown';
import { EmptyState } from '@pl/components/EmptyState';
import { Input } from '@pl/components/Input';
import { PageHeader } from '@pl/components/PageHeader';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pl/components/Table';
import { Textarea } from '@pl/components/Textarea';
import {
  ITEM_STATUSES,
  STATUS_LABELS,
  type BacklogItem,
  type Initiative,
  type ItemStatus,
  type Roadmap,
  type RoadmapBacklogItem,
  type Role,
} from '@/lib/types';
import { ApiError, api } from '@/lib/client/api';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';
import { SignedOutLanding } from './SignedOutLanding';
import { useToast } from './Toasts';

type RoadmapChoice = { id: string; title: string; role?: string };
type FormValues = {
  title: string;
  description: string;
  milestoneText: string;
  okrs: string;
  dris: string;
  responsibleTeam: string;
  status: ItemStatus;
  kpi: string;
};
const EMPTY: FormValues = {
  title: '', description: '', milestoneText: '', okrs: '', dris: '',
  responsibleTeam: '', status: 'green', kpi: '',
};
type Entry = RoadmapBacklogItem;

/**
 * Backlog view, scoped to ONE roadmap: the picker (or `?roadmap=`) selects
 * which roadmap's unscheduled work is shown; reads and writes go through that
 * roadmap's own backlog route, so another roadmap's entries can never appear
 * here or be touched from here. Legacy personal (roadmap-less) items are
 * listed separately so nothing is lost; each can be moved into the open
 * roadmap's backlog.
 */
export function BacklogView() {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get('roadmap') ?? '';

  const [roadmaps, setRoadmaps] = useState<RoadmapChoice[] | null>(null);
  const [roadmapId, setRoadmapId] = useState(requested);
  const [scope, setScope] = useState<{ roadmap: Roadmap; initiatives: Initiative[]; role: Role } | null>(null);
  const [legacy, setLegacy] = useState<BacklogItem[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [scheduling, setScheduling] = useState<Entry | null>(null);
  const [initiativeId, setInitiativeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  // Rapid switching: only the latest request may populate the view.
  const loadSeq = useRef(0);

  const editable = scope !== null && (scope.role === 'owner' || scope.role === 'editor');
  const entries = scope?.roadmap.backlog ?? null;

  // Roadmap choices + default selection (URL → last visited → first).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [lists, me] = await Promise.all([
          api<{ owned: RoadmapChoice[]; shared: RoadmapChoice[] }>('/api/me/roadmaps'),
          api<{ lastRoadmapId: string | null }>('/api/me').catch(() => ({ lastRoadmapId: null })),
        ]);
        if (cancelled) return;
        const all = [...lists.owned, ...lists.shared];
        setRoadmaps(all);
        if (!requested) {
          const fallback = all.find((r) => r.id === me.lastRoadmapId)?.id ?? all[0]?.id ?? '';
          setRoadmapId(fallback);
        }
        api<{ items: BacklogItem[] }>('/api/backlog').then((r) => !cancelled && setLegacy(r.items)).catch(() => {});
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) setSignedOut(true);
        else setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requested]);

  useEffect(() => {
    if (requested && requested !== roadmapId) setRoadmapId(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  const load = useCallback(async () => {
    if (!roadmapId) return;
    const seq = ++loadSeq.current;
    setFailed(false);
    setScope(null); // never show the previous roadmap's entries while switching
    try {
      const result = await api<{ roadmap: Roadmap; initiatives: Initiative[]; role: Role }>(`/api/roadmaps/${roadmapId}`);
      if (seq !== loadSeq.current) return;
      setScope({ roadmap: result.roadmap, initiatives: result.initiatives, role: result.role });
    } catch (error) {
      if (seq !== loadSeq.current) return;
      if (error instanceof ApiError && error.status === 401) setSignedOut(true);
      else setFailed(true);
    }
  }, [roadmapId]);

  useEffect(() => {
    load();
  }, [load]);

  function choose(id: string) {
    setRoadmapId(id);
    router.replace(id ? `/backlog?roadmap=${id}` : '/backlog');
  }

  function setBacklog(backlog: Entry[]) {
    setScope((s) => (s ? { ...s, roadmap: { ...s.roadmap, backlog } } : s));
  }

  function openForm(item?: Entry) {
    setFormError('');
    if (item) {
      setEditing(item);
      setValues({
        title: item.title, description: item.description, milestoneText: item.milestoneText,
        okrs: item.okrs, dris: item.dris, responsibleTeam: item.responsibleTeam,
        status: item.status, kpi: item.kpi,
      });
    } else {
      setEditing('new');
      setValues(EMPTY);
    }
  }

  async function save() {
    if (!scope) return;
    if (!values.title.trim()) return setFormError('Title is required');
    setBusy(true);
    setFormError('');
    try {
      const res = await api<{ backlog: Entry[] }>(`/api/roadmaps/${scope.roadmap.id}/backlog`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        body: editing === 'new' ? values : { id: (editing as Entry).id, ...values },
      });
      setBacklog(res.backlog);
      setEditing(null);
      toast('success', editing === 'new' ? 'Added to the backlog' : 'Saved');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Save failed — please retry');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting || !scope) return;
    setBusy(true);
    try {
      const res = await api<{ backlog: Entry[] }>(`/api/roadmaps/${scope.roadmap.id}/backlog?id=${deleting.id}`, { method: 'DELETE' });
      setBacklog(res.backlog);
      toast('success', `Deleted "${deleting.title}"`);
      setDeleting(null);
    } catch {
      toast('error', 'Delete failed — please retry');
    } finally {
      setBusy(false);
    }
  }

  function openSchedule(entry: Entry) {
    setScheduling(entry);
    setInitiativeId(scope?.initiatives[0]?.id ?? '');
    setStartDate('');
    setEndDate('');
    setFormError('');
  }

  async function runSchedule() {
    if (!scheduling || !scope) return;
    if (!initiativeId || !startDate || !endDate) return setFormError('Initiative and dates are required');
    if (startDate > endDate) return setFormError('End date must be on or after start date');
    setBusy(true);
    try {
      const { id, createdAt: _c, sprints: _s, milestonePosition: _m, ...fields } = scheduling;
      const result = await api<{ item: { id: string } }>(`/api/roadmaps/${scope.roadmap.id}/items`, {
        method: 'POST',
        body: { ...fields, initiativeId, startDate, endDate, fromBacklogId: id },
      });
      toast('success', `Scheduled "${scheduling.title}"`);
      setScheduling(null);
      router.push(`/roadmaps/${scope.roadmap.id}/items/${result.item.id}`);
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Scheduling failed — please retry');
    } finally {
      setBusy(false);
    }
  }

  /** Legacy personal item → this roadmap's backlog (append, then delete the personal row). */
  async function adopt(item: BacklogItem) {
    if (!scope) return;
    setBusy(true);
    try {
      const { id, ownerUid: _o, createdAt: _c, updatedAt: _u, sprints: _s, milestonePosition: _m, ...fields } = item;
      const res = await api<{ backlog: Entry[] }>(`/api/roadmaps/${scope.roadmap.id}/backlog`, { method: 'POST', body: fields });
      setBacklog(res.backlog);
      await api(`/api/backlog/${id}`, { method: 'DELETE' });
      setLegacy((l) => l.filter((b) => b.id !== id));
      toast('success', `Moved "${item.title}" into this roadmap's backlog`);
    } catch (error) {
      toast('error', error instanceof ApiError ? error.message : 'Move failed — please retry');
    } finally {
      setBusy(false);
    }
  }

  if (signedOut) return <SignedOutLanding />;
  if (failed) {
    return (
      <div className="center-state">
        <EmptyState title="Couldn't load this backlog" description="The backlog is still safe. Try again." primaryAction={<Button variant="primary" styleType="fill" onClick={load}>Retry</Button>} />
      </div>
    );
  }

  const picker = roadmaps && roadmaps.length > 0 && (
    <select className="filter-select" aria-label="Roadmap" value={roadmapId} onChange={(e) => choose(e.target.value)} data-testid="backlog-roadmap-picker">
      {roadmaps.map((r) => (
        <option key={r.id} value={r.id}>{r.title}</option>
      ))}
    </select>
  );

  return (
    <div className="backlog-page" data-testid="backlog-view" data-roadmap-id={scope?.roadmap.id ?? ''}>
      <PageHeader
        title="Backlog"
        description={scope ? `Unscheduled work for "${scope.roadmap.title}".` : 'Unscheduled work for one roadmap at a time.'}
        compact
        actions={
          <div className="backlog-actions">
            {picker}
            {editable && <Button variant="primary" styleType="fill" onClick={() => openForm()} data-testid="new-backlog-item">New backlog item</Button>}
          </div>
        }
      />
      {scope && scope.role === 'viewer' && <p className="backlog-note" data-testid="backlog-readonly">View only — ask the owner for an editor invite to change this backlog.</p>}

      {roadmaps !== null && roadmaps.length === 0 ? (
        <EmptyState title="No roadmaps yet" description="Create a roadmap first; its backlog lives here." primaryAction={<Button variant="primary" styleType="fill" onClick={() => router.push('/profile')}>Go home</Button>} />
      ) : entries === null ? (
        <div className="backlog-loading" role="status">Loading backlog…</div>
      ) : entries.length === 0 ? (
        <EmptyState
          title="This roadmap's backlog is empty"
          description={editable ? 'Park an idea here before it has dates.' : 'Nothing is waiting to be scheduled.'}
          primaryAction={editable ? <Button variant="primary" styleType="fill" onClick={() => openForm()}>Create backlog item</Button> : undefined}
        />
      ) : (
        <Table fullWidth aria-label="Roadmap backlog">
          <TableHead><TableRow><TableHeader>Item</TableHeader><TableHeader>State</TableHeader><TableHeader>Sprints</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead>
          <TableBody>{entries.map((item) => <TableRow key={item.id} data-testid="backlog-row">
            <TableCell><strong>{item.title}</strong>{item.description && <div className="backlog-description">{item.description}</div>}</TableCell>
            <TableCell><Badge color={item.status === 'deprioritized' ? 'gray' : item.status} styleType="light" size="sm">{STATUS_LABELS[item.status]}</Badge></TableCell>
            <TableCell>{item.sprints.length}</TableCell>
            <TableCell><div className="backlog-actions">
              <Button variant="secondary" styleType="border" size="xs" onClick={() => openForm(item)}>{editable ? 'Inspect / edit' : 'Inspect'}</Button>
              {editable && <Button variant="primary" styleType="fill" size="xs" onClick={() => openSchedule(item)}>Schedule</Button>}
              {editable && <Button variant="error" styleType="light" size="xs" onClick={() => setDeleting(item)}>Delete</Button>}
            </div></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      )}

      {legacy.length > 0 && scope && (
        <section className="backlog-legacy" aria-label="Not linked to a roadmap" data-testid="backlog-legacy">
          <h3>Not linked to a roadmap</h3>
          <p className="backlog-note">Items from your previous personal backlog. Move each into the roadmap it belongs to.</p>
          <ul>
            {legacy.map((item) => (
              <li key={item.id} data-testid="backlog-legacy-row">
                <strong>{item.title}</strong>
                {editable && <Button variant="secondary" styleType="border" size="xs" disabled={busy} onClick={() => adopt(item)}>Move into this roadmap</Button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Drawer open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} size="md">
        <DrawerHeader title={editing === 'new' ? 'New backlog item' : 'Backlog item'} onClose={() => setEditing(null)} />
        <DrawerBody><div className="backlog-form">
          <Input label="Title" value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} error={formError && !values.title.trim() ? formError : undefined} fullWidth disabled={!editable} data-testid="backlog-title" />
          <Textarea label="Description" value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} fullWidth disabled={!editable} />
          <Input label="Milestone" value={values.milestoneText} onChange={(e) => setValues({ ...values, milestoneText: e.target.value })} fullWidth disabled={!editable} />
          <Textarea label="Key result" value={values.okrs} onChange={(e) => setValues({ ...values, okrs: e.target.value })} fullWidth disabled={!editable} />
          <Input label="DRI" value={values.dris} onChange={(e) => setValues({ ...values, dris: e.target.value })} fullWidth disabled={!editable} />
          <Input label="Responsible team" value={values.responsibleTeam} onChange={(e) => setValues({ ...values, responsibleTeam: e.target.value })} fullWidth disabled={!editable} />
          <Input label="KPI" value={values.kpi} onChange={(e) => setValues({ ...values, kpi: e.target.value })} fullWidth disabled={!editable} />
          <div className="backlog-dropdown-field">
            <span id="backlog-status-label">Status</span>
            <Dropdown trigger={<Button variant="secondary" styleType="border" fullWidth disabled={!editable} aria-labelledby="backlog-status-label backlog-status-value" data-testid="backlog-status"><span id="backlog-status-value">{STATUS_LABELS[values.status]}</span></Button>}>
              {ITEM_STATUSES.map((status) => <DropdownItem key={status} onSelect={() => setValues({ ...values, status })}>{STATUS_LABELS[status]}</DropdownItem>)}
            </Dropdown>
          </div>
          {formError && values.title.trim() && <p className="backlog-error" role="alert">{formError}</p>}
          {editing !== 'new' && editing && editing.sprints.length > 0 && (
            <section className="backlog-sprints" aria-labelledby="backlog-sprints-heading">
              <h3 id="backlog-sprints-heading">Preserved sprint items</h3>
              <p className="backlog-note">These sprint items keep their proportional positions when scheduled.</p>
              <ul>
                {editing.sprints.map((sprint, index) => (
                  <li key={`${sprint.name}-${index}`}>
                    <strong>{sprint.name}</strong>
                    {sprint.description && <p>{sprint.description}</p>}
                    <dl>
                      {sprint.milestoneText && <div><dt>Milestone</dt><dd>{sprint.milestoneText}</dd></div>}
                      {sprint.kpi && <div><dt>KPI</dt><dd>{sprint.kpi}</dd></div>}
                      {sprint.dri && <div><dt>DRI</dt><dd>{sprint.dri}</dd></div>}
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div></DrawerBody>
        <DrawerFooter>
          <Button variant="secondary" styleType="border" onClick={() => setEditing(null)}>{editable ? 'Cancel' : 'Close'}</Button>
          {editable && <Button variant="primary" styleType="fill" loading={busy} onClick={save} data-testid="save-backlog-item">Save</Button>}
        </DrawerFooter>
      </Drawer>

      {scheduling && scope && (
        <Modal open onOpenChange={(open) => !open && setScheduling(null)} title={`Schedule “${scheduling.title}”`} footer={<><Button variant="secondary" styleType="border" onClick={() => setScheduling(null)}>Cancel</Button><Button variant="primary" styleType="fill" loading={busy} onClick={runSchedule} data-testid="confirm-backlog-schedule">Schedule</Button></>}>
          <div className="backlog-form">
            <div className="backlog-dropdown-field">
              <span id="backlog-initiative-label">Initiative</span>
              <Dropdown trigger={<Button variant="secondary" styleType="border" fullWidth aria-labelledby="backlog-initiative-label backlog-initiative-value" data-testid="backlog-initiative"><span id="backlog-initiative-value">{scope.initiatives.find((i) => i.id === initiativeId)?.name ?? 'Choose an initiative'}</span></Button>}>
                {scope.initiatives.map((initiative) => <DropdownItem key={initiative.id} onSelect={() => setInitiativeId(initiative.id)}>{initiative.name}</DropdownItem>)}
              </Dropdown>
            </div>
            <Input label="Start date" type="date" value={startDate} min={scope.roadmap.startMonth} onChange={(e) => setStartDate(e.target.value)} fullWidth />
            <Input label="End date" type="date" value={endDate} min={scope.roadmap.startMonth} onChange={(e) => setEndDate(e.target.value)} fullWidth />
            {formError && <p className="backlog-error" role="alert">{formError}</p>}
          </div>
        </Modal>
      )}

      {deleting && <ConfirmModal open onOpenChange={(open) => !open && setDeleting(null)} title="Delete backlog item?" message={`“${deleting.title}” and its ${deleting.sprints.length} preserved sprint item(s) will be permanently deleted from this roadmap's backlog.`} busy={busy} onConfirm={remove} />}
    </div>
  );
}

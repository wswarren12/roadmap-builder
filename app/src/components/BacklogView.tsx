'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@pl/components/Badge';
import { Button } from '@pl/components/Button';
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from '@pl/components/Drawer';
import { Dropdown, DropdownItem } from '@pl/components/Dropdown';
import { EmptyState } from '@pl/components/EmptyState';
import { Input } from '@pl/components/Input';
import { PageHeader } from '@pl/components/PageHeader';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pl/components/Table';
import { Textarea } from '@pl/components/Textarea';
import type { BacklogItem, Initiative, ItemStatus } from '@/lib/types';
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
const STATUS_LABEL: Record<ItemStatus, string> = { green: 'Green', yellow: 'Yellow', red: 'Red' };

export function BacklogView() {
  const toast = useToast();
  const [items, setItems] = useState<BacklogItem[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<BacklogItem | 'new' | null>(null);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [deleting, setDeleting] = useState<BacklogItem | null>(null);
  const [importing, setImporting] = useState<BacklogItem | null>(null);
  const [roadmaps, setRoadmaps] = useState<RoadmapChoice[]>([]);
  const [roadmapId, setRoadmapId] = useState('');
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [initiativeId, setInitiativeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const result = await api<{ items: BacklogItem[] }>('/api/backlog');
      setItems(result.items);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setSignedOut(true);
      else setFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openForm(item?: BacklogItem) {
    setEditing(item ?? 'new');
    setValues(item ? {
      title: item.title, description: item.description, milestoneText: item.milestoneText,
      okrs: item.okrs, dris: item.dris, responsibleTeam: item.responsibleTeam,
      status: item.status, kpi: item.kpi,
    } : EMPTY);
    setFormError('');
  }

  async function save() {
    if (!values.title.trim()) return setFormError('Title is required');
    setBusy(true);
    try {
      if (editing === 'new') {
        await api('/api/backlog', { method: 'POST', body: values });
        toast('success', `Saved "${values.title}" to your backlog`);
      } else if (editing) {
        await api(`/api/backlog/${editing.id}`, { method: 'PATCH', body: values });
        toast('success', `Updated "${values.title}"`);
      }
      setEditing(null);
      await load();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Save failed — please retry');
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/api/backlog/${deleting.id}`, { method: 'DELETE' });
      toast('success', `Deleted "${deleting.title}"`);
      setDeleting(null);
      await load();
    } catch { toast('error', 'Delete failed — please retry'); }
    finally { setBusy(false); }
  }

  async function openImport(item: BacklogItem) {
    setImporting(item); setRoadmapId(''); setInitiativeId(''); setStartDate(''); setEndDate(''); setFormError('');
    try {
      const lists = await api<{ owned: RoadmapChoice[]; shared: RoadmapChoice[] }>('/api/me/roadmaps');
      setRoadmaps([...lists.owned, ...lists.shared].filter((r) => r.role !== 'viewer'));
    } catch { setFormError('Could not load your roadmaps'); }
  }

  async function chooseRoadmap(id: string) {
    setRoadmapId(id); setInitiativeId(''); setInitiatives([]);
    if (!id) return;
    try {
      const result = await api<{ initiatives: Initiative[] }>(`/api/roadmaps/${id}`);
      setInitiatives(result.initiatives);
    } catch { setFormError('Could not load that roadmap'); }
  }

  async function runImport() {
    if (!importing) return;
    if (!roadmapId || !initiativeId || !startDate || !endDate) return setFormError('Roadmap, initiative, and dates are required');
    if (startDate > endDate) return setFormError('End date must be on or after start date');
    setBusy(true);
    try {
      const result = await api<{ item: { roadmapId: string; id: string } }>(`/api/backlog/${importing.id}/import`, {
        method: 'POST', body: { roadmapId, initiativeId, startDate, endDate },
      });
      toast('success', `Added "${importing.title}" to the roadmap`);
      setImporting(null);
      await load();
      window.location.assign(`/roadmaps/${result.item.roadmapId}/items/${result.item.id}`);
    } catch (error) { setFormError(error instanceof ApiError ? error.message : 'Import failed — please retry'); }
    finally { setBusy(false); }
  }

  if (signedOut) return <SignedOutLanding />;
  if (failed) return <div className="center-state"><EmptyState title="Couldn't load your backlog" description="Your backlog is still safe. Try again." primaryAction={<Button variant="primary" styleType="fill" onClick={load}>Retry</Button>} /></div>;

  return (
    <div className="backlog-page" data-testid="backlog-view">
      <PageHeader title="Backlog" description="Private, unscheduled roadmap work you can add to any roadmap." compact actions={<Button variant="primary" styleType="fill" onClick={() => openForm()} data-testid="new-backlog-item">New backlog item</Button>} />
      {items === null ? <div className="backlog-loading" role="status">Loading backlog…</div> : items.length === 0 ? (
        <EmptyState title="Your backlog is empty" description="Save an idea here before it has roadmap dates." primaryAction={<Button variant="primary" styleType="fill" onClick={() => openForm()}>Create backlog item</Button>} />
      ) : (
        <Table fullWidth aria-label="Personal backlog">
          <TableHead><TableRow><TableHeader>Item</TableHeader><TableHeader>State</TableHeader><TableHeader>Sprints</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead>
          <TableBody>{items.map((item) => <TableRow key={item.id} data-testid="backlog-row">
            <TableCell><strong>{item.title}</strong>{item.description && <div className="backlog-description">{item.description}</div>}</TableCell>
            <TableCell><Badge color={item.status} styleType="light" size="sm">{item.status}</Badge></TableCell>
            <TableCell>{item.sprints.length}</TableCell>
            <TableCell><div className="backlog-actions"><Button variant="secondary" styleType="border" size="xs" onClick={() => openForm(item)}>Inspect / edit</Button><Button variant="primary" styleType="fill" size="xs" onClick={() => openImport(item)}>Add to roadmap</Button><Button variant="error" styleType="light" size="xs" onClick={() => setDeleting(item)}>Delete</Button></div></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      )}

      <Drawer open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} size="md">
        <DrawerHeader title={editing === 'new' ? 'New backlog item' : 'Backlog item'} onClose={() => setEditing(null)} />
        <DrawerBody><div className="backlog-form">
          <Input label="Title" value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} error={formError && !values.title.trim() ? formError : undefined} fullWidth data-testid="backlog-title" />
          <Textarea label="Description" value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} fullWidth />
          <Input label="Milestone" value={values.milestoneText} onChange={(e) => setValues({ ...values, milestoneText: e.target.value })} fullWidth />
          <Textarea label="Key result" value={values.okrs} onChange={(e) => setValues({ ...values, okrs: e.target.value })} fullWidth />
          <Input label="DRIs" value={values.dris} onChange={(e) => setValues({ ...values, dris: e.target.value })} fullWidth />
          <Input label="Responsible team" value={values.responsibleTeam} onChange={(e) => setValues({ ...values, responsibleTeam: e.target.value })} fullWidth />
          <Input label="KPI" value={values.kpi} onChange={(e) => setValues({ ...values, kpi: e.target.value })} fullWidth />
          <div className="backlog-dropdown-field">
            <span id="backlog-status-label">Status</span>
            <Dropdown trigger={<Button variant="secondary" styleType="border" fullWidth aria-labelledby="backlog-status-label backlog-status-value" data-testid="backlog-status"><span id="backlog-status-value">{STATUS_LABEL[values.status]}</span></Button>}>
              {(['green', 'yellow', 'red'] as ItemStatus[]).map((status) => <DropdownItem key={status} onSelect={() => setValues({ ...values, status })}>{STATUS_LABEL[status]}</DropdownItem>)}
            </Dropdown>
          </div>
          {formError && values.title.trim() && <p className="backlog-error" role="alert">{formError}</p>}
          {editing !== 'new' && editing && editing.sprints.length > 0 && (
            <section className="backlog-sprints" aria-labelledby="backlog-sprints-heading">
              <h3 id="backlog-sprints-heading">Preserved sprint items</h3>
              <p className="backlog-note">These sprint items will keep their proportional positions when imported.</p>
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
        <DrawerFooter><Button variant="secondary" styleType="border" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" styleType="fill" loading={busy} onClick={save} data-testid="save-backlog-item">Save</Button></DrawerFooter>
      </Drawer>

      {importing && <Modal open onOpenChange={(open) => !open && setImporting(null)} title={`Add “${importing.title}” to a roadmap`} footer={<><Button variant="secondary" styleType="border" onClick={() => setImporting(null)}>Cancel</Button><Button variant="primary" styleType="fill" loading={busy} onClick={runImport} data-testid="confirm-backlog-import">Add to roadmap</Button></>}>
        <div className="backlog-form">
          <div className="backlog-dropdown-field">
            <span id="backlog-roadmap-label">Roadmap</span>
            <Dropdown trigger={<Button variant="secondary" styleType="border" fullWidth aria-labelledby="backlog-roadmap-label backlog-roadmap-value" data-testid="backlog-roadmap"><span id="backlog-roadmap-value">{roadmaps.find((roadmap) => roadmap.id === roadmapId)?.title ?? 'Choose a roadmap'}</span></Button>}>
              {roadmaps.map((roadmap) => <DropdownItem key={roadmap.id} onSelect={() => { void chooseRoadmap(roadmap.id); }}>{roadmap.title}</DropdownItem>)}
            </Dropdown>
          </div>
          <div className="backlog-dropdown-field">
            <span id="backlog-initiative-label">Initiative</span>
            <Dropdown trigger={<Button variant="secondary" styleType="border" fullWidth disabled={!roadmapId} aria-labelledby="backlog-initiative-label backlog-initiative-value" data-testid="backlog-initiative"><span id="backlog-initiative-value">{initiatives.find((initiative) => initiative.id === initiativeId)?.name ?? 'Choose an initiative'}</span></Button>}>
              {initiatives.map((initiative) => <DropdownItem key={initiative.id} onSelect={() => setInitiativeId(initiative.id)}>{initiative.name}</DropdownItem>)}
            </Dropdown>
          </div>
          <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} fullWidth />
          <Input label="End date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} fullWidth />
          {formError && <p className="backlog-error" role="alert">{formError}</p>}
        </div>
      </Modal>}

      {deleting && <ConfirmModal open onOpenChange={(open) => !open && setDeleting(null)} title="Delete backlog item?" message={`“${deleting.title}” and its ${deleting.sprints.length} preserved sprint item(s) will be permanently deleted.`} busy={busy} onConfirm={remove} />}
    </div>
  );
}

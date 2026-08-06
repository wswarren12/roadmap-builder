'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@pl/components/Button';
import { Drawer, DrawerBody, DrawerHeader } from '@pl/components/Drawer';
import { Input } from '@pl/components/Input';
import type { TeamMember } from '@/lib/types';
import { ApiError, api } from '@/lib/client/api';
import { Avatar } from './Avatar';
import { useToast } from './Toasts';

/**
 * Team panel (F-13): the roadmap's roster of assignable DRIs. "Add people
 * with access" imports the roadmap's LabOS users (you + everyone who joined
 * via an invite link) — profile pictures fill in as each member uses the
 * app, since LabOS only shows a member their own profile. Anyone else can
 * be added by name and gets an initials avatar.
 */
export function TeamPanel({
  open,
  onOpenChange,
  roadmapId,
  editable,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roadmapId: string;
  editable: boolean;
  onChanged: (members: TeamMember[]) => void;
}) {
  const toast = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ members: TeamMember[] }>(`/api/roadmaps/${roadmapId}/team`);
      setMembers(res.members);
      onChanged(res.members);
    } catch {
      // panel stays usable; the next action surfaces its own error
    }
  }, [roadmapId, onChanged]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  async function importAccess() {
    setBusy(true);
    try {
      const res = await api<{ members: TeamMember[]; added: number }>(
        `/api/roadmaps/${roadmapId}/team/import`,
        { method: 'POST' },
      );
      setMembers(res.members);
      onChanged(res.members);
      toast(
        'success',
        res.added
          ? `Added ${res.added} ${res.added === 1 ? 'person' : 'people'} from LabOS`
          : 'Everyone with access is already on the team',
      );
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Import failed — please retry');
    } finally {
      setBusy(false);
    }
  }

  async function addByName() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api<{ member: TeamMember }>(`/api/roadmaps/${roadmapId}/team`, {
        method: 'POST',
        body: { name: name.trim() },
      });
      setName('');
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add — please retry');
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: TeamMember) {
    try {
      await api(`/api/team-members/${member.id}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Remove failed — please retry');
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} side="right" size="sm">
      <DrawerHeader title="Team" onClose={() => onOpenChange(false)} />
      <DrawerBody>
        <div className="team-panel" data-testid="team-panel">
          {editable && (
            <section className="team-section">
              <p className="team-blurb">
                Build the team this roadmap draws DRIs from. Import brings in the
                LabOS members with access to this roadmap; profile photos appear
                as each person uses the app.
              </p>
              <Button
                variant="secondary"
                styleType="border"
                size="sm"
                loading={busy}
                onClick={importAccess}
                data-testid="team-import"
              >
                Add people with access
              </Button>
              <div className="team-add-row">
                <Input
                  value={name}
                  placeholder="Add someone by name"
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && addByName()}
                  data-testid="team-add-name"
                  fullWidth
                />
                <Button
                  variant="primary"
                  styleType="fill"
                  size="sm"
                  disabled={!name.trim() || busy}
                  onClick={addByName}
                  data-testid="team-add"
                >
                  Add
                </Button>
              </div>
              {error && (
                <span className="range-error" data-testid="team-error">
                  {error}
                </span>
              )}
            </section>
          )}

          <ul className="team-list" data-testid="team-list">
            {members.map((member) => (
              <li className="team-row" key={member.id} data-testid="team-member">
                <Avatar name={member.name} image={member.image} testId="team-avatar" />
                <span className="team-name">{member.name}</span>
                {member.memberUid && <span className="team-tag">LabOS</span>}
                {editable && (
                  <button
                    className="icon-btn"
                    aria-label={`Remove ${member.name}`}
                    onClick={() => remove(member)}
                    data-testid="team-remove"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
            {members.length === 0 && (
              <li className="team-empty" data-testid="team-empty">
                No one on the team yet.
              </li>
            )}
          </ul>
        </div>
      </DrawerBody>
    </Drawer>
  );
}

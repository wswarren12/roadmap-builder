'use client';

import { useState } from 'react';
import { Button } from '@pl/components/Button';
import { Drawer, DrawerBody, DrawerHeader } from '@pl/components/Drawer';
import type { Suggestion } from '@/lib/types';
import { ApiError, api } from '@/lib/client/api';
import { useToast } from './Toasts';

export type SuggestionWithMeta = Suggestion & { agentName: string; summary: string };

const KIND_LABEL: Record<Suggestion['kind'], string> = {
  create_item: 'New item',
  update_item: 'Change item',
  delete_item: 'Delete item',
  create_sprint: 'New sprint',
  update_sprint: 'Change sprint',
  comment: 'Comment',
};

/**
 * Review panel for agent suggestions (agent-links design): each pending card
 * shows who proposed what and why; Accept replays the payload through the
 * normal write path, Reject just marks it. Both remove the card.
 */
export function SuggestionsPanel({
  open,
  onOpenChange,
  suggestions,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: SuggestionWithMeta[];
  /** Called after any resolution so the roadmap and badge refresh. */
  onResolved: () => void;
}) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = suggestions.filter((s) => s.status === 'pending');

  async function resolve(s: SuggestionWithMeta, action: 'accept' | 'reject') {
    setBusyId(s.id);
    try {
      const res = await api<{ applied: boolean; reason?: string }>(
        `/api/suggestions/${s.id}/resolve`,
        { method: 'POST', body: { action } },
      );
      if (action === 'accept' && !res.applied) {
        toast('warning', `Could not apply: ${res.reason ?? 'the roadmap changed underneath it'}`);
      } else {
        toast('success', action === 'accept' ? 'Suggestion applied' : 'Suggestion rejected');
      }
      onResolved();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not resolve — please retry');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} side="right" size="sm">
      <DrawerHeader title="Agent suggestions" onClose={() => onOpenChange(false)} />
      <DrawerBody>
        <div className="sprint-card-fields" data-testid="suggestions-panel">
          {pending.length === 0 ? (
            <span className="max-hint">No pending suggestions.</span>
          ) : (
            pending.map((s) => (
              <div key={s.id} className="sprint-card-fields" data-testid="suggestion-card">
                <div className="share-row">
                  <span>
                    <strong>{s.agentName}</strong>
                    <span className="max-hint"> · {KIND_LABEL[s.kind]}</span>
                  </span>
                </div>
                <p className="confirm-message" data-testid="suggestion-summary">
                  {s.summary}
                </p>
                <span className="max-hint" data-testid="suggestion-rationale">
                  Why: {s.rationale}
                </span>
                <div className="share-add">
                  <Button
                    variant="primary"
                    styleType="fill"
                    size="xs"
                    loading={busyId === s.id}
                    onClick={() => resolve(s, 'accept')}
                    data-testid="suggestion-accept"
                  >
                    Accept
                  </Button>
                  <Button
                    variant="neutral"
                    styleType="light"
                    size="xs"
                    loading={busyId === s.id}
                    onClick={() => resolve(s, 'reject')}
                    data-testid="suggestion-reject"
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DrawerBody>
    </Drawer>
  );
}

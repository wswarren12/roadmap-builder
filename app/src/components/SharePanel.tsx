'use client';

import { useEffect, useState } from 'react';
import { Button } from '@pl/components/Button';
import { Drawer, DrawerBody, DrawerHeader } from '@pl/components/Drawer';
import type { RoadmapShare } from '@/lib/types';
import { ApiError, api } from '@/lib/client/api';
import { useToast } from './Toasts';

/**
 * Share panel (F-6, invite-link mechanism). The owner shares a /join/<token>
 * link; opening it while signed in to LabOS binds the visitor's verified
 * member uid as a read-only viewer. Viewers get the full read experience and
 * PDF export, zero write surface. (Email whitelist is dormant: the v1.4
 * member context exposes no email — rows with an email would only match if
 * LabOS adds it.)
 */
export function SharePanel({
  open,
  onOpenChange,
  roadmapId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roadmapId: string;
}) {
  const toast = useToast();
  const [shares, setShares] = useState<RoadmapShare[] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setCopied(false);
    Promise.all([
      api<{ shares: RoadmapShare[] }>(`/api/roadmaps/${roadmapId}/shares`),
      api<{ token: string | null }>(`/api/roadmaps/${roadmapId}/invite`),
    ])
      .then(([sharesRes, inviteRes]) => {
        setShares(sharesRes.shares);
        setToken(inviteRes.token);
        setLoaded(true);
      })
      .catch(() => {
        toast('error', "Couldn't load sharing settings");
        onOpenChange(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roadmapId]);

  const joinUrl = token ? `${window.location.origin}/join/${token}` : null;

  async function generate() {
    setBusy(true);
    try {
      const res = await api<{ token: string }>(`/api/roadmaps/${roadmapId}/invite`, {
        method: 'POST',
      });
      setToken(res.token);
      setCopied(false);
      toast('success', token ? 'New link generated — the old one no longer works' : 'Invite link is on');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not generate the link');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await api(`/api/roadmaps/${roadmapId}/invite`, { method: 'DELETE' });
      setToken(null);
      toast('success', 'Invite link turned off — people who already joined keep access');
    } catch {
      toast('error', 'Could not turn off the link — please retry');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast('warning', 'Copy failed — select the link text and copy it manually');
    }
  }

  async function remove(share: RoadmapShare) {
    try {
      await api(`/api/shares/${share.id}`, { method: 'DELETE' });
      setShares((s) => (s ? s.filter((x) => x.id !== share.id) : s));
    } catch {
      toast('error', 'Could not remove — please retry');
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} side="right" size="sm">
      <DrawerHeader title="Share (read-only)" onClose={() => onOpenChange(false)} />
      <DrawerBody>
        <div className="sprint-card-fields" data-testid="share-panel">
          <p className="confirm-message">
            Anyone who opens the invite link while signed in to LabOS joins as a
            viewer: they can see every level of this roadmap and download PDFs,
            but can&apos;t change anything.
          </p>

          {!loaded ? (
            <div className="skeleton" style={{ height: 72 }} />
          ) : token ? (
            <div className="sprint-card-fields" data-testid="invite-active">
              <div className="share-row">
                <span className="invite-link-text" data-testid="invite-link">
                  {joinUrl}
                </span>
              </div>
              <div className="share-add">
                <Button
                  variant="primary"
                  styleType="fill"
                  onClick={copy}
                  data-testid="invite-copy"
                >
                  {copied ? 'Copied ✓' : 'Copy link'}
                </Button>
                <Button
                  variant="secondary"
                  styleType="border"
                  onClick={generate}
                  loading={busy}
                  data-testid="invite-rotate"
                >
                  New link
                </Button>
                <Button
                  variant="neutral"
                  styleType="light"
                  onClick={disable}
                  loading={busy}
                  data-testid="invite-disable"
                >
                  Turn off
                </Button>
              </div>
              <span className="max-hint">
                Generating a new link stops the current one from working. People who
                already joined keep access until you remove them below.
              </span>
            </div>
          ) : (
            <div className="share-add">
              <Button
                variant="primary"
                styleType="fill"
                onClick={generate}
                loading={busy}
                data-testid="invite-generate"
              >
                Create invite link
              </Button>
            </div>
          )}

          <div className="share-list" data-testid="share-list">
            <span className="detail-label">People with access</span>
            {shares === null ? (
              <div className="skeleton" style={{ height: 40 }} />
            ) : shares.length === 0 ? (
              <span className="max-hint">Nobody has joined yet — send the link.</span>
            ) : (
              shares.map((share) => (
                <div key={share.id} className="share-row" data-testid="share-row">
                  <span>{share.memberName ?? share.email}</span>
                  <Button
                    variant="neutral"
                    styleType="light"
                    size="xs"
                    onClick={() => remove(share)}
                    aria-label={`Remove ${share.memberName ?? share.email}`}
                    data-testid="share-remove"
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </DrawerBody>
    </Drawer>
  );
}

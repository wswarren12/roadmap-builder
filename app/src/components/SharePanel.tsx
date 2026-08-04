'use client';

import { useEffect, useState } from 'react';
import { Button } from '@pl/components/Button';
import { Drawer, DrawerBody, DrawerHeader } from '@pl/components/Drawer';
import type { InviteTokens, RoadmapShare, ShareRole } from '@/lib/types';
import { ApiError, api } from '@/lib/client/api';
import { useToast } from './Toasts';

/**
 * Share panel (F-6, invite-link mechanism). The owner picks who they are
 * inviting: the editor link grants full content editing, the viewer link is
 * read-only. Each role has its own independent /join/<token> URL; opening one
 * while signed in to LabOS binds the visitor's verified member uid with that
 * link's role. Editors still can't share or delete — that stays owner-only.
 * (Email whitelist is dormant: the v1.4 member context exposes no email.)
 */

const ROLE_COPY: Record<
  ShareRole,
  { title: string; blurb: string; onMsg: string; offMsg: string }
> = {
  editor: {
    title: 'Editor link',
    blurb: 'People who join with this link can edit and add to the roadmap.',
    onMsg: 'Editor link is on',
    offMsg: 'Editor link turned off — people who already joined keep access',
  },
  viewer: {
    title: 'Viewer link',
    blurb: 'People who join with this link can view and download PDFs only.',
    onMsg: 'Viewer link is on',
    offMsg: 'Viewer link turned off — people who already joined keep access',
  },
};

function InviteLinkSection({
  roadmapId,
  role,
  token,
  onToken,
}: {
  roadmapId: string;
  role: ShareRole;
  token: string | null;
  onToken: (token: string | null) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy_ = ROLE_COPY[role];
  const joinUrl = token ? `${window.location.origin}/join/${token}` : null;

  async function generate() {
    setBusy(true);
    try {
      const res = await api<{ token: string }>(`/api/roadmaps/${roadmapId}/invite`, {
        method: 'POST',
        body: { role },
      });
      onToken(res.token);
      setCopied(false);
      toast('success', token ? 'New link generated — the old one no longer works' : copy_.onMsg);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not generate the link');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await api(`/api/roadmaps/${roadmapId}/invite`, { method: 'DELETE', body: { role } });
      onToken(null);
      toast('success', copy_.offMsg);
    } catch {
      toast('error', 'Could not turn off the link — please retry');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast('warning', 'Copy failed — select the link text and copy it manually');
    }
  }

  return (
    <div className="sprint-card-fields" data-testid={`invite-section-${role}`}>
      <span className="detail-label">{copy_.title}</span>
      <p className="confirm-message">{copy_.blurb}</p>
      {token ? (
        <div className="sprint-card-fields" data-testid={`invite-active-${role}`}>
          <div className="share-row">
            <span className="invite-link-text" data-testid={`invite-link-${role}`}>
              {joinUrl}
            </span>
          </div>
          <div className="share-add">
            <Button
              variant="primary"
              styleType="fill"
              onClick={copyLink}
              data-testid={`invite-copy-${role}`}
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </Button>
            <Button
              variant="secondary"
              styleType="border"
              onClick={generate}
              loading={busy}
              data-testid={`invite-rotate-${role}`}
            >
              New link
            </Button>
            <Button
              variant="neutral"
              styleType="light"
              onClick={disable}
              loading={busy}
              data-testid={`invite-disable-${role}`}
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
            data-testid={`invite-generate-${role}`}
          >
            {`Create ${role} link`}
          </Button>
        </div>
      )}
    </div>
  );
}

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
  const [tokens, setTokens] = useState<InviteTokens>({ editor: null, viewer: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    Promise.all([
      api<{ shares: RoadmapShare[] }>(`/api/roadmaps/${roadmapId}/shares`),
      api<{ tokens: InviteTokens }>(`/api/roadmaps/${roadmapId}/invite`),
    ])
      .then(([sharesRes, inviteRes]) => {
        setShares(sharesRes.shares);
        setTokens(inviteRes.tokens);
        setLoaded(true);
      })
      .catch(() => {
        toast('error', "Couldn't load sharing settings");
        onOpenChange(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, roadmapId]);

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
      <DrawerHeader title="Share" onClose={() => onOpenChange(false)} />
      <DrawerBody>
        <div className="sprint-card-fields" data-testid="share-panel">
          <p className="confirm-message">
            Choose who you&apos;re inviting: editors can make edits and
            additions to the roadmap, viewers can only look. Anyone who opens a
            link while signed in to LabOS joins with that link&apos;s role.
          </p>

          {!loaded ? (
            <div className="skeleton" style={{ height: 144 }} />
          ) : (
            <>
              <InviteLinkSection
                roadmapId={roadmapId}
                role="editor"
                token={tokens.editor}
                onToken={(t) => setTokens((prev) => ({ ...prev, editor: t }))}
              />
              <InviteLinkSection
                roadmapId={roadmapId}
                role="viewer"
                token={tokens.viewer}
                onToken={(t) => setTokens((prev) => ({ ...prev, viewer: t }))}
              />
            </>
          )}

          <div className="share-list" data-testid="share-list">
            <span className="detail-label">People with access</span>
            {shares === null ? (
              <div className="skeleton" style={{ height: 40 }} />
            ) : shares.length === 0 ? (
              <span className="max-hint">Nobody has joined yet — send a link.</span>
            ) : (
              shares.map((share) => (
                <div key={share.id} className="share-row" data-testid="share-row">
                  <span>
                    {share.memberName ?? share.email}
                    <span className="max-hint" data-testid="share-role">
                      {' '}
                      · {share.role === 'editor' ? 'Editor' : 'Viewer'}
                    </span>
                  </span>
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

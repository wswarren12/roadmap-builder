'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button } from '@pl/components/Button';
import { EmptyState } from '@pl/components/EmptyState';
import { PageHeader } from '@pl/components/PageHeader';
import { ConfirmModal } from '@/components/ConfirmModal';
import { NewRoadmapModal } from '@/components/NewRoadmapModal';
import { SignedOutLanding } from '@/components/SignedOutLanding';
import { useToast } from '@/components/Toasts';
import { ApiError, api } from '@/lib/client/api';
import { formatDate, rangeEndDate } from '@/lib/dates';

interface RoadmapRow {
  id: string;
  title: string;
  startMonth: string;
  endMonth: string;
  itemCount?: number;
  sprintCount?: number;
}

interface Lists {
  owned: RoadmapRow[];
  shared: RoadmapRow[];
}

function RoadmapRowView({
  roadmap,
  onOpen,
  onDelete,
}: {
  roadmap: RoadmapRow;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className="roadmap-list-item"
      onClick={onOpen}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      data-testid="roadmap-row"
    >
      <div>
        <div className="roadmap-list-title">{roadmap.title}</div>
        <div className="roadmap-list-dates">
          {formatDate(roadmap.startMonth)} – {formatDate(rangeEndDate(roadmap.endMonth))}
        </div>
      </div>
      {onDelete && (
        <Button
          variant="error"
          styleType="light"
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Delete ${roadmap.title}`}
        >
          Delete
        </Button>
      )}
    </div>
  );
}

function HomeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [lists, setLists] = useState<Lists | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RoadmapRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function load() {
    setFailed(false);
    try {
      setLists(await api<Lists>('/api/me/roadmaps'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSignedOut(true);
      else setFailed(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (params.get('fallback')) {
      toast('info', 'Your last roadmap is no longer available — pick one below.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api(`/api/roadmaps/${deleting.id}`, { method: 'DELETE' });
      toast('success', `Deleted "${deleting.title}"`);
      setDeleting(null);
      await load();
    } catch {
      toast('error', 'Delete failed — please retry');
    } finally {
      setDeleteBusy(false);
    }
  }

  if (signedOut) return <SignedOutLanding />;

  if (failed) {
    return (
      <div className="center-state">
        <EmptyState
          title="Couldn't load your roadmaps"
          description="Something went wrong fetching your roadmaps."
          primaryAction={
            <Button variant="primary" styleType="fill" onClick={load}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="profile-page">
      <PageHeader title="Home" compact />

      <section className="profile-section" aria-label="Roadmaps you own">
        <div className="profile-section-head">
          <h2 className="profile-section-title">Roadmaps you own</h2>
        </div>
        {lists === null ? (
          <div className="skeleton" style={{ height: 56 }} />
        ) : lists.owned.length === 0 ? (
          <EmptyState
            title="No roadmaps yet"
            description="Create your first roadmap to start planning."
            primaryAction={
              <Button variant="primary" styleType="fill" onClick={() => setCreating(true)}>
                Create your first roadmap
              </Button>
            }
          />
        ) : (
          <div className="roadmap-list">
            {lists.owned.map((r) => (
              <RoadmapRowView
                key={r.id}
                roadmap={r}
                onOpen={() => router.push(`/roadmaps/${r.id}`)}
                onDelete={() => setDeleting(r)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="profile-section" aria-label="Shared with you">
        <div className="profile-section-head">
          <h2 className="profile-section-title">Shared with you</h2>
        </div>
        {lists === null ? (
          <div className="skeleton" style={{ height: 56 }} />
        ) : lists.shared.length === 0 ? (
          <EmptyState
            title="Nothing shared with you yet"
            description="Roadmaps someone shares to your email will show up here, read-only."
          />
        ) : (
          <div className="roadmap-list">
            {lists.shared.map((r) => (
              <RoadmapRowView
                key={r.id}
                roadmap={r}
                onOpen={() => router.push(`/roadmaps/${r.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      <NewRoadmapModal open={creating} onOpenChange={setCreating} />
      <ConfirmModal
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete roadmap?"
        message={
          deleting
            ? `"${deleting.title}" will be permanently deleted. This will also delete ${deleting.itemCount ?? 0} roadmap item${deleting.itemCount === 1 ? '' : 's'}, ${deleting.sprintCount ?? 0} sprint item${deleting.sprintCount === 1 ? '' : 's'}, and its share list.`
            : ''
        }
        busy={deleteBusy}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  );
}

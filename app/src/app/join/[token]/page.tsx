'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@pl/components/Button';
import { EmptyState } from '@pl/components/EmptyState';
import { SignedOutLanding } from '@/components/SignedOutLanding';
import { ApiError, api } from '@/lib/client/api';

type State = 'claiming' | 'signedout' | 'invalid' | 'error';

/** Invite-link landing: claims viewer access for the signed-in member and
 *  forwards to the roadmap. */
export default function JoinPage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const [state, setState] = useState<State>('claiming');
  const claimed = useRef(false);

  useEffect(() => {
    if (claimed.current) return; // guard against double-invoke in dev strict mode
    claimed.current = true;
    api<{ roadmapId: string }>(`/api/join/${params.token}`, { method: 'POST' })
      .then((res) => router.replace(`/roadmaps/${res.roadmapId}`))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setState('signedout');
        else if (e instanceof ApiError && e.status === 404) setState('invalid');
        else setState('error');
      });
  }, [params.token, router]);

  if (state === 'signedout') return <SignedOutLanding />;

  if (state === 'invalid') {
    return (
      <div className="center-state">
        <EmptyState
          title="This invite link is no longer valid"
          description="The owner may have turned it off or generated a new one. Ask them for a fresh link."
          primaryAction={
            <Button variant="primary" styleType="fill" onClick={() => router.push('/profile')}>
              Go home
            </Button>
          }
        />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="center-state">
        <EmptyState
          title="Couldn't open this invite"
          primaryAction={
            <Button
              variant="primary"
              styleType="fill"
              onClick={() => {
                claimed.current = false;
                setState('claiming');
                router.refresh();
              }}
            >
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="roadmap-page" data-testid="join-claiming">
      <div className="skeleton" style={{ height: 120 }} />
      <div className="skeleton" style={{ height: 360 }} />
    </div>
  );
}

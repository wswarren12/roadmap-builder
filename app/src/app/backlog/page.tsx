import { Suspense } from 'react';
import { BacklogView } from '@/components/BacklogView';

export const dynamic = 'force-dynamic';

export default function BacklogPage() {
  return (
    <Suspense fallback={<div className="backlog-loading" role="status">Loading backlog…</div>}>
      <BacklogView />
    </Suspense>
  );
}

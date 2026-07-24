import { EmptyState } from '@pl/components/EmptyState';

/** Friendly signed-out state (starter-kit rule: never hard-fail on identity). */
export function SignedOutLanding() {
  return (
    <div className="center-state">
      <EmptyState
        title="Sign in through LabOS to use Roadmapper"
        description="Open this app from the PL Infra → AI Apps dashboard so it can identify you. Your roadmaps and anything shared with you will be waiting."
      />
    </div>
  );
}

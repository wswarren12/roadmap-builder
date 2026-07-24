'use client';

import { Tooltip } from '@pl/components/Tooltip';
import { daysBetween } from '@/lib/dates';
import { useBarDrag } from './useBarDrag';

/**
 * A timeline bar (roadmap item or sprint item). Shows the title only —
 * details live in forms/cards (PRD reqs 4, 9). Supports drag-to-move and
 * edge drag-to-resize for owners; clean clicks open (drill-down / card).
 */
export function Bar({
  testId,
  entityId,
  title,
  startDate,
  endDate,
  spanStart,
  pxPerDay,
  lane,
  laneHeight,
  laneGap,
  color,
  editable,
  clampStart,
  clampEnd,
  statusColor,
  milestoneDate,
  milestoneText,
  tooltip,
  enterIndex = 0,
  onOpen,
  onCommitDates,
}: {
  testId: string;
  entityId: string;
  title: string;
  startDate: string;
  endDate: string;
  spanStart: string;
  pxPerDay: number;
  lane: number;
  laneHeight: number;
  laneGap: number;
  color: string;
  editable: boolean;
  clampStart: string;
  clampEnd: string;
  statusColor?: string;
  milestoneDate?: string | null;
  milestoneText?: string;
  tooltip: React.ReactNode;
  enterIndex?: number;
  onOpen: () => void;
  onCommitDates: (startDate: string, endDate: string) => Promise<boolean>;
}) {
  const { onPointerDown, preview, dragging } = useBarDrag({
    enabled: editable,
    pxPerDay,
    startDate,
    endDate,
    clampStart,
    clampEnd,
    onCommit: onCommitDates,
    onClick: onOpen,
  });

  const shownStart = preview?.startDate ?? startDate;
  const shownEnd = preview?.endDate ?? endDate;
  const left = daysBetween(spanStart, shownStart) * pxPerDay;
  const width = Math.max((daysBetween(shownStart, shownEnd) + 1) * pxPerDay - 2, 8);
  const top = lane * (laneHeight + laneGap) + laneGap;

  const milestoneVisible =
    milestoneDate &&
    daysBetween(shownStart, milestoneDate) >= 0 &&
    daysBetween(milestoneDate, shownEnd) >= 0;

  const bar = (
    <div
      className={`bar${dragging ? ' bar--dragging' : ''}${editable ? '' : ' bar--readonly'}`}
      style={{
        left,
        width,
        top,
        height: laneHeight - 2,
        background: color,
        ['--enter-delay' as string]: `${Math.min(enterIndex * 40, 400)}ms`,
      }}
      data-testid={testId}
      data-entity-id={entityId}
      data-start={shownStart}
      data-end={shownEnd}
      role="button"
      tabIndex={0}
      aria-label={title}
      onPointerDown={onPointerDown('move')}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      {statusColor && <span className="status-dot" style={{ background: statusColor }} />}
      <span className="bar-title">{title}</span>
      {milestoneVisible && (
        <span
          className="milestone-diamond"
          style={{
            left: (daysBetween(shownStart, milestoneDate!) + 0.5) * pxPerDay,
            color,
          }}
          title={milestoneText || 'Milestone'}
          data-testid={`${testId}-milestone`}
        />
      )}
      {editable && (
        <>
          <span
            className="bar-handle bar-handle--left"
            data-testid={`${testId}-handle-left`}
            onPointerDown={onPointerDown('resize-left')}
          />
          <span
            className="bar-handle bar-handle--right"
            data-testid={`${testId}-handle-right`}
            onPointerDown={onPointerDown('resize-right')}
          />
        </>
      )}
    </div>
  );

  if (dragging) return bar;

  return (
    <Tooltip content={tooltip} side="top" delayDuration={350}>
      {bar}
    </Tooltip>
  );
}

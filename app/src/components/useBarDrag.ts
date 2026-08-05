'use client';

import { useCallback, useRef, useState } from 'react';
import { addDays, daysBetween, toUTC } from '@/lib/dates';

export type DragMode = 'move' | 'resize-left' | 'resize-right';

const CLICK_THRESHOLD_PX = 4;

interface DragOptions {
  enabled: boolean;
  pxPerDay: number;
  startDate: string;
  endDate: string;
  clampStart: string;
  clampEnd: string;
  /** Called on drop with the final dates and pointer position (for lane
   *  hit-testing, AC-2.8); resolve false to revert. Dates may equal the
   *  originals when the drag was purely vertical. */
  onCommit: (
    startDate: string,
    endDate: string,
    drop: { x: number; y: number },
  ) => Promise<boolean>;
  /** Clean click (movement under threshold) — drill-down etc. (AC-3.3). */
  onClick: () => void;
  /** Fired while dragging — lets the caller highlight drop targets. */
  onDragMove?: (x: number, y: number) => void;
}

interface Preview {
  startDate: string;
  endDate: string;
}

/**
 * Pointer-based drag-to-move / drag-to-resize with day snapping (F-2/F-4).
 * Distinguishes click from drag by a ~4px movement threshold (PRD §9), clamps
 * previews to the allowed span, and snaps deltas to whole days.
 */
export function useBarDrag(options: DragOptions) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragging, setDragging] = useState(false);
  const state = useRef<{
    mode: DragMode;
    originX: number;
    originY: number;
    moved: boolean;
    start: string;
    end: string;
    latest: Preview | null;
    lastPoint: { x: number; y: number };
  } | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const onPointerDown = useCallback(
    (mode: DragMode) => (e: React.PointerEvent) => {
      const opts = optionsRef.current;
      if (e.button !== 0) return;
      if (!opts.enabled && mode !== 'move') return;
      e.stopPropagation();

      state.current = {
        mode,
        originX: e.clientX,
        originY: e.clientY,
        moved: false,
        start: opts.startDate,
        end: opts.endDate,
        latest: null,
        lastPoint: { x: e.clientX, y: e.clientY },
      };

      const onMove = (ev: PointerEvent) => {
        const st = state.current;
        if (!st) return;
        const opts2 = optionsRef.current;
        const dx = ev.clientX - st.originX;
        const dy = ev.clientY - st.originY;
        // Vertical movement counts too — a straight-down drag into another
        // initiative row must not be mistaken for a click (AC-2.8).
        if (
          !st.moved &&
          Math.abs(dx) < CLICK_THRESHOLD_PX &&
          Math.abs(dy) < CLICK_THRESHOLD_PX
        ) {
          return;
        }
        if (!opts2.enabled) return; // viewers: never a drag, click still works

        st.moved = true;
        st.lastPoint = { x: ev.clientX, y: ev.clientY };
        setDragging(true);
        opts2.onDragMove?.(ev.clientX, ev.clientY);

        const dayDelta = Math.round(dx / opts2.pxPerDay);
        const duration = daysBetween(st.start, st.end);
        let next: Preview;

        if (st.mode === 'move') {
          let delta = dayDelta;
          const minDelta = daysBetween(st.start, opts2.clampStart);
          const maxDelta = daysBetween(st.end, opts2.clampEnd);
          delta = Math.max(minDelta, Math.min(maxDelta, delta));
          next = { startDate: addDays(st.start, delta), endDate: addDays(st.end, delta) };
        } else if (st.mode === 'resize-left') {
          let s = addDays(st.start, dayDelta);
          if (toUTC(s) < toUTC(opts2.clampStart)) s = opts2.clampStart;
          if (toUTC(s) > toUTC(st.end)) s = st.end;
          next = { startDate: s, endDate: st.end };
        } else {
          let en = addDays(st.end, dayDelta);
          if (toUTC(en) > toUTC(opts2.clampEnd)) en = opts2.clampEnd;
          if (toUTC(en) < toUTC(st.start)) en = st.start;
          next = { startDate: st.start, endDate: en };
        }

        st.latest = next;
        setPreview(next);
        void duration;
      };

      const onUp = async () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const st = state.current;
        state.current = null;
        setDragging(false);

        if (!st) return;
        const opts2 = optionsRef.current;

        if (!st.moved) {
          setPreview(null);
          opts2.onClick();
          return;
        }

        // Even with unchanged dates the drop may land on another initiative
        // row, so a moved drag always commits — the caller no-ops when
        // nothing actually changed (AC-2.8).
        const finalDates = st.latest ?? { startDate: st.start, endDate: st.end };
        const ok = await opts2.onCommit(finalDates.startDate, finalDates.endDate, st.lastPoint);
        setPreview(null);
        void ok;
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [],
  );

  return { onPointerDown, preview, dragging };
}

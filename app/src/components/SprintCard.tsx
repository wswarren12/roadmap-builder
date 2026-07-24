'use client';

import { Button } from '@pl/components/Button';
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from '@pl/components/Drawer';
import { formatDate, formatRange } from '@/lib/dates';
import type { SprintItem } from '@/lib/types';

/**
 * Right-hand full-detail card for a sprint item (AC-4.3): every field, with
 * Edit/Delete for owners and a strictly read-only view for viewers (AC-4.5).
 */
export function SprintCard({
  sprint,
  editable,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  sprint: SprintItem | null;
  editable: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (sprint: SprintItem) => void;
  onDelete: (sprint: SprintItem) => void;
}) {
  return (
    <Drawer open={sprint !== null} onOpenChange={onOpenChange} side="right" size="sm">
      {sprint && (
        <>
          <DrawerHeader title={sprint.name} onClose={() => onOpenChange(false)} />
          <DrawerBody>
            <div className="sprint-card-fields" data-testid="sprint-card">
              <div className="detail-field">
                <span className="detail-label">Dates</span>
                <span className="detail-value" data-testid="sprint-card-dates">
                  {formatRange(sprint.startDate, sprint.endDate)}
                </span>
              </div>
              <div className="detail-field">
                <span className="detail-label">Description</span>
                <span className="detail-value">
                  {sprint.description || '—'}
                </span>
              </div>
              <div className="detail-field">
                <span className="detail-label">Milestones</span>
                <span className="detail-value">
                  {sprint.milestoneText
                    ? `${sprint.milestoneText}${sprint.milestoneDate ? ` — ${formatDate(sprint.milestoneDate)}` : ''}`
                    : '—'}
                </span>
              </div>
              <div className="detail-field">
                <span className="detail-label">KPI</span>
                <span className="detail-value" data-testid="sprint-card-kpi">
                  {sprint.kpi || '—'}
                </span>
              </div>
              <div className="detail-field">
                <span className="detail-label">DRI</span>
                <span className="detail-value">{sprint.dri || '—'}</span>
              </div>
            </div>
          </DrawerBody>
          {editable && (
            <DrawerFooter>
              <Button
                variant="secondary"
                styleType="border"
                onClick={() => onEdit(sprint)}
                data-testid="sprint-card-edit"
              >
                Edit
              </Button>
              <Button
                variant="error"
                styleType="light"
                onClick={() => onDelete(sprint)}
                data-testid="sprint-card-delete"
              >
                Delete
              </Button>
            </DrawerFooter>
          )}
        </>
      )}
    </Drawer>
  );
}

'use client';

import { Button } from '@pl/components/Button';
import { Modal } from './Modal';

/**
 * Destructive-action confirm (F-9c): names the target and its cascade so
 * nothing is deleted until explicitly confirmed (AC-9.3).
 */
export function ConfirmModal({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = 'Delete',
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button variant="secondary" styleType="border" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="error"
            styleType="fill"
            loading={busy}
            onClick={onConfirm}
            data-testid="confirm-delete"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="confirm-message">{message}</p>
    </Modal>
  );
}

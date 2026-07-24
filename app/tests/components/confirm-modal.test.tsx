// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmModal } from '@/components/ConfirmModal';

afterEach(cleanup);

describe('ConfirmModal (AC-9.3)', () => {
  it('names the target and cascade, and deletes nothing until confirmed', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmModal
        open
        onOpenChange={onOpenChange}
        title="Delete roadmap item?"
        message='"Signup revamp" will be permanently deleted. This will also delete 6 sprint items.'
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText(/also delete 6 sprint items/)).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('fires onConfirm only from the confirm button', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        open
        onOpenChange={() => {}}
        title="Delete?"
        message="gone forever"
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByTestId('confirm-delete'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

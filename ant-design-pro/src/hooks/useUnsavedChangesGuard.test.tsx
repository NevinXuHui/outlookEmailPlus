import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { blockMock } = vi.hoisted(() => ({
  blockMock: vi.fn(),
}));

vi.mock('@umijs/max', () => ({
  history: { block: blockMock },
}));

import {
  type UnsavedChangesDecision,
  useUnsavedChangesGuard,
} from './useUnsavedChangesGuard';

type BlockedTransition = { retry: () => void };
type Blocker = (transition: BlockedTransition) => void;

describe('useUnsavedChangesGuard', () => {
  let blocker: Blocker | undefined;
  let unblock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    blocker = undefined;
    unblock = vi.fn();
    blockMock.mockReset();
    blockMock.mockImplementation((next: Blocker) => {
      blocker = next;
      return unblock;
    });
  });

  it('guards refreshes and SPA navigation only while the form is dirty', () => {
    const confirm = vi.fn();
    const { rerender } = renderHook(
      ({ dirty }) => useUnsavedChangesGuard(dirty, confirm),
      { initialProps: { dirty: false } },
    );

    expect(blockMock).not.toHaveBeenCalled();
    rerender({ dirty: true });
    expect(blockMock).toHaveBeenCalledTimes(1);

    const unloadEvent = new Event('beforeunload', {
      cancelable: true,
    }) as BeforeUnloadEvent;
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(true);

    const retry = vi.fn();
    act(() => blocker?.({ retry }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('keeps editing on cancel and retries navigation after confirmation', () => {
    const confirm = vi.fn();
    renderHook(() => useUnsavedChangesGuard(true, confirm));

    const firstRetry = vi.fn();
    act(() => blocker?.({ retry: firstRetry }));
    const firstDecision = confirm.mock.calls[0][0] as UnsavedChangesDecision;
    act(() => firstDecision.stay());
    expect(firstRetry).not.toHaveBeenCalled();

    const secondRetry = vi.fn();
    act(() => blocker?.({ retry: secondRetry }));
    const secondDecision = confirm.mock.calls[1][0] as UnsavedChangesDecision;
    act(() => secondDecision.proceed());

    expect(unblock).toHaveBeenCalled();
    expect(secondRetry).toHaveBeenCalledTimes(1);
  });

  it('does not open duplicate confirmations for the same pending navigation', () => {
    const confirm = vi.fn();
    renderHook(() => useUnsavedChangesGuard(true, confirm));

    act(() => {
      blocker?.({ retry: vi.fn() });
      blocker?.({ retry: vi.fn() });
    });

    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

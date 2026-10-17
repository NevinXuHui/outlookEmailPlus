import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePollingSettingsDraft } from './usePollingSettingsDraft';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('usePollingSettingsDraft', () => {
  it('hydrates server settings when the draft is untouched', async () => {
    const load = vi.fn().mockResolvedValue({ interval: 30, maxCount: 8 });
    const { result } = renderHook(() =>
      usePollingSettingsDraft({ interval: 10, maxCount: 5 }, load),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.interval).toBe(30);
    expect(result.current.maxCount).toBe(8);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not reload or overwrite an edited draft when the account changes', async () => {
    const pending = deferred<{ interval: number; maxCount: number }>();
    const load = vi.fn(() => pending.promise);
    const { result, rerender } = renderHook(
      ({ account }) => ({
        account,
        draft: usePollingSettingsDraft({ interval: 10, maxCount: 5 }, load),
      }),
      { initialProps: { account: 'first@example.com' } },
    );

    act(() => {
      result.current.draft.setInterval(12);
    });
    rerender({ account: 'second@example.com' });

    await act(async () => {
      pending.resolve({ interval: 20, maxCount: 9 });
      await pending.promise;
    });

    expect(result.current.account).toBe('second@example.com');
    expect(result.current.draft.interval).toBe(12);
    expect(result.current.draft.maxCount).toBe(5);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('accepts normalized settings after a successful save', () => {
    const load = vi.fn(() => new Promise<never>(() => {}));
    const { result } = renderHook(() =>
      usePollingSettingsDraft({ interval: 10, maxCount: 5 }, load),
    );

    act(() => {
      result.current.setInterval(2);
      result.current.acceptSettings({ interval: 3, maxCount: 5 });
    });

    expect(result.current.interval).toBe(3);
    expect(result.current.maxCount).toBe(5);
  });
});

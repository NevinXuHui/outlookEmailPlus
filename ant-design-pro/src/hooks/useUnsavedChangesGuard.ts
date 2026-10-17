import { history } from '@umijs/max';
import { useEffect } from 'react';

export type UnsavedChangesDecision = {
  proceed: () => void;
  stay: () => void;
};

export type UnsavedChangesConfirm = (decision: UnsavedChangesDecision) => void;

export function useUnsavedChangesGuard(
  dirty: boolean,
  confirm: UnsavedChangesConfirm,
) {
  useEffect(() => {
    if (!dirty) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);

    let confirming = false;
    const unblock = history.block((transition) => {
      if (confirming) return;
      confirming = true;
      confirm({
        proceed: () => {
          unblock();
          transition.retry();
        },
        stay: () => {
          confirming = false;
        },
      });
    });

    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      unblock();
    };
  }, [confirm, dirty]);
}

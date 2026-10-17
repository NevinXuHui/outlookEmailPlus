import { useCallback, useEffect, useRef, useState } from 'react';

export type PollingSettingsDraft = {
  interval: number;
  maxCount: number;
};

type PollingSettingsLoader = () => Promise<PollingSettingsDraft>;

export function usePollingSettingsDraft(
  initialSettings: PollingSettingsDraft,
  loadSettings: PollingSettingsLoader,
) {
  const initialSettingsRef = useRef(initialSettings);
  const touchedRef = useRef(false);
  const [draft, setDraft] = useState(initialSettingsRef.current);

  useEffect(() => {
    let active = true;
    void loadSettings().then((settings) => {
      if (!active || touchedRef.current) return;
      setDraft(settings);
    });
    return () => {
      active = false;
    };
  }, [loadSettings]);

  const setInterval = useCallback((interval: number) => {
    touchedRef.current = true;
    setDraft((current) => ({ ...current, interval }));
  }, []);

  const setMaxCount = useCallback((maxCount: number) => {
    touchedRef.current = true;
    setDraft((current) => ({ ...current, maxCount }));
  }, []);

  const acceptSettings = useCallback((settings: PollingSettingsDraft) => {
    touchedRef.current = false;
    setDraft(settings);
  }, []);

  return {
    ...draft,
    setInterval,
    setMaxCount,
    acceptSettings,
  };
}

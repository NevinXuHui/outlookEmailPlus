import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchSettingsMock } = vi.hoisted(() => ({
  fetchSettingsMock: vi.fn(),
}));

vi.mock('./settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./settings')>();
  return {
    ...actual,
    fetchSettings: fetchSettingsMock,
  };
});

vi.mock('./emails', () => ({
  extractEmailVerification: vi.fn(),
  fetchEmails: vi.fn(),
}));

import {
  applyPollSettings,
  getPollSettings,
  loadPollSettingsFromServer,
} from './pollEngine';

describe('poll engine settings contract', () => {
  beforeEach(() => {
    fetchSettingsMock.mockReset();
    applyPollSettings({ enabled: false, interval: 10, maxCount: 5 });
  });

  it('keeps zero as unlimited and clamps server data to backend bounds', async () => {
    fetchSettingsMock.mockResolvedValue({
      settings: {
        enable_auto_polling: true,
        polling_interval: 2,
        polling_count: 0,
      },
    });

    await expect(loadPollSettingsFromServer()).resolves.toEqual({
      enabled: true,
      interval: 3,
      maxCount: 0,
    });
  });

  it('clamps direct cache updates to the shared polling contract', () => {
    applyPollSettings({ interval: 3600, maxCount: 999 });

    expect(getPollSettings()).toEqual({
      enabled: false,
      interval: 300,
      maxCount: 100,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { outlookRequestMock } = vi.hoisted(() => ({
  outlookRequestMock: vi.fn(),
}));

vi.mock('./request', () => ({
  outlookRequest: outlookRequestMock,
}));

import {
  fetchHealth,
  normalizePollingSettings,
  updatePollingSettings,
} from './settings';

describe('settings service contracts', () => {
  beforeEach(() => {
    outlookRequestMock.mockReset();
    outlookRequestMock.mockResolvedValue({ success: true });
  });

  it('normalizes polling settings to backend-supported bounds', () => {
    expect(normalizePollingSettings(0, -3)).toEqual({
      polling_interval: 3,
      polling_count: 0,
    });
    expect(normalizePollingSettings(10, 0)).toEqual({
      polling_interval: 10,
      polling_count: 0,
    });
    expect(normalizePollingSettings(5000, 1200)).toEqual({
      polling_interval: 300,
      polling_count: 100,
    });
    expect(normalizePollingSettings(Number.NaN, Number.NaN)).toEqual({
      polling_interval: 10,
      polling_count: 5,
    });
  });

  it('persists mailbox polling settings through the shared settings endpoint', async () => {
    await updatePollingSettings(20, 0);

    expect(outlookRequestMock).toHaveBeenCalledWith('/api/settings', {
      method: 'PUT',
      data: { polling_interval: 20, polling_count: 0 },
      skipErrorHandler: true,
    });
  });

  it('reads the backend application version from healthz', async () => {
    await fetchHealth();

    expect(outlookRequestMock).toHaveBeenCalledWith('/healthz', {
      method: 'GET',
      skipErrorHandler: true,
    });
  });
});

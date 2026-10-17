import { beforeEach, describe, expect, it, vi } from 'vitest';

const { outlookRequestMock } = vi.hoisted(() => ({
  outlookRequestMock: vi.fn(),
}));

vi.mock('./request', () => ({
  outlookRequest: outlookRequestMock,
}));

import { fetchFailedRefreshLogs, fetchRefreshLogs } from './refreshLogs';

describe('refresh log service contracts', () => {
  beforeEach(() => {
    outlookRequestMock.mockReset();
    outlookRequestMock.mockResolvedValue({ success: true, logs: [] });
  });

  it('requests the backend refresh log endpoint with filters', async () => {
    await fetchRefreshLogs({ limit: 200 });

    expect(outlookRequestMock).toHaveBeenCalledWith(
      '/api/accounts/refresh-logs',
      {
        method: 'GET',
        params: { limit: 200 },
        skipErrorHandler: true,
      },
    );
  });

  it('requests the backend failed refresh log endpoint', async () => {
    await fetchFailedRefreshLogs();

    expect(outlookRequestMock).toHaveBeenCalledWith(
      '/api/accounts/refresh-logs/failed',
      {
        method: 'GET',
        params: {},
        skipErrorHandler: true,
      },
    );
  });
});

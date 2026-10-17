import { beforeEach, describe, expect, it, vi } from 'vitest';

const { outlookRequestMock } = vi.hoisted(() => ({
  outlookRequestMock: vi.fn(),
}));

vi.mock('./request', () => ({
  outlookRequest: outlookRequestMock,
}));

import { fetchEmailDetail, fetchEmails } from './emails';

describe('email folder request contracts', () => {
  beforeEach(() => {
    outlookRequestMock.mockReset();
    outlookRequestMock.mockResolvedValue({ success: true, emails: [] });
  });

  it.each([
    { folder: 'inbox', label: '收件箱' },
    { folder: 'junkemail', label: '垃圾邮件' },
  ] as const)('requests the $folder folder independently ($label)', async ({
    folder,
  }) => {
    await fetchEmails('user+tag@example.com', {
      method: 'graph',
      folder,
      skip: 20,
      top: 10,
    });

    expect(outlookRequestMock).toHaveBeenCalledWith(
      '/api/emails/user%2Btag%40example.com',
      {
        method: 'GET',
        params: {
          method: 'graph',
          folder,
          skip: 20,
          top: 10,
        },
        skipErrorHandler: true,
        getResponse: false,
      },
    );
  });

  it('keeps the selected folder when requesting message details', async () => {
    await fetchEmailDetail('user@example.com', 'message/1', {
      method: 'imap',
      folder: 'junkemail',
    });

    expect(outlookRequestMock).toHaveBeenCalledWith(
      '/api/email/user%40example.com/message%2F1',
      {
        method: 'GET',
        params: {
          method: 'imap',
          folder: 'junkemail',
        },
        skipErrorHandler: true,
      },
    );
  });

  it('defaults the list request to inbox', async () => {
    await fetchEmails('user@example.com');

    expect(outlookRequestMock).toHaveBeenCalledWith(
      '/api/emails/user%40example.com',
      expect.objectContaining({
        params: expect.objectContaining({ folder: 'inbox' }),
      }),
    );
  });
});

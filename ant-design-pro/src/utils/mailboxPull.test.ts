import { describe, expect, it } from 'vitest';
import { summarizeDualFolderPull } from './mailboxPull';

async function settled(
  inbox: Promise<{ success?: boolean }>,
  junk: Promise<{ success?: boolean }>,
) {
  return Promise.allSettled([inbox, junk]);
}

describe('summarizeDualFolderPull', () => {
  it('reports success only when both folders succeed', async () => {
    const result = summarizeDualFolderPull(
      await settled(Promise.resolve({ success: true }), Promise.resolve({ success: true })),
    );

    expect(result).toEqual({
      status: 'success',
      succeededFolders: ['收件箱', '垃圾邮件'],
      failedFolders: [],
    });
  });

  it('reports a business failure as partial success', async () => {
    const result = summarizeDualFolderPull(
      await settled(Promise.resolve({ success: true }), Promise.resolve({ success: false })),
    );

    expect(result).toEqual({
      status: 'partial',
      succeededFolders: ['收件箱'],
      failedFolders: ['垃圾邮件'],
    });
  });

  it('reports a rejected request as partial success', async () => {
    const result = summarizeDualFolderPull(
      await settled(Promise.reject(new Error('inbox failed')), Promise.resolve({ success: true })),
    );

    expect(result).toEqual({
      status: 'partial',
      succeededFolders: ['垃圾邮件'],
      failedFolders: ['收件箱'],
    });
  });

  it('reports failure when neither folder succeeds', async () => {
    const result = summarizeDualFolderPull(
      await settled(Promise.resolve({ success: false }), Promise.reject(new Error('junk failed'))),
    );

    expect(result).toEqual({
      status: 'failure',
      succeededFolders: [],
      failedFolders: ['收件箱', '垃圾邮件'],
    });
  });
});

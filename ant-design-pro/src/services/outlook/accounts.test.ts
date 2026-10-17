import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import {
  getResponseHeader,
  isHttpOk,
  parseContentDispositionFilename,
  parseSseDataLines,
  refreshAllAccounts,
} from './accounts';

vi.mock('./auth', () => ({
  ensureCsrfToken: vi.fn().mockResolvedValue('test-csrf-token'),
  clearCsrfToken: vi.fn(),
}));

describe('parseSseDataLines', () => {
  it('parses complete SSE data lines and keeps partial carry', () => {
    const first = parseSseDataLines(
      'data: {"type":"start","total":2,"skipped_count":1}\n\ndata: {"type":"progress","current":1',
    );
    expect(first.events).toEqual([
      { type: 'start', total: 2, skipped_count: 1 },
    ]);
    expect(first.rest.startsWith('data: {"type":"progress"')).toBe(true);

    const second = parseSseDataLines(
      ',"total":2,"result":"success"}\n\ndata: {"type":"complete","total":2,"success_count":2,"failed_count":0}\n\n',
      first.rest,
    );
    expect(second.events.map((e) => e.type)).toEqual([
      'progress',
      'complete',
    ]);
    expect(second.rest).toBe('');
  });

  it('ignores malformed JSON lines', () => {
    const parsed = parseSseDataLines(
      'data: not-json\ndata: {"type":"delay","seconds":1.5}\n',
    );
    expect(parsed.events).toEqual([{ type: 'delay', seconds: 1.5 }]);
  });
});

describe('refreshAllAccounts', () => {
  it('consumes the full-refresh SSE stream and summarizes all counters', async () => {
    const encoder = new TextEncoder();
    const events: string[] = [];
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"start","total":3,"delay_seconds":1}\n\n' +
              'data: {"type":"progress","current":1,"total":3,"success_count":0,"failed_count":0}\n\n' +
              'data: {"type":"complete","total":3,"success_count":2,"failed_count":1,"failed_list":[{"email":"failed@example.com","error":"invalid token"}]}\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(stream, { status: 200 }));

    const result = await refreshAllAccounts({
      onEvent: (event) => events.push(event.type),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/accounts/refresh-all',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Accept: 'text/event-stream',
          'X-CSRFToken': 'test-csrf-token',
        }),
      }),
    );
    expect(events).toEqual(['start', 'progress', 'complete']);
    expect(result).toMatchObject({
      success: true,
      total: 3,
      success_count: 2,
      failed_count: 1,
      skipped_count: 0,
    });
    expect(result.failed_list).toEqual([
      { email: 'failed@example.com', error: 'invalid token' },
    ]);

    fetchMock.mockRestore();
  });
});

describe('export response helpers', () => {
  it('isHttpOk supports fetch Response.ok and axios status', () => {
    expect(isHttpOk({ ok: true, status: 200 })).toBe(true);
    expect(isHttpOk({ ok: false, status: 500 })).toBe(false);
    expect(isHttpOk({ status: 200 })).toBe(true);
    expect(isHttpOk({ status: 404 })).toBe(false);
    expect(isHttpOk(undefined)).toBe(false);
    expect(isHttpOk({ headers: {}, data: new Blob() })).toBe(true);
  });

  it('getResponseHeader supports Headers.get and plain object', () => {
    const headers = new Headers({
      'Content-Disposition':
        "attachment; filename*=UTF-8''accounts_export_selected_20260711.txt",
    });
    expect(getResponseHeader({ headers }, 'Content-Disposition')).toContain(
      'accounts_export_selected_20260711.txt',
    );

    expect(
      getResponseHeader(
        {
          headers: {
            'content-disposition':
              'attachment; filename="plain_export.txt"',
          },
        },
        'Content-Disposition',
      ),
    ).toBe('attachment; filename="plain_export.txt"');
  });

  it('parseContentDispositionFilename handles UTF-8 and plain forms', () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename*=UTF-8''accounts_export_selected_20260711.txt",
        'fallback.txt',
      ),
    ).toBe('accounts_export_selected_20260711.txt');

    expect(
      parseContentDispositionFilename(
        'attachment; filename="plain_export.txt"',
        'fallback.txt',
      ),
    ).toBe('plain_export.txt');

    expect(parseContentDispositionFilename(null, 'fallback.txt')).toBe(
      'fallback.txt',
    );
  });
});

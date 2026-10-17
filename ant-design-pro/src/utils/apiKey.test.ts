import { describe, expect, it } from 'vitest';
import {
  getApiKeyExpiryLabel,
  getApiKeyStatus,
  getInvalidEmailScope,
  parseEmailScope,
} from './apiKey';

describe('API Key helpers', () => {
  it('marks disabled and expired keys separately', () => {
    const now = new Date('2026-08-08T00:00:00Z');
    expect(getApiKeyStatus({ enabled: false }, now)).toBe('disabled');
    expect(
      getApiKeyStatus({ enabled: true, expires_at: '2026-08-07T00:00:00Z' }, now),
    ).toBe('expired');
    expect(
      getApiKeyStatus({ enabled: true, expires_at: '2026-09-07T00:00:00Z' }, now),
    ).toBe('active');
  });

  it('formats expiry without exposing implementation details', () => {
    expect(getApiKeyExpiryLabel({})).toBe('永不过期');
    expect(getApiKeyExpiryLabel({ expires_at: '2026-09-07T00:00:00Z' })).toBe(
      '2026-09-07 到期',
    );
  });

  it('normalizes and deduplicates email scope', () => {
    expect(parseEmailScope('A@example.com\na@example.com, b@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('reports invalid email scope entries', () => {
    expect(getInvalidEmailScope('valid@example.com\ninvalid-address')).toEqual([
      'invalid-address',
    ]);
  });
});

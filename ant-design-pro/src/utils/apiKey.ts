import type { ExternalApiKeyItem } from '@/services/outlook/settings';

export type ApiKeyStatus = 'active' | 'disabled' | 'expired';

export const API_KEY_EXPIRY_OPTIONS = [
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
  { label: '1 年', value: 365 },
  { label: '永不过期', value: 0 },
];

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function splitEmailScope(value: unknown): string[] {
  return String(value || '')
    .split(/[\n,]/)
    .map((email) => email.trim())
    .filter(Boolean);
}

export function getApiKeyStatus(
  item: ExternalApiKeyItem,
  now = new Date(),
): ApiKeyStatus {
  if (item.expired) return 'expired';
  if (item.expires_at) {
    const expiresAt = new Date(item.expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt <= now) {
      return 'expired';
    }
  }
  return item.enabled === false ? 'disabled' : 'active';
}

export function getApiKeyExpiryLabel(item: ExternalApiKeyItem): string {
  if (!item.expires_at) return '永不过期';
  const date = new Date(item.expires_at);
  if (Number.isNaN(date.getTime())) return '过期时间无效';
  return `${date.toISOString().slice(0, 10)} 到期`;
}

export function parseEmailScope(value: unknown): string[] {
  return splitEmailScope(value)
    .map((email) => email.trim().toLowerCase())
    .filter((email, index, values) =>
      Boolean(EMAIL_PATTERN.test(email) && values.indexOf(email) === index),
    );
}

export function getInvalidEmailScope(value: unknown): string[] {
  return splitEmailScope(value).filter((email) => !EMAIL_PATTERN.test(email));
}

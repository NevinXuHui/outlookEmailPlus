export const SETTINGS_TAB_KEYS = [
  'refresh',
  'notification',
  'ai',
  'temp-mail',
  'external',
  'security',
  'update',
] as const;

export function getInitialSettingsTab(search: string) {
  const requested = new URLSearchParams(search).get('tab');
  return SETTINGS_TAB_KEYS.includes(
    requested as (typeof SETTINGS_TAB_KEYS)[number],
  )
    ? requested || 'refresh'
    : 'refresh';
}

export function formatJsonSetting(value: unknown, fallback: unknown) {
  const normalized = value === undefined || value === null ? fallback : value;
  return JSON.stringify(normalized, null, 2);
}

function parseJsonSetting(value: unknown, label: string) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}必须是合法 JSON`);
  }
}

export function parseDomainSetting(value: unknown, label: string) {
  const parsed = parseJsonSetting(value, label);
  if (parsed === undefined) return [];
  if (!Array.isArray(parsed)) {
    throw new Error(`${label}必须是数组`);
  }
  return parsed;
}

export function parseObjectSetting(value: unknown, label: string) {
  const parsed = parseJsonSetting(value, label);
  if (parsed === undefined) return {};
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label}必须是对象`);
  }
  return parsed;
}

export function getDomainNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && 'name' in item
          ? String(item.name || '')
          : '',
    )
    .filter(Boolean);
}

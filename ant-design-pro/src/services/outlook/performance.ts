import { request as umiRequest } from '@umijs/max';
import { ensureCsrfToken } from './auth';

export type ClientPerformanceMetric = {
  kind: 'api' | 'page' | 'navigation';
  name: string;
  duration_ms: number;
  success: boolean;
  status?: number;
  trace_id?: string;
};

type ActivePageMeasurement = {
  name: string;
  startedAt: number;
};

const MAX_QUEUE_SIZE = 200;
const MAX_BATCH_SIZE = 50;
const FLUSH_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 30_000;
const PAGE_SETTLE_MS = 500;
const SAFE_PATH_SEGMENTS = new Set([
  'api',
  'accounts',
  'activity',
  'audit',
  'audit-logs',
  'auth',
  'client',
  'csrf-token',
  'current-user',
  'emails',
  'export',
  'export-selected',
  'external-api',
  'groups',
  'healthz',
  'import',
  'items',
  'logout',
  'mailbox',
  'options',
  'overview',
  'performance',
  'plugins',
  'pool',
  'pool-admin',
  'providers',
  'refresh',
  'refresh-log',
  'refresh-logs',
  'settings',
  'status',
  'summary',
  'tags',
  'temp-emails',
  'token-tool',
  'user',
  'verification',
  'verify',
]);

let queue: ClientPerformanceMetric[] = [];
let flushTimer: number | undefined;
let pageTimer: number | undefined;
let activePage: ActivePageMeasurement | undefined;
let pendingApiRequests = 0;
let flushing = false;
let monitoringInstalled = false;
let navigationReported = false;
let flushDelayMs = FLUSH_DELAY_MS;

function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function normalizeMetricName(value: string): string {
  const raw = String(value || 'unknown').split('?', 1)[0].split('#', 1)[0];
  return raw
    .split('/')
    .map((part) =>
      !part || SAFE_PATH_SEGMENTS.has(part.toLowerCase()) ? part : ':id',
    )
    .join('/')
    .slice(0, 160);
}

export function createClientTraceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function enqueueMetric(metric: ClientPerformanceMetric): void {
  queue.push({
    ...metric,
    name: normalizeMetricName(metric.name),
    duration_ms: Math.max(0, Math.round(metric.duration_ms * 10) / 10),
  });
  if (queue.length > MAX_QUEUE_SIZE) {
    queue = queue.slice(-MAX_QUEUE_SIZE);
  }
  if (queue.length >= MAX_BATCH_SIZE && flushDelayMs === FLUSH_DELAY_MS) {
    void flushClientPerformanceMetrics();
    return;
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (typeof window === 'undefined' || flushTimer || flushing || !queue.length) {
    return;
  }
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    void flushClientPerformanceMetrics();
  }, flushDelayMs);
}

export async function flushClientPerformanceMetrics(): Promise<void> {
  if (typeof window === 'undefined' || flushing || !queue.length) {
    return;
  }
  flushing = true;
  if (flushTimer) {
    window.clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  const batch = queue.splice(0, MAX_BATCH_SIZE);
  try {
    const token = await ensureCsrfToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['X-CSRFToken'] = token;
    }
    await umiRequest('/api/performance/client', {
      method: 'POST',
      data: { metrics: batch },
      credentials: 'include',
      headers,
      skipErrorHandler: true,
    });
    flushDelayMs = FLUSH_DELAY_MS;
  } catch (_error) {
    queue = [...batch, ...queue].slice(-MAX_QUEUE_SIZE);
    flushDelayMs = Math.min(MAX_RETRY_DELAY_MS, flushDelayMs * 2);
  } finally {
    flushing = false;
    scheduleFlush();
  }
}

function finishPageMeasurement(): void {
  if (!activePage || pendingApiRequests > 0) {
    return;
  }
  const measurement = activePage;
  activePage = undefined;
  enqueueMetric({
    kind: 'page',
    name: measurement.name,
    duration_ms: monotonicNow() - measurement.startedAt,
    success: true,
    status: 200,
  });
}

function schedulePageSettle(): void {
  if (typeof window === 'undefined' || !activePage || pendingApiRequests > 0) {
    return;
  }
  if (pageTimer) {
    window.clearTimeout(pageTimer);
  }
  pageTimer = window.setTimeout(() => {
    pageTimer = undefined;
    finishPageMeasurement();
  }, PAGE_SETTLE_MS);
}

export function beginPageMeasurement(pathname: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const name = normalizeMetricName(pathname || window.location.pathname);
  if (activePage?.name === name) {
    return;
  }
  if (pageTimer) {
    window.clearTimeout(pageTimer);
    pageTimer = undefined;
  }
  activePage = { name, startedAt: monotonicNow() };
  schedulePageSettle();
}

export function startApiMeasurement(): number {
  pendingApiRequests += 1;
  if (pageTimer && typeof window !== 'undefined') {
    window.clearTimeout(pageTimer);
    pageTimer = undefined;
  }
  return monotonicNow();
}

export function finishApiMeasurement(input: {
  url: string;
  startedAt: number;
  success: boolean;
  status?: number;
  traceId?: string;
}): void {
  pendingApiRequests = Math.max(0, pendingApiRequests - 1);
  enqueueMetric({
    kind: 'api',
    name: input.url,
    duration_ms: monotonicNow() - input.startedAt,
    success: input.success,
    status: input.status || 0,
    trace_id: input.traceId,
  });
  schedulePageSettle();
}

function reportNavigationTiming(): void {
  if (navigationReported || typeof performance === 'undefined') {
    return;
  }
  const navigation = performance.getEntriesByType(
    'navigation',
  )[0] as PerformanceNavigationTiming | undefined;
  const duration = navigation?.duration || 0;
  if (!navigation || duration <= 0) {
    return;
  }
  navigationReported = true;
  enqueueMetric({
    kind: 'navigation',
    name:
      typeof window !== 'undefined' ? window.location.pathname : 'navigation',
    duration_ms: duration,
    success: true,
    status: 200,
  });
}

export function installPerformanceMonitoring(): void {
  if (typeof window === 'undefined' || monitoringInstalled) {
    return;
  }
  monitoringInstalled = true;
  if (document.readyState === 'complete') {
    reportNavigationTiming();
  } else {
    window.addEventListener('load', reportNavigationTiming, { once: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushClientPerformanceMetrics();
    }
  });
}

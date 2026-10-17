/**
 * 统一业务请求封装：自动带 credentials + CSRF。
 */
import { request as umiRequest } from '@umijs/max';
import { ensureCsrfToken, clearCsrfToken } from './auth';
import {
  createClientTraceId,
  finishApiMeasurement,
  startApiMeasurement,
} from './performance';

type RequestOptions = Record<string, any>;

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function pickErrorMessage(payload: any, fallback = '请求失败'): string {
  if (!payload) return fallback;
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error === 'object') {
    return (
      payload.error.message ||
      payload.error.message_en ||
      payload.error.code ||
      fallback
    );
  }
  if (typeof payload.message === 'string') return payload.message;
  return fallback;
}

/**
 * 业务 API 请求。默认 credentials: include。
 * 写操作自动附加 X-CSRFToken；若 400 且像 CSRF 失败会强制刷新后重试一次。
 */
export async function outlookRequest<T = any>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    skipPerformanceTracking = false,
    ...requestOptions
  }: RequestOptions = options;
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const traceId = String(
    requestOptions.headers?.['X-Trace-Id'] || createClientTraceId(),
  );
  const headers: Record<string, string> = {
    ...(requestOptions.headers || {}),
    'X-Trace-Id': traceId,
  };

  if (MUTATING.has(method)) {
    const token = await ensureCsrfToken();
    if (token) {
      headers['X-CSRFToken'] = token;
    }
  }

  const finalOptions: RequestOptions = {
    ...requestOptions,
    method,
    headers,
    credentials: 'include',
  };

  const startedAt = skipPerformanceTracking ? 0 : startApiMeasurement();
  let succeeded = false;
  let finalStatus = 0;
  try {
    const result = await umiRequest<T>(url, finalOptions);
    succeeded = true;
    finalStatus = 200;
    return result;
  } catch (error: any) {
    let finalError = error;
    let status = finalError?.response?.status;
    let data = finalError?.response?.data;
    const msg = pickErrorMessage(data, error?.message || '');
    const looksLikeCsrf =
      status === 400 &&
      MUTATING.has(method) &&
      /csrf|CSRF|token/i.test(String(msg));

    if (looksLikeCsrf) {
      clearCsrfToken();
      const token = await ensureCsrfToken(true);
      if (token) {
        headers['X-CSRFToken'] = token;
      }
      try {
        const result = await umiRequest<T>(url, { ...finalOptions, headers });
        succeeded = true;
        finalStatus = 200;
        return result;
      } catch (retryError: any) {
        finalError = retryError;
        status = finalError?.response?.status;
        data = finalError?.response?.data;
      }
    }

    finalStatus = Number(status || 0);
    const finalMessage = pickErrorMessage(
      data,
      finalError?.message || msg || '请求失败',
    );
    // 业务页常用 skipErrorHandler：把 HTTP 错误体规范化后抛出，
    // 保证 catch 侧总能读到 payload（含 502 details）。
    if (data && typeof data === 'object') {
      const normalized: any = new Error(finalMessage);
      normalized.name = finalError?.name || 'RequestError';
      normalized.response = finalError?.response;
      normalized.data = data;
      normalized.info = data;
      normalized.status = status;
      throw normalized;
    }
    throw finalError;
  } finally {
    if (!skipPerformanceTracking) {
      finishApiMeasurement({
        url,
        startedAt,
        success: succeeded,
        status: finalStatus,
        traceId,
      });
    }
  }
}

export { pickErrorMessage };

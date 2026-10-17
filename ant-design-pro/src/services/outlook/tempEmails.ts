import { outlookRequest } from './request';

export type TempEmailCapabilities = {
  create_mailbox?: boolean;
  list_messages?: boolean;
  get_message_detail?: boolean;
  delete_mailbox?: boolean;
  delete_message?: boolean;
  clear_messages?: boolean;
};

export type TempEmailProvider = {
  name: string;
  label?: string;
  version?: string;
  author?: string;
  kind?: 'builtin' | 'plugin' | string;
  active?: boolean;
  selected?: boolean;
  [key: string]: any;
};

export type TempEmailItem = {
  email: string;
  status?: string;
  source?: string;
  provider_name?: string;
  provider_capabilities?: TempEmailCapabilities;
  compatibility_mode?: 'legacy' | 'native' | string;
  read_capability?: string;
  created_at?: string;
  [key: string]: any;
};

export type TempEmailMessage = {
  id: string;
  from?: string;
  subject?: string;
  body_preview?: string;
  date?: string;
  timestamp?: number;
  has_html?: number | boolean;
};

export type TempEmailDetail = {
  id?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  body_type?: 'html' | 'text' | string;
  date?: string;
  timestamp?: number;
  inline_resources?: Record<string, any>;
};

export type TempEmailOptions = {
  domains?: Array<{ name?: string; domain?: string; enabled?: boolean; [key: string]: any }>;
  providers?: TempEmailProvider[];
  default_domain?: string;
  prefix_rules?: Record<string, any>;
  provider_name?: string;
  provider_label?: string;
  provider_kind?: 'builtin' | 'plugin' | string;
  active_provider?: string;
  capabilities?: TempEmailCapabilities;
  enabled?: boolean;
  configured?: boolean;
  status?: 'ready' | 'disabled' | 'not_configured' | string;
  status_message?: string;
  [key: string]: any;
};

export async function fetchTempEmails() {
  return outlookRequest<{ success: boolean; emails: TempEmailItem[] }>(
    '/api/temp-emails',
    { method: 'GET', skipErrorHandler: true },
  );
}

export async function fetchTempEmailOptions(providerName?: string) {
  return outlookRequest<{ success: boolean; options?: TempEmailOptions; error?: any }>(
    '/api/temp-emails/options',
    {
      method: 'GET',
      params: providerName ? { provider_name: providerName } : undefined,
      skipErrorHandler: true,
    },
  );
}

export async function generateTempEmail(body: {
  prefix?: string;
  domain?: string;
  provider_name?: string;
}) {
  return outlookRequest<{
    success: boolean;
    email?: string;
    mailbox?: TempEmailItem;
    message?: string;
    error?: any;
  }>('/api/temp-emails/generate', {
    method: 'POST',
    data: body,
    skipErrorHandler: true,
  });
}

export async function deleteTempEmail(email: string) {
  return outlookRequest<{ success: boolean; message?: string; error?: any }>(
    `/api/temp-emails/${encodeURIComponent(email)}`,
    { method: 'DELETE', skipErrorHandler: true },
  );
}

export async function fetchTempEmailMessages(
  email: string,
  params: { sync_remote?: boolean } = {},
) {
  return outlookRequest<{
    success: boolean;
    emails?: TempEmailMessage[];
    count?: number;
    method?: string;
    provider?: string;
    error?: any;
  }>(`/api/temp-emails/${encodeURIComponent(email)}/messages`, {
    method: 'GET',
    params: {
      sync_remote: params.sync_remote === false ? 'false' : 'true',
    },
    skipErrorHandler: true,
  });
}

export async function fetchTempEmailMessageDetail(email: string, messageId: string) {
  return outlookRequest<{
    success: boolean;
    email?: TempEmailDetail;
    error?: any;
  }>(
    `/api/temp-emails/${encodeURIComponent(email)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'GET', skipErrorHandler: true },
  );
}

export async function clearTempEmailMessages(email: string) {
  return outlookRequest<{ success: boolean; message?: string; error?: any }>(
    `/api/temp-emails/${encodeURIComponent(email)}/clear`,
    { method: 'DELETE', skipErrorHandler: true },
  );
}

export async function extractTempEmailVerification(email: string) {
  return outlookRequest<{ success: boolean; data?: any; message?: string; error?: any }>(
    `/api/temp-emails/${encodeURIComponent(email)}/extract-verification`,
    { method: 'GET', skipErrorHandler: true },
  );
}

export function pickTempErrorMessage(payload: any, fallback = '请求失败'): string {
  if (!payload) return fallback;
  if (typeof payload.error === 'string' && payload.error) return payload.error;
  if (payload.error && typeof payload.error === 'object') {
    return (
      payload.error.message ||
      payload.error.message_en ||
      payload.error.code ||
      fallback
    );
  }
  if (typeof payload.message === 'string' && payload.message) return payload.message;
  return fallback;
}

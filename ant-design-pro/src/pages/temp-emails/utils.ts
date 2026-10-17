import type {
  TempEmailCapabilities,
  TempEmailItem,
  TempEmailOptions,
  TempEmailProvider,
} from '@/services/outlook/tempEmails';

const BUILTIN_PROVIDER_LABELS: Record<string, string> = {
  custom_domain_temp_mail: '通用 API (GPTMail)',
  legacy_bridge: 'Legacy Bridge (GPTMail)',
  legacy_gptmail: 'Legacy Bridge (GPTMail)',
  cloudflare_temp_mail: 'Cloudflare Worker',
};

const BUILTIN_PROVIDERS = new Set(Object.keys(BUILTIN_PROVIDER_LABELS));

export type TempMailAvailability = {
  state: 'loading' | 'ready' | 'disabled' | 'not_configured' | 'unavailable';
  enabled: boolean;
  canGenerate: boolean;
  message: string;
};

export function resolveTempMailAvailability(
  options?: TempEmailOptions,
  flags: { loading?: boolean; failed?: boolean; errorMessage?: string } = {},
): TempMailAvailability {
  if (flags.loading) {
    return {
      state: 'loading',
      enabled: false,
      canGenerate: false,
      message: '正在检查临时邮箱服务',
    };
  }
  if (flags.failed || !options) {
    return {
      state: 'unavailable',
      enabled: false,
      canGenerate: false,
      message: flags.errorMessage || '临时邮箱服务当前不可用',
    };
  }
  if (options.enabled === false || options.status === 'disabled') {
    return {
      state: 'disabled',
      enabled: false,
      canGenerate: false,
      message: options.status_message || '临时邮箱服务未启用',
    };
  }
  if (options.configured === false || options.status === 'not_configured') {
    return {
      state: 'not_configured',
      enabled: true,
      canGenerate: false,
      message: options.status_message || '临时邮箱 Provider 尚未完成配置',
    };
  }
  return {
    state: 'ready',
    enabled: true,
    canGenerate: true,
    message: options.status_message || '临时邮箱服务已启用',
  };
}

export function getMailboxProviderPresentation(
  mailbox: TempEmailItem,
  providers: TempEmailProvider[] = [],
): {
  name: string;
  label: string;
  kind: 'builtin' | 'plugin' | 'legacy';
  capabilities: TempEmailCapabilities;
} {
  const legacy =
    mailbox.compatibility_mode === 'legacy' ||
    mailbox.source === 'legacy_gptmail' ||
    mailbox.provider_name === 'legacy_bridge';
  const name = legacy
    ? 'legacy_bridge'
    : mailbox.provider_name || mailbox.source || 'custom_domain_temp_mail';
  const provider = providers.find((item) => item.name === name);
  const kind = legacy
    ? 'legacy'
    : provider?.kind === 'builtin' || BUILTIN_PROVIDERS.has(name)
      ? 'builtin'
      : 'plugin';
  return {
    name,
    label: provider?.label || BUILTIN_PROVIDER_LABELS[name] || name,
    kind,
    capabilities: mailbox.provider_capabilities || {},
  };
}

export function isMailboxCapabilityEnabled(
  capabilities: TempEmailCapabilities,
  capability: keyof TempEmailCapabilities,
): boolean {
  return capabilities[capability] !== false;
}

export function providerKindLabel(kind?: string): string {
  if (kind === 'legacy') return '历史兼容';
  if (kind === 'plugin') return '插件';
  return '内置';
}

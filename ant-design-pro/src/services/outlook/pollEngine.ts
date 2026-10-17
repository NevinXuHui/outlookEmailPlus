/**
 * SPA 轮询引擎（对齐 static/js/features/poll-engine.js 最小可用子集）
 * - 多账号并行
 * - 按 interval / maxCount 停止
 * - 发现新邮件后尝试提取验证码
 */
import { extractEmailVerification, fetchEmails } from './emails';
import { fetchSettings, normalizePollingSettings } from './settings';

export type PollStatus = 'idle' | 'polling' | 'stopped' | 'error' | 'found';

export type PollSnapshot = {
  email: string;
  status: PollStatus;
  pollCount: number;
  maxCount: number;
  remaining: number;
  lastMessage?: string;
  verification?: string;
};

type PollState = {
  timer: ReturnType<typeof setInterval> | null;
  baselineIds: Set<string>;
  errorCount: number;
  pollCount: number;
  isPolling: boolean;
  /** 停止后置为 false；entry 保留为「幽灵快照」供 UI 展示最终结果 */
  active: boolean;
  intervalSec: number;
  maxCount: number;
  lastMessage?: string;
  verification?: string;
  status: PollStatus;
};

export type PollSettings = {
  enabled: boolean;
  interval: number;
  maxCount: number;
};

type Listener = (snapshots: PollSnapshot[]) => void;

const pollMap = new Map<string, PollState>();
const listeners = new Set<Listener>();

let settingsCache: PollSettings = {
  enabled: false,
  interval: 10,
  maxCount: 5,
};

function emit() {
  const snaps = getPollSnapshots();
  listeners.forEach((fn) => {
    try {
      fn(snaps);
    } catch {
      /* ignore */
    }
  });
}

export function getPollSnapshots(): PollSnapshot[] {
  return Array.from(pollMap.entries()).map(([email, state]) => ({
    email,
    status: state.status,
    pollCount: state.pollCount,
    maxCount: state.maxCount,
    remaining:
      state.maxCount > 0
        ? Math.max(0, state.maxCount - state.pollCount)
        : 0,
    lastMessage: state.lastMessage,
    verification: state.verification,
  }));
}

export function getPollSnapshot(email: string): PollSnapshot | undefined {
  return getPollSnapshots().find((s) => s.email === email);
}

export function subscribePoll(listener: Listener): () => void {
  listeners.add(listener);
  listener(getPollSnapshots());
  return () => listeners.delete(listener);
}

export function getPollSettings(): PollSettings {
  return { ...settingsCache };
}

export async function loadPollSettingsFromServer(): Promise<PollSettings> {
  try {
    const res = await fetchSettings();
    const s = res?.settings || {};
    const normalized = normalizePollingSettings(
      Number(s.polling_interval ?? 10),
      Number(s.polling_count ?? 5),
    );
    settingsCache = {
      enabled: !!(
        s.enable_auto_polling === true ||
        s.enable_auto_polling === 'true' ||
        s.enable_auto_polling === 1 ||
        s.enable_auto_polling === '1'
      ),
      interval: normalized.polling_interval,
      maxCount: normalized.polling_count,
    };
  } catch {
    /* keep cache */
  }
  return getPollSettings();
}

export function applyPollSettings(partial: Partial<PollSettings>) {
  const normalized = normalizePollingSettings(
    Number(partial.interval ?? settingsCache.interval),
    Number(partial.maxCount ?? settingsCache.maxCount),
  );
  settingsCache = {
    ...settingsCache,
    ...partial,
    interval: normalized.polling_interval,
    maxCount: normalized.polling_count,
  };
  // 运行中的轮询沿用新间隔需重启；此处仅更新缓存，UI 可选择 restart
  emit();
}

function stopInternal(email: string, message?: string, status: PollStatus = 'stopped') {
  const state = pollMap.get(email);
  if (!state) return;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.status = status;
  if (message) state.lastMessage = message;
  state.isPolling = false;
  // 保留 entry 作为幽灵快照：UI 需要看到「监听完成/找到验证码」的最终状态，
  // 删除会导致 stop 后的最后一次 emit 丢失该账号的结果（ZER-381 状态丢失问题）。
  state.active = false;
  emit();
}

export function stopPoll(email: string, message?: string) {
  stopInternal(email, message, 'stopped');
}

export function stopAllPolls() {
  const keys = Array.from(pollMap.keys());
  keys.forEach((email) => stopInternal(email, undefined, 'stopped'));
}

async function collectFolderIds(email: string, folder: string): Promise<string[]> {
  const res = await fetchEmails(email, {
    method: 'graph',
    folder,
    skip: 0,
    top: 50,
  });
  if (res?.success && Array.isArray(res.emails)) {
    return res.emails.map((e) => e.id).filter(Boolean);
  }
  return [];
}

async function pollOnce(email: string, state: PollState) {
  if (!state.active || pollMap.get(email) !== state || state.isPolling) return;
  state.isPolling = true;
  state.status = 'polling';
  emit();
  try {
    const [inboxIds, junkIds] = await Promise.all([
      collectFolderIds(email, 'inbox'),
      collectFolderIds(email, 'junkemail').catch(() => [] as string[]),
    ]);
    if (!state.active || pollMap.get(email) !== state) return;

    state.pollCount += 1;
    state.errorCount = 0;
    const allIds = new Set([...inboxIds, ...junkIds]);
    let hasNew = false;
    allIds.forEach((id) => {
      if (!state.baselineIds.has(id)) hasNew = true;
    });

    if (state.maxCount > 0 && state.pollCount >= state.maxCount && !hasNew) {
      stopInternal(email, '监听超时，未检测到新邮件', 'stopped');
      return;
    }

    if (!hasNew) {
      state.isPolling = false;
      emit();
      return;
    }

    // 发现新邮件 → 尝试提取验证码
    try {
      const vres = await extractEmailVerification(email);
      if (vres?.success && vres.data) {
        const code =
          vres.data.verification_code ||
          vres.data.code ||
          vres.data.formatted ||
          '';
        if (code) {
          state.verification = String(code);
          try {
            await navigator.clipboard.writeText(String(code));
          } catch {
            /* ignore */
          }
          stopInternal(email, `检测到验证码：${code}`, 'found');
          return;
        }
      }
    } catch {
      /* fall through */
    }
    stopInternal(email, '发现新邮件', 'found');
  } catch {
    state.errorCount += 1;
    state.isPolling = false;
    state.status = 'error';
    emit();
    if (state.errorCount >= 3) {
      stopInternal(email, '拉取失败，已停止监听', 'error');
    }
  }
}

export async function startPoll(
  email: string,
  opts?: { interval?: number; maxCount?: number; force?: boolean },
) {
  const addr = String(email || '').trim();
  if (!addr) return;
  if (!opts?.force && !settingsCache.enabled) {
    // 仍允许 force 启动（邮箱页手动监听）
  }
  if (pollMap.has(addr)) {
    stopInternal(addr);
  }

  const intervalSec = opts?.interval ?? settingsCache.interval ?? 10;
  const maxCount =
    opts?.maxCount !== undefined ? opts.maxCount : settingsCache.maxCount ?? 5;

  const state: PollState = {
    timer: null,
    baselineIds: new Set(),
    errorCount: 0,
    pollCount: 0,
    isPolling: false,
    active: true,
    intervalSec,
    maxCount,
    status: 'polling',
  };
  pollMap.set(addr, state);
  emit();

  try {
    const [inboxIds, junkIds] = await Promise.all([
      collectFolderIds(addr, 'inbox'),
      collectFolderIds(addr, 'junkemail').catch(() => [] as string[]),
    ]);
    if (!state.active || pollMap.get(addr) !== state) return;
    [...inboxIds, ...junkIds].forEach((id) => state.baselineIds.add(id));
  } catch {
    // baseline 失败仍继续轮询
  }

  // 首次轮询略延迟，确保 baseline 写入
  setTimeout(() => {
    if (state.active && pollMap.get(addr) === state) void pollOnce(addr, state);
  }, 150);

  state.timer = setInterval(() => {
    if (state.active && pollMap.get(addr) === state) void pollOnce(addr, state);
  }, Math.max(1, intervalSec) * 1000);
}

export function isPolling(email: string): boolean {
  const state = pollMap.get(email);
  return !!(state && state.active);
}

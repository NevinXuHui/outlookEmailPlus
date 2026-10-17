import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  THEME_STORAGE_KEY,
  loadPersistedNavTheme,
  persistNavTheme,
} from './ThemeToggle';

describe('ThemeToggle persistence (ZER-658)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('无存储值时回退到默认浅色', () => {
    expect(loadPersistedNavTheme()).toBe('light');
    expect(loadPersistedNavTheme('realDark')).toBe('realDark');
  });

  it('持久化后可读回深色偏好', () => {
    persistNavTheme('realDark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('realDark');
    expect(loadPersistedNavTheme()).toBe('realDark');
  });

  it('非法存储值回退到默认值', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(loadPersistedNavTheme()).toBe('light');
  });

  it('localStorage 不可用时静默回退', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(loadPersistedNavTheme()).toBe('light');

    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(() => persistNavTheme('realDark')).not.toThrow();
  });
});

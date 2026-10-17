import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { Button, Tooltip } from 'antd';
import React from 'react';

export const THEME_STORAGE_KEY = 'outlook.navTheme';

export type AppNavTheme = Exclude<LayoutSettings['navTheme'], undefined>;

/**
 * 读取持久化的主题偏好；非法值回退到默认浅色。
 */
export function loadPersistedNavTheme(fallback: AppNavTheme = 'light'): AppNavTheme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'realDark') {
      return saved;
    }
  } catch (_error) {
    // localStorage 不可用（隐私模式等）时静默回退
  }
  return fallback;
}

export function persistNavTheme(theme: AppNavTheme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (_error) {
    // 忽略持久化失败，不影响当次切换
  }
}

type ThemeToggleProps = {
  navTheme?: AppNavTheme;
  onChange?: (theme: AppNavTheme) => void;
};

/**
 * 正式的主题切换入口：仅暴露浅色 / 深色两个产品选项，
 * 不包含布局、固定侧栏等开发态设置（ZER-658）。
 */
const ThemeToggle: React.FC<ThemeToggleProps> = ({ navTheme, onChange }) => {
  const isDark = navTheme === 'realDark';
  return (
    <Tooltip title={isDark ? '切换到浅色模式' : '切换到深色模式'}>
      <Button
        type="text"
        aria-label={isDark ? '切换到浅色模式' : '切换到深色模式'}
        icon={isDark ? <MoonOutlined /> : <SunOutlined />}
        onClick={() => onChange?.(isDark ? 'light' : 'realDark')}
      />
    </Tooltip>
  );
};

export default ThemeToggle;

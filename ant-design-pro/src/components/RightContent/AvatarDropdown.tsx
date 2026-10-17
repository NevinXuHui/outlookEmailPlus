import {
  LogoutOutlined,
  SettingOutlined,
  SkinOutlined,
} from '@ant-design/icons';
import { history, useModel } from '@umijs/max';
import type { MenuProps } from 'antd';
import { Spin } from 'antd';
import React, { startTransition } from 'react';
import { outLogin } from '@/services/outlook/auth';
import HeaderDropdown from '../HeaderDropdown';
import { persistNavTheme } from './ThemeToggle';

const isDev = process.env.NODE_ENV === 'development';

type GlobalHeaderRightProps = {
  children?: React.ReactNode;
};

const menuItems: MenuProps['items'] = [
  {
    key: 'settings',
    icon: <SettingOutlined />,
    label: '系统设置',
  },
  {
    key: 'theme',
    icon: <SkinOutlined />,
    label: '主题设置',
  },
  {
    type: 'divider' as const,
  },
  {
    key: 'logout',
    icon: <LogoutOutlined />,
    label: '退出登录',
  },
];

const loginOut = async () => {
  try {
    await outLogin();
  } catch {
    // Local logout has already cleared user state; redirect should still proceed.
  }
  const { search, pathname } = window.location;
  const urlParams = new URL(window.location.href).searchParams;
  const searchParams = new URLSearchParams({
    redirect: pathname + search,
  });
  const redirect = urlParams.get('redirect');
  if (window.location.pathname !== '/user/login' && !redirect) {
    history.replace({
      pathname: '/user/login',
      search: searchParams.toString(),
    });
  }
};

export const AvatarDropdown: React.FC<GlobalHeaderRightProps> = ({
  children,
}) => {
  const { initialState, setInitialState } = useModel('@@initialState');

  const onMenuClick: MenuProps['onClick'] = (event) => {
    const { key } = event;
    if (key === 'logout') {
      startTransition(() => {
        setInitialState((s) => ({ ...s, currentUser: undefined }));
      });
      loginOut();
      return;
    }
    if (key === 'theme') {
      // ZER-658：生产环境没有开发态抽屉，菜单项直接切换浅色/深色；
      // 开发环境保留打开 SettingDrawer 的行为。
      if (isDev) {
        setInitialState((s) => ({ ...s, settingDrawerOpen: true }));
      } else {
        const current = initialState?.settings?.navTheme;
        const next = current === 'realDark' ? 'light' : 'realDark';
        persistNavTheme(next);
        setInitialState((s) => ({
          ...s,
          settings: { ...s?.settings, navTheme: next },
        }));
      }
      return;
    }
    if (key === 'settings') {
      history.push('/settings');
      return;
    }
    history.push(`/${key}`);
  };

  if (!initialState) {
    return <Spin size="small" />;
  }

  const { currentUser } = initialState;

  if (!currentUser) {
    return <Spin size="small" />;
  }

  return (
    <HeaderDropdown
      placement="bottomRight"
      menu={{
        selectedKeys: [],
        onClick: onMenuClick,
        items: menuItems,
      }}
      arrow
    >
      {children}
    </HeaderDropdown>
  );
};

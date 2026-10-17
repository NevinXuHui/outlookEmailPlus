import { Typography } from 'antd';
import React from 'react';

const guideSteps = [
  {
    title: '注册应用',
    content: (
      <>
        <p>
          进入{' '}
          <a
            href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
            target="_blank"
            rel="noopener noreferrer"
          >
            Azure 门户 → 应用注册
          </a>
          ，点击「新注册」。
        </p>
        <ul>
          <li>名称：自定义（如 &quot;OutlookEmailPlus&quot;）</li>
          <li>
            受支持的账户类型：选择「
            <strong>
              Accounts in any organizational directory and personal Microsoft
              accounts
            </strong>
            」（任意目录 + 个人账号）
          </li>
          <li>
            ⚠️ 不要选「仅个人 Microsoft accounts」，否则会触发 AADSTS9002331 错误
          </li>
        </ul>
      </>
    ),
  },
  {
    title: '开启公共客户端流',
    content: (
      <>
        <p>
          进入应用 →「身份验证」→ 页面底部「高级设置」→ 将「允许公共客户端流」设为「是」。
        </p>
        <Typography.Text type="secondary">
          ⚠️ 这一步最容易遗漏！缺失会导致 <code>unauthorized_client</code> 错误。
        </Typography.Text>
      </>
    ),
  },
  {
    title: '配置 API 权限',
    content: (
      <>
        <p>
          进入应用 →「API 权限」→「添加权限」→ 选择「Microsoft Graph」→「委托的权限」，添加以下权限：
        </p>
        <ul>
          <li>
            <code>offline_access</code>（必须，用于获取 refresh_token）
          </li>
          <li>
            <code>Mail.Read</code>（读取邮件）
          </li>
          <li>
            <code>User.Read</code>（读取用户信息）
          </li>
        </ul>
        <Typography.Text type="secondary">
          💡 推荐使用 Graph 协议（本系统默认邮件读取主链路），直接使用「Graph 邮件」预设即可。
        </Typography.Text>
      </>
    ),
  },
  {
    title: '配置重定向 URI',
    content: (
      <>
        <p>
          在「身份验证」页面添加一个「Web」平台的重定向 URI，填入本工具页面的回调地址。
        </p>
        <ul>
          <li>
            本地部署：
            <code>http://localhost:5001/token-tool/callback</code>（端口号根据实际调整）
          </li>
          <li>
            Docker/远程部署：可填 <code>http://localhost</code>
            ，授权后手动复制地址栏 URL 粘贴回本工具
          </li>
        </ul>
      </>
    ),
  },
  {
    title: '获取 Client ID',
    content: (
      <p>
        回到应用「概述」页面，复制「应用程序(客户端) ID」，粘贴到下方 OAuth 配置的 Client ID
        输入框中。
      </p>
    ),
  },
];

const TokenToolGuide: React.FC = () => {
  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        如果你是第一次使用，请先在 Azure 门户注册一个应用，获取 Client ID 后再填写下方配置。
      </Typography.Paragraph>
      {guideSteps.map((step, index) => (
        <div
          key={step.title}
          style={{
            display: 'flex',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'rgba(184, 92, 56, 0.12)',
              color: '#B85C38',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {index + 1}
          </div>
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong>{step.title}</Typography.Text>
            <div style={{ marginTop: 4 }}>{step.content}</div>
          </div>
        </div>
      ))}
      <Typography.Paragraph style={{ marginBottom: 0 }}>
        📖 详细教程：{' '}
        <a
          href="https://real-caption-6d1.notion.site/OutlooKMailplus-token-344463aed7e680099380dc324ecdf1c9?source=copy_link"
          target="_blank"
          rel="noopener noreferrer"
        >
          OutlookMailPlus Token 教程
        </a>
      </Typography.Paragraph>
    </div>
  );
};

export default TokenToolGuide;

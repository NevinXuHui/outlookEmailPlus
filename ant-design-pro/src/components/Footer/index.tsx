import { GithubOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Divider } from 'antd';
import { createStyles } from 'antd-style';
import React from 'react';
import { fetchHealth } from '@/services/outlook/settings';
import { REPO_URL } from '@/utils/repoUrl';

const COMMIT_HASH = process.env.COMMIT_HASH || '';

const useStyles = createStyles(({ token, css }) => ({
  footer: css`
    padding: 16px 24px;
    text-align: center;
    color: ${token.colorTextDescription};
    font-size: ${token.fontSizeSM}px;
    line-height: ${token.lineHeight};
    background: transparent;
  `,
  copyright: css`
    margin-bottom: 6px;
  `,
  link: css`
    color: ${token.colorTextDescription};
    text-decoration: none;
    transition: color ${token.motionDurationMid};

    &:hover {
      color: ${token.colorText};
    }
  `,
  meta: css`
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px 12px;
    font-family: ${token.fontFamilyCode};
    font-size: ${token.fontSizeSM - 1}px;
  `,
  group: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
  `,
  label: css`
    color: ${token.colorTextQuaternary};
  `,
  divider: css`
    display: inline-block;
    vertical-align: middle;
  `,
}));

const Footer: React.FC = () => {
  const { styles } = useStyles();
  const year = new Date().getFullYear();
  const healthQuery = useQuery({
    queryKey: ['app-health'],
    queryFn: fetchHealth,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
  const appVersion = healthQuery.data?.version || '--';

  return (
    <div className={styles.footer}>
      <div className={styles.copyright}>Outlook 邮件管理 &copy; {year}</div>
      <div className={styles.meta}>
        <span className={styles.group}>
          <span className={styles.label}>app</span>
          <span title={healthQuery.isError ? '无法读取后端版本' : undefined}>
            {appVersion}
          </span>
          {COMMIT_HASH && (
            <a
              className={styles.link}
              href={`${REPO_URL}/commit/${COMMIT_HASH}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {COMMIT_HASH.slice(0, 7)}
            </a>
          )}
        </span>
        <Divider orientation="vertical" className={styles.divider} />
        <span className={styles.group}>
          <span className={styles.label}>frontend</span>
          <span>{__APP_VERSION__}</span>
        </span>
        <Divider orientation="vertical" className={styles.divider} />
        <a
          className={styles.link}
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <GithubOutlined style={{ marginRight: 4 }} />
          GitHub
        </a>
      </div>
    </div>
  );
};

export default Footer;

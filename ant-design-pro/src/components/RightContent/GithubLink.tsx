import { GithubOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import React from 'react';
import { REPO_URL } from '@/utils/repoUrl';

/**
 * 顶栏 GitHub 仓库链接（对齐旧前端抬头 btn-github）
 */
const GithubLink: React.FC = () => {
  return (
    <Tooltip title="访问 GitHub 仓库">
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub 仓库"
        style={{
          color: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          fontSize: 18,
          padding: '0 8px',
        }}
      >
        <GithubOutlined />
      </a>
    </Tooltip>
  );
};

export default GithubLink;

import packageJson from '@root/package.json';

export const FALLBACK_REPO_URL =
  'https://github.com/ZeroPointSix/outlookEmailPlus';

/**
 * 从 package.json repository 推导 GitHub 仓库地址；
 * 脚手架默认仓库（ant-design-pro）回退到本项目仓库。
 */
export function getRepoUrl(): string {
  if (!packageJson.repository) return FALLBACK_REPO_URL;
  const repo =
    typeof packageJson.repository === 'string'
      ? packageJson.repository
      : (packageJson.repository as { url: string }).url;
  const match = repo.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) return FALLBACK_REPO_URL;
  const owner = match[1];
  const name = match[2];
  if (owner === 'ant-design' && name === 'ant-design-pro') {
    return FALLBACK_REPO_URL;
  }
  return `https://github.com/${owner}/${name}`;
}

export const REPO_URL = getRepoUrl();

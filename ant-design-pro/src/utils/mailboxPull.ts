export const DUAL_FOLDER_LABELS = ['收件箱', '垃圾邮件'] as const;

type PullResponse = {
  success?: boolean;
};

export type DualFolderPullStatus = 'success' | 'partial' | 'failure';

export type DualFolderPullSummary = {
  status: DualFolderPullStatus;
  succeededFolders: string[];
  failedFolders: string[];
};

export function summarizeDualFolderPull(
  results: readonly PromiseSettledResult<PullResponse>[],
): DualFolderPullSummary {
  const succeededFolders: string[] = [];
  const failedFolders: string[] = [];

  DUAL_FOLDER_LABELS.forEach((label, index) => {
    const result = results[index];
    if (result?.status === 'fulfilled' && result.value?.success) {
      succeededFolders.push(label);
    } else {
      failedFolders.push(label);
    }
  });

  return {
    status:
      failedFolders.length === 0
        ? 'success'
        : succeededFolders.length === 0
          ? 'failure'
          : 'partial',
    succeededFolders,
    failedFolders,
  };
}

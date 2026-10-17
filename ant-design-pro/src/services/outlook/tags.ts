import { outlookRequest } from './request';

export type TagItem = {
  id: number;
  name: string;
  color?: string;
};

export type TagsResponse = {
  success: boolean;
  tags: TagItem[];
};

/**
 * 账号列表标签筛选参数：后端 /api/accounts 支持
 * `tag_id`（可重复）或 `tag_ids`（逗号分隔），这里统一用逗号分隔形式。
 */
export function serializeTagIds(tagIds?: number[]): string | undefined {
  if (!tagIds?.length) return undefined;
  return tagIds.join(',');
}

export async function fetchTags() {
  return outlookRequest<TagsResponse>('/api/tags', { method: 'GET' });
}

export async function createTag(name: string, color = '#1a1a1a') {
  return outlookRequest<{
    success: boolean;
    tag?: TagItem;
    message?: string;
    error?: any;
  }>('/api/tags', {
    method: 'POST',
    data: { name, color },
  });
}

export async function deleteTag(tagId: number) {
  return outlookRequest<{ success: boolean; message?: string; error?: any }>(
    `/api/tags/${tagId}`,
    { method: 'DELETE' },
  );
}

export async function batchManageAccountTags(
  accountIds: number[],
  tagId: number,
  action: 'add' | 'remove',
) {
  return outlookRequest<{ success: boolean; message?: string; error?: any }>(
    '/api/accounts/tags',
    {
      method: 'POST',
      data: { account_ids: accountIds, tag_id: tagId, action },
    },
  );
}

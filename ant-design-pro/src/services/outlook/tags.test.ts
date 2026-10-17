import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  batchManageAccountTags,
  createTag,
  deleteTag,
  fetchTags,
  serializeTagIds,
} from './tags';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('./request', () => ({
  outlookRequest: requestMock,
}));

describe('tags service (ZER-653)', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ success: true });
  });

  it('fetchTags 调用 GET /api/tags', async () => {
    await fetchTags();
    expect(requestMock).toHaveBeenCalledWith('/api/tags', { method: 'GET' });
  });

  it('createTag 提交名称与颜色', async () => {
    await createTag('重点', '#ff4d4f');
    expect(requestMock).toHaveBeenCalledWith('/api/tags', {
      method: 'POST',
      data: { name: '重点', color: '#ff4d4f' },
    });
  });

  it('deleteTag 调用 DELETE /api/tags/:id', async () => {
    await deleteTag(7);
    expect(requestMock).toHaveBeenCalledWith('/api/tags/7', {
      method: 'DELETE',
    });
  });

  it('batchManageAccountTags 提交账号列表与动作', async () => {
    await batchManageAccountTags([1, 2, 3], 5, 'add');
    expect(requestMock).toHaveBeenCalledWith('/api/accounts/tags', {
      method: 'POST',
      data: { account_ids: [1, 2, 3], tag_id: 5, action: 'add' },
    });
  });

  it('serializeTagIds 输出逗号分隔字符串，空输入返回 undefined', () => {
    expect(serializeTagIds([1, 2, 3])).toBe('1,2,3');
    expect(serializeTagIds([])).toBeUndefined();
    expect(serializeTagIds(undefined)).toBeUndefined();
  });
});

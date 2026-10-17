import {
  ClearOutlined,
  DeleteOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { Button, Popconfirm, Space, Tooltip } from 'antd';
import type { MouseEvent } from 'react';
import type { TempEmailCapabilities } from '@/services/outlook/tempEmails';
import { isMailboxCapabilityEnabled } from './utils';

type MailboxActionsProps = {
  capabilities?: TempEmailCapabilities;
  onExtractVerification: () => void;
  onClearMessages: () => void;
  onDeleteMailbox: () => void;
};

export function MailboxActions({
  capabilities = {},
  onExtractVerification,
  onClearMessages,
  onDeleteMailbox,
}: MailboxActionsProps) {
  const canExtractVerification =
    isMailboxCapabilityEnabled(capabilities, 'list_messages') &&
    isMailboxCapabilityEnabled(capabilities, 'get_message_detail');
  const canClearMessages = isMailboxCapabilityEnabled(
    capabilities,
    'clear_messages',
  );

  const stopPropagation = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  return (
    <Space size={0}>
      <Tooltip
        title={
          canExtractVerification
            ? '提取验证码'
            : '当前 Provider 不支持读取邮件'
        }
      >
        <Button
          type="text"
          size="small"
          aria-label="提取验证码"
          icon={<KeyOutlined />}
          disabled={!canExtractVerification}
          onClick={(event) => {
            stopPropagation(event);
            onExtractVerification();
          }}
        />
      </Tooltip>
      <Popconfirm
        title="清空该邮箱全部邮件？"
        disabled={!canClearMessages}
        onConfirm={onClearMessages}
      >
        <Tooltip
          title={
            canClearMessages ? '清空邮件' : '当前 Provider 不支持清空邮件'
          }
        >
          <Button
            type="text"
            size="small"
            aria-label="清空邮件"
            icon={<ClearOutlined />}
            disabled={!canClearMessages}
            onClick={stopPropagation}
          />
        </Tooltip>
      </Popconfirm>
      <Popconfirm title="确认删除该临时邮箱？" onConfirm={onDeleteMailbox}>
        <Tooltip title="移除邮箱">
          <Button
            type="text"
            size="small"
            danger
            aria-label="移除邮箱"
            icon={<DeleteOutlined />}
            onClick={stopPropagation}
          />
        </Tooltip>
      </Popconfirm>
    </Space>
  );
}

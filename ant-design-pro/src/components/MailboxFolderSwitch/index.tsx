import {
  DeleteOutlined,
  MailOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Segmented, Space } from 'antd';
import React from 'react';
import type { EmailFolder } from '@/services/outlook/emails';

export const MAILBOX_FOLDERS: Array<{
  label: string;
  value: EmailFolder;
}> = [
  { label: '收件箱', value: 'inbox' },
  { label: '垃圾邮件', value: 'junkemail' },
  { label: '已删除', value: 'deleteditems' },
];

export function getMailboxFolderLabel(folder: EmailFolder) {
  return MAILBOX_FOLDERS.find((item) => item.value === folder)?.label || folder;
}

export type MailboxFolderSwitchProps = {
  value: EmailFolder;
  disabled?: boolean;
  onChange: (folder: EmailFolder) => void;
};

const MailboxFolderSwitch: React.FC<MailboxFolderSwitchProps> = ({
  value,
  disabled,
  onChange,
}) => (
  <Segmented
    aria-label="邮件文件夹"
    block
    disabled={disabled}
    value={value}
    options={[
      {
        label: (
          <Space size={4}>
            <MailOutlined />
            收件箱
          </Space>
        ),
        value: 'inbox',
      },
      {
        label: (
          <Space size={4}>
            <WarningOutlined />
            垃圾邮件
          </Space>
        ),
        value: 'junkemail',
      },
      {
        label: (
          <Space size={4}>
            <DeleteOutlined />
            已删除
          </Space>
        ),
        value: 'deleteditems',
      },
    ]}
    onChange={(next) => onChange(String(next) as EmailFolder)}
  />
);

export default MailboxFolderSwitch;

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MailboxActions } from './MailboxActions';

const handlers = {
  onExtractVerification: vi.fn(),
  onClearMessages: vi.fn(),
  onDeleteMailbox: vi.fn(),
};

describe('MailboxActions', () => {
  it('disables read and clear actions when the mailbox capabilities reject them', () => {
    render(
      <MailboxActions
        capabilities={{
          list_messages: false,
          get_message_detail: false,
          clear_messages: false,
        }}
        {...handlers}
      />,
    );

    expect(
      screen.getByRole('button', { name: '提取验证码' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '清空邮件' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '移除邮箱' })).toBeEnabled();
  });

  it('keeps legacy actions enabled when capability metadata is absent', () => {
    render(<MailboxActions {...handlers} />);

    expect(
      screen.getByRole('button', { name: '提取验证码' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: '清空邮件' })).toBeEnabled();
  });
});

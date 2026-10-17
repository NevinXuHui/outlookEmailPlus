import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MailboxFolderSwitch, { getMailboxFolderLabel } from './index';

describe('MailboxFolderSwitch', () => {
  it('shows the inbox and junk folders as explicit modes', () => {
    const onChange = vi.fn();
    const { container } = render(
      <MailboxFolderSwitch value="inbox" onChange={onChange} />,
    );

    expect(screen.getByText('收件箱')).toBeInTheDocument();
    expect(screen.getByText('垃圾邮件')).toBeInTheDocument();
    expect(screen.getByText('已删除')).toBeInTheDocument();
    expect(
      container.querySelector('[aria-label="邮件文件夹"]'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('垃圾邮件'));

    expect(onChange).toHaveBeenCalledWith('junkemail');
  });

  it('can disable folder changes while no account is selected', () => {
    const onChange = vi.fn();
    render(
      <MailboxFolderSwitch disabled value="inbox" onChange={onChange} />,
    );

    fireEvent.click(screen.getByText('垃圾邮件'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('returns a stable label for known and future folders', () => {
    expect(getMailboxFolderLabel('inbox')).toBe('收件箱');
    expect(getMailboxFolderLabel('junkemail')).toBe('垃圾邮件');
    expect(getMailboxFolderLabel('deleteditems')).toBe('已删除');
    expect(getMailboxFolderLabel('archive')).toBe('archive');
  });
});

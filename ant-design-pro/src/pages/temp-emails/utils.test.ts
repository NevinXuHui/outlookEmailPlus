import { describe, expect, it } from 'vitest';
import {
  getMailboxProviderPresentation,
  isMailboxCapabilityEnabled,
  resolveTempMailAvailability,
} from './utils';

describe('temp email presentation', () => {
  it('marks historical GPTMail mailboxes as legacy-compatible', () => {
    expect(
      getMailboxProviderPresentation({
        email: 'old@example.test',
        source: 'legacy_gptmail',
      }),
    ).toMatchObject({
      name: 'legacy_bridge',
      label: 'Legacy Bridge (GPTMail)',
      kind: 'legacy',
    });
  });

  it('uses plugin metadata and mailbox capabilities', () => {
    expect(
      getMailboxProviderPresentation(
        {
          email: 'plugin@example.test',
          provider_name: 'moemail',
          provider_capabilities: { clear_messages: false },
        },
        [{ name: 'moemail', label: 'Moemail', kind: 'plugin' }],
      ),
    ).toEqual({
      name: 'moemail',
      label: 'Moemail',
      kind: 'plugin',
      capabilities: { clear_messages: false },
    });
  });
});

describe('mailbox capabilities', () => {
  it('disables an explicitly unsupported operation', () => {
    expect(isMailboxCapabilityEnabled({ clear_messages: false }, 'clear_messages')).toBe(
      false,
    );
  });

  it('keeps legacy mailboxes compatible when capability metadata is absent', () => {
    expect(isMailboxCapabilityEnabled({}, 'clear_messages')).toBe(true);
  });
});

describe('temp email availability', () => {
  it('blocks generation when the provider is not configured', () => {
    expect(
      resolveTempMailAvailability({
        enabled: true,
        configured: false,
        status: 'not_configured',
      }),
    ).toMatchObject({ state: 'not_configured', enabled: true, canGenerate: false });
  });

  it('allows generation for a ready provider', () => {
    expect(
      resolveTempMailAvailability({ enabled: true, configured: true }),
    ).toMatchObject({ state: 'ready', canGenerate: true });
  });
});

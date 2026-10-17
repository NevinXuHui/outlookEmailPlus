import { describe, expect, it } from 'vitest';
import {
  formatJsonSetting,
  getDomainNames,
  getInitialSettingsTab,
  parseDomainSetting,
  parseObjectSetting,
} from './tempMailSettings';

describe('temporary mail settings helpers', () => {
  it('opens the requested settings tab and rejects unknown tabs', () => {
    expect(getInitialSettingsTab('?tab=temp-mail')).toBe('temp-mail');
    expect(getInitialSettingsTab('?tab=unknown')).toBe('refresh');
  });

  it('round-trips domain and prefix JSON fields', () => {
    const domains = [{ name: 'mail.example.com', enabled: true }];
    expect(parseDomainSetting(formatJsonSetting(domains, []), '域名')).toEqual(
      domains,
    );
    expect(
      parseObjectSetting(
        '{"min_length":1,"max_length":32}',
        '前缀规则',
      ),
    ).toEqual({ min_length: 1, max_length: 32 });
  });

  it('rejects invalid field shapes with actionable messages', () => {
    expect(() => parseDomainSetting('{}', '可用域名')).toThrow(
      '可用域名必须是数组',
    );
    expect(() => parseObjectSetting('[]', '前缀规则')).toThrow(
      '前缀规则必须是对象',
    );
    expect(() => parseObjectSetting('{', '前缀规则')).toThrow(
      '前缀规则必须是合法 JSON',
    );
  });

  it('renders both string and object domain records', () => {
    expect(
      getDomainNames([
        'one.example.com',
        { name: 'two.example.com', enabled: true },
      ]),
    ).toEqual(['one.example.com', 'two.example.com']);
  });
});

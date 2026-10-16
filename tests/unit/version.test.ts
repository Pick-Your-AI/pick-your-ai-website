import { describe, expect, it } from 'vitest';
import { shortSha } from '../../src/lib/version';

describe('shortSha', () => {
  it('shortens a full git sha', () => {
    expect(shortSha('d4bdca479f78439b3b98e7418b37acbaccbaa63c')).toBe('d4bdca4');
  });
  it('leaves non-sha values untouched', () => {
    expect(shortSha('unknown')).toBe('unknown');
  });
});

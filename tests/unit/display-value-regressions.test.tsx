import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatValue, settingsFields, specFields, humanize } from '../../src/lib/schema-fields';
import { rowSubtitle } from '../../src/lib/catalog-view';
import { item } from './scenarios';

describe('contract display values', () => {
  it.each(['__proto__', 'constructor', 'toString'])('renders prototype key %s as text', (value) => {
    render(<div>{formatValue(value, { key: 'region', type: 'string' })}</div>);
    expect(screen.getByText(value)).toBeInTheDocument();
    expect(typeof humanize(value)).toBe('string');
    expect(typeof formatValue(value, { key: 'mode', type: 'enum' })).toBe('string');
  });
  it('preserves free text, whitespace, and case even for words used as enum labels', () => {
    for (const value of ['secret://demo/key', 'us-east-1', 'api', '  Mixed_Case  ']) {
      expect(formatValue(value)).toBe(value);
      expect(formatValue(value, { key: 'region', type: 'string' })).toBe(value);
    }
    expect(formatValue(['us-east-1', 'api'], { key: 'regions', type: 'string-array' })).toBe(
      'us-east-1, api',
    );
    const credential = settingsFields('model_provider').find((f) => f.key === 'credential_ref');
    expect(credential).toBeDefined();
    expect(formatValue('secret://demo/key', credential)).toBe('secret://demo/key');
  });
  it('humanizes only schema enum fields', () => {
    const mode = specFields('deployment_mode').find((f) => f.key === 'mode');
    expect(mode?.type).toBe('enum');
    expect(formatValue('api', mode)).toBe('API');
    expect(formatValue(['api', 'on_prem'], { key: 'modes', type: 'enum-array' })).toBe(
      'API, On-premises',
    );
  });
  it('labels unresolved compute accelerators generically', () => {
    const profile = structuredClone(item('compute_profile', 'nimbus-1x-c24'));
    profile.spec = {
      accelerator_count: 2,
      accelerator_ref: 'demo.accelerator.tpu',
    } as typeof profile.spec;
    expect(rowSubtitle(profile)).toBe('2 accelerators');
  });
});

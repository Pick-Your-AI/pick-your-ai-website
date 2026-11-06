/*
 * The catalog is synthetic because of its item tags, not because it lacks prices. A real sourced
 * model must not be shown as a fictional demo product, and an unverified record must not be
 * silently upgraded to look real.
 */
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEMO_CATALOG } from '../../src/data/fixture/catalog';
import { isSyntheticCatalog } from '../../src/lib/catalog-view';
import { MiniBuild } from '../../src/components/parts';

describe('synthetic catalog labelling follows item provenance', () => {
  it('identifies the built-in fixtures as synthetic', () => {
    expect(isSyntheticCatalog(DEMO_CATALOG.items)).toBe(true);
  });

  it('does not label the real pilot records as synthetic', () => {
    const raw = JSON.parse(
      readFileSync('public/v1/catalog/snapshots/catalog.pilot.open-1', 'utf8'),
    );
    expect(isSyntheticCatalog(raw.items)).toBe(false);
  });

  it('is conservative while no catalog is available yet', () => {
    expect(isSyntheticCatalog(undefined)).toBe(false);
  });

  it('renders a synthetic estimate label only for synthetic records', () => {
    const props = {
      selected: 1,
      required: { done: 1, total: 1 },
      outcome: 'none' as const,
      cost: undefined,
      conflicts: 0,
      unknown: 0,
    };
    const { unmount } = render(
      <MemoryRouter>
        <MiniBuild {...props} synthetic />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/Estimates are synthetic demo data/).length).toBeGreaterThan(0);
    unmount();
    render(
      <MemoryRouter>
        <MiniBuild {...props} synthetic={false} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/Estimates use the configured pricebook/).length).toBeGreaterThan(0);
  });
});

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { MiniBuild } from '../../src/components/parts';
import type { CostEstimate } from '../../src/contracts';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { estimateCost } from '../../src/domain/cost';
import { apiChat, BY_ID, NOW } from './scenarios';

function show(cost: CostEstimate, selected = 5) {
  render(
    <MemoryRouter>
      <MiniBuild
        selected={selected}
        required={{ done: 5, total: 5 }}
        outcome="none"
        conflicts={0}
        unknown={0}
        cost={cost}
      />
    </MemoryRouter>,
  );
  return screen.getByText(/-day cost/).parentElement!;
}

describe('catalog total', () => {
  it('shows Unknown when the selected currency has no rates', () => {
    const build = apiChat();
    build.objectives.currency = 'EUR';
    const estimate = estimateCost(build, BY_ID, DEMO_PRICEBOOK, { now: NOW });
    expect(estimate.coverage).toBe('unknown');
    expect(show(estimate)).toHaveTextContent('Unknown');
    expect(screen.queryByText(/\$0/)).toBeNull();
  });

  it.each(['complete', 'partial'] as const)('formats %s totals in their currency', (coverage) => {
    const estimate = estimateCost(apiChat(), BY_ID, DEMO_PRICEBOOK, { now: NOW });
    const row = show({
      ...estimate,
      coverage,
      currency: 'EUR',
      total: { currency: 'EUR', amount: '12.50' },
    });
    expect(row).toHaveTextContent('€12.50');
    expect(row).not.toHaveTextContent('$');
    expect(row.textContent?.includes('≥')).toBe(coverage === 'partial');
  });

  it('keeps an empty stack distinct from a priced zero', () => {
    const estimate = estimateCost(apiChat(), BY_ID, DEMO_PRICEBOOK, { now: NOW });
    expect(show(estimate, 0)).toHaveTextContent('—');
  });
});

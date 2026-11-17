// Offline synthetic security-review regression. No vendor prices or live eligibility evidence.
import { describe, expect, it } from 'vitest';
import type { Pricebook } from '../../src/contracts';
import { BASELINE_GRAPH, BASELINE_RULESET, validateContract } from '../../src/contracts';
import { createHttpProviders } from '../../src/data/http/providers';
import { DEMO_PRICEBOOK } from '../../src/data/fixture/pricebook';
import { estimateCost } from '../../src/domain/cost';
import { evaluateBuild } from '../../src/domain/evaluator';
import { costShort, itemPrice } from '../../src/lib/item-cost';
import { apiChat, BY_ID, CATALOG, buildWith, item, NOW } from './scenarios';

it('keeps account-conditioned contract prices unknown without eligibility evidence', async () => {
  const book = structuredClone(DEMO_PRICEBOOK);
  book.rates = book.rates.filter((r) => r.catalog_item_id.includes('aurora-large'));
  for (const rate of book.rates) {
    rate.price_type = 'contract';
    rate.conditions = [
      'Synthetic contract price: eligible only for account TEST-ELIGIBLE with signed commitment.',
    ];
  }
  const build = buildWith([['cost_policy', 'hard-cap']], apiChat());
  build.objectives.requests_per_day = 100;
  build.objectives.avg_input_tokens = 100;
  build.objectives.avg_output_tokens = 100;
  build.objectives.monthly_budget_amount = '100.00';
  expect(validateContract('Pricebook', book).ok).toBe(true);
  expect(validateContract('BuildSnapshot', build).ok).toBe(true);
  const providers = createHttpProviders({
    baseUrl: '/v1',
    catalogSnapshotId: CATALOG.id,
    pricebookId: book.id,
    staticMirror: true,
    fetch: async (url) => {
      const data = url.includes('/pricebooks/')
        ? book
        : url.includes('/catalog/')
          ? CATALOG
          : url.includes('/rulesets/')
            ? BASELINE_RULESET
            : BASELINE_GRAPH;
      return new Response(JSON.stringify(data));
    },
  });
  const cost = await providers.pricing.estimate(build);
  const report = await providers.compatibility.evaluate(build, { costEstimate: cost });
  console.log(
    'SYNTHETIC conditional quote result',
    JSON.stringify({
      coverage: cost.coverage,
      total: cost.total,
      budget: report.findings.filter((f) => f.rule_id === 'rule.budget.monthly.cap'),
      warnings: cost.warnings,
    }),
  );
  // v1 has no evidence admitting this build to the named account contract. The safe outcome is
  // unpriced/unknown coverage, preventing an unsupported discount from satisfying the hard cap.
  expect.soft(cost.coverage).toBe('unknown');
  expect.soft(cost.unpriced_selection_ids).toContain('sel_model');
  expect
    .soft(report.findings.find((f) => f.rule_id === 'rule.budget.monthly.cap')?.outcome)
    .toBe('unknown');
});

type Rate = Pricebook['rates'][number];

function syntheticBook(priceType: Rate['price_type'], conditions?: string[]): Pricebook {
  const book = structuredClone(DEMO_PRICEBOOK);
  return {
    ...book,
    rates: book.rates
      .filter((rate) => rate.catalog_item_id === item('model', 'aurora-large').id)
      .map((rate) => ({ ...rate, price_type: priceType, ...(conditions ? { conditions } : {}) })),
  };
}

describe('v1 rate eligibility', () => {
  it.each([
    { priceType: 'contract', conditions: undefined },
    { priceType: 'contract', conditions: [] },
    { priceType: 'contract', conditions: ['Synthetic account commitment required.'] },
    { priceType: 'list', conditions: ['Synthetic minimum volume required.'] },
    { priceType: 'estimate', conditions: ['Synthetic account tier required.'] },
    // Free text is not a machine-readable eligibility policy, even if blank or apparently met.
    { priceType: 'list', conditions: [''] },
    { priceType: 'estimate', conditions: ['   '] },
    { priceType: 'list', conditions: ['USD only'] },
  ] satisfies { priceType: Rate['price_type']; conditions: string[] | undefined }[])(
    'leaves $priceType with conditions=$conditions unpriced',
    ({ priceType, conditions }) => {
      const book = syntheticBook(priceType, conditions);
      // Verification of a recorded rate is not evidence of this build's eligibility.
      for (const rate of book.rates) rate.provenance.verification_status = 'verified';
      const build = apiChat();
      expect(build.policy?.allow_unverified_catalog_items).toBe(true);
      expect(validateContract('Pricebook', book).ok).toBe(true);
      const original = structuredClone(book);
      const cost = estimateCost(build, BY_ID, book, { now: NOW });
      expect(validateContract('CostEstimate', cost).ok).toBe(true);
      expect(cost.coverage).toBe('unknown');
      expect(cost.unpriced_selection_ids).toEqual(['sel_model']);
      expect(cost.line_items).toEqual([]);
      expect(costShort(cost).text).toBe('Unknown');
      expect(itemPrice(item('model', 'aurora-large'), build, BY_ID, book)).toMatchObject({
        amount: null,
        label: 'Unknown',
        note: 'No applicable rate',
      });
      for (const rate of book.rates) {
        expect(cost.warnings).toContain(
          `sel_model: rate ${rate.id} not applicable (${priceType === 'contract' ? 'contract eligibility' : 'rate conditions'} cannot be established from v1 build evidence).`,
        );
      }
      expect(book).toEqual(original);
    },
  );

  it.each([
    { priceType: 'list', conditions: undefined },
    { priceType: 'list', conditions: [] },
    { priceType: 'estimate', conditions: undefined },
    { priceType: 'estimate', conditions: [] },
  ] satisfies { priceType: Rate['price_type']; conditions: string[] | undefined }[])(
    'still prices unconditional $priceType with conditions=$conditions',
    ({ priceType, conditions }) => {
      const book = syntheticBook(priceType, conditions);
      expect(validateContract('Pricebook', book).ok).toBe(true);
      const cost = estimateCost(apiChat(), BY_ID, book, { now: NOW });
      expect(cost.coverage).toBe('complete');
      expect(cost.unpriced_selection_ids).toEqual([]);
      expect(cost.line_items.map((line) => line.meter)).toEqual([
        'input_tokens_1m',
        'output_tokens_1m',
      ]);
      expect(cost.total.amount).toBe('324.00');
    },
  );

  it('retains only the applicable meter as a lower bound and keeps the budget unknown', () => {
    const build = buildWith([['cost_policy', 'hard-cap']], apiChat());
    build.objectives.monthly_budget_amount = '1000.00';
    const book = syntheticBook('list');
    book.rates[1]!.conditions = ['Synthetic account commitment required.'];
    expect(validateContract('Pricebook', book).ok).toBe(true);
    const cost = estimateCost(build, BY_ID, book, { now: NOW });
    expect(cost.coverage).toBe('partial');
    expect(cost.unpriced_selection_ids).toEqual(['sel_model']);
    expect(cost.line_items.map((line) => line.meter)).toEqual(['input_tokens_1m']);
    expect(cost.total.amount).toBe('108.00');
    expect(costShort(cost)).toMatchObject({ text: '≥ $108.00', complete: false });
    expect(itemPrice(item('model', 'aurora-large'), build, BY_ID, book)).toMatchObject({
      amount: '108.00',
      label: '≥ $108',
      partial: true,
    });
    const report = evaluateBuild({
      build,
      catalog: CATALOG,
      ruleset: BASELINE_RULESET,
      costEstimate: cost,
      evaluatedAt: NOW,
    });
    expect(
      report.findings.find((finding) => finding.rule_id === 'rule.budget.monthly.cap')?.outcome,
    ).toBe('unknown');
  });
});

describe('simultaneously applicable quote conflicts', () => {
  it('leaves overlapping global and matching-region quotes unpriced without a precedence policy', () => {
    const book = syntheticBook('list');
    book.rates.push({
      ...book.rates[0]!,
      id: 'rate.test.regional-input',
      region: 'us-east-demo',
      unit_price: { amount: '1.00', currency: 'USD' },
    });
    expect(validateContract('Pricebook', book).ok).toBe(true);
    const cost = estimateCost(apiChat(), BY_ID, book, { now: NOW });
    expect(cost.coverage).toBe('partial');
    expect(cost.unpriced_selection_ids).toEqual(['sel_model']);
    expect(cost.line_items.map((line) => line.meter)).toEqual(['output_tokens_1m']);
    expect(cost.total.amount).toBe('216.00');
  });

  it.each([undefined, 'us-east-demo'])(
    'leaves conflicting input quotes in region %s unpriced while retaining the output meter',
    (region) => {
      const book = syntheticBook('list');
      const input = book.rates[0]!;
      if (region !== undefined) input.region = region;
      book.rates.push({
        ...input,
        id: 'rate.test.alternative-input',
        unit_price: { amount: '1.00', currency: 'USD' },
      });
      expect(validateContract('Pricebook', book).ok).toBe(true);
      const cost = estimateCost(apiChat(), BY_ID, book, { now: NOW });
      expect(cost.coverage).toBe('partial');
      expect(cost.unpriced_selection_ids).toEqual(['sel_model']);
      expect(cost.line_items.map((line) => line.meter)).toEqual(['output_tokens_1m']);
      expect(cost.total.amount).toBe('216.00');
      expect(cost.warnings.some((warning) => warning.includes('multiple applicable rates'))).toBe(
        true,
      );
    },
  );

  it('keeps an otherwise applicable input quote when its alternative is expired or conditional', () => {
    const book = syntheticBook('list');
    book.rates.push(
      {
        ...book.rates[0]!,
        id: 'rate.test.expired-input',
        valid_until: '2026-10-02T00:00:00Z',
      },
      {
        ...book.rates[0]!,
        id: 'rate.test.conditional-input',
        conditions: ['Synthetic commitment required.'],
      },
    );
    expect(validateContract('Pricebook', book).ok).toBe(true);
    const cost = estimateCost(apiChat(), BY_ID, book, { now: NOW });
    // The original inapplicable-rate handling remains conservative about overall coverage.
    expect(cost.coverage).toBe('partial');
    expect(cost.line_items.map((line) => line.meter)).toEqual([
      'input_tokens_1m',
      'output_tokens_1m',
    ]);
    expect(cost.total.amount).toBe('324.00');
    expect(cost.warnings.some((warning) => warning.includes('multiple applicable rates'))).toBe(
      false,
    );
  });
});

describe('per-item pricing wording', () => {
  it('describes missing configured rates without asserting demo provenance', () => {
    const book = { ...syntheticBook('contract'), id: 'prices.test.configured' };
    const build = apiChat();
    build.locks.pricebook_id = book.id;
    expect(itemPrice(item('model', 'aurora-large'), build, BY_ID, book)).toMatchObject({
      label: 'Unknown',
      note: 'No applicable rate',
    });
  });

  it('describes admitted unverified free billing as catalog data', () => {
    const book = { ...syntheticBook('estimate'), id: 'prices.test.configured' };
    const build = apiChat();
    build.locks.pricebook_id = book.id;
    const freeItem = { ...item('integration', 'webhook'), id: 'test.integration.free' };
    const catalog = new Map(BY_ID).set(freeItem.id, freeItem);
    expect(itemPrice(freeItem, build, catalog, book)).toMatchObject({
      label: 'Included*',
      note: 'Free or included billing (unverified catalog data; the build policy allows unverified items).',
    });
  });
});

// @vitest-environment node
import { readFileSync } from 'node:fs';
import { Script, runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Picks = Record<string, string | null>;
type Workload = { inputTokens: string; outputTokens: string };
type Part = {
  id: string;
  name: string;
  cost?: number | null;
  omitted?: boolean;
  usage?: { inputCentsPerMillion: number; outputCentsPerMillion: number };
  rec?: number;
};
type Price = {
  status: 'priced' | 'unpriced' | 'missing' | 'omitted';
  cents: number | null;
  label: string;
  reason: string;
};
type Finding = {
  id: string;
  outcome: 'pass' | 'fail' | 'unknown' | 'skipped';
  severity: 'error' | 'warning' | 'info';
  reason?: string;
  message: string;
};
type Summary = {
  priced: Price[];
  unpriced: (Price & { id: string })[];
  missing: Price[];
  omitted: Price[];
  subtotalCents: number | null;
};
type Concept = {
  categories: { id: string; kind: string; tag: string }[];
  components: Record<string, Part[]>;
  templates: Record<'support' | 'local' | 'rag' | 'automation', { name: string; picks: Picks }>;
  lookup: (category: string, id: string) => Part;
  emptyWorkload: () => Workload;
  copyWorkload: (value: unknown) => Workload;
  parseWorkload: (value: unknown) => { inputTokens: bigint; outputTokens: bigint } | null;
  priceForPart: (part: unknown, workload?: Workload) => Price;
  priceSummary: (picks: Picks, workload?: Workload) => Summary;
  issuesFor: (picks: Picks) => Finding[];
  checkSummary: (findings: Finding[]) => {
    title: string;
    fail: number;
    unknown: number;
    skipped: number;
    incomplete: number;
  };
  coverageFor: (picks: Picks) => { categories: string[]; label: string }[];
  demoExport: (state: { name: string; picks: Picks; workload?: Workload }) => {
    pricing: { pricedSubtotalUSD: string | null; unpricedItems: unknown[] };
    workload: Workload;
    demoRuleFindings: Finding[];
    uncoveredLayerPairs: unknown[];
  };
};

const html = readFileSync(
  new URL('../../docs/design/pickyourai-complete.html', import.meta.url),
  'utf8',
);
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('The standalone concept inline script is missing');

// Run the actual concept model in a fresh VM, before its DOM bindings. Include
// its actual private-export function too; the test defines no pricing or rules.
function concept(): Concept {
  const prefix = script!.slice(0, script!.indexOf('    function scrollToBuilder()'));
  const exporter = script!.slice(
    script!.indexOf('    function demoExport('),
    script!.indexOf('    function currentJson()'),
  );
  return runInNewContext(
    prefix +
      exporter +
      ';return {categories,components,templates,lookup,emptyWorkload,copyWorkload,parseWorkload,priceForPart,priceSummary,issuesFor,checkSummary,coverageFor,demoExport};})();',
  ) as Concept;
}

describe('standalone concept contract presentation', () => {
  it('parses the complete inline script before testing the extracted model', () => {
    expect(() => new Script(script!)).not.toThrow();
  });

  it('has nine layers with the four distinct canonical T6 kinds', () => {
    const c = concept();
    expect(c.categories).toHaveLength(9);
    expect(c.categories.filter((x) => x.tag.startsWith('T6 /')).map((x) => x.kind)).toEqual([
      'guardrail',
      'evaluation_suite',
      'monitoring_stack',
      'deployment_target',
    ]);
    expect(new Set(c.categories.map((x) => x.id)).size).toBe(9);
  });

  it('resolves every template selection, including guardrails and evaluation', () => {
    const c = concept();
    for (const template of Object.values(c.templates)) {
      expect(Object.keys(template.picks).sort()).toEqual(c.categories.map((x) => x.id).sort());
      for (const category of c.categories)
        expect(c.lookup(category.id, template.picks[category.id]!)).toBeDefined();
    }
  });

  it('excludes the API and every unpriced selected item from the default subtotal', () => {
    const c = concept(),
      summary = c.priceSummary(c.templates.support.picks);
    expect(summary.subtotalCents).toBe(8000);
    expect(summary.priced).toHaveLength(3);
    expect(summary.unpriced.map((x) => x.id)).toEqual([
      'gpt41',
      'provider',
      'managed',
      'langgraph',
      'policy-demo',
      'regression-demo',
    ]);
    expect(summary.unpriced.every((x) => x.cents === null && x.label === 'Unpriced')).toBe(true);
    expect(
      summary.priced.length +
        summary.unpriced.length +
        summary.missing.length +
        summary.omitted.length,
    ).toBe(c.categories.length);
  });

  it('prices model usage only from two explicit token counts', () => {
    const c = concept(),
      workload = { inputTokens: '1000000', outputTokens: '1000000' };
    expect(c.priceForPart(c.lookup('model', 'gpt41'), workload).cents).toBe(1500);
    expect(c.priceSummary(c.templates.support.picks, workload).subtotalCents).toBe(9500);
    expect(c.priceSummary(c.templates.support.picks, workload).unpriced).toHaveLength(5);
  });

  it.each([
    { inputTokens: '', outputTokens: '' },
    { inputTokens: '100', outputTokens: '' },
    { inputTokens: '', outputTokens: '100' },
    { inputTokens: '-1', outputTokens: '0' },
    { inputTokens: '1.5', outputTokens: '0' },
    { inputTokens: '1e3', outputTokens: '0' },
    { inputTokens: '1000000001', outputTokens: '0' },
    { inputTokens: ' 1', outputTokens: '0' },
  ])('withholds API pricing for unsupported or missing workload %j', (workload) => {
    const c = concept();
    expect(c.parseWorkload(workload)).toBeNull();
    expect(c.priceForPart(c.lookup('model', 'gpt41'), workload)).toMatchObject({
      status: 'unpriced',
      cents: null,
    });
    expect(c.priceSummary(c.templates.support.picks, workload).subtotalCents).toBe(8000);
  });

  it('keeps explicit zero usage distinct from missing usage', () => {
    const c = concept();
    expect(
      c.priceForPart(c.lookup('model', 'gpt41'), { inputTokens: '0', outputTokens: '0' }),
    ).toMatchObject({ status: 'priced', cents: 0, label: '$0.00' });
    expect(c.priceForPart(c.lookup('model', 'gpt41'), c.emptyWorkload())).toMatchObject({
      status: 'unpriced',
      cents: null,
    });
  });

  it('admits the declared upper token bound exactly', () => {
    const c = concept(),
      workload = { inputTokens: '1000000000', outputTokens: '1000000000' };
    expect(c.parseWorkload(workload)).toEqual({
      inputTokens: 1000000000n,
      outputTokens: 1000000000n,
    });
    expect(c.priceForPart(c.lookup('model', 'gpt41'), workload).cents).toBe(1500000);
  });

  it('rounds combined usage once per model line, half-up at one cent', () => {
    const c = concept(),
      rate = {
        id: 'rounding-control',
        name: 'Synthetic',
        usage: { inputCentsPerMillion: 1, outputCentsPerMillion: 1 },
      };
    expect(c.priceForPart(rate, { inputTokens: '249999', outputTokens: '250000' }).cents).toBe(0);
    expect(c.priceForPart(rate, { inputTokens: '250000', outputTokens: '250000' }).cents).toBe(1);
    expect(c.priceForPart(rate, { inputTokens: '500000', outputTokens: '500000' }).cents).toBe(1);
  });

  it('does not coerce unsupported rates or missing fixed amounts into a price', () => {
    const c = concept(),
      workload = { inputTokens: '1', outputTokens: '1' };
    for (const cost of [undefined, null, '0', -1, NaN, Infinity, 0.001])
      expect(c.priceForPart({ cost }, workload)).toMatchObject({ status: 'unpriced', cents: null });
    expect(c.priceForPart({ cost: 0 })).toMatchObject({ status: 'priced', cents: 0 });
    expect(
      c.priceForPart({ usage: { inputCentsPerMillion: -1, outputCentsPerMillion: 1 } }, workload),
    ).toMatchObject({ status: 'unpriced', cents: null });
  });

  it('keeps inactive, missing and unpriced selections distinct', () => {
    const c = concept();
    expect(c.priceForPart(undefined).status).toBe('missing');
    expect(c.priceForPart(c.lookup('knowledge', 'none-knowledge')).status).toBe('omitted');
    expect(c.priceForPart(c.lookup('model', 'qwen32')).status).toBe('unpriced');
    expect(c.priceSummary({}).subtotalCents).toBeNull();
    expect(c.priceSummary({ model: 'qwen32' }).subtotalCents).toBeNull();
  });

  it('makes every rule with a missing input skipped and Incomplete', () => {
    const c = concept(),
      findings = c.issuesFor({});
    expect(findings).toHaveLength(10);
    expect(
      findings.every(
        (x) =>
          x.outcome === 'skipped' &&
          x.reason === 'missing_selection' &&
          x.message.startsWith('Incomplete:'),
      ),
    ).toBe(true);
    expect(c.checkSummary(findings)).toMatchObject({
      title: 'Incomplete',
      skipped: 10,
      unknown: 0,
    });
  });

  it('does not treat an invalid component ID as a selected input', () => {
    const c = concept(),
      findings = c.issuesFor({ ...c.templates.support.picks, model: 'foreign-model' });
    expect(findings.filter((x) => x.reason === 'missing_selection')).toHaveLength(4);
    expect(c.priceSummary({ model: 'foreign-model' }).missing).toHaveLength(9);
  });

  it('retains no-failure wording alongside actual unknown and nonapplicable outcomes', () => {
    const c = concept(),
      findings = c.issuesFor(c.templates.support.picks);
    expect(c.checkSummary(findings)).toMatchObject({
      title: 'No failing checks',
      fail: 0,
      unknown: 2,
      skipped: 2,
      incomplete: 0,
    });
    expect(
      findings
        .filter((x) => x.outcome === 'unknown')
        .every((x) => /Eligible.*evidence is missing/i.test(x.message)),
    ).toBe(true);
    expect(
      findings.filter((x) => x.outcome === 'skipped').every((x) => x.reason === 'not_applicable'),
    ).toBe(true);
  });

  it('uses fail outcome independently of warning severity', () => {
    const c = concept(),
      findings = c.issuesFor({ ...c.templates.support.picks, observability: 'none-observe' });
    expect(findings.find((x) => x.id === 'demo.monitoring.present')).toMatchObject({
      outcome: 'fail',
      severity: 'warning',
    });
    expect(c.checkSummary(findings).title).toBe('1 failing check');
  });

  it('retains explicit path contradiction instead of converting it to missing evidence', () => {
    const c = concept(),
      findings = c.issuesFor({ ...c.templates.support.picks, inference: 'vllm' });
    expect(findings.find((x) => x.id === 'demo.model.serving')).toMatchObject({
      outcome: 'fail',
      severity: 'error',
    });
    expect(findings.find((x) => x.id === 'demo.guardrail.evidence')).toMatchObject({
      outcome: 'unknown',
      severity: 'error',
    });
  });

  it('does not infer capacity from a local model or GPU label', () => {
    const c = concept(),
      findings = c.issuesFor(c.templates.local.picks);
    expect(findings.find((x) => x.id === 'demo.capacity.evidence')).toMatchObject({
      outcome: 'unknown',
      severity: 'error',
    });
  });

  it('keeps core T6 plans independent of optional retrieval breadth', () => {
    const c = concept(),
      findings = c.issuesFor({
        ...c.templates.support.picks,
        knowledge: 'none-knowledge',
        guardrail: 'none-guardrail',
        evaluation: 'none-evaluation',
      });
    expect(findings.find((x) => x.id === 'demo.guardrail.configured')?.outcome).toBe('fail');
    expect(findings.find((x) => x.id === 'demo.evaluation.configured')?.outcome).toBe('fail');
    expect(findings.find((x) => x.id === 'demo.guardrail.evidence')).toMatchObject({
      outcome: 'skipped',
      reason: 'not_applicable',
    });
    expect(findings.find((x) => x.id === 'demo.retrieval.persistence')).toMatchObject({
      outcome: 'skipped',
      reason: 'not_applicable',
    });
  });

  it('keeps uncovered combinations outside all four outcome classes', () => {
    const c = concept(),
      picks = c.templates.support.picks,
      before = c.issuesFor(picks),
      gaps = c.coverageFor(picks);
    expect(gaps).toHaveLength(32);
    expect(gaps.some((x) => x.categories.join('/') === 'model/agent')).toBe(true);
    expect(gaps.some((x) => x.categories.join('/') === 'model/inference')).toBe(false);
    expect(c.issuesFor(picks)).toEqual(before);
    expect(before).toHaveLength(10);
  });

  it('exports the same price states and exact workload without asserting a full total', () => {
    const c = concept(),
      workload = { inputTokens: '000010', outputTokens: '000001' };
    const exported = c.demoExport({ name: 'Fixture', picks: c.templates.support.picks, workload });
    expect(exported.workload).toEqual(workload);
    expect(exported.pricing.pricedSubtotalUSD).toBe('80.00');
    expect(exported.pricing.unpricedItems).toHaveLength(5);
    expect(exported.demoRuleFindings).toEqual(c.issuesFor(c.templates.support.picks));
    expect(exported.uncoveredLayerPairs).toEqual(c.coverageFor(c.templates.support.picks));
    expect(exported).not.toHaveProperty('illustrativeMonthlyTotalUSD');
  });

  it('treats a legacy saved build without workload as explicitly unpriced', () => {
    const c = concept(),
      exported = c.demoExport({ name: 'Legacy', picks: c.templates.support.picks });
    expect(exported.workload).toEqual({ inputTokens: '', outputTokens: '' });
    expect(exported.pricing.pricedSubtotalUSD).toBe('80.00');
    expect(exported.pricing.unpricedItems).toHaveLength(6);
    expect(c.copyWorkload({ inputTokens: 1, outputTokens: null })).toEqual({
      inputTokens: '',
      outputTokens: '',
    });
  });
});

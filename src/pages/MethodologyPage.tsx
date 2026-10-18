/*
 * Methodology. Structure, copy and class names are ported from the approved design mock
 * (`docs/design/pickyourai-complete.html`, `#methodologyScreen`, plus `rulesLibrary`/`renderRules` in its
 * script). The mock's example rules and IF/THEN snippets are design placeholders: every rule shown
 * here is read from the vendored baseline ruleset and its condition is rendered from the contract's
 * own expression AST, so nothing about a rule is invented by the website.
 */
import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  BASELINE_GRAPH,
  BASELINE_RULESET,
  CONTRACT_PROVENANCE,
  KIND_LABELS,
  type ComponentKind,
  type Expression,
  type Ruleset,
} from '../contracts';
import { Icon } from '../components/icon';
import { SeverityLabel } from '../components/status';
import { useData } from '../app/data-context';

const RESEARCH_REPO = 'https://github.com/Pick-Your-AI/pick-your-ai-research';
const issue = (n: number) => `${RESEARCH_REPO}/issues/${n}`;
const contractTree = `${RESEARCH_REPO}/tree/${CONTRACT_PROVENANCE.sourceSha}/contracts/v1`;

const RULES = BASELINE_RULESET.rules;
const EDGES = BASELINE_GRAPH.edges;

const kindLabel = (kind: string) => KIND_LABELS[kind as ComponentKind] ?? kind;

const ON_UNKNOWN_LABELS: Record<string, string> = {
  block: 'block',
  review: 'review',
  defer: 'defer',
};

const ACTIVATION_LABELS: Record<string, string> = {
  always: 'always',
  self_hosted: 'self-hosted',
  non_api: 'mode is not pure API',
  rag_enabled: 'RAG enabled',
  agents_enabled: 'agents enabled',
  fine_tuning_enabled: 'fine-tuning enabled',
  if_selected: 'if selected',
  production_only: 'production target',
};

/** The activations that actually occur in the vendored graph, in first-seen order. */
const ACTIVATIONS = [...new Set(EDGES.map((edge) => edge.activation))].map(
  (activation) => ACTIVATION_LABELS[activation] ?? activation,
);

/** Distinct contract values, so the copy cannot drift from the vendored ruleset. */
const SEVERITIES = [...new Set(RULES.map((rule) => rule.severity))];
const ON_UNKNOWN = [...new Set(RULES.map((rule) => rule.on_unknown))].map(
  (value) => ON_UNKNOWN_LABELS[value] ?? value,
);

type Rule = Ruleset['rules'][number];
/** One side of a comparison: a literal, a metric or a reference into the build/catalog. */
type Operand = Extract<Expression, { op: 'exists' }>['value'];
type ComparisonOp = Exclude<Expression['op'], 'exists' | 'all' | 'any' | 'not' | 'implies'>;

const OP_TEXT: Record<ComparisonOp, string> = {
  eq: '=',
  ne: '≠',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  in: 'in',
  contains: 'contains',
  subset_of: '⊆',
  intersects: 'intersects',
};

/* ---------------------------------------------------------------------------------------------
 * Rule conditions, rendered from the contract's expression AST. The mock showed hand-written
 * "IF … THEN …" examples; the same block here shows the real published condition instead.
 * ------------------------------------------------------------------------------------------- */

function operandText(value: Operand): string {
  if ('literal' in value) {
    return typeof value.literal === 'string'
      ? `"${value.literal}"`
      : (JSON.stringify(value.literal) ?? 'null');
  }
  if ('metric' in value) return value.metric;
  const pointer = value.ref.pointer.replace(/\//g, '.');
  if (value.ref.scope === 'catalog') return `catalog.${value.ref.kind ?? 'item'}${pointer}`;
  if (value.ref.scope === 'build') return `build${pointer}`;
  const role = value.ref.role && value.ref.role !== 'primary' ? `.${value.ref.role}` : '';
  return `${value.ref.kind ?? 'selection'}${role}${pointer}`;
}

const isTrueLiteral = (value: Operand) => 'literal' in value && value.literal === true;

/** `all`/`any` share an `op` union, so a predicate is needed for the compiler to narrow them out. */
const isGroup = (
  expression: Expression,
): expression is Extract<Expression, { args: Expression[] }> =>
  expression.op === 'all' || expression.op === 'any';

function inlineExpr(expression: Expression): string {
  if (expression.op === 'exists') return `exists(${operandText(expression.value)})`;
  if (expression.op === 'not') return `not(${inlineExpr(expression.arg)})`;
  if (isGroup(expression)) {
    return `${expression.op}(${expression.args.map(inlineExpr).join(', ')})`;
  }
  if (expression.op === 'implies') {
    return `implies(${inlineExpr(expression.if)}, ${inlineExpr(expression.then)})`;
  }
  if (isTrueLiteral(expression.left) && isTrueLiteral(expression.right)) return 'always';
  return `${operandText(expression.left)} ${OP_TEXT[expression.op]} ${operandText(expression.right)}`;
}

/** A top-level `all` reads better as one clause per line, like a conjunction of requirements. */
function clauses(expression: Expression): string[] {
  return expression.op === 'all' ? expression.args.map(inlineExpr) : [inlineExpr(expression)];
}

function conditionLines(rule: Rule): string[] {
  const when = clauses(rule.applies_when);
  const then = clauses(rule.assert);
  const lines = when.map((clause, index) => `${index === 0 ? 'IF   ' : 'AND  '}${clause}`);
  then.forEach((clause, index) => lines.push(`${index === 0 ? 'THEN ' : 'AND  '}${clause}`));
  return lines;
}

/** Short label for the rule list, derived from the contract rule id (`rule.model.context.fit`). */
const TITLE_WORDS: Record<string, string> = {
  api: 'API',
  acl: 'ACL',
  mcp: 'MCP',
  pii: 'PII',
  rag: 'RAG',
  selfhost: 'Self-host',
  sku: 'SKU',
  vram: 'VRAM',
};

function ruleTitle(id: string): string {
  return id
    .replace(/^rule\./, '')
    .split('.')
    .map((token, index) => {
      const word = TITLE_WORDS[token];
      if (word) return word;
      return index === 0 ? token.charAt(0).toUpperCase() + token.slice(1) : token;
    })
    .join(' ');
}

/**
 * Six rules from the published ruleset, chosen to show the shapes the engine actually evaluates:
 * required selections, a numeric capacity check, mode-gated infrastructure, a cross-selection
 * equality, a production gate and a cost cap. Looked up by id so the page follows the contract.
 */
const FEATURED_RULE_IDS = [
  'rule.required.foundation',
  'rule.model.context.fit',
  'rule.selfhost.requires.infrastructure',
  'rule.embedding.dimension',
  'rule.production.gates',
  'rule.budget.monthly.cap',
];

const RULES_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));
const FEATURED_RULES = FEATURED_RULE_IDS.map((id) => RULES_BY_ID.get(id)).filter(
  (rule): rule is Rule => rule !== undefined,
);

const SECTIONS = [
  { id: 'compatibility', label: 'Compatibility outcomes' },
  { id: 'invalidation', label: 'Rules & dependencies' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'evidence', label: 'Evidence & freshness' },
  { id: 'data', label: 'Data & demo mode' },
  { id: 'limits', label: 'Known limitations' },
];

function IssueLink({ n, children }: { n: number; children?: ReactNode }) {
  return (
    <a className="text-link" href={issue(n)}>
      {children ?? `research issue #${n}`}
    </a>
  );
}

/* ---------------------------------------------------------------------------------- chapters -- */

function Compatibility() {
  return (
    <section className="method-chapter" id="compatibility">
      <div className="chapter-index">01 / OUTCOMES</div>
      <h2>Four states. No hand-waving.</h2>
      <p>
        Compatibility is an evidence-backed claim, not a badge assigned to every combination. Each
        published rule produces exactly one outcome for your build, and the outcome is separate from
        the rule&apos;s severity: the outcome says what happened, the severity says how much it
        matters. Both are always shown with an icon and a word, never colour alone.
      </p>
      <div className="outcome-grid">
        <div className="outcome-card pass">
          <span>✓ PASS</span>
          <strong>The rule applied and held</strong>
          <p>
            Every check in the rule was satisfied for this revision. A pass means no published rule
            objected — it does not certify real-world performance, answer quality or deployment
            readiness.
          </p>
        </div>
        <div className="outcome-card fail">
          <span>✕ FAIL</span>
          <strong>A condition is proven false</strong>
          <p>
            The rule applied and its check failed, for example a model that cannot be served in the
            selected deployment mode, or an embedding dimension that does not match the index.
          </p>
        </div>
        <div className="outcome-card warn">
          <span>! ADVISORY</span>
          <strong>Warning severity, not an outcome</strong>
          <p>
            Severity is its own dimension: error-severity findings block, warning-severity findings
            need review, and info-severity findings are advisory. A warning can accompany a pass, a
            fail or an unknown outcome.
          </p>
        </div>
        <div className="outcome-card unknown">
          <span>? UNKNOWN</span>
          <strong>Not enough evidence</strong>
          <p>
            The check could not be decided — a value, a price or a capacity estimate is missing.
            Missing evidence must never be shown as a confirmed match, and unknown is never promoted
            to pass.
          </p>
        </div>
      </div>
      <p>
        The fourth outcome is <strong>skipped</strong>: the rule&apos;s condition is proven false,
        so the rule does not apply — GPU checks in an API-only stack, for example. Skipped is not a
        statement of compatibility either. If the condition itself cannot be decided, the outcome is
        unknown, never skipped and never pass.
      </p>
      <div className="limitation-list">
        <div>
          <span>01</span>
          <p>
            <strong>all(F, U) = F</strong> and <strong>all(T, U) = U</strong> — one false check
            fails the rule; otherwise one unknown check makes it unknown.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>any(T, U) = T</strong> and <strong>any(F, U) = U</strong> — one true check
            passes the rule; otherwise an unknown check leaves it unknown.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>not(U) = U</strong> — negation cannot turn missing information into a definite
            answer.
          </p>
        </div>
        <div>
          <span>04</span>
          <p>
            <strong>Unknown condition, unknown outcome.</strong> A rule that cannot decide whether
            it applies is never reported as skipped or as pass.
          </p>
        </div>
      </div>
      <p>
        Compatibility is also not deployment readiness. A build with no rule failures is compatible
        for that revision and that evidence only; readiness additionally needs measured quality
        runs, a complete price quote, security review and human approval, so the site never reports
        a stack as &ldquo;ready&rdquo; from compatibility alone.
      </p>
    </section>
  );
}

function RuleBrowser() {
  const [activeId, setActiveId] = useState(FEATURED_RULES[0]?.id ?? '');
  if (!FEATURED_RULES.length) return null;
  const active = FEATURED_RULES.find((rule) => rule.id === activeId) ?? FEATURED_RULES[0];
  const lines = active ? conditionLines(active) : [];
  return (
    <div className="rules-browser">
      <div className="rule-titles">
        {FEATURED_RULES.map((rule) => (
          <button
            aria-controls="ruleDetail"
            aria-pressed={rule.id === activeId}
            className={rule.id === activeId ? 'on' : undefined}
            key={rule.id}
            type="button"
            onClick={() => setActiveId(rule.id)}
          >
            {ruleTitle(rule.id)}
          </button>
        ))}
      </div>
      <div aria-live="polite" className="rule-detail" id="ruleDetail" role="region">
        {active ? (
          <>
            <div className="rule-id">{active.id}</div>
            <h3>{active.message}</h3>
            <p>{active.remediation}</p>
            <p>
              <SeverityLabel severity={active.severity} /> · on unknown:{' '}
              {ON_UNKNOWN_LABELS[active.on_unknown] ?? active.on_unknown} · affects{' '}
              {active.affected_kinds.map(kindLabel).join(', ')}
            </p>
            <div className="rule-example">
              {lines.map((line, index) => (
                <Fragment key={line}>
                  {index > 0 ? <br /> : null}
                  {line}
                </Fragment>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Invalidation() {
  return (
    <section className="method-chapter" id="invalidation">
      <div className="chapter-index">02 / RULE ENGINE</div>
      <h2>Dependencies, not opinions.</h2>
      <p>
        An AI stack is a constraint graph, not a linear wizard. The baseline graph has{' '}
        <strong className="mono">{EDGES.length}</strong> directed edges between component kinds, and
        the baseline ruleset publishes <strong className="mono">{RULES.length}</strong> rules. The
        website applies them exactly as vendored — it does not add, change or remove a rule.
      </p>
      <p>
        Each choice changes which downstream choices make sense. Pick a rule to read its real
        condition, severity and the component kinds it touches, instead of trusting a hidden score.
      </p>
      <RuleBrowser />
      <p>
        When you change a selection, the builder follows active edges in <strong>both</strong>{' '}
        directions — to what depends on the change and to what it depends on — and re-checks every
        affected rule. Edges carry an activation condition ({ACTIVATIONS.join(', ')}), checked
        before and after the change, so a mode switch that turns a whole tier on or off is caught.
        If an edge&apos;s activation itself is unknown, the edge is treated as active.
      </p>
      <div className="limitation-list">
        <div>
          <span>01</span>
          <p>
            <strong>Immutable revisions.</strong> Every change creates a new revision. Earlier
            results, estimates and quotes are marked stale, not rewritten.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Nothing removed silently.</strong> The builder never drops your selections or
            downgrades a model, context or hardware choice behind your back; it highlights what to
            revisit.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Undecidable means blocked.</strong> Every rule in this ruleset is{' '}
            {SEVERITIES.join('/')} severity and resolves an undecidable check as{' '}
            {ON_UNKNOWN.join('/')}: the build is not reported as compatible until evidence exists.
          </p>
        </div>
      </div>
      <Link className="inline-cta" to="/builder">
        Try these checks in the builder <Icon name="arrow-right" />
      </Link>
      <p>
        Ruleset <span className="mono">{BASELINE_RULESET.id}</span> version{' '}
        <span className="mono">{BASELINE_RULESET.version}</span> and graph{' '}
        <span className="mono">{BASELINE_GRAPH.id}</span> revision{' '}
        <span className="mono">{BASELINE_GRAPH.revision}</span> are research proposals under
        governance (<IssueLink n={40} />
        ). The complete list, including every edge rationale, is published in the vendored{' '}
        <a className="text-link" href={contractTree}>
          contracts/v1 at {CONTRACT_PROVENANCE.sourceSha.slice(0, 7)}
        </a>
        .
      </p>
    </section>
  );
}

function Pricing() {
  return (
    <section className="method-chapter" id="pricing">
      <div className="chapter-index">03 / COST &amp; EVIDENCE</div>
      <h2>Show the math. Show the gaps.</h2>
      <div className="method-split">
        <div>
          <h3>Illustrative cost baseline</h3>
          <p>
            The amounts in this preview are synthetic monthly scenario placeholders. They are not
            vendor quotes, and they do not measure token consumption, throughput, reserved capacity,
            egress or licensing.
          </p>
          <p>
            Amounts are decimal strings with a currency, for example{' '}
            <span className="mono">{'{ "amount": "12.50", "currency": "USD" }'}</span>. A line
            amount is quantity × unit rate and is computed without floating-point rounding, so every
            figure is an estimate and never a quote.
          </p>
          <p>
            A component with <strong>unknown billing is not free</strong>. It stays unpriced and the
            estimate&apos;s coverage drops. Coverage is <strong>complete</strong> only when every
            billable selection has a current, applicable rate; otherwise it is{' '}
            <strong>partial</strong> or <strong>unknown</strong>, and a budget check cannot pass on
            partial or stale coverage. No currency conversion is applied, so amounts in different
            currencies are never summed.
          </p>
          <p>
            The in-browser estimator is a provisional preview; the authoritative pricing model is{' '}
            <IssueLink n={39} />.
          </p>
        </div>
        <div className="formula-card">
          <span>ESTIMATION FRAMEWORK</span>
          <div className="formula-line">
            Line amount <b>= quantity × rate</b>
          </div>
          <div className="formula-line">
            Unknown billing <b>stays unpriced</b>
          </div>
          <div className="formula-line">
            Coverage <b>complete / partial / unknown</b>
          </div>
          <div className="formula-total">
            Scenario total <span>= priced lines, one currency</span>
          </div>
          <small>
            Unpriced components are marked <b>Unknown</b>, never silently counted as zero, and
            amounts in another currency are not converted.
          </small>
        </div>
      </div>
      <div className="evidence-strip">
        <span>DECIMAL STRINGS</span>
        <span>VERSIONED PRICEBOOK</span>
        <span>EXPLICIT COVERAGE</span>
        <span>NO CURRENCY CONVERSION</span>
      </div>
    </section>
  );
}

function Evidence() {
  return (
    <section className="method-chapter" id="evidence">
      <div className="chapter-index">04 / PROVENANCE</div>
      <h2>Every fact carries its source.</h2>
      <p>
        Each catalog fact records when it was checked and how it was verified. Verification status
        is one of four values, and an unchecked fact is never presented as verified:
      </p>
      <dl className="kv">
        <dt className="mono">verified</dt>
        <dd>Confirmed against a primary source.</dd>
        <dt className="mono">user_supplied</dt>
        <dd>Provided by a user or contributor and not independently checked.</dd>
        <dt className="mono">estimated</dt>
        <dd>Derived from a model or an estimate rather than measured.</dd>
        <dt className="mono">unverified</dt>
        <dd>Not yet checked. Every item in this preview is unverified.</dd>
      </dl>
      <p>
        The preview flags facts and catalog snapshots older than 30 days as stale, and it shows the
        check date next to the status. That window is provisional pending <IssueLink n={41} />.
      </p>
      <p>
        Provenance attaches to the catalog snapshot as well as to individual items, so a result can
        always be traced back to the exact snapshot, ruleset and pricebook revision it was computed
        from.
      </p>
    </section>
  );
}

function DataSection() {
  const { mode } = useData();
  return (
    <section className="method-chapter" id="data">
      <div className="chapter-index">05 / DATA</div>
      <h2>What this deployment is running.</h2>
      <p>
        The real catalog of AI components is still being researched. Until it is published, the site
        runs in <strong>demo mode</strong>: every component, price, benchmark and compatibility
        result is <strong>synthetic</strong> and exists only to demonstrate the builder. Demo items
        use invented names, are marked Synthetic, and must not be read as real products, quotes or
        measurements.
      </p>
      <p>
        The data source is chosen at build time with <span className="mono">VITE_DATA_MODE</span>:{' '}
        <span className="mono">fixture</span> (synthetic demo data bundled with the site) or{' '}
        <span className="mono">http</span> (a contract-conformant API).{' '}
        {mode === 'fixture' ? (
          <>This deployment uses fixture, so everything you see is demo data.</>
        ) : (
          <>
            This deployment uses http; check each item&apos;s provenance and verification status
            before relying on it.
          </>
        )}
      </p>
      <dl className="kv">
        <dt>Contract version</dt>
        <dd className="mono">v{CONTRACT_PROVENANCE.contractVersion}</dd>
        <dt>Contract source</dt>
        <dd>
          <a className="text-link" href={contractTree}>
            contracts/v1 at {CONTRACT_PROVENANCE.sourceSha}
          </a>
        </dd>
        <dt>Ruleset</dt>
        <dd className="mono">
          {BASELINE_RULESET.id} · {RULES.length} rules
        </dd>
        <dt>Dependency graph</dt>
        <dd className="mono">
          {BASELINE_GRAPH.id} · revision {BASELINE_GRAPH.revision} · {EDGES.length} edges
        </dd>
      </dl>
    </section>
  );
}

function Limits() {
  return (
    <section className="method-chapter" id="limits">
      <div className="chapter-index">06 / LIMITATIONS</div>
      <h2>
        What this preview does <em>not</em> prove.
      </h2>
      <div className="limitation-list">
        <div>
          <span>01</span>
          <p>
            <strong>Not a hardware sizing engine.</strong> Real fit depends on quantization, context
            length, KV cache, concurrency, batching and memory headroom. The preview compares
            published capacity with a documented estimate, nothing more.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Not verified compatibility.</strong> The baseline ruleset covers explicit
            dependency patterns; it is not a continuously researched support matrix, and every rule
            is still a research proposal (<IssueLink n={40} />
            ).
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Not live billing data.</strong> Example costs exist only to demonstrate
            presentation and comparison workflows. There is no pricing feed, no vendor quote and no
            currency conversion.
          </p>
        </div>
        <div>
          <span>04</span>
          <p>
            <strong>Not an endorsement.</strong> Naming a vendor or an open-source project is an
            example, not a ranking, a recommendation or an affiliation.
          </p>
        </div>
        <div>
          <span>05</span>
          <p>
            <strong>Not a deployment sign-off.</strong> Readiness needs measured quality runs, a
            complete price quote, security review and human approval; compatibility alone never
            grants it.
          </p>
        </div>
      </div>
      <p>
        Questions or corrections? The{' '}
        <Link className="text-link" to="/about">
          About page
        </Link>{' '}
        explains how the project is organised and where to contribute, and <IssueLink n={40} /> is
        the place to propose a contract change.
      </p>
    </section>
  );
}

export default function MethodologyPage() {
  return (
    <>
      <div className="page-masthead method-head">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">PICKYOUR.AI</Link>
            <span>/</span> METHODOLOGY
          </div>
          <div className="eyebrow">HOW THE SYSTEM THINKS</div>
          <h1>
            Trust should be <span>inspectable.</span>
          </h1>
          <p>
            Understand what the compatibility engine can check, how costs are presented, and the
            difference between a proven match and an unanswered question.
          </p>
          <div className="method-top-metrics">
            <span>
              <i>{RULES.length}</i> published rules
            </span>
            <span>
              <i>{EDGES.length}</i> dependency edges
            </span>
            <span>
              <i>04</i> outcome states
            </span>
          </div>
        </div>
      </div>
      <div className="container methodology-layout">
        <aside className="method-toc">
          <div className="eyebrow">ON THIS PAGE</div>
          {SECTIONS.map((section) => (
            <a href={`#${section.id}`} key={section.id}>
              {section.label}
            </a>
          ))}
          <div className="method-toc-note">
            <Icon name="shield" />
            <strong>Evidence over assumptions.</strong>
            <p>Unsupported is not the same as incompatible.</p>
          </div>
        </aside>
        <div className="method-content">
          <Compatibility />
          <Invalidation />
          <Pricing />
          <Evidence />
          <DataSection />
          <Limits />
        </div>
      </div>
    </>
  );
}

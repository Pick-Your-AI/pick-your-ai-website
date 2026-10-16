/*
 * Compatibility presentation. Contract outcome states (pass/fail/unknown/skipped) and severities
 * (info/warning/error) are separate dimensions and always rendered with an icon AND a word —
 * never colour alone. Unknown is never styled like pass.
 */
import type { EvaluationReport } from '../contracts';
import { IconAlert, IconCheck, IconInfo, IconMinus, IconQuestion, IconX } from './icons';

export type Outcome = EvaluationReport['findings'][number]['outcome'];
export type Severity = EvaluationReport['findings'][number]['severity'];

const OUTCOME: Record<Outcome, { label: string; className: string; Icon: typeof IconCheck }> = {
  pass: {
    label: 'Pass',
    className:
      'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    Icon: IconCheck,
  },
  fail: {
    label: 'Fail',
    className:
      'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
    Icon: IconX,
  },
  unknown: {
    label: 'Unknown',
    className:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200',
    Icon: IconQuestion,
  },
  skipped: {
    label: 'Skipped',
    className:
      'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    Icon: IconMinus,
  },
};

const SEVERITY: Record<Severity, { label: string; Icon: typeof IconCheck; className: string }> = {
  error: { label: 'Error', Icon: IconX, className: 'text-red-800 dark:text-red-300' },
  warning: { label: 'Warning', Icon: IconAlert, className: 'text-amber-800 dark:text-amber-300' },
  info: { label: 'Info', Icon: IconInfo, className: 'text-sky-800 dark:text-sky-300' },
};

export function OutcomeBadge({ outcome, label }: { outcome: Outcome; label?: string }) {
  const o = OUTCOME[outcome];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${o.className}`}
    >
      <o.Icon className="shrink-0" />
      {label ?? o.label}
    </span>
  );
}

export function SeverityLabel({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${s.className}`}>
      <s.Icon className="shrink-0" />
      {s.label}
    </span>
  );
}

/** Worst outcome among findings: fail > unknown > pass > skipped. */
export function worstOutcome(outcomes: Outcome[]): Outcome | null {
  if (!outcomes.length) return null;
  if (outcomes.includes('fail')) return 'fail';
  if (outcomes.includes('unknown')) return 'unknown';
  if (outcomes.includes('pass')) return 'pass';
  return 'skipped';
}

export type VerdictValue = 'compatible' | 'incompatible' | 'unknown';

export function VerdictBadge({ verdict }: { verdict: VerdictValue }) {
  if (verdict === 'compatible') return <OutcomeBadge outcome="pass" label="No rule failures" />;
  if (verdict === 'incompatible') return <OutcomeBadge outcome="fail" label="Incompatible" />;
  return <OutcomeBadge outcome="unknown" label="Unknown" />;
}

export function SyntheticBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border border-dashed border-violet-400 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-violet-800 uppercase dark:border-violet-500 dark:text-violet-300 ${className}`}
    >
      Synthetic
    </span>
  );
}

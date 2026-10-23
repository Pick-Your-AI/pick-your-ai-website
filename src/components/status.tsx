/*
 * Compatibility presentation. Contract outcome states (pass/fail/unknown/skipped) and severities
 * (info/warning/error) are separate dimensions and are always rendered with an icon AND a word —
 * never colour alone. Unknown is never styled like pass.
 */
import type { EvaluationReport } from '../contracts';
import { Icon, type IconName } from './icon';

export type Outcome = EvaluationReport['findings'][number]['outcome'];
export type Severity = EvaluationReport['findings'][number]['severity'];

const OUTCOME: Record<Outcome, { label: string; className: string; icon: IconName }> = {
  pass: { label: 'Pass', className: 'badge badge-pass', icon: 'check' },
  fail: { label: 'Fail', className: 'badge badge-fail', icon: 'x-circle' },
  unknown: { label: 'Unknown', className: 'badge badge-unknown', icon: 'alert' },
  skipped: { label: 'Skipped', className: 'badge badge-skipped', icon: 'info' },
};

const SEVERITY: Record<Severity, { label: string; icon: IconName; className: string }> = {
  error: { label: 'Error', icon: 'x-circle', className: 'severity-error' },
  warning: { label: 'Warning', icon: 'alert', className: 'severity-warning' },
  info: { label: 'Info', icon: 'info', className: 'severity-info' },
};

export function OutcomeBadge({ outcome, label }: { outcome: Outcome; label?: string }) {
  const o = OUTCOME[outcome];
  return (
    <span className={o.className}>
      <Icon name={o.icon} />
      {label ?? o.label}
    </span>
  );
}

export function SeverityLabel({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  return (
    <span className={`severity ${s.className}`}>
      <Icon name={s.icon} />
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

/** Marks a catalog item as synthetic demo data (never used for real, sourced records). */
export function SyntheticBadge({ className = '' }: { className?: string }) {
  return (
    <span className={className ? `badge badge-synthetic ${className}` : 'badge badge-synthetic'}>
      Synthetic
    </span>
  );
}

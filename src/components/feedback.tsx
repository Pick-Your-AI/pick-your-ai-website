/* Loading, empty, error and stale states (deliberate, never blank). */
import type { ReactNode } from 'react';
import { DATA_ERROR_TITLES, isDataError } from '../data/errors';
import { IconAlert, IconInfo } from './icons';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="muted flex items-center gap-2 py-6 text-sm">
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-600 border-t-transparent motion-reduce:animate-none"
        aria-hidden="true"
      />
      {label}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const heading =
    title ?? (isDataError(error) ? DATA_ERROR_TITLES[error.kind] : 'Something went wrong');
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
    >
      <p className="flex items-center gap-2 font-semibold">
        <IconAlert /> {heading}
      </p>
      <p className="mt-1 text-sm break-words">{message}</p>
      {isDataError(error) && error.validationErrors?.length ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer">Contract validation details</summary>
          <ul className="mt-1 list-disc pl-5 font-mono text-xs">
            {error.validationErrors.slice(0, 8).map((e, i) => (
              <li key={i}>
                {e.instancePath || '(root)'} — {e.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {onRetry ? (
        <button type="button" className="btn-secondary mt-3" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
      <p className="font-semibold">{title}</p>
      {children ? <div className="muted mt-1 text-sm">{children}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
  title,
}: {
  tone?: 'info' | 'warning';
  title?: string;
  children: ReactNode;
}) {
  const cls =
    tone === 'warning'
      ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'
      : 'border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100';
  return (
    <div className={`rounded-lg border p-3 text-sm ${cls}`}>
      <p className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{tone === 'warning' ? <IconAlert /> : <IconInfo />}</span>
        <span>
          {title ? <strong className="font-semibold">{title} </strong> : null}
          {children}
        </span>
      </p>
    </div>
  );
}

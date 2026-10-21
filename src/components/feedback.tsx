/* Loading, empty, error, notice, toast and modal primitives — styled with the mock's design system. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DATA_ERROR_TITLES, isDataError } from '../data/errors';
import { Icon } from './icon';

// ----------------------------------------------------------------------------------- toast ----

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((next: string) => {
    setMessage(next);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 3100);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" role="status" className={visible ? 'toast visible' : 'toast'}>
        {message}
      </div>
    </ToastContext.Provider>
  );
}

/** Shows a transient status message in the mock's bottom-centre toast. */
export const useToast = () => useContext(ToastContext);

// ----------------------------------------------------------------------------------- modal ----

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  primaryLabel,
  onPrimary,
  primaryIcon = 'copy',
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryIcon?: 'copy' | 'download' | 'check';
}) {
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    // Restore focus to whatever opened the dialog when it closes.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // Contain Tab within the dialog: modal content must not reach the page behind it.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop open"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-modal="true"
        className="modal"
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <h3 id={titleId}>{title}</h3>
            {subtitle ? <p id={subtitleId}>{subtitle}</p> : null}
          </div>
          <button
            ref={closeRef}
            aria-label="Close dialog"
            className="icon-button"
            type="button"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          <button className="btn btn-outline" type="button" onClick={onClose}>
            Close
          </button>
          {onPrimary ? (
            <button className="btn btn-primary" type="button" onClick={onPrimary}>
              {primaryLabel ?? 'Copy JSON'} <Icon name={primaryIcon} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------- states ----

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="page-loading">
      <span className="live-dot" aria-hidden="true" />
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
    <div role="alert" className="notice-error">
      <p className="notice-line">
        <Icon name="alert" /> <strong>{heading}</strong>
      </p>
      <p className="notice-message">{message}</p>
      {isDataError(error) && error.validationErrors?.length ? (
        <details className="notice-details">
          <summary className="cursor-pointer">Contract validation details</summary>
          <ul className="notice-list">
            {error.validationErrors.slice(0, 8).map((e, i) => (
              <li key={i}>
                {e.instancePath || '(root)'} — {e.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {onRetry ? (
        <button type="button" className="btn btn-outline btn-small notice-action" onClick={onRetry}>
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
  icon = 'layers',
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: 'layers' | 'search' | 'info';
}) {
  return (
    <div className="no-results">
      <Icon name={icon} />
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action ? <div className="notice-action">{action}</div> : null}
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
  title,
}: {
  tone?: 'info' | 'warning' | 'error' | 'ok';
  title?: string;
  children: ReactNode;
}) {
  if (tone === 'warning')
    return (
      <div className="rule-alert">
        <strong>
          <Icon name="alert" /> {title ?? 'Needs review'}
        </strong>
        <p>{children}</p>
      </div>
    );
  if (tone === 'error')
    return (
      <div className="notice-error" role="alert">
        {title ? <strong>{title} </strong> : null}
        {children}
      </div>
    );
  if (tone === 'ok')
    return (
      <div className="notice-ok" role="status">
        {title ? <strong>{title} </strong> : null}
        {children}
      </div>
    );
  return (
    <div className="local-note">
      <Icon name="info" />
      <span>
        {title ? <strong>{title} </strong> : null}
        {children}
      </span>
    </div>
  );
}

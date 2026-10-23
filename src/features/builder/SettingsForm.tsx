/* Generic settings form driven by the contract selection schema ($defs/settings_<kind>). */
import { useId, useState, type FormEvent } from 'react';
import type { ComponentKind } from '../../contracts';
import { type FieldDef, settingsFields } from '../../lib/schema-fields';

type Values = Record<string, unknown>;

function toInput(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function parse(field: FieldDef, raw: string): unknown {
  const v = raw.trim();
  if (v === '') return undefined;
  switch (field.type) {
    case 'integer':
      return Number.parseInt(v, 10);
    case 'number':
      return Number(v);
    case 'boolean':
      return v === 'true';
    case 'string-array':
    case 'enum-array':
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    default:
      return v;
  }
}

function validate(field: FieldDef, value: unknown): string | null {
  if (value === undefined) return field.required ? 'Required by the contract.' : null;
  if ((field.type === 'integer' || field.type === 'number') && Number.isNaN(value as number))
    return 'Enter a number.';
  if (field.type === 'integer' && !Number.isInteger(value)) return 'Enter a whole number.';
  if (typeof value === 'number' && field.minimum !== undefined && value < field.minimum)
    return `Minimum is ${field.minimum}.`;
  if (typeof value === 'number' && field.maximum !== undefined && value > field.maximum)
    return `Maximum is ${field.maximum}.`;
  if (typeof value === 'string' && field.pattern && !new RegExp(field.pattern).test(value)) {
    return field.key.endsWith('_ref') || field.key.includes('secret')
      ? 'Must be an opaque secret:// reference — never paste a credential.'
      : `Must match ${field.pattern}.`;
  }
  return null;
}

export function SettingsForm({
  kind,
  values,
  onApply,
  onCancel,
}: {
  kind: ComponentKind;
  values: Values;
  onApply: (patch: Values) => void;
  onCancel: () => void;
}) {
  const fields = settingsFields(kind);
  const formId = useId();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, toInput(values[f.key])])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!fields.length) {
    return <p className="muted">This component has no configurable settings in contract v1.</p>;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch: Values = {};
    const errs: Record<string, string> = {};
    for (const f of fields) {
      const value = parse(f, draft[f.key] ?? '');
      const err = validate(f, value);
      if (err) errs[f.key] = err;
      patch[f.key] = value;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    onApply(patch);
  };

  return (
    <form onSubmit={submit} noValidate aria-label="Component settings" className="settings-grid">
      {fields.map((f) => {
        const id = `${formId}-${f.key}`;
        const errId = `${id}-err`;
        const common = {
          id,
          'aria-invalid': errors[f.key] ? true : undefined,
          'aria-describedby': errors[f.key] ? errId : undefined,
        } as const;
        return (
          <div key={f.key}>
            <label htmlFor={id} className="field-label">
              {f.label}
              {f.required ? <span aria-hidden="true"> *</span> : null}
              {f.required ? <span className="sr-only"> (required)</span> : null}
            </label>
            {f.type === 'enum' || f.type === 'boolean' ? (
              <select
                {...common}
                className="control-input"
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              >
                <option value="">Not set</option>
                {(f.type === 'boolean' ? ['true', 'false'] : (f.options ?? [])).map((o) => (
                  <option key={o} value={o}>
                    {f.type === 'boolean' ? (o === 'true' ? 'Yes' : 'No') : o.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...common}
                className="control-input"
                inputMode={f.type === 'integer' || f.type === 'number' ? 'decimal' : undefined}
                value={draft[f.key] ?? ''}
                placeholder={
                  f.key.includes('credential') || f.key.endsWith('_key_ref')
                    ? 'secret://…'
                    : undefined
                }
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            )}
            {f.type === 'string-array' || f.type === 'enum-array' ? (
              <p className="hint-text">Comma-separated.</p>
            ) : null}
            {errors[f.key] ? (
              <p id={errId} className="field-error">
                {errors[f.key]}
              </p>
            ) : null}
          </div>
        );
      })}
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary">
          Apply settings
        </button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="hint-text">
        Applying creates a new build revision and re-runs every affected check.
      </p>
    </form>
  );
}

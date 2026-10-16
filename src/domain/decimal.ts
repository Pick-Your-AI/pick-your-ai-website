/*
 * Exact decimal helpers. Contract money and quantities are decimal strings; never use binary floats
 * for comparisons or sums. Values are represented as a BigInt scaled by 10^SCALE.
 */

const SCALE = 12;
const FACTOR = 10n ** BigInt(SCALE);
const DECIMAL_RE = /^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$/;

export type ScaledDecimal = bigint;

/** Mirrors reference/evaluate.py `numeric()`: numbers and contract decimal strings; booleans are not numeric. */
export function toScaled(value: unknown): ScaledDecimal | null {
  if (typeof value === 'boolean') return null;
  if (typeof value === 'bigint') return value * FACTOR;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return parseSigned(numberToPlain(value));
  }
  if (typeof value === 'string' && DECIMAL_RE.test(value)) return parseSigned(value);
  return null;
}

function numberToPlain(n: number): string {
  const s = String(n);
  if (!/e/i.test(s)) return s;
  // Exponent notation: fall back to a fixed representation within the supported scale.
  return n.toFixed(SCALE).replace(/\.?0+$/, '');
}

function parseSigned(s: string): ScaledDecimal | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const [, sign, int = '0', frac = ''] = m;
  const fracPadded = (frac + '0'.repeat(SCALE)).slice(0, SCALE);
  const v = BigInt(int) * FACTOR + BigInt(fracPadded || '0');
  return sign === '-' ? -v : v;
}

export function compareScaled(a: ScaledDecimal, b: ScaledDecimal): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Formats a scaled decimal as a plain decimal string with `places` fraction digits (half-up). */
export function formatScaled(v: ScaledDecimal, places = 2): string {
  const negative = v < 0n;
  let abs = negative ? -v : v;
  const drop = 10n ** BigInt(SCALE - places);
  abs = (abs + drop / 2n) / drop;
  const unit = 10n ** BigInt(places);
  const int = abs / unit;
  const frac = (abs % unit).toString().padStart(places, '0');
  return `${negative ? '-' : ''}${int}${places > 0 ? `.${frac}` : ''}`;
}

export function decimalString(value: string | number, places = 2): string {
  const v = toScaled(typeof value === 'number' ? value : value);
  if (v === null) throw new Error(`Not a decimal: ${String(value)}`);
  return formatScaled(v, places);
}

export function multiplyDecimals(a: string, b: string, places = 2): string {
  const x = toScaled(a);
  const y = toScaled(b);
  if (x === null || y === null) throw new Error(`Not decimals: ${a}, ${b}`);
  return formatScaled((x * y) / FACTOR, places);
}

export function addDecimals(values: string[], places = 2): string {
  let total = 0n;
  for (const v of values) {
    const x = toScaled(v);
    if (x === null) throw new Error(`Not a decimal: ${v}`);
    total += x;
  }
  return formatScaled(total, places);
}

export const SCALED_ONE = FACTOR;

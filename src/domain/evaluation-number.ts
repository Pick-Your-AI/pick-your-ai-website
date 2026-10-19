/*
 * Numeric values for the rules interpreter. The 12-place limit belongs to contract decimal
 * strings; finite JSON numbers may also use scientific notation or smaller fractions.
 * Keep their decimal spelling as coefficient * 10^exponent, without money-format rounding.
 */
const DECIMAL_STRING = /^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$/;
const NUMBER_PARTS = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/;

export class EvaluationNumber {
  readonly #coefficient: bigint;
  readonly #exponent: number;

  private constructor(coefficient: bigint, exponent: number) {
    this.#coefficient = coefficient;
    this.#exponent = exponent;
  }

  /** A JSON object cannot acquire this private runtime brand by imitating field names. */
  static is(value: unknown): value is EvaluationNumber {
    return typeof value === 'object' && value !== null && #coefficient in value;
  }

  static from(value: unknown): EvaluationNumber | null {
    if (EvaluationNumber.is(value)) return value;
    let text: string;
    if (typeof value === 'number' && Number.isFinite(value)) text = String(value);
    else if (typeof value === 'string' && DECIMAL_STRING.test(value)) text = value;
    else return null;

    const match = NUMBER_PARTS.exec(text);
    if (!match || match[0] !== text) return null;
    const [, sign, integer, fraction = '', exponent = '0'] = match;
    return new EvaluationNumber(
      BigInt(`${sign}${integer}${fraction}`),
      Number(exponent) - fraction.length,
    );
  }

  private align(other: EvaluationNumber): [bigint, bigint, number] {
    const exponent = Math.min(this.#exponent, other.#exponent);
    return [
      this.#coefficient * 10n ** BigInt(this.#exponent - exponent),
      other.#coefficient * 10n ** BigInt(other.#exponent - exponent),
      exponent,
    ];
  }

  compare(other: EvaluationNumber): -1 | 0 | 1 {
    const [left, right] = this.align(other);
    return left < right ? -1 : left > right ? 1 : 0;
  }

  /** Preserve a primitive scalar only when its decimal spelling retains the exact value. */
  toNumberExact(): number | null {
    const value = Number(`${this.#coefficient}e${this.#exponent}`);
    const roundTrip = EvaluationNumber.from(value);
    return roundTrip !== null && this.compare(roundTrip) === 0 ? value : null;
  }

  add(other: EvaluationNumber): EvaluationNumber {
    const [left, right, exponent] = this.align(other);
    return new EvaluationNumber(left + right, exponent);
  }

  multiply(other: EvaluationNumber): EvaluationNumber {
    return new EvaluationNumber(
      this.#coefficient * other.#coefficient,
      this.#exponent + other.#exponent,
    );
  }
}

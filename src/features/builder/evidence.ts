/*
 * Evidence presentation for one catalog item in the builder register.
 *
 * Research #41 adopts no time-to-live. An evidence date is descriptive: a version-pinned fact does
 * not expire with age, and the age of a recorded check says nothing about whether the fact is still
 * correct. So this module never derives a "stale" flag from a day count — that would reintroduce the
 * blanket expiry policy the research explicitly rejected.
 *
 * The verification word is the *recorded* provenance status. A historical `verified` label may record
 * a source check only, so it is never presented as current independent verification; the caveat
 * travels with the value as `detail` so callers can attach it as a title or caption.
 */
import type { CatalogItem, Provenance } from '../../contracts';
import { evidenceDateLabel, itemFreshness } from '../../domain/freshness';

const VERIFICATION: Record<Provenance['verification_status'], string> = {
  verified: 'Recorded: verified',
  user_supplied: 'Recorded: user supplied',
  estimated: 'Recorded: estimated',
  unverified: 'Recorded: unverified',
};

const VERIFICATION_ORDER: Provenance['verification_status'][] = [
  'verified',
  'user_supplied',
  'estimated',
  'unverified',
];

export interface ItemEvidence {
  /** Compact cell label: "Recorded: unverified · 2026-10-16". */
  label: string;
  /** Full caveat, suitable for a `title` attribute or a footnote. */
  detail: string;
  /** The recorded verification status, unchanged from the contract enum. */
  status: Provenance['verification_status'];
  /** The descriptive evidence date (no freshness/expiry verdict). */
  checkedAt: string;
}

/** Evidence cell for one catalog item. Age alone never marks a row stale. */
export function evidenceLine(item: CatalogItem): ItemEvidence {
  const statuses = new Set(item.provenance.map((p) => p.verification_status));
  const status = VERIFICATION_ORDER.find((candidate) => statuses.has(candidate)) ?? 'unverified';
  const date = itemFreshness(item);
  return {
    label: `${VERIFICATION[status]} · ${date.checkedAt.slice(0, 10)}`,
    detail: `${evidenceDateLabel(date)}. Recorded provenance only: this date does not establish currentness or independent verification.`,
    status,
    checkedAt: date.checkedAt,
  };
}

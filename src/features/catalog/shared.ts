/*
 * Presentation helpers shared by the catalog screens.
 *
 * The design mock shows a "vendor" for every component. The research contract has no vendor,
 * developer or provider field on a catalog item (only `model_provider` is a component kind of its
 * own), so nothing here invents one: every line is derived from data the contract does carry —
 * licence, billing class, record status, version, provenance and spec fields.
 */
import type { CatalogItem, Provenance } from '../../contracts';
import { KEY_FIELDS, specValue } from '../../lib/catalog-view';
import { formatValue, specFields } from '../../lib/schema-fields';

/**
 * An item counts as open source / open weights when it declares an SPDX licence id. That is the
 * only distribution signal the contract records, and it is deliberately not guessed from tags.
 */
export function isOpenSource(item: CatalogItem): boolean {
  return Boolean(item.license?.spdx_id);
}

const VERIFICATION_ORDER: Provenance['verification_status'][] = [
  'verified',
  'user_supplied',
  'estimated',
  'unverified',
];

/** Strongest provenance verification recorded for the item (contract enum, never invented). */
export function strongestVerification(item: CatalogItem): Provenance['verification_status'] {
  const statuses = new Set(item.provenance.map((p) => p.verification_status));
  return VERIFICATION_ORDER.find((v) => statuses.has(v)) ?? 'unverified';
}

/** Human wording for the provenance enum. */
export function verificationLabel(status: Provenance['verification_status']): string {
  switch (status) {
    case 'verified':
      return 'verified';
    case 'user_supplied':
      return 'user supplied';
    case 'estimated':
      return 'estimated';
    default:
      return 'unverified';
  }
}

/**
 * Stands in for the mock's `vendor · description` line: the record's verification status plus the
 * item description, both of which are real contract data.
 */
export function recordLine(item: CatalogItem): string {
  const status = verificationLabel(strongestVerification(item));
  return `${status} demo record · ${item.description ?? 'No description recorded'}`;
}

/** Licence/access line: SPDX id plus the two flags the contract records, or "not declared". */
export function licenseLine(item: CatalogItem): string {
  const license = item.license;
  if (!license?.spdx_id) return 'No licence declared in this demo record';
  const flags: string[] = [];
  if (license.commercial_use_allowed !== undefined)
    flags.push(license.commercial_use_allowed ? 'commercial use allowed' : 'no commercial use');
  if (license.self_hosting_allowed !== undefined)
    flags.push(license.self_hosting_allowed ? 'self-hosting allowed' : 'no self-hosting');
  return flags.length ? `${license.spdx_id} · ${flags.join(' · ')}` : license.spdx_id;
}

/**
 * Up to `max` decision-relevant spec values for a card's `.meta-row`. Reference fields are skipped
 * (they would render raw catalog ids) and unspecified values are never shown as facts.
 */
export function specChips(item: CatalogItem, max = 3): string[] {
  const fields = new Map(specFields(item.kind).map((f) => [f.key, f]));
  const chips: string[] = [];
  for (const key of KEY_FIELDS[item.kind]) {
    const field = fields.get(key);
    const value = specValue(item, key);
    if (!field || field.isRef || value === undefined || value === null) continue;
    const text = formatValue(value, field);
    if (!text || text === 'None') continue;
    chips.push(text);
    if (chips.length === max) break;
  }
  return chips;
}

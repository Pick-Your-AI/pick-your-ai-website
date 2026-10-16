/*
 * Build import/export and share-by-URL (preview). An export file wraps a contract BuildSnapshot
 * with provenance so another browser can reproduce it. Imports are validated against the contract
 * schema and never executed or rendered as HTML. Share links carry the build in the URL fragment
 * (#…), which browsers do not send to the server.
 */
import type { BuildSnapshot } from '../contracts';
import { CONTRACT_PROVENANCE, validateContract } from '../contracts';
import { MIN_SELECTIONS_FOR_SNAPSHOT } from './build';

export const EXPORT_FORMAT = 'pickyour.ai/build-export';
export const EXPORT_FORMAT_VERSION = 1;
export const MAX_IMPORT_BYTES = 512 * 1024;

export interface BuildExport {
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  exportedAt: string;
  contract: { version: string; sourceSha: string };
  dataMode: 'fixture' | 'http';
  build: BuildSnapshot;
}

export type ImportResult =
  { ok: true; build: BuildSnapshot; warnings: string[] } | { ok: false; error: string };

export function canExport(build: BuildSnapshot): string | null {
  if (build.selections.length < MIN_SELECTIONS_FOR_SNAPSHOT) {
    return `Add at least ${MIN_SELECTIONS_FOR_SNAPSHOT} components before exporting — the contract's BuildSnapshot requires two selections.`;
  }
  const result = validateContract('BuildSnapshot', build);
  return result.ok ? null : result.summary;
}

export function exportBuild(
  build: BuildSnapshot,
  dataMode: 'fixture' | 'http',
  now: string = new Date().toISOString(),
): BuildExport {
  const problem = canExport(build);
  if (problem) throw new Error(problem);
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now,
    contract: {
      version: CONTRACT_PROVENANCE.contractVersion,
      sourceSha: CONTRACT_PROVENANCE.sourceSha,
    },
    dataMode,
    build,
  };
}

export function exportFileName(build: BuildSnapshot): string {
  const slug = build.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${slug || 'build'}.r${build.revision}.pickyour-ai.json`;
}

/** Accepts an export envelope or a bare BuildSnapshot. */
export function importBuild(text: string, currentMode: 'fixture' | 'http'): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'File is larger than 512 KB.' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }
  if (!data || typeof data !== 'object')
    return { ok: false, error: 'File does not contain a build.' };
  const warnings: string[] = [];
  let candidate: unknown = data;
  const env = data as Partial<BuildExport>;
  if ('format' in env) {
    if (env.format !== EXPORT_FORMAT)
      return { ok: false, error: `Unsupported file format "${String(env.format)}".` };
    if (env.formatVersion !== EXPORT_FORMAT_VERSION) {
      return { ok: false, error: `Unsupported export version ${String(env.formatVersion)}.` };
    }
    if (env.contract?.version !== CONTRACT_PROVENANCE.contractVersion) {
      return {
        ok: false,
        error: `Build uses contract ${String(env.contract?.version)}; this site uses ${CONTRACT_PROVENANCE.contractVersion}.`,
      };
    }
    if (env.dataMode && env.dataMode !== currentMode) {
      warnings.push(
        `This build was made with ${env.dataMode} data; this site is in ${currentMode} mode, so components may not resolve.`,
      );
    }
    candidate = env.build;
  }
  const result = validateContract('BuildSnapshot', candidate);
  if (!result.ok) return { ok: false, error: result.summary };
  return { ok: true, build: result.value, warnings };
}

// ---- share-by-URL (fragment) -------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeShareFragment(build: BuildSnapshot, dataMode: 'fixture' | 'http'): string {
  const json = JSON.stringify(exportBuild(build, dataMode));
  return `b1.${toBase64Url(new TextEncoder().encode(json))}`;
}

export function decodeShareFragment(
  fragment: string,
  currentMode: 'fixture' | 'http',
): ImportResult {
  const raw = fragment.replace(/^#/, '');
  if (!raw.startsWith('b1.'))
    return { ok: false, error: 'This link does not contain a PickYour.AI build.' };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(raw.slice(3)));
  } catch {
    return { ok: false, error: 'The shared link is corrupted.' };
  }
  return importBuild(text, currentMode);
}

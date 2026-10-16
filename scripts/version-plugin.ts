import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export interface BuildVersion {
  commit: string;
  builtAt: string;
  contractVersion: string;
  contractSourceSha: string;
  dataMode: 'fixture' | 'http';
}

function resolveCommit(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.PYAI_COMMIT_SHA || env.GITHUB_SHA;
  if (fromEnv) return fromEnv.trim();
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export function resolveDataMode(value: string | undefined): 'fixture' | 'http' {
  if (value === undefined || value === '' || value === 'fixture') return 'fixture';
  if (value === 'http') return 'http';
  throw new Error(`VITE_DATA_MODE must be "fixture" or "http", got "${value}"`);
}

/** Computes the build version once (INTERFACES.md build contract). */
export function computeBuildVersion(root: string, env: NodeJS.ProcessEnv): BuildVersion {
  const provenance = JSON.parse(
    readFileSync(resolve(root, 'contracts/PROVENANCE.json'), 'utf8'),
  ) as {
    contractVersion: string;
    sourceSha: string;
  };
  return {
    commit: resolveCommit(env),
    builtAt: new Date().toISOString(),
    contractVersion: provenance.contractVersion,
    contractSourceSha: provenance.sourceSha,
    dataMode: resolveDataMode(env.VITE_DATA_MODE),
  };
}

/** Emits dist/version.json and exposes the same object to the app as `__PYAI_VERSION__`. */
export function versionPlugin(version: BuildVersion): Plugin {
  return {
    name: 'pyai-version',
    config: () => ({ define: { __PYAI_VERSION__: JSON.stringify(version) } }),
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(version, null, 2) + '\n',
      });
    },
  };
}

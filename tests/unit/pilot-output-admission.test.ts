import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const validator = resolve('scripts/check-dist.mjs');
const syntheticCommit = '1'.repeat(40);
const temporaryDirectories: string[] = [];

type DataMode = 'fixture' | 'http';

function minimalOutput(dataMode: DataMode) {
  const cwd = mkdtempSync(join(tmpdir(), 'pyai-pilot-output-'));
  temporaryDirectories.push(cwd);
  mkdirSync(join(cwd, 'dist/assets'), { recursive: true });
  writeFileSync(join(cwd, 'dist/index.html'), '<!doctype html><title>Synthetic test</title>');
  writeFileSync(join(cwd, 'dist/assets/index-12345678.js'), '// Synthetic test asset\n');
  const version = {
    commit: syntheticCommit,
    builtAt: '2026-11-17T00:00:00.000Z',
    contractVersion: '1.0.0',
    contractSourceSha: '2'.repeat(40),
    dataMode,
  };
  writeFileSync(join(cwd, 'dist/version.json'), JSON.stringify(version));
  return { cwd, version };
}

function validate(cwd: string) {
  return spawnSync(process.execPath, [validator], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PYAI_COMMIT_SHA: syntheticCommit,
      GITHUB_SHA: syntheticCommit,
    },
    timeout: 10_000,
  });
}

function expectRejected(cwd: string) {
  const result = validate(cwd);
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.each<DataMode>(['fixture', 'http'])(
  'deployment output admission in %s mode',
  (dataMode) => {
    it('accepts minimal output with valid metadata and no unadmitted candidates', () => {
      const { cwd } = minimalOutput(dataMode);
      const result = validate(cwd);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('dist/ OK');
    });

    it.each(['v1/catalog/snapshots/catalog.pilot.open-1', 'v1/pricebooks/prices.pilot.1'])(
      'rejects output containing the unadmitted candidate %s',
      (candidatePath) => {
        const { cwd } = minimalOutput(dataMode);
        const candidate = join(cwd, 'dist', candidatePath);
        mkdirSync(dirname(candidate), { recursive: true });
        // Contents are synthetic: deployment admission must not depend on real pilot payloads.
        writeFileSync(candidate, JSON.stringify({ synthetic: true }));
        expectRejected(cwd);
      },
    );

    it.each([
      ['commit', 'short-sha'],
      ['contractSourceSha', 'short-sha'],
      ['contractVersion', '0.0.0'],
      ['builtAt', 'not-a-date'],
      ['dataMode', 'unsupported'],
    ])('still rejects invalid ordinary metadata: %s', (key, invalidValue) => {
      const { cwd, version } = minimalOutput(dataMode);
      writeFileSync(
        join(cwd, 'dist/version.json'),
        JSON.stringify({ ...version, [key]: invalidValue }),
      );
      expectRejected(cwd);
    });
  },
);

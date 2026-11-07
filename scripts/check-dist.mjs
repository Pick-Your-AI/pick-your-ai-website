#!/usr/bin/env node
// Verifies dist/ satisfies the INTERFACES.md build contract consumed by the deploy workflow.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyDist } from './organization-lib.mjs';

const errors = [];
if (!existsSync('dist/index.html')) errors.push('dist/index.html missing');

const v = JSON.parse(readFileSync('dist/version.json', 'utf8'));
const keys = Object.keys(v).sort().join(',');
if (keys !== 'builtAt,commit,contractSourceSha,contractVersion,dataMode') {
  errors.push(`version.json keys are ${keys}`);
}
const expectedSha = process.env.PYAI_COMMIT_SHA || process.env.GITHUB_SHA;
if (expectedSha && v.commit !== expectedSha) errors.push(`commit ${v.commit} != ${expectedSha}`);
if (!/^[0-9a-f]{40}$/.test(v.commit)) errors.push(`commit is not a full sha: ${v.commit}`);
if (!/^[0-9a-f]{40}$/.test(v.contractSourceSha)) errors.push('contractSourceSha is not a full sha');
if (v.contractVersion !== '1.0.0') errors.push(`contractVersion ${v.contractVersion}`);
if (!['fixture', 'http'].includes(v.dataMode)) errors.push(`dataMode ${v.dataMode}`);
if (Number.isNaN(Date.parse(v.builtAt))) errors.push('builtAt is not ISO-8601');

const assets = existsSync('dist/assets') ? readdirSync('dist/assets') : [];
if (!assets.some((f) => /-[A-Za-z0-9_-]{8}\.js$/.test(f)))
  errors.push('no hashed JS asset in dist/assets');

// /organization/ must carry exactly the admitted, hash-pinned bundle, or be absent when none is admitted.
errors.push(...verifyDist(fileURLToPath(new URL('..', import.meta.url))).errors);

if (errors.length) {
  console.error(`dist/ violates the build contract:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`dist/ OK: ${JSON.stringify(v)}`);

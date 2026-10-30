#!/usr/bin/env node
// Pinned importer and verifier for the canonical organization directory (served at /organization/).
//
//   node scripts/organization.mjs verify                    offline: pin shape, vendored bytes, bundle rules
//   node scripts/organization.mjs verify --upstream         also compare with upstream at the pinned SHA
//                                                           and re-check ancestry of upstream main
//   node scripts/organization.mjs verify-dist [dist]        a build output carries exactly the pinned bytes
//   node scripts/organization.mjs inspect --source-dir DIR  validate a candidate directory; never writes
//   node scripts/organization.mjs inspect --local-repo PATH --sha SHA
//   node scripts/organization.mjs update --ref SHA \
//       --pull-request URL --review-url URL --reviewer LOGIN
//
// `update` admits only a commit that is already an ancestor of .github main, with the merged pull
// request and the independent human review recorded. There is no unmerged or exception path.
//
// The upstream repository is fixed in organization-lib.mjs. No URL, branch or script is ever taken
// from the pin, the bundle or the command line, and nothing fetched is executed.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOURCE_MAIN,
  SOURCE_REPOSITORY,
  admit,
  hashFiles,
  readBundleDir,
  readBundleFromGit,
  validateBundle,
  verifyDist,
  verifyLocal,
  verifyUpstream,
} from './organization-lib.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function option(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`${name} needs a value`);
    process.exit(2);
  }
  return value;
}

function finish(errors, ok) {
  if (errors.length) {
    console.error(
      `Organization directory check FAILED (${errors.length}):\n  - ${errors.join('\n  - ')}`,
    );
    process.exit(1);
  }
  console.log(ok);
}

function describe(pin) {
  if (!pin.admitted) {
    const pending = pin.candidate
      ? `; candidate ${pin.candidate.sourceSha.slice(0, 12)} is recorded as pending (not admitted)`
      : '';
    return `No organization bundle is admitted; /organization/ shows the pending page${pending}`;
  }
  const a = pin.admitted;
  return (
    `Admitted ${SOURCE_REPOSITORY}@${a.sourceSha.slice(0, 12)} (${a.basis}, observed ${a.observedAt}, ` +
    `${a.files.length} files)`
  );
}

function inspect(args) {
  const dir = option(args, '--source-dir');
  const repo = option(args, '--local-repo');
  const sha = option(args, '--sha');
  const expect = option(args, '--expect-sha');
  let read;
  if (dir) read = readBundleDir(resolve(dir));
  else if (repo && sha) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(repo) || repo.startsWith('git@')) {
      console.error('--local-repo must be a filesystem path, not a URL');
      process.exit(2);
    }
    read = readBundleFromGit(resolve(repo), sha);
  } else {
    console.error('inspect needs --source-dir DIR, or --local-repo PATH with --sha SHA');
    process.exit(2);
  }
  const errors = [...read.errors];
  if (expect && sha !== expect) errors.push(`--sha ${sha} != --expect-sha ${expect}`);
  const result = validateBundle(read.files);
  errors.push(...result.errors);
  const files = hashFiles(read.files);
  console.log(JSON.stringify({ facts: result.facts, files }, null, 2));
  console.log(
    'ELIGIBILITY: PENDING. Inspection validates structure only; it does not approve, admit or deploy.',
  );
  finish(errors, `Candidate bundle is structurally valid (${files.length} files).`);
}

function update(args) {
  const sha = option(args, '--ref');
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    console.error(
      'update needs --ref <full 40-character commit SHA>; branches and tags are refused',
    );
    process.exit(2);
  }
  const approval = {
    pullRequest: option(args, '--pull-request'),
    humanReviewUrl: option(args, '--review-url'),
    humanReviewer: option(args, '--reviewer'),
  };
  const { errors, pin } = admit(ROOT, { sha, approval });
  finish(errors, `${describe(pin)}. Review the diff, then open a PR.`);
  const verified = verifyLocal(ROOT);
  finish(verified.errors, 'Re-verified the vendored tree against the new pin.');
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'verify') {
  const local = verifyLocal(ROOT);
  const errors = [...local.errors];
  if (rest.includes('--upstream') && !errors.length) errors.push(...verifyUpstream(ROOT).errors);
  finish(
    errors,
    `${describe(local.pin)}${rest.includes('--upstream') ? '; identical to upstream.' : '.'}`,
  );
} else if (cmd === 'verify-dist') {
  const out = verifyDist(ROOT, resolve(rest[0] ?? 'dist'));
  finish(out.errors, `dist matches the pin. ${describe(out.pin)}`);
} else if (cmd === 'inspect') inspect(rest);
else if (cmd === 'update') update(rest);
else {
  console.error(
    `usage: organization.mjs verify [--upstream] | verify-dist [dist] | inspect ... | update ... (upstream ${SOURCE_REPOSITORY}@${SOURCE_MAIN} is fixed)`,
  );
  process.exit(2);
}

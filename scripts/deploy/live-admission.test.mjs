import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { admitLiveEvent, LIMITS, main, qualifyDeployment } from './live-admission.mjs';

// Selected public identities and step timestamps from the original incident in #318:
// deploy 39277650970/job118156365161 -> deploy 39281193002/job118166683941.
// Response envelopes, omitted unrelated jobs and all mutations below are synthetic CPU fixtures.
// They are not additional deployments or retrospective browser passes for the failed live run.
const REPOSITORY = 'Pick-Your-AI/pick-your-ai-website';
const REPOSITORY_ID = 1422238606;
const WORKFLOW_ID = 386820379;
const ORIGINAL = '0446eaa76be1f4c36b5d24f57a5a7b4088629de4';
const LATER = 'fcf1502b9c7d1a5503e89b171a61351583c64947';
const MAIN = '097641e4862630fd54bf3d2b912837c702ab2b60';
const SECRET = 'synthetic-read-token-never-for-production';
const context = { repository: REPOSITORY, repositoryId: REPOSITORY_ID, workflowId: WORKFLOW_ID };
const path = '/.github/workflows/e2e-live.yml';
const repoFile = (name) => new URL(`../../${name}`, import.meta.url);

function run(sha, runId) {
  return {
    id: runId,
    run_attempt: 1,
    name: 'Deploy production',
    workflow_id: WORKFLOW_ID,
    path: '.github/workflows/deploy-production.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    repository: { id: REPOSITORY_ID, full_name: REPOSITORY },
    head_repository: { id: REPOSITORY_ID, full_name: REPOSITORY },
  };
}
function job(run, jobId, startedAt, completedAt, times) {
  const names = [
    'Check the artifact is the exact commit',
    'Validate release on host',
    'Activate',
    'Verify live site through Cloudflare',
    'Restore previous release on failure',
  ];
  return {
    id: jobId,
    run_id: run.id,
    run_attempt: run.run_attempt,
    name: 'deploy',
    workflow_name: run.name,
    head_sha: run.head_sha,
    head_branch: run.head_branch,
    status: 'completed',
    conclusion: 'success',
    started_at: `2026-10-19T${startedAt}Z`,
    completed_at: `2026-10-19T${completedAt}Z`,
    steps: names.map((name, i) => ({
      name,
      number: [4, 7, 8, 9, 10][i],
      status: 'completed',
      conclusion: i === 4 ? 'skipped' : 'success',
      started_at: `2026-10-19T${times[i][0]}Z`,
      completed_at: `2026-10-19T${times[i][1]}Z`,
    })),
  };
}
const list = (field, items) => ({ total_count: items.length, [field]: items });
const comparison = (base, count = 1) => ({
  base_commit: { sha: base },
  merge_base_commit: { sha: base },
  status: count === 0 ? 'identical' : 'ahead',
  ahead_by: count,
  behind_by: 0,
});
const json = (value, options = {}) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
    ...options,
  });

function fixture() {
  const original = run(ORIGINAL, 39277650970);
  const later = run(LATER, 39281193002);
  const state = {
    original,
    later,
    originalJobs: list('jobs', [
      job(original, 118156365161, '16:19:25', '16:19:53', [
        ['16:19:30', '16:19:30'],
        ['16:19:34', '16:19:36'],
        ['16:19:36', '16:19:37'],
        ['16:19:37', '16:19:47'],
        ['16:19:47', '16:19:47'],
      ]),
    ]),
    laterJobs: list('jobs', [
      job(later, 118166683941, '16:31:50', '16:32:11', [
        ['16:31:57', '16:31:57'],
        ['16:32:00', '16:32:01'],
        ['16:32:01', '16:32:02'],
        ['16:32:02', '16:32:07'],
        ['16:32:07', '16:32:07'],
      ]),
    ]),
    workflow: { id: WORKFLOW_ID, name: 'Deploy production', path: original.path, state: 'active' },
    branch: { name: 'main', commit: { sha: MAIN } },
    originalToLive: comparison(ORIGINAL),
    liveToMain: comparison(LATER),
    candidates: list('workflow_runs', [structuredClone(later)]),
    versions: [{ commit: LATER }],
    calls: [],
    sleeps: [],
    versionReads: 0,
  };
  const input = {
    eventName: 'workflow_run',
    event: {
      repository: structuredClone(original.repository),
      workflow_run: structuredClone(original),
    },
    expectedSha: ORIGINAL,
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    productionUrl: 'https://pickyour.ai',
    token: SECRET,
  };
  const dependencies = {
    sleep: async (delay) => {
      state.sleeps.push(delay);
      await state.onSleep?.();
    },
    fetch: async (url, options) => {
      state.calls.push({ url, options });
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      const parsed = new URL(url);
      assert.ok(options.signal instanceof AbortSignal);
      if (parsed.origin === 'https://pickyour.ai') {
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.headers['Cache-Control'], 'no-cache');
        assert.equal(parsed.pathname, '/version.json');
        assert.ok(parsed.searchParams.has('admission'));
        const index = state.versionReads++;
        return (
          state.liveResponse?.() ?? json(state.versions[Math.min(index, state.versions.length - 1)])
        );
      }
      assert.equal(parsed.origin, 'https://api.github.com');
      assert.equal(options.headers.Authorization, `Bearer ${SECRET}`);
      assert.equal(options.headers['X-GitHub-Api-Version'], '2026-03-10');
      assert.equal(parsed.pathname.startsWith(`/repos/${REPOSITORY}/`), true);
      const route = parsed.pathname.slice(`/repos/${REPOSITORY}`.length) + parsed.search;
      const override = await state.apiResponse?.(route);
      if (override) return override;
      const routes = new Map([
        ['/actions/workflows/deploy-production.yml', state.workflow],
        ['/branches/main', state.branch],
        [`/compare/${ORIGINAL}...${LATER}?per_page=1`, state.originalToLive],
        [`/compare/${LATER}...${MAIN}?per_page=1`, state.liveToMain],
        ['/actions/runs/39277650970/attempts/1', state.original],
        ['/actions/runs/39277650970/attempts/1/jobs?per_page=100', state.originalJobs],
        [
          `/actions/workflows/${WORKFLOW_ID}/runs?branch=main&event=push&head_sha=${LATER}&per_page=5`,
          state.candidates,
        ],
        ['/actions/runs/39281193002/attempts/1', state.later],
        ['/actions/runs/39281193002/attempts/1/jobs?per_page=100', state.laterJobs],
      ]);
      assert.ok(routes.has(route), `unexpected fixture request: ${route}`);
      return json(routes.get(route));
    },
  };
  return { state, input, dependencies, decide: () => admitLiveEvent(input, dependencies) };
}

test('the original delayed-event incident is explicitly superseded, with both exact deployment proofs', async () => {
  const f = fixture();
  // The unchanged old assertion fails causally for these two real release identities.
  assert.throws(() => assert.equal(LATER, f.input.expectedSha));
  const result = await f.decide();
  assert.equal(result.decision, 'superseded');
  assert.equal(result.expected_sha, ORIGINAL);
  assert.equal(result.observed_sha, LATER);
  assert.equal(result.main_sha, MAIN);
  assert.equal(result.original_deployment.job_id, 118156365161);
  assert.equal(result.successor_deployments[0].job_id, 118166683941);
  assert.equal(result.successor_deployments[0].run_attempt, 1);
  assert.deepEqual(result.accepted_ancestry, [
    { base: ORIGINAL, head: LATER, ahead_by: 1 },
    { base: LATER, head: MAIN, ahead_by: 1 },
  ]);
  assert.equal(f.state.versionReads, 2);
  assert.equal(f.state.calls.at(-1).url.startsWith('https://pickyour.ai/version.json?'), true);
  assert.equal(f.input.expectedSha, ORIGINAL);
  assert.equal(f.state.sleeps.length, 0);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test('a matching live release validates the canonical trigger before running unchanged strict checks', async () => {
  const f = fixture();
  f.state.versions = [{ commit: ORIGINAL }];
  const result = await f.decide();
  assert.equal(result.decision, 'run');
  assert.equal(result.expected_sha, ORIGINAL);
  assert.equal(result.original_deployment, undefined);
  assert.equal(f.state.calls.length, 3);
  assert.equal(f.state.calls[0].url.endsWith('/actions/workflows/deploy-production.yml'), true);
  assert.equal(f.state.calls[1].url.endsWith('/actions/runs/39277650970/attempts/1'), true);
});

test('a matching public SHA cannot bypass canonical workflow or exact triggering-run validation', async (t) => {
  const mutations = {
    'same-name foreign workflow ID': (f) => f.input.event.workflow_run.workflow_id++,
    'wrong workflow descriptor path': (f) =>
      (f.state.workflow.path = '.github/workflows/other.yml'),
    'trigger run ID': (f) => f.state.original.id++,
    'trigger attempt': (f) => f.state.original.run_attempt++,
    'trigger repository ID': (f) => f.state.original.repository.id++,
    'trigger head repository ID': (f) => f.state.original.head_repository.id++,
    'trigger feature branch': (f) => (f.state.original.head_branch = 'feature'),
    'trigger workflow ID': (f) => f.state.original.workflow_id++,
    'trigger workflow path': (f) => (f.state.original.path = '.github/workflows/other.yml'),
    'trigger workflow event': (f) => (f.state.original.event = 'workflow_dispatch'),
    'trigger failure': (f) => (f.state.original.conclusion = 'failure'),
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, async () => {
      const f = fixture();
      f.state.versions = [{ commit: ORIGINAL }];
      mutate(f);
      assert.equal((await f.decide()).decision, 'failed');
      assert.equal(f.state.versionReads, 0);
    });
});

test('schedule, manual and rollback verification keep their unbound live-check behavior', async () => {
  for (const eventName of ['schedule', 'workflow_dispatch', 'workflow_run']) {
    const f = fixture();
    f.input.eventName = eventName;
    f.input.event.workflow_run.event = 'workflow_dispatch';
    f.input.expectedSha = '';
    delete f.input.token;
    assert.equal((await f.decide()).decision, 'run');
    assert.equal(f.state.calls.length, 0);
    f.input.expectedSha = ORIGINAL;
    assert.equal((await f.decide()).reason, 'unexpected_expected_sha');
  }
});

test('malformed identities and noncanonical trigger fields stop before any request', async (t) => {
  const mutations = {
    'event repository ID': (f) => f.input.event.repository.id++,
    'head repository ID': (f) => f.input.event.workflow_run.head_repository.id++,
    'repository name': (f) => (f.input.event.workflow_run.repository.full_name = 'someone/else'),
    'repository traversal': (f) => (f.input.repository = '../else'),
    'workflow path': (f) => (f.input.event.workflow_run.path = '.github/workflows/fake.yml'),
    'workflow name': (f) => (f.input.event.workflow_run.name = 'Almost Deploy production'),
    branch: (f) => (f.input.event.workflow_run.head_branch = 'feature'),
    event: (f) => (f.input.event.workflow_run.event = 'pull_request'),
    SHA: (f) => (f.input.expectedSha = 'abc'),
    'typed SHA': (f) => (f.input.expectedSha = [ORIGINAL]),
    attempt: (f) => (f.input.event.workflow_run.run_attempt = 0),
    'missing ID': (f) => delete f.input.event.workflow_run.id,
    'failed trigger': (f) => (f.input.event.workflow_run.conclusion = 'failure'),
    token: (f) => (f.input.token = ''),
    'HTTP origin': (f) => (f.input.productionUrl = 'http://pickyour.ai'),
    'credentialed origin': (f) => (f.input.productionUrl = 'https://private:secret@pickyour.ai'),
    'origin path': (f) => (f.input.productionUrl = 'https://pickyour.ai/elsewhere'),
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, async () => {
      const f = fixture();
      mutate(f);
      assert.equal((await f.decide()).decision, 'failed');
      assert.equal(f.state.calls.length, 0);
    });
});

test('a later accepted commit alone never certifies deployment', async (t) => {
  const mutations = {
    'no canonical run': (f) => (f.state.candidates = list('workflow_runs', [])),
    'no deploy job': (f) => (f.state.laterJobs = list('jobs', [])),
    'skipped deploy': (f) => (f.state.laterJobs.jobs[0].conclusion = 'skipped'),
    'failed deploy': (f) => (f.state.laterJobs.jobs[0].conclusion = 'failure'),
    'pending deploy': (f) => (f.state.laterJobs.jobs[0].status = 'in_progress'),
    'failed original': (f) => (f.state.original.conclusion = 'failure'),
    'skipped original': (f) => (f.state.originalJobs.jobs[0].conclusion = 'skipped'),
    'unverified original': (f) => (f.state.originalJobs.jobs[0].steps[3].conclusion = 'skipped'),
    'pending run': (f) => (f.state.later.status = 'waiting'),
    'unknown status': (f) => (f.state.later.status = 'green'),
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, async () => {
      const f = fixture();
      mutate(f);
      const result = await f.decide();
      assert.equal(result.decision, 'failed');
      assert.equal(result.successor_deployments, undefined);
    });
});

test('authenticated run and job identities must join at the exact attempt', async (t) => {
  const mutations = {
    'descriptor ID': (f) => f.state.workflow.id++,
    'descriptor path': (f) => (f.state.workflow.path = '.github/workflows/other.yml'),
    'descriptor inactive': (f) => (f.state.workflow.state = 'disabled_manually'),
    'run repository ID': (f) => f.state.later.repository.id++,
    'run head repository': (f) => (f.state.later.head_repository.full_name = 'someone/fork'),
    'run workflow ID': (f) => f.state.later.workflow_id++,
    'run attempt': (f) => (f.state.later.run_attempt = 2),
    'run head': (f) => (f.state.later.head_sha = ORIGINAL),
    'candidate ref': (f) => (f.state.candidates.workflow_runs[0].head_branch = 'topic'),
    'candidate workflow': (f) => f.state.candidates.workflow_runs[0].workflow_id++,
    'job run ID': (f) => f.state.laterJobs.jobs[0].run_id++,
    'job attempt': (f) => (f.state.laterJobs.jobs[0].run_attempt = 2),
    'job workflow name': (f) => (f.state.laterJobs.jobs[0].workflow_name = 'Other'),
    'job head': (f) => (f.state.laterJobs.jobs[0].head_sha = ORIGINAL),
    'job ref': (f) => (f.state.laterJobs.jobs[0].head_branch = 'topic'),
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, async () => {
      const f = fixture();
      mutate(f);
      assert.equal((await f.decide()).decision, 'failed');
    });
});

test('ambiguous or truncated metadata cannot select a convenient successful job or run', async (t) => {
  const mutations = {
    'duplicate deploy job': (f) => {
      f.state.laterJobs.jobs.push(structuredClone(f.state.laterJobs.jobs[0]));
      f.state.laterJobs.total_count++;
    },
    'duplicate run': (f) => {
      f.state.candidates.workflow_runs.push(structuredClone(f.state.later));
      f.state.candidates.total_count++;
    },
    'truncated jobs': (f) => f.state.laterJobs.total_count++,
    'too many candidate runs': (f) => (f.state.candidates.total_count = LIMITS.runs + 1),
    'missing count': (f) => delete f.state.candidates.total_count,
    'string count': (f) => (f.state.laterJobs.total_count = '1'),
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, async () => {
      const f = fixture();
      mutate(f);
      assert.equal((await f.decide()).decision, 'failed');
    });
});

test('candidate order cannot conceal an unqualified execution or borrow a previous attempt', async () => {
  for (const reverse of [false, true]) {
    const f = fixture();
    const secondRun = { ...structuredClone(f.state.later), id: 90000000001 };
    const secondJob = {
      ...structuredClone(f.state.laterJobs.jobs[0]),
      id: 90000000002,
      run_id: secondRun.id,
    };
    f.state.candidates = list(
      'workflow_runs',
      reverse ? [secondRun, f.state.later] : [f.state.later, secondRun],
    );
    f.state.apiResponse = (route) =>
      route === '/actions/runs/90000000001/attempts/1'
        ? json(secondRun)
        : route === '/actions/runs/90000000001/attempts/1/jobs?per_page=100'
          ? json(list('jobs', [secondJob]))
          : undefined;
    const result = await f.decide();
    assert.equal(result.decision, 'superseded');
    assert.equal(result.successor_deployments.length, 2);
    secondJob.conclusion = 'failure';
    assert.equal((await f.decide()).decision, 'failed');
  }
  const f = fixture();
  f.state.candidates.workflow_runs[0].run_attempt = 2;
  f.state.apiResponse = (route) =>
    route === '/actions/runs/39281193002/attempts/2' ? json(f.state.later) : undefined;
  assert.equal((await f.decide()).reason, 'deployment_identity_mismatch');
});

test('every artifact, validation, activation and verification step must have executed exactly once', async (t) => {
  for (const index of [0, 1, 2, 3])
    for (const variant of ['missing', 'duplicate', 'skipped', 'failure', 'pending']) {
      await t.test(`${index}: ${variant}`, () => {
        const f = fixture();
        const job = f.state.laterJobs.jobs[0];
        if (variant === 'missing') job.steps.splice(index, 1);
        else if (variant === 'duplicate') job.steps.push({ ...job.steps[index], number: 90 });
        else if (variant === 'pending') job.steps[index].status = 'in_progress';
        else job.steps[index].conclusion = variant;
        assert.throws(() =>
          qualifyDeployment(f.state.later, f.state.laterJobs, context, { sha: LATER }),
        );
      });
    }
  for (const conclusion of ['success', 'failure', undefined]) {
    const f = fixture();
    f.state.laterJobs.jobs[0].steps[4].conclusion = conclusion;
    assert.throws(
      () => qualifyDeployment(f.state.later, f.state.laterJobs, context, { sha: LATER }),
      /restore_not_proven_skipped/,
    );
  }
});

test('chronology is typed, ordered, within the job, and strictly later than original verification', async (t) => {
  for (const bad of [null, '', 'tomorrow', '2026-02-31T12:00:00Z', 1]) {
    const f = fixture();
    f.state.laterJobs.jobs[0].steps[2].started_at = bad;
    assert.throws(
      () => qualifyDeployment(f.state.later, f.state.laterJobs, context, { sha: LATER }),
      /invalid_chronology/,
    );
  }
  for (const mutation of [
    (job) => (job.steps[3].number = 2),
    (job) => (job.steps[3].number = job.steps[2].number),
    (job) => (job.steps[3].started_at = '2026-10-19T16:31:59Z'),
    (job) => (job.steps[3].completed_at = '2026-10-19T17:00:00Z'),
  ]) {
    const f = fixture();
    mutation(f.state.laterJobs.jobs[0]);
    assert.throws(() =>
      qualifyDeployment(f.state.later, f.state.laterJobs, context, { sha: LATER }),
    );
  }
  for (const separation of [0, -1])
    await t.test(`activation after original verification by ${separation} ms`, async () => {
      const f = fixture();
      const job = f.state.laterJobs.jobs[0];
      const delta =
        Date.parse(f.state.originalJobs.jobs[0].steps[3].completed_at) +
        separation -
        Date.parse(job.steps[2].started_at);
      for (const item of [job, ...job.steps])
        for (const field of ['started_at', 'completed_at']) {
          item[field] = new Date(Date.parse(item[field]) + delta).toISOString();
        }
      assert.equal((await f.decide()).reason, 'unproven_release_order');
    });
});

test('unrelated, older, or no-longer-accepted live versions fail even with green deployment metadata', async (t) => {
  const mutations = {
    'unrelated merge base': (f) => (f.state.originalToLive.merge_base_commit.sha = MAIN),
    'older live': (f) => (f.state.originalToLive.status = 'behind'),
    'diverged live': (f) => (f.state.originalToLive.behind_by = 1),
    'current main excludes live': (f) => (f.state.liveToMain.merge_base_commit.sha = ORIGINAL),
    'main identity invalid': (f) => (f.state.branch.commit.sha = 'short'),
    'wrong branch': (f) => (f.state.branch.name = 'feature'),
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, async () => {
      const f = fixture();
      mutate(f);
      assert.equal((await f.decide()).decision, 'failed');
    });
  const f = fixture();
  f.state.branch.commit.sha = LATER;
  assert.equal((await f.decide()).decision, 'superseded');
});

test('the final public read cannot inherit the proof for a different release', async () => {
  for (const changed of [MAIN, ORIGINAL]) {
    const f = fixture();
    f.state.versions.push({ commit: changed });
    assert.equal((await f.decide()).reason, 'live_identity_changed');
    assert.equal(f.state.versionReads, 2);
    assert.equal(f.state.sleeps.length, 0);
  }
});

test('the confirming public read uses a distinct cache key even within the same millisecond', async (t) => {
  t.mock.method(Date, 'now', () => 1792427520000);
  const f = fixture();
  assert.equal((await f.decide()).decision, 'superseded');
  const urls = f.state.calls
    .filter((call) => call.url.startsWith('https://pickyour.ai/'))
    .map((call) => call.url);
  assert.equal(urls.length, 2);
  assert.notEqual(urls[0], urls[1]);
});

test('metadata lag is bounded and must resolve to actual successful steps, with a stable live identity', async () => {
  const f = fixture();
  f.state.later.status = 'in_progress';
  f.state.onSleep = () => {
    f.state.later.status = 'completed';
  };
  const result = await f.decide();
  assert.equal(result.decision, 'superseded');
  assert.equal(result.attempts, 2);
  assert.deepEqual(f.state.sleeps, [LIMITS.intervalMs]);
  assert.equal(f.state.versionReads, 3);
  const never = fixture();
  never.state.laterJobs.jobs[0].status = 'in_progress';
  const failed = await never.decide();
  assert.equal(failed.reason, 'reconciliation_exhausted');
  assert.equal(failed.last_pending_reason, 'deployment_pending');
  assert.equal(never.state.versionReads, LIMITS.attempts);
  assert.equal(never.state.sleeps.length, LIMITS.attempts - 1);
  const changed = fixture();
  changed.state.later.status = 'in_progress';
  changed.state.versions.push({ commit: MAIN });
  assert.equal((await changed.decide()).reason, 'live_identity_changed');
});

test('a global deadline ends retries even when the attempt budget has not been used', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.dependencies.signal = controller.signal;
  f.state.apiResponse = () => json({}, { status: 503 });
  f.state.onSleep = () => controller.abort();
  const result = await f.decide();
  assert.equal(result.reason, 'reconciliation_deadline');
  assert.equal(result.attempts, 1);
});

test('HTTP, malformed, oversized and private-error responses never become superseded', async (t) => {
  const variants = {
    'permission failure': () => json({}, { status: 403 }),
    redirect: () => json({}, { status: 302 }),
    'malformed JSON': () =>
      new Response('private/secret/invalid', { headers: { 'content-type': 'application/json' } }),
    HTML: () => new Response('<html>private</html>', { headers: { 'content-type': 'text/html' } }),
    'large JSON': () => json({ private: 'x'.repeat(LIMITS.apiBytes) }),
    exception: () => {
      throw new Error(`private path /home/private/key ${SECRET}`);
    },
  };
  for (const [name, respond] of Object.entries(variants))
    await t.test(name, async () => {
      const f = fixture();
      f.state.apiResponse = respond;
      const result = await f.decide();
      assert.equal(result.decision, 'failed');
      assert.doesNotMatch(JSON.stringify(result), /private|secret|Bearer/);
    });
  for (const value of [null, {}, { commit: 'short' }, { commit: [LATER] }]) {
    const f = fixture();
    f.state.versions = [value];
    assert.equal((await f.decide()).reason, 'invalid_live_identity');
  }
  const cached = fixture();
  cached.state.liveResponse = () =>
    json(
      { commit: LATER },
      { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } },
    );
  assert.equal((await cached.decide()).reason, 'cached_live_identity');
});

test('the deadline also covers a stalled response body and cancels its reader', async (t) => {
  const f = fixture();
  const controller = new AbortController();
  let cancelled = 0;
  const timer = setTimeout(() => controller.abort(), 20);
  t.after(() => clearTimeout(timer));
  f.dependencies.signal = controller.signal;
  f.state.liveResponse = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"commit":'));
        },
        cancel() {
          cancelled++;
        },
      }),
      { headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' } },
    );
  assert.equal((await f.decide()).reason, 'reconciliation_deadline');
  assert.equal(cancelled, 1);
});

test('a fetch that never produces headers also fails within the global deadline', async (t) => {
  const f = fixture();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20);
  t.after(() => clearTimeout(timer));
  f.dependencies.signal = controller.signal;
  f.dependencies.fetch = () => new Promise(() => {});
  assert.equal((await f.decide()).reason, 'reconciliation_deadline');
  assert.equal(f.state.sleeps.length, 0);
});

async function cliFixture(t, fixture) {
  const directory = await mkdtemp(join(tmpdir(), 'live-admission-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = {
    GITHUB_EVENT_NAME: fixture.input.eventName,
    GITHUB_EVENT_PATH: join(directory, 'event.json'),
    EXPECTED_SHA: fixture.input.expectedSha,
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REPOSITORY_ID: String(REPOSITORY_ID),
    PRODUCTION_URL: 'https://pickyour.ai',
    GH_TOKEN: SECRET,
    ADMISSION_RECEIPT: join(directory, 'receipt.json'),
    GITHUB_OUTPUT: join(directory, 'output'),
    GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
  };
  await writeFile(env.GITHUB_EVENT_PATH, JSON.stringify(fixture.input.event));
  await writeFile(env.GITHUB_OUTPUT, '');
  return env;
}

test('CLI retains a reviewable superseded receipt and explicitly separates it from a browser pass', async (t) => {
  const f = fixture();
  const env = await cliFixture(t, f);
  assert.equal(await main(env, f.dependencies), 0);
  const receipt = JSON.parse(await readFile(env.ADMISSION_RECEIPT, 'utf8'));
  assert.equal(receipt.decision, 'superseded');
  assert.equal(receipt.original_deployment.run_id, 39277650970);
  assert.equal(receipt.successor_deployments[0].run_id, 39281193002);
  assert.equal(await readFile(env.GITHUB_OUTPUT, 'utf8'), 'decision=superseded\n');
  const summary = await readFile(env.GITHUB_STEP_SUMMARY, 'utf8');
  assert.match(summary, /Obsolete browser run explicitly skipped/);
  assert.match(summary, /no browser pass is claimed/);
  assert.equal(summary.includes(SECRET), false);
  assert.equal(env.EXPECTED_SHA, ORIGINAL);
});

test('CLI fails safely for malformed events and never admits if receipt publication fails', async (t) => {
  const f = fixture();
  const env = await cliFixture(t, f);
  await writeFile(env.GITHUB_EVENT_PATH, `private ${SECRET}`);
  assert.equal(await main(env, f.dependencies), 1);
  assert.equal(
    JSON.parse(await readFile(env.ADMISSION_RECEIPT, 'utf8')).reason,
    'event_read_failed',
  );
  assert.doesNotMatch(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8'), /synthetic-read-token/);
  const other = await cliFixture(t, f);
  other.ADMISSION_RECEIPT = join(other.GITHUB_OUTPUT, 'unwritable');
  assert.equal(await main(other, f.dependencies), 1);
  assert.equal(await readFile(other.GITHUB_OUTPUT, 'utf8'), '');
});

test('ordinary CI runs the CPU tests, and live workflow gates only obsolete browser work', async () => {
  const workflow = parse(await readFile(repoFile(path.slice(1)), 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.equal(
    workflow.concurrency.group,
    "e2e-live-${{ github.event_name }}-${{ github.event_name == 'workflow_run' && github.event.workflow_run.id || github.ref }}",
  );
  const liveJob = workflow.jobs['e2e-live'];
  assert.equal(
    liveJob.env.EXPECTED_SHA,
    "${{ github.event_name == 'workflow_run' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_sha || '' }}",
  );
  const admission = liveJob.steps.find((step) => step.id === 'admission');
  assert.equal(admission.run, 'node scripts/deploy/live-admission.mjs');
  assert.equal(admission.env.GH_TOKEN, '${{ github.token }}');
  const gated = liveJob.steps.filter((step) => /npm ci|npx playwright/.test(step.run ?? ''));
  assert.equal(gated.length, 3);
  for (const step of gated) {
    assert.equal(step.if, "steps.admission.outputs.decision == 'run'");
    assert.ok(liveJob.steps.indexOf(admission) < liveJob.steps.indexOf(step));
  }
  assert.ok(
    liveJob.steps.some((step) => step.if === 'failure()' && step.with?.name === 'e2e-live-results'),
  );
  assert.ok(
    liveJob.steps.some((step) => step.if === 'always()' && step.with?.name === 'live-admission'),
  );
  assert.equal(liveJob.steps.filter((step) => step.env?.GH_TOKEN).length, 1);
  const spec = await readFile(repoFile('tests/e2e-live/production.live.spec.ts'), 'utf8');
  assert.ok(spec.includes('if (expectedSha) expect(v.commit).toBe(expectedSha);'));
  const pkg = JSON.parse(await readFile(repoFile('package.json'), 'utf8'));
  assert.equal(
    pkg.scripts.test,
    'node --test scripts/deploy/live-admission.test.mjs && vitest run',
  );
  const ci = parse(await readFile(repoFile('.github/workflows/ci.yml'), 'utf8'));
  assert.ok(ci.jobs.unit.steps.some((step) => step.run === 'npm test'));
});

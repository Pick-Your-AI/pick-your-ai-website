// Read-only admission for delayed deployment events. See issue #318 and the deployment runbook.
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const WORKFLOW = { name: 'Deploy production', path: '.github/workflows/deploy-production.yml' };
const REQUIRED_STEPS = [
  'Check the artifact is the exact commit',
  'Validate release on host',
  'Activate',
  'Verify live site through Cloudflare',
];
export const LIMITS = Object.freeze({
  totalMs: 240_000,
  requestMs: 10_000,
  attempts: 13,
  intervalMs: 20_000,
  runs: 5,
  jobs: 100,
  apiBytes: 1_048_576,
  versionBytes: 4_096,
});

class AdmissionError extends Error {
  constructor(code, retryable = false) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}
function requireThat(condition, code) {
  if (!condition) throw new AdmissionError(code);
}
function id(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function isSha(value) {
  return typeof value === 'string' && SHA.test(value);
}
function timestamp(value) {
  requireThat(
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value),
    'invalid_chronology',
  );
  const parsed = Date.parse(value);
  requireThat(
    Number.isFinite(parsed) &&
      new Date(parsed).toISOString() === value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z'),
    'invalid_chronology',
  );
  return parsed;
}
function sameRepository(repository, context) {
  return repository?.id === context.repositoryId && repository?.full_name === context.repository;
}
function runIdentity(run, context, expected) {
  requireThat(
    sameRepository(run?.repository, context) &&
      sameRepository(run?.head_repository, context) &&
      run.workflow_id === context.workflowId &&
      run.path === WORKFLOW.path &&
      run.name === WORKFLOW.name &&
      run.event === 'push' &&
      run.head_branch === 'main' &&
      run.head_sha === expected.sha &&
      id(run.id) &&
      id(run.run_attempt) &&
      (expected.runId === undefined || run.id === expected.runId) &&
      (expected.attempt === undefined || run.run_attempt === expected.attempt),
    'deployment_identity_mismatch',
  );
}
function completeSuccess(value) {
  if (['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(value.status)) {
    throw new AdmissionError('deployment_pending', true);
  }
  requireThat(value.status === 'completed', 'invalid_deployment_status');
  requireThat(value.conclusion === 'success', 'deployment_not_successful');
}
function boundedList(value, field, maximum) {
  requireThat(
    Array.isArray(value?.[field]) &&
      Number.isSafeInteger(value.total_count) &&
      value.total_count >= 0 &&
      value.total_count === value[field].length &&
      value.total_count <= maximum,
    'incomplete_or_excessive_evidence',
  );
  return value[field];
}

// The authenticated attempt/job identity is the trust boundary: these exact steps in the
// canonical, reviewed main workflow check the same-run artifact, activate it, then verify SHA
// equality through Cloudflare. A green workflow or accepted commit alone is insufficient.
export function qualifyDeployment(run, response, context, expected) {
  runIdentity(run, context, expected);
  completeSuccess(run);
  const jobs = boundedList(response, 'jobs', LIMITS.jobs);
  const matching = jobs.filter((job) => job.name === 'deploy');
  if (matching.length === 0) throw new AdmissionError('deployment_job_pending', true);
  requireThat(matching.length === 1, 'ambiguous_deployment_job');
  const job = matching[0];
  requireThat(
    id(job.id) &&
      job.run_id === run.id &&
      job.run_attempt === run.run_attempt &&
      job.workflow_name === WORKFLOW.name &&
      job.head_branch === 'main' &&
      job.head_sha === run.head_sha &&
      Array.isArray(job.steps),
    'deployment_job_identity_mismatch',
  );
  completeSuccess(job);
  const start = timestamp(job.started_at);
  const finish = timestamp(job.completed_at);
  requireThat(start <= finish, 'invalid_chronology');
  requireThat(
    job.steps.every((step) => id(step.number)) &&
      new Set(job.steps.map((step) => step.number)).size === job.steps.length,
    'ambiguous_deployment_step',
  );
  let priorEnd = start;
  let priorNumber = 0;
  const steps = REQUIRED_STEPS.map((name) => {
    const matches = job.steps.filter((step) => step.name === name);
    requireThat(matches.length === 1, 'missing_or_ambiguous_deployment_step');
    const step = matches[0];
    completeSuccess(step);
    const stepStart = timestamp(step.started_at);
    const stepEnd = timestamp(step.completed_at);
    requireThat(
      priorNumber < step.number &&
        priorEnd <= stepStart &&
        stepStart <= stepEnd &&
        stepEnd <= finish,
      'invalid_chronology',
    );
    priorNumber = step.number;
    priorEnd = stepEnd;
    return {
      name,
      number: step.number,
      started_at: step.started_at,
      completed_at: step.completed_at,
    };
  });
  const restores = job.steps.filter((step) => step.name === 'Restore previous release on failure');
  requireThat(
    restores.length === 1 &&
      restores[0].status === 'completed' &&
      restores[0].conclusion === 'skipped',
    'restore_not_proven_skipped',
  );
  return {
    sha: run.head_sha,
    run_id: run.id,
    run_attempt: run.run_attempt,
    workflow_id: run.workflow_id,
    workflow_path: run.path,
    job_id: job.id,
    started_at: job.started_at,
    completed_at: job.completed_at,
    steps,
  };
}

function abortable(promise, signal) {
  return new Promise((resolvePromise, reject) => {
    const aborted = () => reject(new AdmissionError('read_timeout', true));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    Promise.resolve(promise)
      .then(resolvePromise, reject)
      .finally(() => signal.removeEventListener('abort', aborted));
  });
}
async function readJson(fetchImpl, url, { token, limit, signal }) {
  const controller = new AbortController();
  const requestSignal = AbortSignal.any([
    signal,
    controller.signal,
    AbortSignal.timeout(LIMITS.requestMs),
  ]);
  let reader;
  try {
    const response = await abortable(
      fetchImpl(url, {
        signal: requestSignal,
        redirect: 'error',
        cache: 'no-store',
        headers: token
          ? {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2026-03-10',
            }
          : { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      }),
      requestSignal,
    );
    if (response.status === 404 || response.status === 429 || response.status >= 500) {
      throw new AdmissionError('evidence_temporarily_unavailable', true);
    }
    requireThat(response.status === 200 && !response.redirected, 'unexpected_http_response');
    requireThat(
      /\bjson\b/i.test(response.headers.get('content-type') ?? ''),
      'invalid_json_response',
    );
    if (!token) {
      requireThat(
        /\bno-cache\b/i.test(response.headers.get('cache-control') ?? ''),
        'cached_live_identity',
      );
    }
    requireThat(response.body, 'empty_response');
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await abortable(reader.read(), requestSignal);
      if (done) break;
      length += value.byteLength;
      requireThat(length <= limit, 'response_too_large');
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
    } catch {
      throw new AdmissionError('invalid_json_response');
    }
  } catch (error) {
    if (error instanceof AdmissionError) throw error;
    throw new AdmissionError('read_failed', true);
  } finally {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

function acceptedComparison(comparison, base, head) {
  requireThat(
    comparison?.base_commit?.sha === base &&
      comparison.merge_base_commit?.sha === base &&
      comparison.status === (base === head ? 'identical' : 'ahead') &&
      comparison.behind_by === 0 &&
      Number.isSafeInteger(comparison.ahead_by) &&
      (base === head ? comparison.ahead_by === 0 : comparison.ahead_by > 0),
    'unaccepted_live_identity',
  );
  return { base, head, ahead_by: comparison.ahead_by };
}

export async function admitLiveEvent(input, dependencies = {}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const wait = dependencies.sleep ?? sleep;
  const signal = AbortSignal.any([
    AbortSignal.timeout(LIMITS.totalMs),
    ...(dependencies.signal ? [dependencies.signal] : []),
  ]);
  const receipt = { schema_version: 1, decision: 'failed', attempts: 0 };
  try {
    const { eventName, event, expectedSha, repository, repositoryId, productionUrl, token } = input;
    requireThat(
      ['workflow_run', 'schedule', 'workflow_dispatch'].includes(eventName),
      'unsupported_event',
    );
    if (eventName !== 'workflow_run' || event?.workflow_run?.event === 'workflow_dispatch') {
      requireThat(expectedSha === '', 'unexpected_expected_sha');
      return { ...receipt, decision: 'run', reason: 'unbound_schedule_or_manual_check' };
    }
    requireThat(
      typeof repository === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository) &&
        id(repositoryId) &&
        isSha(expectedSha),
      'invalid_admission_input',
    );
    const trigger = event?.workflow_run;
    const context = { repository, repositoryId, workflowId: trigger?.workflow_id };
    requireThat(
      sameRepository(event?.repository, context) && id(context.workflowId),
      'repository_mismatch',
    );
    const expected = { sha: expectedSha, runId: trigger?.id, attempt: trigger?.run_attempt };
    runIdentity(trigger, context, expected);
    completeSuccess(trigger);
    requireThat(typeof token === 'string' && token.length > 0, 'missing_read_token');
    const origin = new URL(productionUrl);
    requireThat(
      origin.protocol === 'https:' &&
        !origin.username &&
        !origin.password &&
        origin.pathname === '/' &&
        !origin.search &&
        !origin.hash,
      'invalid_production_origin',
    );
    Object.assign(receipt, {
      repository,
      repository_id: repositoryId,
      expected_sha: expectedSha,
      trigger: {
        run_id: trigger.id,
        run_attempt: trigger.run_attempt,
        workflow_id: trigger.workflow_id,
      },
    });
    const api = (path) =>
      readJson(fetchImpl, `https://api.github.com/repos/${repository}${path}`, {
        token,
        limit: LIMITS.apiBytes,
        signal,
      });
    let liveReads = 0;
    const live = async () => {
      const url = new URL('/version.json', origin);
      url.searchParams.set('admission', `${Date.now()}-${receipt.attempts}-${++liveReads}`);
      const value = await readJson(fetchImpl, url.href, { limit: LIMITS.versionBytes, signal });
      requireThat(isSha(value?.commit), 'invalid_live_identity');
      return value.commit;
    };
    const deployment = async (runId, attempt, sha) => {
      const path = `/actions/runs/${runId}/attempts/${attempt}`;
      const run = await api(path);
      runIdentity(run, context, { sha, runId, attempt });
      completeSuccess(run);
      return qualifyDeployment(run, await api(`${path}/jobs?per_page=${LIMITS.jobs}`), context, {
        sha,
        runId,
        attempt,
      });
    };
    for (let attempt = 1; attempt <= LIMITS.attempts; attempt++) {
      receipt.attempts = attempt;
      try {
        if (signal.aborted) throw new AdmissionError('reconciliation_deadline');
        const workflow = await api('/actions/workflows/deploy-production.yml');
        requireThat(
          workflow.id === context.workflowId &&
            workflow.name === WORKFLOW.name &&
            workflow.path === WORKFLOW.path &&
            workflow.state === 'active',
          'canonical_workflow_mismatch',
        );
        const originalPath = `/actions/runs/${trigger.id}/attempts/${trigger.run_attempt}`;
        const originalRun = await api(originalPath);
        runIdentity(originalRun, context, expected);
        completeSuccess(originalRun);
        const observed = await live();
        requireThat(
          !receipt.observed_sha || receipt.observed_sha === observed,
          'live_identity_changed',
        );
        receipt.observed_sha = observed;
        // Canonical identity must be checked even here. Matching SHA permits strict assertions;
        // it does not establish that a deployment job ran or that any browser test passed.
        if (observed === expectedSha)
          return { ...receipt, decision: 'run', reason: 'expected_release_is_live' };
        const branch = await api('/branches/main');
        requireThat(branch.name === 'main' && isSha(branch.commit?.sha), 'invalid_main_identity');
        receipt.main_sha = branch.commit.sha;
        receipt.accepted_ancestry = [
          acceptedComparison(
            await api(`/compare/${expectedSha}...${observed}?per_page=1`),
            expectedSha,
            observed,
          ),
        ];
        if (observed !== branch.commit.sha) {
          receipt.accepted_ancestry.push(
            acceptedComparison(
              await api(`/compare/${observed}...${branch.commit.sha}?per_page=1`),
              observed,
              branch.commit.sha,
            ),
          );
        }
        const original = qualifyDeployment(
          originalRun,
          await api(`${originalPath}/jobs?per_page=${LIMITS.jobs}`),
          context,
          expected,
        );
        const candidates = boundedList(
          await api(
            `/actions/workflows/${context.workflowId}/runs?branch=main&event=push&head_sha=${observed}&per_page=${LIMITS.runs}`,
          ),
          'workflow_runs',
          LIMITS.runs,
        );
        if (candidates.length === 0) throw new AdmissionError('successor_deployment_pending', true);
        requireThat(
          new Set(candidates.map((run) => run.id)).size === candidates.length,
          'ambiguous_deployment_run',
        );
        const proofs = [];
        for (const candidate of candidates) {
          runIdentity(candidate, context, { sha: observed });
          // Do not borrow an older attempt's success or silently ignore an indeterminate deployment.
          const proof = await deployment(candidate.id, candidate.run_attempt, observed);
          requireThat(
            timestamp(original.steps[3].completed_at) < timestamp(proof.steps[2].started_at),
            'unproven_release_order',
          );
          proofs.push(proof);
        }
        requireThat((await live()) === observed, 'live_identity_changed');
        return {
          ...receipt,
          decision: 'superseded',
          reason: 'verified_later_release_is_live',
          original_deployment: original,
          successor_deployments: proofs,
        };
      } catch (error) {
        if (!(error instanceof AdmissionError) || !error.retryable) throw error;
        receipt.last_pending_reason = error.code;
        if (signal.aborted) throw new AdmissionError('reconciliation_deadline');
        if (attempt === LIMITS.attempts) throw new AdmissionError('reconciliation_exhausted');
        await abortable(wait(LIMITS.intervalMs, undefined, { signal }), signal);
      }
    }
  } catch (error) {
    return {
      ...receipt,
      reason: signal.aborted
        ? 'reconciliation_deadline'
        : error instanceof AdmissionError
          ? error.code
          : 'invalid_admission_data',
    };
  }
}

export async function main(env = process.env, dependencies = {}) {
  let result;
  try {
    result = await admitLiveEvent(
      {
        eventName: env.GITHUB_EVENT_NAME,
        event: JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')),
        expectedSha: env.EXPECTED_SHA ?? '',
        repository: env.GITHUB_REPOSITORY,
        repositoryId: Number(env.GITHUB_REPOSITORY_ID),
        productionUrl: env.PRODUCTION_URL,
        token: env.GH_TOKEN,
      },
      dependencies,
    );
  } catch {
    result = { schema_version: 1, decision: 'failed', reason: 'event_read_failed', attempts: 0 };
  }
  result.checked_at = new Date().toISOString();
  const scope =
    result.decision === 'superseded'
      ? 'Obsolete browser run explicitly skipped; no browser pass is claimed for the expected release.'
      : result.decision === 'run'
        ? 'Run the existing live suite with its unchanged EXPECTED_SHA. Admission is not a test result.'
        : 'Admission failed. No deployment or supersession is certified.';
  try {
    await writeFile(env.ADMISSION_RECEIPT, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `### Live admission: ${result.decision}\n\n${scope}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`,
    );
    await appendFile(env.GITHUB_OUTPUT, `decision=${result.decision}\n`);
  } catch {
    process.stderr.write('Live admission failed: receipt_write_failed\n');
    return 1;
  }
  process.stdout.write(`Live admission: ${result.decision} (${result.reason})\n`);
  return result.decision === 'failed' ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

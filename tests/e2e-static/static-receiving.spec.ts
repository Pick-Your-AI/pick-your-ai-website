/* Synthetic HTTP receiving coverage only; this admits no real catalog or publication rights. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test as base, type Page } from '@playwright/test';
import type { BuildSnapshot, DependencyGraph, Ruleset } from '../../src/contracts';

// Playwright's CommonJS TS hook also handles the app fixtures' transitive JSON imports.
const loadFixture = createRequire(import.meta.url);
const { DEMO_CATALOG, DEMO_VERSION } = loadFixture(
  '../../src/data/fixture/catalog.ts',
) as typeof import('../../src/data/fixture/catalog');
const { DEMO_PRICEBOOK } = loadFixture(
  '../../src/data/fixture/pricebook.ts',
) as typeof import('../../src/data/fixture/pricebook');

// Serve the frozen policy bytes unchanged, including the ruleset's version query.
const graphBody = readFileSync('contracts/v1/baseline/core-dependency-graph.json', 'utf8');
const rulesetBody = readFileSync('contracts/v1/baseline/core-ruleset.json', 'utf8');
const graph = JSON.parse(graphBody) as DependencyGraph;
const ruleset = JSON.parse(rulesetBody) as Ruleset;
const catalogPath = `/v1/catalog/snapshots/${DEMO_CATALOG.id}`;
const artifacts = new Map([
  [catalogPath, JSON.stringify(DEMO_CATALOG)],
  [`/v1/pricebooks/${DEMO_PRICEBOOK.id}`, JSON.stringify(DEMO_PRICEBOOK)],
  [`/v1/dependencies/${graph.id}`, graphBody],
  [`/v1/rulesets/${ruleset.id}?version=${ruleset.version}`, rulesetBody],
]);

type CatalogFailure = 'schema' | 'identity' | 'http';
interface Receiving {
  catalogFailure?: CatalogFailure;
  requests: string[];
}

const test = base.extend<{ receiving: Receiving }>({
  receiving: [
    async ({ context, baseURL }, run) => {
      const origin = new URL(baseURL!).origin;
      expect(['localhost', '127.0.0.1']).toContain(new URL(origin).hostname);
      const receiving: Receiving = { requests: [] };
      const external: string[] = [];
      const mutations: string[] = [];
      const rejected: string[] = [];
      await context.routeWebSocket(/.*/, (socket) => {
        rejected.push(`WebSocket ${socket.url()}`);
        socket.close();
      });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        if (url.origin !== origin) {
          external.push(`${method} ${url.origin}`);
          return route.abort('blockedbyclient');
        }
        if (!['GET', 'HEAD'].includes(method)) {
          mutations.push(`${method} ${url.pathname}`);
          return route.abort('blockedbyclient');
        }
        if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
          const path = `${url.pathname}${url.search}`;
          receiving.requests.push(`${method} ${path}`);
          const body = artifacts.get(path);
          if (!body) {
            rejected.push(`${method} ${path}`);
            return route.abort('blockedbyclient');
          }
          const failure = path === catalogPath && receiving.catalogFailure;
          return route.fulfill({
            status: failure === 'http' ? 503 : 200,
            contentType: 'application/json',
            body:
              method === 'HEAD'
                ? ''
                : failure === 'schema'
                  ? JSON.stringify({ ...DEMO_CATALOG, items: [] })
                  : failure === 'identity'
                    ? JSON.stringify({ ...DEMO_CATALOG, id: 'catalog.demo.wrong' })
                    : failure === 'http'
                      ? JSON.stringify({ message: 'Synthetic catalog unavailable' })
                      : body,
          });
        }
        // Only the local built React app and its same-origin assets reach the preview server.
        return route.continue();
      });
      try {
        await run(receiving);
      } finally {
        expect(external, 'No request may escape the preview origin').toEqual([]);
        expect(mutations, 'Static receiving and local persistence must never write an API').toEqual(
          [],
        );
        expect(rejected, 'Only exact immutable API paths and versions are admitted').toEqual([]);
      }
    },
    { auto: true },
  ],
});

test.use({ serviceWorkers: 'block' });

async function savedBuild(page: Page): Promise<BuildSnapshot | null> {
  return page.evaluate(() => {
    const id = localStorage.getItem('pyai.currentBuildId');
    const raw = id && localStorage.getItem(`pyai.build.${id}`);
    return raw ? JSON.parse(raw).build : null;
  });
}

const locks = {
  catalog_snapshot_id: DEMO_CATALOG.id,
  pricebook_id: DEMO_PRICEBOOK.id,
  dependency_graph_id: graph.id,
  dependency_graph_revision: graph.revision,
  ruleset_id: ruleset.id,
  ruleset_version: ruleset.version,
};

async function assertSummary(page: Page) {
  const details = page.getByRole('region', { name: 'Build details' });
  await expect(details).toContainText(DEMO_CATALOG.id);
  await expect(details).toContainText(DEMO_PRICEBOOK.id);
  await expect(details).toContainText(`${ruleset.id}@${ruleset.version}`);
  await expect(details).toContainText(`${graph.id} r${graph.revision}`);
  await expect(page.getByRole('row', { name: /Demo Customer Support Chat/ })).toContainText(
    'Synthetic',
  );
  await expect(
    page.getByText('Synthetic demo prices — not a quote', { exact: true }),
  ).toBeVisible();
  const capacity = page.getByRole('region', { name: 'Capacity evidence' });
  await expect(capacity).toContainText(/memory and throughput checks stay unknown/i);
  await expect(capacity).toContainText(/no calibrated capacity estimator/i);
  await expect(page.getByText(/^All rule outcomes/)).toBeVisible();
  await page.getByText(/^All rule outcomes/).click();
  const memoryRule = page.getByRole('row', { name: /rule\.vram\.estimate\.fit/ });
  await expect(memoryRule.getByRole('cell').first()).toHaveText('Unknown');
}

test('receives synthetic HTTP artifacts into a blank build, summary and local reopen', async ({
  page,
  receiving,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-18T12:00:00Z'));
  await page.goto('/catalog/workload?show=all');
  await expect(page.getByRole('row', { name: /Demo Customer Support Chat/ })).toBeVisible();
  await page.goto('/builder');
  await expect(page.getByTestId('overall-status')).toContainText('0 of 4 required choices made');
  await expect(page.getByRole('button', { name: /^Remove .* from the stack$/ })).toHaveCount(0);

  // Inspect the received synthetic provenance before selecting this item through the real UI.
  await page.goto('/catalog/workload/demo~workload~support-chat');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo Customer Support Chat');
  await expect(page.locator('.detail-provenance')).toContainText('SYNTHETIC DEMO FIXTURE');
  await expect(page.locator('.detail-provenance')).toContainText('unverified');
  await expect(page.locator('.detail-provenance')).toContainText('No source URL recorded');
  await page.getByRole('button', { name: /Add to my stack/ }).click();
  await expect(page.getByRole('button', { name: /In your build/ })).toBeDisabled();

  for (const [kind, name] of [
    ['deployment-mode', 'Self-hosted'],
    ['accelerator', 'Demo C24 GPU'],
    ['compute-profile', 'Nimbus 1× C24 instance'],
  ]) {
    await page.goto(`/catalog/${kind}?show=all`);
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name, exact: true }) });
    await row.getByRole('button', { name: /^Add$/ }).click();
    await expect(row).toContainText('In stack');
  }

  await page.goto('/builder');
  await page.getByLabel('Build name').fill('Offline HTTP receiving stack');
  await page.getByLabel('Build name').blur();
  await expect
    .poll(async () => (await savedBuild(page))?.name)
    .toBe('Offline HTTP receiving stack');
  const saved = (await savedBuild(page))!;
  expect(saved.locks).toEqual(locks);
  expect(saved.selections.map((selection) => selection.catalog_item_id).sort()).toEqual(
    [
      'demo.workload.support-chat',
      'demo.deployment_mode.self-hosted',
      'demo.accelerator.c24',
      'demo.compute_profile.nimbus-1x-c24',
    ].sort(),
  );
  expect(
    saved.selections.every((selection) => selection.catalog_item_version === DEMO_VERSION),
  ).toBe(true);
  await page.getByRole('link', { name: 'Summary', exact: true }).click();
  await assertSummary(page);

  // A full reload and explicit saved-card open exercise browser-local persistence.
  await page.goto('/builds');
  await page.reload();
  const card = page.locator('.saved-card').filter({ hasText: 'Offline HTTP receiving stack' });
  await card.getByRole('button', { name: /Open build/ }).click();
  await expect(page).toHaveURL(/\/builder$/);
  await expect(page.getByLabel('Build name')).toHaveValue('Offline HTTP receiving stack');
  const reopened = (await savedBuild(page))!;
  expect(reopened.id).toBe(saved.id);
  expect(reopened.revision).toBe(saved.revision);
  expect(reopened.locks).toEqual(locks);
  expect(reopened.selections).toEqual(saved.selections);
  await page.getByRole('link', { name: 'Summary', exact: true }).click();
  await assertSummary(page);
  expect(receiving.requests).toEqual(
    expect.arrayContaining([...artifacts.keys()].map((path) => `GET ${path}`)),
  );
});

for (const [failure, message] of [
  ['schema', /CatalogSnapshot failed schema validation/],
  ['identity', /CatalogSnapshot does not match the requested ID/],
  ['http', /returned 503: Synthetic catalog unavailable/],
] as const) {
  test(`shows a visible catalog error for ${failure} refusal`, async ({ page, receiving }) => {
    receiving.catalogFailure = failure;
    await page.goto('/catalog/workload?show=all');
    const alert = page.getByRole('alert').filter({ hasText: message }).first();
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Add$/ })).toHaveCount(0);
    expect(receiving.requests).toContain(`GET ${catalogPath}`);
  });
}

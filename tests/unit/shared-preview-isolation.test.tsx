import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { BuilderProvider } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { exportBuild, importBuild } from '../../src/domain/share';
import SharedBuildPage from '../../src/pages/SharedBuildPage';
import { NOW, apiChat, contradictory, item } from './scenarios';

function exportedFile(build: BuildSnapshot, name: string) {
  const json = JSON.stringify(exportBuild(build, 'fixture', NOW));
  const imported = importBuild(json, 'fixture');
  expect(imported).toEqual({ ok: true, build, warnings: [] });
  const file = new File([json], name, { type: 'application/json' });
  // Supply the browser File API missing from this jsdom runtime.
  Object.defineProperty(file, 'text', { value: async () => json });
  return file;
}

beforeEach(() => localStorage.clear());

describe('successive exported-file previews', () => {
  it.each([
    ['the same declared identity', 'build.test.preview-a'],
    ['different declared identities (control)', 'build.test.preview-b'],
  ])('replaces selections and findings for files with %s', async (_case, secondId) => {
    const first: BuildSnapshot = {
      ...apiChat(),
      id: 'build.test.preview-a',
      name: 'Synthetic clean API preview',
    };
    const second: BuildSnapshot = {
      ...contradictory(),
      id: secondId,
      revision: first.revision,
      name: 'Synthetic contradictory API preview',
    };
    expect(second.selections).not.toEqual(first.selections);
    const firstFile = exportedFile(first, 'synthetic-clean-api.json');
    const secondFile = exportedFile(second, 'synthetic-contradictory-api.json');
    const providers = createFixtureProviders({ now: () => NOW });

    // Establish each file's own contract decisions with the real offline provider,
    // independently of the mounted page's analysis queries.
    const firstCost = await providers.pricing.estimate(first);
    const firstReport = await providers.compatibility.evaluate(first, {
      costEstimate: firstCost,
    });
    const secondCost = await providers.pricing.estimate(second);
    const secondReport = await providers.compatibility.evaluate(second, {
      costEstimate: secondCost,
    });
    expect(firstReport.result).toBe('valid');
    expect(firstReport.summary.failed).toBe(0);
    expect(firstReport.summary.unknown).toBe(0);
    expect(secondReport.result).toBe('invalid');
    const secondFailures = secondReport.findings.filter((finding) => finding.outcome === 'fail');
    expect(secondFailures.map((finding) => finding.rule_id).sort()).toEqual([
      'rule.api.model.access',
      'rule.model.provider.match',
    ]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <BuilderProvider>
            <MemoryRouter initialEntries={['/shared']}>
              <SharedBuildPage />
            </MemoryRouter>
          </BuilderProvider>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
    function preview(file: File) {
      const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
      expect(input).not.toBeNull();
      fireEvent.change(input!, { target: { files: [file] } });
    }

    preview(firstFile);
    expect(await screen.findByRole('heading', { name: first.name })).toBeVisible();
    expect(
      await screen.findByRole('link', { name: item('model', 'aurora-large').name }),
    ).toBeVisible();
    const firstFindings = await screen.findByRole('region', { name: 'Findings' });
    await waitFor(() =>
      expect(firstFindings).toHaveTextContent('No failing or unknown checks in this revision.'),
    );
    expect(screen.getByTestId('overall-status')).toHaveTextContent('checks pass');

    // Keep the page and QueryClient mounted while the user opens another file.
    preview(secondFile);
    expect(await screen.findByRole('heading', { name: second.name })).toBeVisible();
    expect(await screen.findByText(secondFile.name)).toBeVisible();
    const selections = screen.getByRole('region', { name: 'Selections (5)' });
    expect(
      within(selections).getByRole('link', { name: item('model', 'open-8b').name }),
    ).toBeVisible();
    expect(
      within(selections).queryByRole('link', { name: item('model', 'aurora-large').name }),
    ).not.toBeInTheDocument();
    const secondFindings = screen.getByRole('region', { name: 'Findings' });
    await waitFor(() => {
      for (const finding of secondFailures) {
        expect(secondFindings).toHaveTextContent(finding.message);
        expect(finding.remediation).toBeTypeOf('string');
        expect(secondFindings).toHaveTextContent(finding.remediation!);
      }
      expect(secondFindings).not.toHaveTextContent(
        'No failing or unknown checks in this revision.',
      );
      expect(screen.getByTestId('overall-status')).toHaveTextContent('2 failing checks');
    });
  });
});

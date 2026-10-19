import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useBuilder } from '../../src/app/builder-context';
import { DataContext } from '../../src/app/data-context';
import type { BuildSnapshot, EvaluationReport } from '../../src/contracts';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import { buildContext, coverage } from '../../src/domain/activation';
import { createDraft } from '../../src/domain/build';
import BuilderPage from '../../src/features/builder/BuilderPage';
import { nextAction } from '../../src/features/builder/analysis';
import { BY_ID, NOW, apiChat, contradictory } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

function showBuild(build: BuildSnapshot) {
  vi.mocked(useBuilder).mockReturnValue({
    draft: createDraft(build),
    ready: true,
    catalogById: BY_ID,
    lastChange: null,
    saveState: { status: 'saved' },
    apply: vi.fn(),
    startNew: vi.fn(),
    open: vi.fn(),
    restore: vi.fn(),
  });
}

describe('current report presentation', () => {
  it('does not infer passing checks from complete choices without a current report', () => {
    const build = apiChat();
    const chosen = coverage(build, buildContext(build, BY_ID));
    expect(chosen.missing).toEqual([]);
    expect(chosen.dependsOnMode).toEqual([]);
    expect(nextAction(build, chosen, undefined, undefined)).toBe(
      'Compatibility results for this build are not available yet.',
    );
  });

  it.each(['another build at the same revision', 'a new revision', 'replacement evidence'])(
    'withholds previous findings and summary verdicts while evaluating %s',
    async (change) => {
      const previous = contradictory();
      const providers = createFixtureProviders({ now: () => NOW });
      const price = providers.pricing.estimate.bind(providers.pricing);
      const evaluate = providers.compatibility.evaluate.bind(providers.compatibility);
      const previousCost = await price(previous);
      const previousReport = await evaluate(previous, { costEstimate: previousCost });
      expect(previousReport.summary.failed).toBeGreaterThan(0);
      let currentCost = previousCost;
      let holding = false;
      let finish!: (report: EvaluationReport) => void;
      const pending = new Promise<EvaluationReport>((resolve) => {
        finish = resolve;
      });
      vi.spyOn(providers.pricing, 'estimate').mockImplementation(() =>
        Promise.resolve(currentCost),
      );
      const evaluateRequest = vi
        .spyOn(providers.compatibility, 'evaluate')
        .mockImplementation(() => (holding ? pending : Promise.resolve(previousReport)));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <DataContext.Provider value={providers}>
            <MemoryRouter>{children}</MemoryRouter>
          </DataContext.Provider>
        </QueryClientProvider>
      );
      showBuild(previous);
      const view = render(<BuilderPage />, { wrapper: Wrapper });
      await screen.findByRole('region', { name: 'Compatibility findings' });
      expect(screen.getByTestId('overall-status')).toHaveTextContent('Incompatible');
      const announcement = await screen.findByText(
        `Revision ${previousReport.build_revision} evaluated: ${previousReport.summary.failed} failing, ${previousReport.summary.unknown} unknown.`,
      );
      expect(announcement).toHaveAttribute('aria-live', 'polite');
      fireEvent.click(screen.getByRole('button', { name: /Summary$/ }));

      const current =
        change === 'replacement evidence'
          ? previous
          : {
              ...apiChat(),
              id: change === 'a new revision' ? previous.id : 'build.other',
              revision: previous.revision + (change === 'a new revision' ? 1 : 0),
            };
      const oldModel = previous.selections.find((selection) => selection.kind === 'model')!;
      const newModel = current.selections.find((selection) => selection.kind === 'model')!;
      expect(newModel.id).toBe(oldModel.id);
      if (change !== 'replacement evidence') {
        expect(newModel.catalog_item_id).not.toBe(oldModel.catalog_item_id);
      }
      currentCost = {
        ...(await price(current)),
        id: `cost.current.${change.replaceAll(' ', '-')}`,
      };
      const currentReport = {
        ...(await evaluate(current, { costEstimate: currentCost })),
        id: `evaluation.current.${change.replaceAll(' ', '-')}`,
      };
      holding = true;
      evaluateRequest.mockClear();
      if (change === 'replacement evidence') {
        act(() => client.setQueryData(['cost', current.id, current.revision], currentCost));
      } else {
        showBuild(current);
        view.rerender(<BuilderPage />);
      }
      await waitFor(() =>
        expect(evaluateRequest).toHaveBeenCalledWith(current, {
          costEstimate: currentCost,
          resourceEstimate: null,
        }),
      );

      expect(screen.queryByRole('region', { name: 'Compatibility findings' })).toBeNull();
      expect(announcement).toBeEmptyDOMElement();
      expect(screen.getByTestId('overall-status')).not.toHaveTextContent('Incompatible');
      expect(screen.getByTestId('overall-status')).not.toHaveTextContent('Compatible (rules pass)');
      expect(screen.getByTestId('overall-status')).toHaveTextContent('not current');
      expect(screen.queryAllByText(/^All configured checks pass/)).toHaveLength(0);
      expect(screen.getByRole('button', { name: /Hide summary$/ })).toHaveTextContent(
        'Not evaluated',
      );
      const mobile = document.getElementById('mobile-summary');
      expect(mobile).not.toBeNull();
      for (const panel of [
        screen.getByRole('complementary', { name: 'Build summary' }),
        mobile!,
      ]) {
        expect(
          within(panel).getByText('Current compatibility results are not available yet.'),
        ).toBeInTheDocument();
        expect(within(panel).queryAllByText(/^\d+ (fail|unknown|pass|skipped)$/)).toHaveLength(0);
        expect(panel).not.toHaveTextContent(
          `Readiness: ${previousReport.deployment_readiness.replace('_', ' ')}`,
        );
      }

      await act(async () => finish(currentReport));
      await screen.findByRole('region', { name: 'Compatibility findings' });
      expect(screen.getByTestId('overall-status')).toHaveTextContent(
        change === 'replacement evidence' ? 'Incompatible' : 'Compatible (rules pass)',
      );
      expect(screen.getByTestId('overall-status')).not.toHaveTextContent('not current');
      await waitFor(() =>
        expect(announcement).toHaveTextContent(
          `Revision ${currentReport.build_revision} evaluated: ${currentReport.summary.failed} failing, ${currentReport.summary.unknown} unknown.`,
        ),
      );
      view.unmount();
      client.clear();
    },
  );
});

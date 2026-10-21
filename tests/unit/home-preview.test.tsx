import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DataContext } from '../../src/app/data-context';
import { useBuilder } from '../../src/app/builder-context';
import { ToastProvider } from '../../src/components/feedback';
import { createFixtureProviders } from '../../src/data/fixture/providers';
import HomePage from '../../src/pages/HomePage';
import TemplatesPage from '../../src/pages/TemplatesPage';
import { NOW } from './scenarios';

vi.mock('../../src/app/builder-context', () => ({ useBuilder: vi.fn() }));

function setup(page = <HomePage />, mode: 'fixture' | 'http' = 'fixture') {
  const providers = createFixtureProviders({ now: () => NOW });
  providers.mode = mode;
  vi.mocked(useBuilder).mockReturnValue({ startNew: vi.fn() } as unknown as ReturnType<
    typeof useBuilder
  >);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0 } },
  });
  const mount = () =>
    render(
      <QueryClientProvider client={client}>
        <DataContext.Provider value={providers}>
          <MemoryRouter>
            <ToastProvider>{page}</ToastProvider>
          </MemoryRouter>
        </DataContext.Provider>
      </QueryClientProvider>,
    );
  return { providers, mount };
}

describe('home preview evidence', () => {
  it.each(['unknown', 'partial', 'complete'] as const)(
    'preserves %s price coverage',
    async (coverage) => {
      const { providers, mount } = setup();
      const estimate = providers.pricing.estimate.bind(providers.pricing);
      vi.spyOn(providers.pricing, 'estimate').mockImplementation(async (build) => ({
        ...(await estimate(build)),
        coverage,
      }));
      mount();
      const preview = screen.getByRole('group', { name: 'Example demo AI stack' });
      const footer = preview.querySelector('.preview-footer')!;
      if (coverage === 'unknown') {
        await waitFor(() => expect(footer).toHaveTextContent('Unknown'));
        expect(footer).not.toHaveTextContent(/\$0|per 30 days|\/mo/);
      } else if (coverage === 'partial') {
        await waitFor(() => expect(footer).toHaveTextContent('≥'));
        expect(footer).toHaveTextContent('lower bound');
      } else {
        await waitFor(() => expect(footer).toHaveTextContent('per 30 days'));
        expect(footer).not.toHaveTextContent('lower bound');
      }
    },
  );

  it('does not claim success while evaluation is pending', () => {
    const { providers, mount } = setup();
    vi.spyOn(providers.compatibility, 'evaluate').mockImplementation(() => new Promise(() => {}));
    mount();
    const preview = screen.getByRole('group', { name: 'Example demo AI stack' });
    expect(within(preview).getAllByText('Not checked')).toHaveLength(2);
    expect(preview).not.toHaveTextContent('0 detected conflicts');
    expect(preview).not.toHaveTextContent('Checked against the ruleset');
  });

  it('shows an error when evaluation fails', async () => {
    const { providers, mount } = setup();
    vi.spyOn(providers.compatibility, 'evaluate').mockRejectedValue(new Error('Unavailable'));
    mount();
    await waitFor(() => expect(screen.getAllByText('Evaluation unavailable')).toHaveLength(2));
    expect(screen.queryByText('0 detected conflicts')).not.toBeInTheDocument();
    expect(screen.queryByText('Checked against the ruleset')).not.toBeInTheDocument();
  });

  it.each(['unknown', 'pass', 'stale'] as const)('distinguishes a %s report', async (state) => {
    const { providers, mount } = setup();
    const evaluate = providers.compatibility.evaluate.bind(providers.compatibility);
    vi.spyOn(providers.compatibility, 'evaluate').mockImplementation(async (build, evidence) => {
      const report = await evaluate(build, evidence);
      return {
        ...report,
        build_revision: state === 'stale' ? build.revision + 1 : build.revision,
        summary: { ...report.summary, failed: 0, unknown: state === 'unknown' ? 2 : 0 },
      };
    });
    mount();
    if (state === 'stale') {
      await waitFor(() => expect(providers.compatibility.evaluate).toHaveResolved());
      expect(screen.getAllByText('Not checked')).toHaveLength(2);
      expect(screen.queryByText('Checked against the ruleset')).not.toBeInTheDocument();
    } else {
      await screen.findByText(state === 'unknown' ? '2 unknown findings' : '0 detected conflicts');
      if (state === 'unknown')
        expect(screen.queryByText('0 detected conflicts')).not.toBeInTheDocument();
    }
  });
});

describe('HTTP catalog starter isolation', () => {
  it.each(['home', 'templates'])(
    'does not offer or analyze fixture starters on %s',
    async (page) => {
      const { providers, mount } = setup(
        page === 'home' ? <HomePage /> : <TemplatesPage />,
        'http',
      );
      const estimate = vi.spyOn(providers.pricing, 'estimate');
      const resources = vi.spyOn(providers.resources, 'estimate');
      const evaluate = vi.spyOn(providers.compatibility, 'evaluate');
      mount();
      await waitFor(() =>
        expect(screen.queryByText('Loading starter builds…')).not.toBeInTheDocument(),
      );
      expect(document.querySelector('.template-card, .template-showcase, .hero-art')).toBeNull();
      expect(estimate).not.toHaveBeenCalled();
      expect(resources).not.toHaveBeenCalled();
      expect(evaluate).not.toHaveBeenCalled();
      if (page === 'templates')
        expect(
          screen.getByText('No starter builds are available for this catalog.'),
        ).toBeInTheDocument();
    },
  );
});

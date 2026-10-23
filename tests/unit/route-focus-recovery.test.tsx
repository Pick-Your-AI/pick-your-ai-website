import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router';
import { expect, it } from 'vitest';
import { RouteFocus } from '../../src/components/layout';
import { RouteError } from '../../src/pages/RouteError';

function Page({ loaded }: { loaded: boolean }) {
  return (
    <MemoryRouter>
      <main>
        {loaded ? <h1 key="loaded">Editor</h1> : <h1 key="loading">Loading</h1>}
        <button>Other control</button>
      </main>
      <RouteFocus />
    </MemoryRouter>
  );
}
it('transfers navigation focus when a loading heading is replaced', async () => {
  const view = render(<Page loaded={false} />);
  expect(screen.getByRole('heading')).toHaveFocus();
  view.rerender(<Page loaded />);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Editor' })).toHaveFocus());
});
it('does not steal focus after the user moves it', async () => {
  const view = render(<Page loaded={false} />);
  act(() => screen.getByRole('button').focus());
  view.rerender(<Page loaded />);
  await act(async () => {});
  expect(screen.getByRole('button')).toHaveFocus();
});
it('does not steal focus after pointer interaction', async () => {
  const view = render(<Page loaded={false} />);
  fireEvent.pointerDown(screen.getByRole('button'));
  view.rerender(<Page loaded />);
  await act(async () => {});
  expect(screen.getByRole('heading')).not.toHaveFocus();
});
it('provides a level-one heading on the standalone route error page', async () => {
  const router = createMemoryRouter([
    {
      path: '/',
      loader: () => {
        throw new Error('Unavailable');
      },
      errorElement: <RouteError />,
    },
  ]);
  render(<RouterProvider router={router} />);
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }),
  ).toBeInTheDocument();
});

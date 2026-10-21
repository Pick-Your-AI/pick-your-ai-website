import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import BuilderRoute from '../../src/features/builder/BuilderRoute';

const editorLoad = vi.hoisted(() => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
});

vi.mock('../../src/features/builder/BuilderPage', async () => {
  await editorLoad.pending;
  return { default: () => <div>Editor loaded</div> };
});

it('renders the builder identity while the editor module is still loading', async () => {
  render(
    <MemoryRouter>
      <BuilderRoute />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Choose your parts' })).toBeInTheDocument();
  expect(screen.getByText(/One row per component slot/)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Loading the parts register…');
  expect(screen.queryByText('Editor loaded')).not.toBeInTheDocument();

  await act(async () => editorLoad.release());
  expect(await screen.findByText('Editor loaded')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

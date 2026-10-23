import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../../src/components/feedback';

describe('modal focus lifecycle', () => {
  it('preserves input focus across callback changes and restores the original invoker', () => {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    invoker.focus();
    const content = <input aria-label="Temperature" />;
    const { rerender, unmount } = render(
      <Modal open title="Configure" onClose={vi.fn()}>
        {content}
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
    const input = screen.getByRole('textbox', { name: 'Temperature' });
    input.focus();
    rerender(
      <Modal open title="Configure" onClose={vi.fn()}>
        {content}
      </Modal>,
    );
    expect(input).toHaveFocus();
    rerender(
      <Modal open={false} title="Configure" onClose={vi.fn()}>
        {content}
      </Modal>,
    );
    expect(invoker).toHaveFocus();
    unmount();
    invoker.remove();
  });

  it('uses the current close callback for Escape without resetting focus or the Tab trap', () => {
    const originalClose = vi.fn();
    const currentClose = vi.fn();
    const { rerender } = render(
      <Modal open title="Configure" onClose={originalClose}>
        <input aria-label="Temperature" />
      </Modal>,
    );
    screen.getByRole('textbox', { name: 'Temperature' }).focus();
    rerender(
      <Modal open title="Configure" onClose={currentClose}>
        <input aria-label="Temperature" />
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(currentClose).toHaveBeenCalledOnce();
    expect(originalClose).not.toHaveBeenCalled();
    const first = screen.getByRole('button', { name: 'Close dialog' });
    const last = screen.getByRole('button', { name: 'Close' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});

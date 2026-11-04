import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsciiStack } from '../../src/components/AsciiStack';
import { renderStack } from '../../src/lib/ascii-stack';

vi.mock('../../src/lib/ascii-stack', () => ({ renderStack: vi.fn(() => 'frame') }));

let intersect: (entries: { isIntersecting: boolean }[]) => void;
let disconnect: ReturnType<typeof vi.fn>;
let hidden = false;
let reduced = false;
let motionChange: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(renderStack).mockClear();
  hidden = false;
  reduced = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return reduced;
      },
      addEventListener: (_: string, listener: () => void) => {
        motionChange = listener;
      },
      removeEventListener: vi.fn(),
    })),
  );
  disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const visible = (value: boolean) => act(() => intersect([{ isIntersecting: value }]));
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('ASCII animation lifecycle', () => {
  it('schedules at the requested cadence only while visible, with no hidden-page timers', () => {
    const mounted = render(<AsciiStack />);
    expect(renderStack).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    visible(true);
    advance(1000);
    expect(renderStack).toHaveBeenCalledTimes(13);
    visible(false);
    expect(vi.getTimerCount()).toBe(0);
    advance(1000);
    expect(renderStack).toHaveBeenCalledTimes(13);
    visible(true);
    hidden = true;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(0);
    advance(1000);
    expect(renderStack).toHaveBeenCalledTimes(13);
    hidden = false;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    advance(84);
    expect(renderStack).toHaveBeenCalledTimes(14);
    mounted.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(disconnect).toHaveBeenCalled();
  });

  it('stops for pause and runtime reduced motion, without contradictory toggle states', () => {
    render(<AsciiStack />);
    visible(true);
    fireEvent.click(screen.getByRole('button', { name: 'Pause animation' }));
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByRole('button', { name: 'Resume animation' })).not.toHaveAttribute(
      'aria-pressed',
    );
    fireEvent.click(screen.getByRole('button', { name: /Assemble/ }));
    expect(screen.getByRole('button', { name: /Explode/ })).not.toHaveAttribute('aria-pressed');
    fireEvent.click(screen.getByRole('button', { name: 'Resume animation' }));
    visible(true);
    expect(vi.getTimerCount()).toBe(1);
    reduced = true;
    act(() => motionChange());
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByText('Still / reduced motion')).toBeVisible();
    expect(screen.queryByRole('button', { name: /animation/ })).not.toBeInTheDocument();
  });
});

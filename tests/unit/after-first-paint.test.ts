/*
 * The contract validators are the largest chunk the app ships (~50 kB gzipped, ~720 kB of generated
 * code). Loading them lazily was already right; starting the request at module evaluation was not,
 * because it put them in the same window as the entry chunk, the route chunk and the first paint.
 * Lighthouse measured that as the last node of the largest-paint graph on all three budgeted routes.
 *
 * `afterFirstPaint` is the mechanism that holds the request back, so it is what this test pins:
 *  - with `requestIdleCallback` available nothing runs synchronously, and running the idle callback
 *    is what starts the work (with a timeout, so a busy page cannot postpone it forever),
 *  - without it the work is deferred to a macrotask, which is also after the current paint, and
 *  - with no `window` at all (SSR) it runs immediately, because there is no paint to wait for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterFirstPaint } from '../../src/contracts/after-first-paint';

const realIdleCallback = Reflect.get(window, 'requestIdleCallback');

function stubIdleCallback() {
  const calls: Array<{ cb: () => void; timeout?: number }> = [];
  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: (cb: () => void, options?: { timeout?: number }) => {
      calls.push({ cb, timeout: options?.timeout });
      return calls.length;
    },
  });
  return calls;
}

afterEach(() => {
  if (realIdleCallback === undefined) Reflect.deleteProperty(window, 'requestIdleCallback');
  else Reflect.set(window, 'requestIdleCallback', realIdleCallback);
  vi.useRealTimers();
});

describe('afterFirstPaint', () => {
  it('defers to requestIdleCallback, with a timeout, when it exists', () => {
    const calls = stubIdleCallback();
    const start = vi.fn();

    afterFirstPaint(start);

    expect(start).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.timeout).toBe(500);

    calls[0]!.cb();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('falls back to a macrotask when requestIdleCallback is missing', async () => {
    Reflect.deleteProperty(window, 'requestIdleCallback');
    vi.useFakeTimers();
    const start = vi.fn();

    afterFirstPaint(start);

    expect(start).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('runs immediately when there is no window to paint', () => {
    const start = vi.fn();
    const originalWindow = globalThis.window;
    // The module reads `window` from the global scope; removing it models SSR.
    Reflect.deleteProperty(globalThis, 'window');
    try {
      afterFirstPaint(start);
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.set(globalThis, 'window', originalWindow);
    }
  });
});

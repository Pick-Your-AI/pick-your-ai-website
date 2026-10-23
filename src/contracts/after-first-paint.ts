/*
 * Runs `start` once the browser has painted and gone idle.
 *
 * Used to keep the generated contract validators — ~50 kB gzipped, ~720 kB of code — out of the
 * window where the entry chunk, the route chunk and the first paint are competing for a slow
 * connection. Providers still await the validators before they validate anything, so this only
 * moves *when the request is made*, never whether validation happens.
 *
 * `requestIdleCallback` fires after the current frame has been painted; the timeout keeps a busy
 * page from postponing data indefinitely. Environments without it (Safari, jsdom) fall back to a
 * macrotask, which is also after the current paint. Server-side rendering has no paint to wait for.
 */
export function afterFirstPaint(start: () => void): void {
  if (typeof window === 'undefined') {
    start();
    return;
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => start(), { timeout: 500 });
    return;
  }
  setTimeout(start, 0);
}

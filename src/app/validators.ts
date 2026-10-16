import { useSyncExternalStore } from 'react';
import { validatorsReady } from '../contracts';

/*
 * Contract validators load as a lazy chunk. Components that validate synchronously while rendering
 * (export availability, shared-link decoding) call this hook so they re-render once validation is
 * possible, instead of showing a stale "still loading" result.
 */
let loaded = false;
const listeners = new Set<() => void>();
void validatorsReady.then(() => {
  loaded = true;
  for (const l of listeners) l();
});

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useValidatorsReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => loaded,
    () => loaded,
  );
}

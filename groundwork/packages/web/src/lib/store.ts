import { useSyncExternalStore } from 'react';

/** Minimal external store (zustand-like) so canvas code and React share one state. */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      for (const l of listeners) l();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
export function useStore<T extends object, U>(store: ReturnType<typeof createStore<T>>, selector: (s: T) => U): U {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

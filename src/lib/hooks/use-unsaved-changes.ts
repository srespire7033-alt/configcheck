'use client';

import { useEffect, useRef } from 'react';

/**
 * Track whether the current form values diverge from the last saved
 * snapshot, and warn before the browser tab is closed/navigated when
 * they do. The intra-app navigation guard is wired separately by the
 * caller (Settings tab-switcher uses `confirm()` if `isDirty()` is
 * true).
 *
 * Pass primitive form values (strings/numbers/booleans) — deep-equality
 * lives outside the hook so callers can pick what counts as "dirty"
 * (e.g. trimming whitespace before comparing).
 *
 * @param current  current form values, snapshot whenever the user types
 * @param saved    last server-acknowledged snapshot
 * @returns        an `isDirty()` getter the caller can use for nav guards
 */
export function useUnsavedChanges<T>(current: T, saved: T): { isDirty: () => boolean } {
  // Stash latest values in a ref so the beforeunload listener (set up
  // once) reads fresh state rather than capturing the initial closure.
  const ref = useRef({ current, saved });
  ref.current = { current, saved };

  useEffect(() => {
    function isDirty() {
      return !shallowEqual(ref.current.current, ref.current.saved);
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty()) return;
      e.preventDefault();
      // Modern browsers ignore the message and show their own — setting
      // returnValue to a truthy string still triggers the prompt.
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return {
    isDirty: () => !shallowEqual(ref.current.current, ref.current.saved),
  };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}

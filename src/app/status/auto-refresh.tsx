'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Soft auto-refresh for the status page. Calls router.refresh() every 30s
 * which re-runs the server component and re-renders the page in place,
 * without a full reload. Pauses when the tab is hidden so we don't burn
 * server requests for a backgrounded tab.
 */
export function StatusAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    function start() {
      if (timer) return;
      timer = setInterval(() => router.refresh(), 30_000);
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') start();
      else stop();
    }
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router]);
  return null;
}

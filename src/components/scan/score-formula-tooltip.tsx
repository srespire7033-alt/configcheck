'use client';

import { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Click-to-open popover that explains how the headline health score is
 * computed. Surfaces the per-severity penalty so users don't have to read
 * the source to understand why an info-severity finding doesn't move the
 * needle, or why one critical takes 2 points off.
 *
 * Renders as a small `?` icon — caller decides where to drop it (typically
 * inline next to the score title).
 */
export function ScoreFormulaTooltip() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="How is the score calculated?"
        className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 z-30 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-4 text-sm">
          <div className="font-semibold text-gray-900 dark:text-white mb-2">
            How the score is calculated
          </div>
          <p className="text-gray-600 dark:text-gray-400 mb-3 text-xs leading-relaxed">
            Start at 100. Each finding deducts points based on severity, then
            the result is rounded and clamped to 0–100.
          </p>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20">
              <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-300">
                <span className="w-2 h-2 rounded-full bg-red-500" /> Critical
              </span>
              <span className="font-mono font-semibold text-red-700 dark:text-red-300">−2.0 pts</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20">
              <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> Warning
              </span>
              <span className="font-mono font-semibold text-amber-700 dark:text-amber-300">−0.5 pts</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20">
              <span className="inline-flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
                <span className="w-2 h-2 rounded-full bg-blue-500" /> Info / Best practice
              </span>
              <span className="font-mono font-semibold text-blue-700 dark:text-blue-300">−0.1 pts</span>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
            Info findings are intentionally near-zero impact — they&apos;re
            best-practice nudges, not real problems. So adding a single info
            finding may not change the rounded headline score.
          </p>
        </div>
      )}
    </div>
  );
}

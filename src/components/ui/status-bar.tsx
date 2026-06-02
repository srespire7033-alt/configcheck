'use client';

import { useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, ChevronDown } from 'lucide-react';

/**
 * Unified compact status row for the org detail page (and reusable
 * anywhere a stack of banners would otherwise compete for vertical
 * space).
 *
 * The org detail page used to render three separate "alert card"
 * blocks (error / forensic complete / recent failed scan) each
 * occupying 4-7 lines of vertical real estate. When more than one
 * was active, the user had to scroll past a half-page of banners
 * before seeing data. StatusBar collapses each condition into a
 * one-line row with the message inline and the action/dismiss as
 * trailing controls — same information density, ~⅕ the vertical
 * space.
 *
 * Expandable detail is supported via the `detail` prop — when set,
 * the row gets a chevron that reveals a second line on click. Use
 * for cases (recent failed scan) where there's a longer error
 * message we want available without blowing up the default height.
 */

export type StatusSeverity = 'success' | 'warning' | 'error' | 'info';

export interface StatusItem {
  /** Stable React key. */
  id: string;
  severity: StatusSeverity;
  /** Single-line headline message. Keep short — under ~80 chars. */
  message: ReactNode;
  /** Optional expandable detail. When set, a chevron lets the user toggle. */
  detail?: ReactNode;
  /** Optional inline action button (rendered before the dismiss X). */
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** When set, renders a dismiss X. */
  onDismiss?: () => void;
}

interface Props {
  items: StatusItem[];
  className?: string;
}

const SEVERITY_STYLES: Record<StatusSeverity, { container: string; icon: string; text: string }> = {
  error: {
    container: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50',
    icon: 'text-red-600 dark:text-red-400',
    text: 'text-red-800 dark:text-red-300',
  },
  warning: {
    container: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50',
    icon: 'text-amber-600 dark:text-amber-400',
    text: 'text-amber-800 dark:text-amber-300',
  },
  success: {
    container: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50',
    icon: 'text-emerald-600 dark:text-emerald-400',
    text: 'text-emerald-800 dark:text-emerald-300',
  },
  info: {
    container: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/50',
    icon: 'text-blue-600 dark:text-blue-400',
    text: 'text-blue-800 dark:text-blue-300',
  },
};

function severityIcon(severity: StatusSeverity, className: string) {
  switch (severity) {
    case 'error':
      return <AlertCircle className={className} />;
    case 'warning':
      return <AlertTriangle className={className} />;
    case 'success':
      return <CheckCircle2 className={className} />;
    case 'info':
      return <Info className={className} />;
  }
}

function StatusRow({ item }: { item: StatusItem }) {
  const styles = SEVERITY_STYLES[item.severity];
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(item.detail);

  return (
    <div className={`rounded-xl border px-3 py-2 sm:px-4 sm:py-2.5 ${styles.container}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        {severityIcon(item.severity, `w-4 h-4 flex-shrink-0 ${styles.icon}`)}
        <div className={`flex-1 min-w-0 text-sm font-medium ${styles.text}`}>
          <span className="truncate inline-block max-w-full align-middle">{item.message}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {hasDetail && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={`p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition ${styles.icon}`}
              aria-label={expanded ? 'Hide details' : 'Show details'}
              aria-expanded={expanded}
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
          {item.action && (
            <button
              type="button"
              onClick={item.action.onClick}
              disabled={item.action.disabled}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition disabled:opacity-50 ${
                item.severity === 'error'
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : item.severity === 'warning'
                    ? 'bg-amber-600 hover:bg-amber-700 text-white'
                    : item.severity === 'success'
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {item.action.label}
            </button>
          )}
          {item.onDismiss && (
            <button
              type="button"
              onClick={item.onDismiss}
              className={`p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition ${styles.icon}`}
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {hasDetail && expanded && (
        <div className={`mt-2 pl-6 text-xs leading-relaxed ${styles.text} opacity-90`}>
          {item.detail}
        </div>
      )}
    </div>
  );
}

export function StatusBar({ items, className = '' }: Props) {
  if (items.length === 0) return null;
  return (
    <div className={`mb-6 flex flex-col gap-2 ${className}`}>
      {items.map((item) => (
        <StatusRow key={item.id} item={item} />
      ))}
    </div>
  );
}

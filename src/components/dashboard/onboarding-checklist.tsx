'use client';

import { CheckCircle2, Circle, ChevronRight, X, Sparkles, UserCircle, Cloud, Scan, FileText, CalendarClock, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export interface ChecklistProgress {
  profile_completed: boolean;
  org_connected: boolean;
  first_scan_run: boolean;
  issue_reviewed: boolean;
  pdf_generated: boolean;
  schedule_created: boolean;
}

export interface OnboardingChecklistProps {
  progress: ChecklistProgress;
  dismissed: boolean;
  onDismiss: () => void;
  onConnectOrg: () => void;
  firstOrgId?: string;
}

interface ChecklistItem {
  key: keyof ChecklistProgress;
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
}

export function OnboardingChecklist({ progress, dismissed, onDismiss, onConnectOrg, firstOrgId }: OnboardingChecklistProps) {
  if (dismissed) return null;

  const completedCount = Object.values(progress).filter(Boolean).length;
  const allDone = completedCount === 6;
  const progressPercent = (completedCount / 6) * 100;

  const items: ChecklistItem[] = [
    {
      key: 'profile_completed',
      label: 'Complete your profile',
      icon: <UserCircle className="w-4 h-4" />,
      href: '/settings',
    },
    {
      key: 'org_connected',
      label: 'Connect a Salesforce org',
      icon: <Cloud className="w-4 h-4" />,
      onClick: onConnectOrg,
    },
    {
      key: 'first_scan_run',
      label: 'Run your first scan',
      icon: <Scan className="w-4 h-4" />,
      href: firstOrgId ? `/orgs/${firstOrgId}` : undefined,
    },
    {
      key: 'issue_reviewed',
      label: 'Review a critical issue',
      icon: <AlertTriangle className="w-4 h-4" />,
      href: firstOrgId ? `/orgs/${firstOrgId}` : undefined,
    },
    {
      key: 'pdf_generated',
      label: 'Generate a PDF report',
      icon: <FileText className="w-4 h-4" />,
      href: firstOrgId ? `/orgs/${firstOrgId}` : undefined,
    },
    {
      key: 'schedule_created',
      label: 'Set up a scheduled scan',
      icon: <CalendarClock className="w-4 h-4" />,
      href: firstOrgId ? `/orgs/${firstOrgId}` : undefined,
    },
  ];

  // All done - show congratulations
  if (allDone) {
    return (
      <div className="mb-8 relative rounded-2xl bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10 p-[1px]">
        <div className="rounded-2xl bg-white dark:bg-gray-900 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/40 dark:to-purple-900/40 rounded-xl">
                <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  You&apos;re all set! You&apos;ve mastered ConfigCheck.
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  All 6 milestones completed. Happy auditing!
                </p>
              </div>
            </div>
            <button
              onClick={onDismiss}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1"
              aria-label="Dismiss checklist"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8 relative rounded-2xl bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 p-[1px]">
      <div className="rounded-2xl bg-white dark:bg-gray-900 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/40 dark:to-purple-900/40 rounded-xl">
              <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Getting Started</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {completedCount} of 6 complete
              </p>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Dismiss
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full mb-5 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Checklist items */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {items.map((item) => {
            const completed = progress[item.key];

            if (completed) {
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-green-50/50 dark:bg-green-900/10 transition-all duration-300"
                >
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 animate-in zoom-in duration-300" />
                  <span className="text-sm text-gray-500 dark:text-gray-400 line-through">{item.label}</span>
                </div>
              );
            }

            const innerContent = (
              <>
                <Circle className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors flex-1">
                  {item.label}
                </span>
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors flex-shrink-0" />
              </>
            );

            const className = "flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group cursor-pointer w-full text-left";

            return item.href ? (
              <Link key={item.key} href={item.href} className={className}>
                {innerContent}
              </Link>
            ) : (
              <button key={item.key} type="button" onClick={item.onClick} className={className}>
                {innerContent}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

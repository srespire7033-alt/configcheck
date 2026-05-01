'use client';

import { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';

// Mix of generic + product-specific messages so users on Billing-only or
// ARM scans don't see "Brewing your CPQ insights..." as if CPQ were the
// only product we cover.
const loadingMessages = [
  // CPQ-specific
  'Brewing your CPQ insights...',
  'Making sense of your price rules...',
  // Billing-specific
  'Reconciling your billing rules...',
  'Lining up finance periods...',
  'Tracing revenue recognition schedules...',
  // ARM (Revenue Cloud) specific
  'Mapping your selling models...',
  'Auditing rate cards and adjustments...',
  'Walking your product catalog...',
  // Generic / product-agnostic
  'Crunching the numbers, hang tight...',
  'Scanning configurations at lightning speed...',
  'Almost there, just dotting the i\'s...',
  'Good things take a moment...',
  'Wrangling your Salesforce data...',
  'Polishing your health report...',
  'Your config audit is on its way...',
  'Running diagnostics, sit tight...',
];

interface LoadingScreenProps {
  message?: string;
  minimal?: boolean;
}

export function LoadingScreen({ message, minimal = false }: LoadingScreenProps) {
  // Start with index 0 to avoid hydration mismatch, then randomize on mount
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (message) return; // Don't rotate if custom message provided
    // Pick a random starting point on mount
    setMsgIndex(Math.floor(Math.random() * loadingMessages.length));
    const interval = setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % loadingMessages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [message]);

  const displayMessage = message || loadingMessages[msgIndex];

  if (minimal) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="relative">
          <div className="w-10 h-10 rounded-full border-2 border-blue-200 dark:border-blue-800 border-t-blue-600 dark:border-t-blue-400 animate-spin" />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">{displayMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-64 gap-5">
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-teal-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <ShieldCheck className="w-8 h-8 text-white" />
        </div>
        <div className="absolute -inset-2 rounded-2xl border-2 border-blue-300/40 dark:border-blue-500/20 animate-ping" style={{ animationDuration: '2s' }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1 transition-all duration-500">{displayMessage}</p>
        <div className="flex items-center justify-center gap-1.5 mt-3">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

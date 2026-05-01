import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

/**
 * Shared chrome for /privacy /terms /security /dpa.
 * Keeps each page focused on content; navbar + footer come from here.
 *
 * NOTE: These are stub pages. The text inside them describes current
 * practice as accurately as we can today, but they are NOT a substitute
 * for legal review. Every claim should be re-validated with counsel
 * before we onboard enterprise customers or apply for the Salesforce
 * AppExchange security review.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b1120] text-gray-900 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: '#5B9BF3' }}
            >
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold">ConfigCheck</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </div>
      </header>

      {/* Hand-rolled typography styles for legal pages — we don't yet
          have @tailwindcss/typography installed, so apply consistent
          spacing/sizing via direct selectors. */}
      <main className="max-w-3xl mx-auto px-6 py-12 legal-prose">
        {children}
      </main>
      <style>{`
        .legal-prose h1 { font-size: 2.25rem; line-height: 1.15; font-weight: 700; margin-bottom: 0.5rem; color: var(--tw-prose-headings, #0f172a); }
        .legal-prose h2 { font-size: 1.25rem; font-weight: 700; margin-top: 2.5rem; margin-bottom: 0.75rem; }
        .legal-prose p { margin-top: 1rem; margin-bottom: 1rem; line-height: 1.7; color: rgb(55 65 81); }
        .dark .legal-prose p { color: rgb(209 213 219); }
        .legal-prose ul { margin-top: 1rem; margin-bottom: 1rem; padding-left: 1.5rem; list-style: disc; }
        .legal-prose ol { margin-top: 1rem; margin-bottom: 1rem; padding-left: 1.5rem; list-style: decimal; }
        .legal-prose li { margin-top: 0.4rem; margin-bottom: 0.4rem; line-height: 1.65; color: rgb(55 65 81); }
        .dark .legal-prose li { color: rgb(209 213 219); }
        .legal-prose li > ul, .legal-prose li > ol { margin-top: 0.4rem; margin-bottom: 0.4rem; }
        .legal-prose a { color: rgb(37 99 235); text-decoration: underline; }
        .dark .legal-prose a { color: rgb(96 165 250); }
        .legal-prose a:hover { text-decoration: none; }
        .legal-prose strong { font-weight: 600; color: rgb(17 24 39); }
        .dark .legal-prose strong { color: rgb(243 244 246); }
        .legal-prose code { font-size: 0.875em; background: rgb(243 244 246); padding: 0.1em 0.3em; border-radius: 0.25rem; font-family: ui-monospace, SFMono-Regular, monospace; }
        .dark .legal-prose code { background: rgb(31 41 55); }
        .legal-prose table { width: 100%; margin-top: 1.25rem; margin-bottom: 1.25rem; border-collapse: collapse; font-size: 0.875rem; }
        .legal-prose th { text-align: left; font-weight: 600; padding: 0.5rem 0.75rem; background: rgb(243 244 246); border: 1px solid rgb(229 231 235); }
        .dark .legal-prose th { background: rgb(31 41 55); border-color: rgb(55 65 81); }
        .legal-prose td { padding: 0.5rem 0.75rem; border: 1px solid rgb(229 231 235); }
        .dark .legal-prose td { border-color: rgb(55 65 81); }
        .legal-prose em { font-style: italic; }
      `}</style>

      <footer className="border-t border-gray-200 dark:border-gray-800 py-8 mt-16">
        <div className="max-w-3xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-gray-500 dark:text-gray-400">
          <p>&copy; ConfigCheck. All rights reserved.</p>
          <div className="flex gap-5">
            <Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-gray-900 dark:hover:text-white transition-colors">
              Terms
            </Link>
            <Link href="/security" className="hover:text-gray-900 dark:hover:text-white transition-colors">
              Security
            </Link>
            <Link href="/dpa" className="hover:text-gray-900 dark:hover:text-white transition-colors">
              DPA
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

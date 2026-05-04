import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data Processing Addendum — OrgPrism',
  description:
    'How to request a Data Processing Addendum (DPA) for OrgPrism — the agreement that governs our processing of your data on your behalf.',
  alternates: { canonical: '/dpa' },
};

export default function DPAPage() {
  return (
    <>
      <h1>Data Processing Addendum</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Last updated: 2026-05-01</p>

      <p>
        If you&rsquo;re a customer subject to GDPR, UK GDPR, the India DPDP Act,
        or any similar data-protection regime, you may need a Data Processing
        Addendum (DPA) governing our processing of personal data on your behalf.
      </p>

      <h2>How to request a DPA</h2>
      <p>
        Email{' '}
        {/* TODO: replace with the live mailbox once orgprism.app is wired up */}
        <a href="mailto:hello@orgprism.app">hello@orgprism.app</a> with the
        subject line <em>&ldquo;DPA request&rdquo;</em> and include:
      </p>
      <ul>
        <li>Your legal entity name and registered address.</li>
        <li>The applicable data-protection regimes (GDPR, UK GDPR, DPDP, etc.).</li>
        <li>Whether you need Standard Contractual Clauses (SCCs) for cross-border transfers.</li>
        <li>Any specific clauses your procurement team requires.</li>
      </ul>
      <p>
        We&rsquo;ll respond within five business days with our standard DPA
        (which incorporates the EU SCCs by reference where applicable). For
        bespoke amendments we may ask for a short call to align expectations.
      </p>

      <h2>What our standard DPA covers</h2>
      <ul>
        <li>Roles and responsibilities (you are the controller; OrgPrism is the processor).</li>
        <li>Categories of personal data processed (account data and Salesforce metadata as described in our <a href="/privacy">Privacy Policy</a>).</li>
        <li>Subprocessor list with notice procedures for changes (current list at <a href="/security">/security</a>).</li>
        <li>Security commitments (encryption in transit and at rest, OAuth-only access, retention limits).</li>
        <li>Personal data breach notification timelines.</li>
        <li>Data subject request handling.</li>
        <li>Audit and compliance cooperation.</li>
        <li>Cross-border transfer mechanisms (EU SCCs, UK Addendum).</li>
        <li>Term, return, and deletion of personal data.</li>
      </ul>

      <p className="text-xs text-gray-500 dark:text-gray-500 mt-8 pt-6 border-t border-gray-200 dark:border-gray-800">
        Until we publish a self-serve DPA portal, requests are handled manually
        within five business days.
      </p>
    </>
  );
}

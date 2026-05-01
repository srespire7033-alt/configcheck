import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — ConfigCheck',
  description:
    'How ConfigCheck handles Salesforce metadata, scan results, and personal data. OAuth-only, read-only, no record-level data leaves your tenant.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Last updated: 2026-05-01</p>

      <p>
        ConfigCheck (&ldquo;we&rdquo;, &ldquo;us&rdquo;) provides automated configuration audits for Salesforce Revenue
        Cloud orgs. This policy explains what data we collect, how we use it, who we
        share it with, and how to control it.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li>
          <strong>Account information:</strong> name, email, profile photo (if you upload one),
          company name, billing details when you subscribe to a paid plan.
        </li>
        <li>
          <strong>Salesforce metadata:</strong> when you connect a Salesforce org, ConfigCheck
          reads <em>configuration metadata</em> via the Salesforce REST and SOAP APIs &mdash;
          price rules, product definitions, approval rule logic, billing rules, ARM standard
          objects, and similar. We do <strong>not</strong> read customer records, opportunities,
          quotes, or other transactional data.
        </li>
        <li>
          <strong>Scan results:</strong> the list of findings produced by each scan
          (severity, category, check ID, affected record IDs, descriptions) is stored
          encrypted in our database so you can compare scans over time.
        </li>
        <li>
          <strong>OAuth tokens:</strong> the refresh token issued by Salesforce when you
          authorize an org. Encrypted at rest. Used only to refresh the access token at
          scan time.
        </li>
        <li>
          <strong>Telemetry:</strong> standard server logs (IP, user agent, request
          timing) and product analytics (which pages you visit, which features you use).
        </li>
      </ul>

      <h2>2. What we do <em>not</em> store</h2>
      <ul>
        <li>Salesforce passwords (we never see them &mdash; you authenticate via OAuth).</li>
        <li>Customer record values from your org.</li>
        <li>Opportunity, quote, contract, asset, or invoice line-item data.</li>
        <li>Any field value from records we describe at scan time.</li>
      </ul>

      <h2>3. AI fix suggestions</h2>
      <p>
        For findings that include an AI fix suggestion, ConfigCheck sends an
        <strong> anonymised configuration pattern</strong> &mdash; the rule structure,
        not the values &mdash; to Google Gemini for analysis. Record-level data,
        customer names, and PII are never included. Suggestions returned by Gemini
        are stored against the scan and shown to you in plain language; you decide
        whether to apply them.
      </p>

      <h2>4. How we use it</h2>
      <ul>
        <li>To produce the audit and present findings on your dashboard.</li>
        <li>To send scan completion / failure notification emails (you can disable these in Settings).</li>
        <li>To enforce plan limits (e.g. monthly scan caps on the Free tier).</li>
        <li>To improve the product through aggregate, non-identifying analytics.</li>
      </ul>

      <h2>5. Subprocessors</h2>
      <p>
        ConfigCheck runs on Vercel (hosting), Supabase (managed Postgres + auth),
        Resend (transactional email), and Google Gemini (AI fix suggestions). Each
        subprocessor sees only the minimum data required to do its job; none receive
        record-level Salesforce data.
      </p>

      <h2>6. Retention &amp; deletion</h2>
      <p>
        Scan results are retained while your account is active. You can delete any
        scan or disconnect any org at any time from the dashboard. Deleting your
        account permanently removes all associated scans, issues, and tokens within
        30 days.
      </p>

      <h2>7. Your rights</h2>
      <p>
        Depending on your jurisdiction (GDPR, UK GDPR, CCPA, India DPDP Act, etc.)
        you have rights to access, correct, export, and delete your personal data.
        Email{' '}
        {/* TODO: replace with the live mailbox once configcheck.io is wired up */}
        <a href="mailto:hello@configcheck.io">hello@configcheck.io</a> with your
        request and we will respond within 30 days.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions or concerns? Reach the founder directly at{' '}
        {/* TODO: replace with the live mailbox */}
        <a href="mailto:hello@configcheck.io">hello@configcheck.io</a>.
      </p>

      <p className="text-xs text-gray-500 dark:text-gray-500 mt-8 pt-6 border-t border-gray-200 dark:border-gray-800">
        This is a working draft. We&rsquo;ll formalise it with counsel before
        onboarding enterprise customers or applying for the Salesforce AppExchange
        security review.
      </p>
    </>
  );
}

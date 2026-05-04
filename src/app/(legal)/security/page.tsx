import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Security — OrgPrism',
  description:
    'How OrgPrism protects your Salesforce metadata, OAuth tokens, and scan results. Read-only OAuth scopes, encryption in transit and at rest, no managed package.',
  alternates: { canonical: '/security' },
};

export default function SecurityPage() {
  return (
    <>
      <h1>Security</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Last updated: 2026-05-01</p>

      <p>
        OrgPrism is designed around the principle of minimum data exposure.
        We connect to your Salesforce org with read-only OAuth, store nothing
        from your customer records, and let you disconnect at any time.
      </p>

      <h2>OAuth scopes used</h2>
      <ul>
        <li><code>api</code> &mdash; required to read configuration metadata via REST/SOAP.</li>
        <li><code>refresh_token</code> &mdash; required to keep scans working without prompting you each time.</li>
        <li><code>id</code> &mdash; required to identify the user and the org at consent time.</li>
      </ul>
      <p>
        We never request <code>full</code>, <code>web</code>, <code>chatter_api</code>,
        or any write-capable scope.
      </p>

      <h2>Data classification</h2>
      <ul>
        <li>
          <strong>Stored encrypted at rest:</strong> OAuth refresh tokens, scan
          results (severity, category, check ID, affected record IDs, plain-text
          descriptions), customer profile and billing details.
        </li>
        <li>
          <strong>In flight:</strong> all traffic between your browser, our app,
          Salesforce, and our subprocessors uses TLS 1.2 or higher.
        </li>
        <li>
          <strong>Never stored:</strong> Salesforce passwords, customer record
          field values, opportunity/quote/contract/asset/invoice data,
          PII captured during scans.
        </li>
      </ul>

      <h2>Where data lives</h2>
      <table>
        <thead>
          <tr>
            <th>Subprocessor</th>
            <th>Purpose</th>
            <th>Region</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Vercel</td>
            <td>Application hosting, edge functions, static asset CDN</td>
            <td>Multi-region</td>
          </tr>
          <tr>
            <td>Supabase</td>
            <td>Managed Postgres, authentication, file storage</td>
            <td>Single region (closest to you at signup)</td>
          </tr>
          <tr>
            <td>Resend</td>
            <td>Transactional email (welcome, scan complete, invitations)</td>
            <td>Multi-region</td>
          </tr>
          <tr>
            <td>Google Gemini</td>
            <td>AI fix suggestions (anonymised configuration patterns only)</td>
            <td>Multi-region</td>
          </tr>
        </tbody>
      </table>

      <h2>Authentication &amp; authorization</h2>
      <ul>
        <li>You sign in with email + password or magic link via Supabase Auth.</li>
        <li>Salesforce orgs are connected via the standard OAuth 2.0 web server flow with PKCE.</li>
        <li>Tokens auto-refresh; revocation in Salesforce Setup &rarr; Connected Apps OAuth Usage takes effect immediately.</li>
        <li>Row-level security in Postgres ensures users can only read their own orgs and scans.</li>
      </ul>

      <h2>Operational practices</h2>
      <ul>
        <li>Production secrets live in Vercel and Supabase environment configs &mdash; never committed.</li>
        <li>Backups: Supabase point-in-time recovery is enabled.</li>
        <li>Code changes go through pull request review; CI runs the full test suite (1,100+ tests) before merge.</li>
      </ul>

      <h2>Reporting a vulnerability</h2>
      <p>
        If you believe you&rsquo;ve found a security issue, please email{' '}
        {/* TODO: replace with the live mailbox; consider a dedicated security@ alias */}
        <a href="mailto:hello@orgprism.app">hello@orgprism.app</a> with a
        description and reproduction steps. We&rsquo;ll acknowledge within 72
        hours, work with you to validate, and deploy a fix as quickly as the
        severity warrants. Please give us reasonable time to remediate before
        public disclosure.
      </p>

      <h2>What we are <em>not</em> claiming</h2>
      <p>
        OrgPrism is built to SOC 2 standards but does <strong>not</strong>{' '}
        currently hold a SOC 2 Type II report. We are not certified ISO 27001 or
        HIPAA compliant. If your procurement requires either, please reach out
        and we&rsquo;ll let you know our roadmap and where we are today.
      </p>

      <p className="text-xs text-gray-500 dark:text-gray-500 mt-8 pt-6 border-t border-gray-200 dark:border-gray-800">
        We&rsquo;ll publish a formal security overview document and a public
        trust portal as we approach the Salesforce AppExchange security review.
      </p>
    </>
  );
}

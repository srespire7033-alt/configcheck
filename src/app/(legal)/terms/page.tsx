import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — ConfigCheck',
  description:
    'Terms governing the use of ConfigCheck, an automated Salesforce Revenue Cloud audit service.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Last updated: 2026-05-01</p>

      <p>
        These terms govern your use of ConfigCheck (&ldquo;the Service&rdquo;).
        By creating an account or connecting a Salesforce org, you agree to them.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old and have the authority to bind any
        organization on whose behalf you connect a Salesforce org.
      </p>

      <h2>2. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Connect orgs you do not own or have explicit, contemporaneous authorisation to audit.</li>
        <li>Reverse engineer, scrape, or attempt to extract the underlying check definitions.</li>
        <li>Use the Service to violate any law or third-party right.</li>
        <li>Resell, sublicense, or white-label the Service without a written agreement with us.</li>
      </ul>

      <h2>3. Plans &amp; billing</h2>
      <p>
        Free tier: limited monthly scans, CPQ-only checks, basic PDF. Paid tiers
        unlock additional orgs, unlimited scans, AI fix suggestions, and white-label
        reports. Subscriptions renew automatically unless cancelled. Cancel any time
        from your account settings; you keep access until the end of the billing
        period. Refunds are at our discretion and not generally provided for partial
        periods.
      </p>

      <h2>4. Service description &amp; disclaimer</h2>
      <p>
        ConfigCheck produces automated audits based on configuration metadata. It
        cannot detect every possible misconfiguration, and findings should be
        verified before remediation. AI fix suggestions are advisory &mdash;
        verify them in a sandbox before applying changes to production.
      </p>
      <p>
        <strong>The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;.</strong>
        {' '}We disclaim implied warranties to the extent permitted by law. We are
        not liable for any indirect, incidental, special, consequential, or punitive
        damages, or for any loss of profits or revenues, whether incurred directly
        or indirectly. Aggregate liability is capped at the amount you paid us in
        the 12 months preceding the claim.
      </p>

      <h2>5. Your data</h2>
      <p>
        How we handle your data is described in our{' '}
        <a href="/privacy">Privacy Policy</a>. You retain all rights to data you
        provide. We retain a license to process it solely to operate the Service.
      </p>

      <h2>6. Termination</h2>
      <p>
        You can delete your account at any time. We can suspend or terminate
        accounts that violate these terms or that pose a risk to the Service or
        other users.
      </p>

      <h2>7. Changes to these terms</h2>
      <p>
        We may revise these terms occasionally. Material changes will be announced
        in-product or by email at least 14 days before they take effect. Continued
        use after the effective date constitutes acceptance.
      </p>

      <h2>8. Governing law</h2>
      <p>
        These terms are governed by the laws of India. Disputes will be resolved
        in the courts of Vadodara, Gujarat, unless otherwise agreed in writing.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about these terms? Email{' '}
        {/* TODO: replace with the live mailbox once configcheck.io is wired up */}
        <a href="mailto:hello@configcheck.io">hello@configcheck.io</a>.
      </p>

      <p className="text-xs text-gray-500 dark:text-gray-500 mt-8 pt-6 border-t border-gray-200 dark:border-gray-800">
        This is a working draft. We&rsquo;ll formalise it with counsel before
        onboarding enterprise customers.
      </p>
    </>
  );
}

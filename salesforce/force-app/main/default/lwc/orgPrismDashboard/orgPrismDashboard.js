import { LightningElement, api } from 'lwc';

/**
 * Embeds the OrgPrism SaaS dashboard (Next.js app deployed to Vercel)
 * inside Salesforce via an iframe. The "single source of truth" for
 * the rich consultant UI lives in the Next.js codebase; this component
 * is just a thin host so users get the same experience whether they
 * open OrgPrism in the browser or inside Salesforce.
 *
 * Configuration (set per FlexiPage instance):
 *   - dashboardUrl: full URL of the deployed SaaS dashboard.
 *     Example: https://orgprism.vercel.app/orgs/{orgId}
 *   - height: iframe height in pixels (default 1200).
 *
 * IMPORTANT — Salesforce CSP blocks iframes from external domains by
 * default. Before this component renders the iframe content, an admin
 * must add the SaaS host to Trusted URLs:
 *   Setup → Security → Trusted URLs → New Trusted URL
 *     URL: https://orgprism.vercel.app
 *     Context: All
 *     Allowed CSP directives: frame-src
 */
export default class OrgPrismDashboard extends LightningElement {
  /** Full URL of the SaaS dashboard. Configured via FlexiPage. */
  @api dashboardUrl;

  /** Iframe height in pixels. Defaults to 1200 if not configured. */
  @api height = 1200;

  /** Optional embed param appended to URL — lets the SaaS app detect
   *  it's running inside Salesforce and adjust chrome (hide outer
   *  navigation, etc). The SaaS app can read ?embed=salesforce from
   *  the URL and switch to a leaner layout. */
  get computedSrc() {
    if (!this.dashboardUrl) return null;
    const url = this.dashboardUrl;
    return url.includes('?')
      ? `${url}&embed=salesforce`
      : `${url}?embed=salesforce`;
  }

  get iframeStyle() {
    return `width: 100%; height: ${this.height}px; border: none; display: block;`;
  }

  get hasUrl() {
    return Boolean(this.dashboardUrl);
  }
}

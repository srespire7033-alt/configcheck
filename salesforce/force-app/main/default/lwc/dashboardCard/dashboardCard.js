import { LightningElement, api } from 'lwc';
import { loadStyle } from 'lightning/platformResourceLoader';
import TOKENS from '@salesforce/resourceUrl/orgPrismTokens';

/**
 * Base card container used by every OrgPrism dashboard component.
 * Mirrors the SaaS `<div class="bg-white rounded-2xl shadow-sm border ...">`
 * idiom so every card in the native LWC dashboard has consistent
 * styling without each child component re-implementing the chrome.
 *
 * Slots:
 *   - title (default named slot for a custom header)
 *   - actions (right-aligned controls in the header — buttons, icons)
 *   - default slot — main card body
 *
 * Props:
 *   - title (String): plain-text heading. Skipped if the `title` slot
 *     is used.
 *   - subtitle (String): smaller descriptive line under the title.
 *   - variant (String): "default" | "outlined" | "flat". Default has
 *     shadow + border; outlined has only a border; flat has neither
 *     (use when card is itself inside another card).
 */
export default class DashboardCard extends LightningElement {
  @api title;
  @api subtitle;
  @api variant = 'default';

  stylesLoaded = false;

  connectedCallback() {
    if (this.stylesLoaded) return;
    loadStyle(this, TOKENS)
      .then(() => { this.stylesLoaded = true; })
      .catch(() => {/* tokens are a nice-to-have, swallow load failures */});
  }

  get cardClass() {
    const base = 'op-card';
    if (this.variant === 'outlined') return `${base} op-card--outlined`;
    if (this.variant === 'flat') return `${base} op-card--flat`;
    return base;
  }

  get hasHeader() {
    return Boolean(this.title) || Boolean(this.subtitle);
  }
}

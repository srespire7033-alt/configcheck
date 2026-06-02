import { LightningElement, api } from 'lwc';

/**
 * Compact status bar — generic banner stack for the dashboard. Native
 * port of the SaaS StatusBar component. Used wherever the dashboard
 * needs to surface transient state (scan complete, error, warning,
 * info) without occupying multiple rows of vertical space.
 *
 * Consumers pass an array of status items via the `items` @api:
 *   [
 *     { id: 'scan-complete', severity: 'success', message: '…', dismissible: true },
 *     { id: 'data-quality', severity: 'warning', message: '…' }
 *   ]
 *
 * Each item dispatches a `statusdismiss` event with the item id when
 * its X is clicked — the parent removes it from the list.
 */
const SEVERITY = {
  success: { bg: 'op-sb__item--success', icon: 'utility:success' },
  warning: { bg: 'op-sb__item--warning', icon: 'utility:warning' },
  error:   { bg: 'op-sb__item--error',   icon: 'utility:error' },
  info:    { bg: 'op-sb__item--info',    icon: 'utility:info' },
};

export default class StatusBar extends LightningElement {
  @api items = [];

  get computedItems() {
    return (this.items || []).map((it) => {
      const sev = SEVERITY[it.severity] || SEVERITY.info;
      return {
        ...it,
        rootClass: `op-sb__item ${sev.bg}`,
        iconName: sev.icon,
      };
    });
  }

  get hasItems() {
    return Array.isArray(this.items) && this.items.length > 0;
  }

  handleDismiss(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.dispatchEvent(new CustomEvent('statusdismiss', {
      detail: { id },
      bubbles: true,
      composed: true,
    }));
  }
}

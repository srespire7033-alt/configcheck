import { LightningElement, api } from 'lwc';

/**
 * Compact severity badge: Critical / Warning / Info.
 *
 * Mirrors the SaaS severity tile + inline-badge styling so the same
 * three colors (red / amber / gray) appear consistently across every
 * card. Tiny, focused — no state, no events. Just a styled label.
 *
 * Props:
 *   severity (String):   'Critical' | 'Warning' | 'Info' (case-insensitive)
 *   count    (Number):   optional numeric. If set, renders as a number
 *                        + label combo ("14 Critical"). If omitted,
 *                        renders just the label as a chip.
 *   variant  (String):   'chip' (default) | 'tile'
 *                        - chip: small inline pill
 *                        - tile: large stacked block for the hero
 *                          severity-tiles row
 */
const NORMALIZED = {
  CRITICAL: { label: 'Critical', cls: 'op-sev--critical' },
  WARNING: { label: 'Warning', cls: 'op-sev--warning' },
  INFO: { label: 'Info', cls: 'op-sev--info' },
};

export default class SeverityBadge extends LightningElement {
  @api severity = 'Info';
  @api count;
  @api variant = 'chip';

  get normalized() {
    const key = (this.severity || 'Info').toUpperCase();
    return NORMALIZED[key] || NORMALIZED.INFO;
  }

  get rootClass() {
    return `op-sev op-sev--${this.variant} ${this.normalized.cls}`;
  }

  get displayLabel() {
    return this.normalized.label;
  }

  get hasCount() {
    return this.count !== undefined && this.count !== null;
  }
}

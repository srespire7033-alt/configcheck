import { LightningElement, api } from 'lwc';

/**
 * Compact USD money display: $247K, $1.2M, $50.
 *
 * Use anywhere the dashboard needs to show recovery dollars. The big
 * hero $-headline, the matrix bubble labels, the per-card $-figures —
 * all funnel through this so the formatting stays consistent.
 *
 * Props:
 *   value (Number):       the raw amount (USD assumed)
 *   currency (String):    ISO code, default 'USD'. Used as prefix for
 *                         non-USD currencies (the symbol $ stays for USD).
 *   size (String):        'hero' | 'large' | 'medium' | 'small'
 *                         'hero'   → 48-56px, hero headline
 *                         'large'  → 28px, card primary metric
 *                         'medium' → 18px (default), inline data
 *                         'small'  → 14px, captions
 *   showZero (Boolean):   when true, $0 is rendered. When false (default),
 *                         null / undefined / 0 renders an em dash.
 *   accent (Boolean):     when true, applies the verified-green color
 *                         (used for "this $ is real" headlines).
 */
export default class MoneyDisplay extends LightningElement {
  @api value;
  @api currency = 'USD';
  @api size = 'medium';
  @api showZero = false;
  @api accent = false;

  get formatted() {
    const n = Number(this.value);
    if (!Number.isFinite(n)) return '—';
    if (!this.showZero && n === 0) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    const symbol = this.currency === 'USD' ? '$' : `${this.currency} `;
    if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}K`;
    return `${sign}${symbol}${Math.round(abs).toLocaleString()}`;
  }

  get rootClass() {
    const accent = this.accent ? ' op-money--accent' : '';
    return `op-money op-money--${this.size}${accent}`;
  }
}

import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getDashboardSummary from '@salesforce/apex/DashboardController.getDashboardSummary';

/**
 * AI Analysis card — deterministic summary computed from findings.
 *
 * v1 emits a rule-based summary so the card lights up immediately
 * without any LLM dependency. v2 will read scan.SummaryText__c (a
 * new field) populated by a Gemini call queued after each scan
 * completes, falling back to this deterministic version when the
 * AI text isn't ready yet.
 *
 * Output shape:
 *   - Headline: "Your org has X critical issues centred on
 *                {top-detector-group}, worth ${total}."
 *   - Bullets:  top 3 detectors by finding count, each with count
 *               and total $.
 *   - "Show details" link: navigates to Forensic Scans list view.
 */

const DETECTOR_LABELS = {
  'REN-001': 'Renewal uplift suppressed',
  'REN-002': 'Renewal below current list',
  'DSC-FOR-001': 'Expired promo discounts',
  'QL-FOR-001': 'Bundle option at $0',
  'ORD-FOR-001': 'Activated orders missing billing',
};

export default class AiAnalysisCard extends NavigationMixin(LightningElement) {
  data;
  error;
  loading = true;

  @wire(getDashboardSummary)
  wireData(result) {
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message || 'Failed to load analysis';
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return Boolean(this.error); }
  get hasData() {
    return !this.loading && !this.error && this.data?.hasForensicData;
  }
  get isEmpty() {
    return !this.loading && !this.error && !this.data?.hasForensicData;
  }

  /** Computed headline derived from severity counts + top detectors. */
  get headline() {
    if (!this.hasData) return '';
    const c = this.data.criticalCount;
    const w = this.data.warningCount;
    const total = this.formatMoney(this.data.totalVerifiedUsd);
    const top = this.topDetectors;
    if (c > 0) {
      const focus = top.length > 0 ? ` centred on ${top[0].label.toLowerCase()}` : '';
      return `Your org has ${c} critical issue${c === 1 ? '' : 's'}${focus}, worth ${total} recoverable.`;
    }
    if (w > 0) {
      return `Your org is critical-clean, with ${w} warning${w === 1 ? '' : 's'} worth ${total} recoverable.`;
    }
    return `Your org has minor findings totalling ${total} recoverable.`;
  }

  /** Top 3 detectors by finding count, with total $ each. */
  get topDetectors() {
    if (!this.data?.topFindings) return [];
    const map = new Map();
    for (const f of this.data.topFindings) {
      const e = map.get(f.detectorId) || { detectorId: f.detectorId, count: 0, total: 0 };
      e.count += 1;
      e.total += Number(f.gapUsd) || 0;
      map.set(f.detectorId, e);
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count || b.total - a.total)
      .slice(0, 3)
      .map((d) => ({
        ...d,
        label: DETECTOR_LABELS[d.detectorId] || d.detectorId,
        totalFmt: this.formatMoney(d.total),
        // Pluralize in JS — LWC template at API 60 doesn't support
        // inline ternaries (would need API 66+). Pre-compute here.
        findingLabel: d.count === 1 ? 'finding' : 'findings',
      }));
  }

  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${Math.round(v)}`;
  }

  handleViewAll() {
    this[NavigationMixin.Navigate]({
      type: 'standard__objectPage',
      attributes: { objectApiName: 'ForensicFinding__c', actionName: 'list' },
    });
  }
}

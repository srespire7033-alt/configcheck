import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import getAllScores from '@salesforce/apex/TrustScoreService.getAllScores';
import getCatalog from '@salesforce/apex/DetectorCatalogController.getCatalog';

/**
 * Trust Scores card — surfaces the per-detector reliability score
 * computed by TrustScoreService. Each row carries:
 *   - composite score (0–1.00) rendered as a percentage with traffic-light color
 *   - finding count + recovered / suppressed / regressed counts
 *   - "insufficient data" treatment for detectors below the 5-finding
 *     sample threshold (Score__c = null)
 *
 * The card sorts highest-trust first so the dashboard leads with the
 * detectors consultants can rely on; the unreliable ones sink to the
 * bottom (and "no data" rows after them).
 *
 * Friendly labels mirror ExecutiveReportController so the same
 * detector reads the same way across PDF, Issues, and this card.
 */
/** Phase 20d — fallback; Detector__mdt.Label__c wins when seeded. */
const FALLBACK_DETECTOR_LABELS = {
  'REN-001':     'Renewal uplift suppressed',
  'REN-002':     'Renewal below current list',
  'REN-003':     'Renewal forecast slipping',
  'REN-004':     'Renewal quote stuck in draft',
  'DSC-FOR-001': 'Expired promo discount applied',
  'DSC-FOR-002': 'Stacked discounts past cap',
  'QL-FOR-001':  'Bundle required option at $0',
  'QL-FOR-002':  'Quote line approval skipped',
  'ORD-FOR-001': 'Order activated, no billing schedule',
  'ORD-FOR-002': 'Q↔O variance (new business)',
  'ORD-FOR-003': 'Q↔O variance (amendment)',
  'SUB-FOR-001': 'Subscription quantity drift',
  'PROV-FOR-001':'Provisioned, not billed',
  'PROV-FOR-002':'Active subscription, no asset',
  'OPP-FOR-001': 'Opportunity closed-won, no quote',
  'CON-FOR-001': 'Contract activated, all subs expired',
  'AMD-FOR-001': 'Amendment without effective date',
  'AST-FOR-001': 'Asset terminated, no credit',
  'CT-FOR-001':  'Contracted price expired',
  'MDQ-FOR-001': 'MDQ segment pricing inconsistency',
};

/** Phase 22q — collapse long rows to a short preview with a "View all"
 *  toggle. The full table is overwhelming when 60+ detectors are tracked;
 *  start with the top N and let the user expand. */
const INITIAL_VISIBLE = 7;

export default class TrustScoresCard extends NavigationMixin(LightningElement) {
  data;
  error;
  loading = true;
  @track connectedOrgId = null;
  @track catalogEntries = [];
  @track showAll = false;
  // Phase 25 — allRows cached. rows/isPaginated/toggleLabel each read it,
  // so an uncached getter rebuilt the label map per row 3x/render.
  @track _allRows = [];

  @wire(getCatalog)
  wireCatalog({ data }) {
    if (data) {
      this.catalogEntries = data;
      this._allRows = this._computeAllRows();
    }
  }

  get detectorLabelMap() {
    const out = { ...FALLBACK_DETECTOR_LABELS };
    for (const e of this.catalogEntries || []) {
      if (e.label) out[e.detectorId] = e.label;
    }
    return out;
  }

  // Trust scores aren't currently per-org (the formula consumes
  // global finding history), but we wire the URL state anyway so
  // future filtering doesn't require a contract change.
  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId || null;
  }

  @wire(getAllScores)
  wireData(result) {
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
      this._allRows = this._computeAllRows();
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return Boolean(this.error); }
  get isEmpty() {
    return !this.loading && !this.error && (!this.data || this.data.length === 0);
  }
  get hasData() {
    return !this.loading && !this.error && this.data && this.data.length > 0;
  }

  // ── KPI strip on the card header ──
  get totalDetectors() { return this.data?.length || 0; }

  get scoredDetectors() {
    return (this.data || []).filter((r) => r.Score__c != null);
  }

  get averageScoreFmt() {
    const scored = this.scoredDetectors;
    if (!scored.length) return '—';
    const avg = scored.reduce((s, r) => s + (r.Score__c || 0), 0) / scored.length;
    return `${Math.round(avg * 100)}%`;
  }

  get insufficientDataCount() {
    return (this.data || []).filter((r) => r.Score__c == null).length;
  }

  get insufficientLabel() {
    const n = this.insufficientDataCount;
    if (n === 0) return '';
    return `${n} detector${n === 1 ? '' : 's'} below sample threshold`;
  }

  // ── Row data ──
  get rows() {
    const all = this.allRows;
    return this.showAll ? all : all.slice(0, INITIAL_VISIBLE);
  }
  /** Phase 22q — pagination toggle support. The toggle button appears
   *  whenever the underlying list has more entries than the initial
   *  preview window; the label flips between "View all N" and
   *  "Show less" based on current state. */
  get isPaginated() {
    return this.allRows.length > INITIAL_VISIBLE;
  }
  get toggleLabel() {
    return this.showAll ? 'Show less' : `View all ${this.allRows.length}`;
  }
  toggleShowAll() { this.showAll = !this.showAll; }

  _computeAllRows() {
    if (!this.data) return [];
    return this.data.map((r) => {
      const score = r.Score__c;
      const insufficient = score == null;
      const pct = insufficient ? null : Math.round(score * 100);
      const recovered = r.RecoveredCount__c || 0;
      const regressed = r.RegressedCount__c || 0;
      const suppressed = r.SuppressedCount__c || 0;
      const findings = r.FindingCount__c || 0;
      return {
        id: r.Id,
        detectorId: r.DetectorId__c,
        label: this.detectorLabelMap[r.DetectorId__c] || r.DetectorId__c,
        scoreLabel: insufficient ? 'No data' : `${pct}%`,
        scoreBadgeClass: this.scoreBadgeClass(score),
        rowClass: insufficient ? 'op-ts__row op-ts__row--muted' : 'op-ts__row',
        findings,
        recovered,
        regressed,
        suppressed,
        // Compact "12 findings · 3 recovered · 1 regressed · 2 suppressed"
        statsLine: this.statsLine(findings, recovered, regressed, suppressed),
        // Render a red "needs review" chip when regressions exist
        hasRegressions: regressed > 0,
      };
    });
  }

  get allRows() { return this._allRows; }

  scoreBadgeClass(score) {
    if (score == null) return 'op-ts__badge op-ts__badge--muted';
    if (score >= 0.85) return 'op-ts__badge op-ts__badge--good';
    if (score >= 0.65) return 'op-ts__badge op-ts__badge--warn';
    return 'op-ts__badge op-ts__badge--bad';
  }

  statsLine(findings, recovered, regressed, suppressed) {
    const parts = [`${findings} finding${findings === 1 ? '' : 's'}`];
    if (recovered) parts.push(`${recovered} recovered`);
    if (regressed) parts.push(`${regressed} regressed`);
    if (suppressed) parts.push(`${suppressed} suppressed`);
    return parts.join(' · ');
  }

  // ── Actions ──
  handleRowClick(event) {
    // Navigate to the Issues page filtered to this detector. Today
    // the Issues page doesn't take a detector URL param, so this
    // is a no-op until we add that — leave the hook in place.
    const detectorId = event.currentTarget.dataset.detector;
    if (!detectorId) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__navItemPage',
      attributes: { apiName: 'OrgPrism_Dashboard' },
      state: { c__detectorId: detectorId },
    });
  }

  handleRowClickKey(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      this.handleRowClick(e);
    }
  }
}

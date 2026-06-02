import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getFindingsByCategory from '@salesforce/apex/DashboardController.getFindingsByCategory';

const DETECTOR_LABELS = {
  'QL-FOR-002':  'Quote line approval skipped',
  'ORD-FOR-002': 'Q↔O variance (new business)',
  'ORD-FOR-003': 'Q↔O variance (amendment)',
  'PROV-FOR-002':'Active subscription, no asset',
  'OPP-FOR-001': 'Opportunity governance miss',
  'CON-FOR-001': 'Contract governance miss',
  'AMD-FOR-001': 'Amendment without effective date',
  'REN-003':     'Renewal forecast slipping',
  'REN-004':     'Renewal quote stuck in draft',
};

/**
 * Governance & Pipeline view — two cards side by side. Governance
 * detectors flag process/control failures; pipeline detectors flag
 * forecast/renewal risk. Most of these are v1.5+ — the v1.0 detectors
 * shipped today are mostly revenue_leakage, so these cards will often
 * show empty states until later phases of the product land more
 * detectors.
 */
export default class GovernancePipelineView extends NavigationMixin(LightningElement) {
  governance;
  pipeline;
  loadingGov = true;
  loadingPipe = true;
  errorGov;
  errorPipe;

  @wire(getFindingsByCategory, { category: 'governance' })
  wireGovernance(result) {
    this.loadingGov = false;
    if (result.data) {
      this.governance = result.data;
      this.errorGov = undefined;
    } else if (result.error) {
      this.errorGov = result.error.body?.message || result.error.message;
    }
  }

  @wire(getFindingsByCategory, { category: 'pipeline' })
  wirePipeline(result) {
    this.loadingPipe = false;
    if (result.data) {
      this.pipeline = result.data;
      this.errorPipe = undefined;
    } else if (result.error) {
      this.errorPipe = result.error.body?.message || result.error.message;
    }
  }

  get hasGovernance() { return this.governance?.findingCount > 0; }
  get hasPipeline() { return this.pipeline?.findingCount > 0; }
  get isLoading() { return this.loadingGov || this.loadingPipe; }

  get governanceRows() { return this.buildRows(this.governance); }
  get pipelineRows() { return this.buildRows(this.pipeline); }

  buildRows(dto) {
    if (!dto?.byDetector) return [];
    return dto.byDetector.map((g) => ({
      detectorId: g.detectorId,
      label: DETECTOR_LABELS[g.detectorId] || g.detectorId,
      count: g.count,
      totalFmt: this.formatMoney(g.totalUsd),
    }));
  }

  get governanceTotal() {
    return this.governance?.totalUsd ? this.formatMoney(this.governance.totalUsd) : '$0';
  }
  get pipelineTotal() {
    return this.pipeline?.totalUsd ? this.formatMoney(this.pipeline.totalUsd) : '$0';
  }

  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${Math.round(v)}`;
  }
}

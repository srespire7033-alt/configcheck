import { LightningElement, wire, track } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getAnalysis from '@salesforce/apex/AiAnalysisController.getAnalysis';

/**
 * AI-Powered Analysis card.
 *
 * Header: "Your org has N critical issue(s) centred on X and Y."
 * Bullet list: top 3 categories with critical/warning counts and "View" link.
 * Residual line: "+ N critical, M warnings across K other categories."
 * Bottom: "Show full analysis" expand → long-form prose from scan summary.
 *
 * View click → opens an inline categoryIssuesModal LWC.
 */
export default class AiAnalysisCard extends LightningElement {
  data;
  error;
  loading = true;
  @track showFullAnalysis = false;
  @track openCategory = null;
  /** Phase 22w — scope analysis to the active Connected Org. */
  @track connectedOrgId = null;
  wiredResult;

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId
      || pageRef.state?.connectedOrgId || null;
  }

  connectedCallback() { window.addEventListener('op:scan-completed', this.handleScanCompleted); }
  disconnectedCallback() { window.removeEventListener('op:scan-completed', this.handleScanCompleted); }
  handleScanCompleted = () => { if (this.wiredResult) refreshApex(this.wiredResult); };

  @wire(getAnalysis, { connectedOrgId: '$connectedOrgId' })
  wireData(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasData() { return !this.loading && !this.error && this.data; }

  get headline() { return this.data?.headline || ''; }
  get topCategories() {
    return (this.data?.topCategories || []).map((c) => ({
      ...c,
      countLabel: this.buildCountLabel(c),
    }));
  }
  buildCountLabel(c) {
    const parts = [];
    if (c.criticalCount > 0) parts.push(`${c.criticalCount} critical`);
    if (c.warningCount > 0) parts.push(`${c.warningCount} warning${c.warningCount === 1 ? '' : 's'}`);
    if (c.infoCount > 0) parts.push(`${c.infoCount} info`);
    return parts.join(', ');
  }

  get hasResidual() {
    return (this.data?.residualCritical > 0) || (this.data?.residualWarning > 0);
  }
  get residualLabel() {
    if (!this.hasResidual) return '';
    const parts = [];
    if (this.data.residualCritical > 0) parts.push(`${this.data.residualCritical} critical`);
    if (this.data.residualWarning > 0) parts.push(`${this.data.residualWarning} warnings`);
    const cats = this.data.residualCategories;
    const catLabel = `${cats} other categor${cats === 1 ? 'y' : 'ies'}`;
    return `+ ${parts.join(', ')} across ${catLabel} — see Top Issues above`;
  }

  get hasFullAnalysis() { return Boolean(this.data?.fullAnalysis); }
  get fullAnalysis() { return this.data?.fullAnalysis || ''; }
  get isExpanded() { return this.showFullAnalysis; }
  get expandLabel() { return this.showFullAnalysis ? 'Hide full analysis' : 'Show full analysis'; }
  get expandIcon() { return this.showFullAnalysis ? 'utility:chevrondown' : 'utility:chevronright'; }
  toggleFull() { this.showFullAnalysis = !this.showFullAnalysis; }

  handleViewCategory(event) {
    event.preventDefault();
    this.openCategory = event.currentTarget.dataset.label;
  }
  handleModalClose() {
    this.openCategory = null;
    if (this.wiredResult) refreshApex(this.wiredResult);
  }

  get isModalOpen() { return Boolean(this.openCategory); }
}

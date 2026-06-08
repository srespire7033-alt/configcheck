import { LightningElement, api, wire, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getIssueDetail from '@salesforce/apex/IssuesController.getIssueDetail';
import updateStatus from '@salesforce/apex/IssuesController.updateStatus';
import getLongDescription from '@salesforce/apex/DetectorCatalogController.getLongDescription';

/**
 * Issue Detail Page (full-page).
 * Lives at the ForensicFinding__c record page via FlexiPage.
 * Layout matches the SaaS detail screen exactly:
 *   - Back arrow + severity chip + detector code + title + Status dropdown
 *   - What's Wrong card
 *   - Why It Matters card
 *   - What To Change card
 *   - AI Fix Suggestion card (purple, with Generate Fix button placeholder)
 *   - Affected Records card
 */
const STATUS_OPTIONS = [
  { label: 'Open', value: 'Open' },
  { label: 'Acknowledged', value: 'Acknowledged' },
  { label: 'Resolved', value: 'Resolved' },
  { label: 'Ignored', value: 'Ignored' },
  { label: 'False Positive', value: 'False Positive' },
  { label: 'Not Relevant', value: 'Not Relevant' },
];

export default class IssueDetailPage extends NavigationMixin(LightningElement) {
  @api recordId;           // wired automatically on the record page
  @api findingId;          // explicit prop for AppPage variants
  @track data;
  @track error;
  @track loading = true;
  @track saving = false;
  @track aiFixPrompted = false;
  wiredResult;

  statusOptions = STATUS_OPTIONS;

  get effectiveId() { return this.findingId || this.recordId; }

  @wire(getIssueDetail, { findingId: '$effectiveId' })
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

  // Phase 24o — admin-facing detector description, looked up by
  // detectorId from the issue. cacheable=true on the Apex side so
  // we don't refetch on every detail-page open.
  @wire(getLongDescription, { detectorId: '$data.detectorId' })
  wireLongDesc({ data }) {
    this.longDescription = data;
  }

  get hasLongDescription() { return Boolean(this.longDescription); }
  // 4-line format ships with literal \n; render as <br>-separated lines
  // via a getter the template iterates instead of using innerHTML.
  get longDescriptionLines() {
    if (!this.longDescription) return [];
    return this.longDescription
      .split('\n')
      .map(t => t.trim())
      .filter(Boolean)
      .map((text, i) => ({ key: i, text }));
  }

  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasData() { return !this.loading && !this.error && this.data; }

  // ── Header ──
  get severityChipClass() {
    return `op-idp__sev-chip op-idp__sev-chip--${(this.data?.severity || '').toLowerCase()}`;
  }
  get severityLabel() { return (this.data?.severity || '').toLowerCase(); }

  // ── Affected records ──
  get hasAffected() { return (this.data?.affectedRecords?.length || 0) > 0; }
  handleAffectedOpen(event) {
    const id = event.currentTarget.dataset.id;
    const type = event.currentTarget.dataset.type;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: type, actionName: 'view' },
    });
  }

  // ── AI Fix Suggestion (placeholder) ──
  handleGenerateFix() {
    this.aiFixPrompted = true;
    this.dispatchEvent(new ShowToastEvent({
      title: 'AI Fix coming soon',
      message: 'Connect an Einstein/LLM endpoint in OrgPrism Settings to enable step-by-step fixes.',
      variant: 'info',
    }));
  }
  get aiSuggestionText() {
    if (this.aiFixPrompted) {
      return 'AI Fix is not yet configured. The recommended fix above is your starting point.';
    }
    return 'Click "Generate Fix" to get a detailed, step-by-step fix from AI.';
  }

  // ── Status updates ──
  async handleStatusChange(event) {
    const newStatus = event.detail.value;
    if (!newStatus || newStatus === this.data?.status) return;
    this.saving = true;
    try {
      await updateStatus({ findingId: this.effectiveId, status: newStatus });
      this.dispatchEvent(new ShowToastEvent({
        title: 'Status updated',
        message: `Marked as ${newStatus}`,
        variant: 'success',
      }));
      await refreshApex(this.wiredResult);
    } catch (e) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'Update failed',
        message: e.body?.message || e.message || 'Unknown error',
        variant: 'error',
      }));
    } finally {
      this.saving = false;
    }
  }

  // ── Back ──
  handleBack() {
    // navigate back to the OrgPrism dashboard
    this[NavigationMixin.Navigate]({
      type: 'standard__navItemPage',
      attributes: { apiName: 'standard-home' },
    });
  }
}

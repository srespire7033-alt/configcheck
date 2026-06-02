import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getDashboardSummary from '@salesforce/apex/DashboardController.getDashboardSummary';
import startScan from '@salesforce/apex/ForensicScanService.startScan';

/**
 * Polished native-LWC scan launcher. Replaces the minimal v1 launcher
 * (lwc/scanLauncher) which was a single button. v2 adds:
 *   - Product type pills (CPQ / CPQ+Billing / ARM)
 *   - Last-scan context line
 *   - Disabled state during scan with spinner + label change
 *   - Auto-navigate to the new scan record after completion
 *
 * The actual scan runs synchronously in Apex via
 * ForensicScanService.startScan — fine for orgs with <10K
 * candidate records. Larger orgs need Queueable; we add that in a
 * later sub-phase.
 */
const PRODUCT_TYPES = [
  { id: 'CPQ', label: 'CPQ' },
  { id: 'CPQ+Billing', label: 'CPQ + Billing' },
  { id: 'ARM', label: 'Revenue Cloud (ARM)' },
];

export default class ScanLauncherV2 extends NavigationMixin(LightningElement) {
  wiredSummary;
  selectedType = 'CPQ';
  running = false;
  lastError;

  @wire(getDashboardSummary)
  wireSummary(result) {
    this.wiredSummary = result;
  }

  get summary() { return this.wiredSummary?.data; }
  get hasLatest() { return Boolean(this.summary?.latestScan?.Id); }

  get pills() {
    return PRODUCT_TYPES.map((p) => ({
      ...p,
      cls: p.id === this.selectedType ? 'op-sl__pill op-sl__pill--active' : 'op-sl__pill',
    }));
  }

  get lastScanCaption() {
    if (!this.hasLatest) return 'No scans yet — run your first one to populate the dashboard.';
    const s = this.summary.latestScan;
    const when = s.CompletedAt__c || s.StartedAt__c;
    const ago = when ? this.timeAgo(when) : '';
    const parts = [];
    if (ago) parts.push('Last scan ' + ago);
    if (s.ProductType__c) parts.push(s.ProductType__c);
    if (this.summary.findingCount > 0) parts.push(`${this.summary.findingCount} findings`);
    return parts.join(' · ');
  }

  get buttonLabel() {
    if (this.running) return 'Scanning…';
    return this.hasLatest ? 'Run new scan' : 'Run first scan';
  }

  timeAgo(iso) {
    const t = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - t);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    return days < 7 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString();
  }

  handlePillClick(event) {
    if (this.running) return;
    const id = event.currentTarget.dataset.id;
    if (id) this.selectedType = id;
  }

  async handleRun() {
    if (this.running) return;
    this.running = true;
    this.lastError = null;
    try {
      const scanId = await startScan({ productType: this.selectedType });
      this.dispatchEvent(new ShowToastEvent({
        title: 'Scan complete',
        variant: 'success',
      }));
      // Refresh the dashboard wire so siblings pick up the new scan.
      await refreshApex(this.wiredSummary);
      // Auto-navigate so the user can see the new scan's findings.
      if (scanId) {
        this[NavigationMixin.Navigate]({
          type: 'standard__recordPage',
          attributes: {
            recordId: scanId,
            objectApiName: 'ForensicScan__c',
            actionName: 'view',
          },
        });
      }
    } catch (e) {
      this.lastError = e?.body?.message || e?.message || 'Scan failed';
      this.dispatchEvent(new ShowToastEvent({
        title: 'Scan failed',
        message: this.lastError,
        variant: 'error',
      }));
    } finally {
      this.running = false;
    }
  }
}

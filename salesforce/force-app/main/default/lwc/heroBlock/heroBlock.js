import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { NavigationMixin } from 'lightning/navigation';
import getDashboardSummary from '@salesforce/apex/DashboardController.getDashboardSummary';

/**
 * Hero block — the top of the OrgPrism dashboard inside Salesforce.
 *
 * Renders one of three states:
 *   1. Empty   — no scans yet. Shows guidance + "Run scan" CTA.
 *   2. No data — scans exist but no findings. Shows scan info +
 *                "Clean org" message.
 *   3. Active  — scan has findings. Shows $ headline + severity
 *                tiles + last-scan caption.
 *
 * Data source: DashboardController.getDashboardSummary() — wired and
 * cacheable so multiple components on the same FlexiPage reuse the
 * same data without re-querying.
 */
export default class HeroBlock extends NavigationMixin(LightningElement) {
  wiredResult;
  data;
  error;
  loading = true;

  @wire(getDashboardSummary)
  wireData(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message || 'Failed to load dashboard data';
      this.data = undefined;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // State branches
  // ─────────────────────────────────────────────────────────────

  get isLoading() {
    return this.loading;
  }
  get hasError() {
    return Boolean(this.error);
  }
  get isEmpty() {
    return !this.loading && !this.error && (!this.data || !this.data.latestScan);
  }
  get hasNoFindings() {
    return !this.isEmpty && this.data && !this.data.hasForensicData;
  }
  get hasFindings() {
    return !this.isEmpty && this.data && this.data.hasForensicData;
  }

  // ─────────────────────────────────────────────────────────────
  // Derived display values
  // ─────────────────────────────────────────────────────────────

  get totalVerifiedUsd() {
    return this.data?.totalVerifiedUsd || 0;
  }
  get criticalCount() {
    return this.data?.criticalCount || 0;
  }
  get warningCount() {
    return this.data?.warningCount || 0;
  }
  get infoCount() {
    return this.data?.infoCount || 0;
  }
  get findingCount() {
    return this.data?.findingCount || 0;
  }
  get scanName() {
    return this.data?.latestScan?.Name || '';
  }
  get productType() {
    return this.data?.latestScan?.ProductType__c || '';
  }
  get scanCompletedAt() {
    return this.data?.latestScan?.CompletedAt__c || this.data?.latestScan?.StartedAt__c;
  }
  /** Compact caption: "Last scan 3 min ago · CPQ · 45 findings · FS-0042" */
  get caption() {
    if (!this.data?.latestScan) return '';
    const parts = [];
    const when = this.scanCompletedAt;
    if (when) parts.push('Last scan ' + this.formatTimeAgo(when));
    if (this.productType) parts.push(this.productType);
    if (this.findingCount > 0) parts.push(`${this.findingCount} findings`);
    if (this.scanName) parts.push(this.scanName);
    return parts.join(' · ');
  }

  formatTimeAgo(iso) {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(iso).toLocaleDateString();
  }

  // ─────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────

  handleViewScans() {
    this[NavigationMixin.Navigate]({
      type: 'standard__objectPage',
      attributes: {
        objectApiName: 'ForensicScan__c',
        actionName: 'list',
      },
    });
  }

  handleViewScan() {
    if (!this.data?.latestScan?.Id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: {
        recordId: this.data.latestScan.Id,
        objectApiName: 'ForensicScan__c',
        actionName: 'view',
      },
    });
  }

  /** Public API to force refresh — parent pages or sibling LWCs can
   *  call this after a scan completes to update the hero live. */
  async refresh() {
    if (this.wiredResult) await refreshApex(this.wiredResult);
  }
}

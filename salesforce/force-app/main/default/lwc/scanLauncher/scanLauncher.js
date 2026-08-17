import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import startScan from '@salesforce/apex/ForensicScanService.startScan';
import getLatestScan from '@salesforce/apex/FindingsListController.getLatestScan';

export default class ScanLauncher extends LightningElement {
  @track productType = 'CPQ';
  @track running = false;
  @track lastScanId = null;
  @track lastScanName = '';
  @track findingCount = 0;
  @track totalLeakage = 0;
  @track errorMessage = null;

  handleProductTypeChange(event) {
    this.productType = event.target.value;
  }

  async handleRunScan() {
    this.running = true;
    this.errorMessage = null;
    this.lastScanId = null;

    try {
      // Kick off the scan synchronously. In v1.5 we'll move this to
      // Queueable for larger orgs that exceed the 5-min sync limit.
      const scanId = await startScan({ productType: this.productType });

      // Re-query to get the finalized totals + name.
      const scan = await getLatestScan();
      if (scan && scan.Id === scanId) {
        this.lastScanId = scan.Id;
        this.lastScanName = scan.Name;
        this.findingCount = scan.FindingCount__c || 0;
        this.totalLeakage = scan.TotalLeakageUsd__c || 0;
      }

      this.dispatchEvent(
        new ShowToastEvent({
          title: 'Scan complete',
          message: `Found ${this.findingCount} findings`,
          variant: 'success',
        })
      );

      // Fire a custom event so a parent page (e.g., the dashboard) can
      // refresh its findings list after the scan completes.
      this.dispatchEvent(
        new CustomEvent('scancomplete', { detail: { scanId } })
      );
    } catch (e) {
      this.errorMessage = e?.body?.message || e?.message || 'Scan failed';
      this.dispatchEvent(
        new ShowToastEvent({
          title: 'Scan failed',
          message: this.errorMessage,
          variant: 'error',
        })
      );
    } finally {
      this.running = false;
    }
  }

  get formattedLeakage() {
    if (!this.totalLeakage) return '$0';
    const n = Number(this.totalLeakage);
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${Math.round(n)}`;
  }
}

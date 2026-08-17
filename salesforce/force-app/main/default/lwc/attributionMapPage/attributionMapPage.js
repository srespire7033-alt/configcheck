import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getMap from '@salesforce/apex/AttributionMapController.getMap';

export default class AttributionMapPage extends NavigationMixin(LightningElement) {
  @track data;
  @track error;
  @track loading = true;
  @track expandedKey = null;

  @wire(getMap)
  wireData(result) {
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
  get hasData() { return !this.loading && !this.error && this.data && (this.data.totalRoots > 0); }
  get isEmpty() { return !this.loading && !this.error && (!this.data || this.data.totalRoots === 0); }

  get totalLabel() {
    const v = this.data?.totalUsd || 0;
    return this.formatMoney(v);
  }
  get rootCountLabel() {
    return `${this.data?.totalRoots || 0} root configs`;
  }

  get rows() {
    return (this.data?.roots || []).map((r) => {
      const key = `${r.rootConfigType}|${r.rootConfigName}`;
      const isOpen = this.expandedKey === key;
      return {
        ...r,
        key,
        isOpen,
        totalLabel: this.formatMoney(r.totalUsd),
        chevronClass: isOpen ? 'op-am__chev op-am__chev--open' : 'op-am__chev',
        findingsView: (r.findings || []).map((f) => ({
          ...f,
          gapLabel: this.formatMoney(f.gapUsd),
          sevChipClass: `op-am__sev op-am__sev--${(f.severity || '').toLowerCase()}`,
        })),
      };
    });
  }

  handleToggle(event) {
    const key = event.currentTarget.dataset.key;
    this.expandedKey = this.expandedKey === key ? null : key;
  }
  handleToggleKey(event) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.handleToggle(event);
    }
  }
  handleFindingClick(event) {
    event.stopPropagation();
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicFinding__c', actionName: 'view' },
    });
  }
  handleFindingClickKey(event) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.handleFindingClick(event);
    }
  }

  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    if (v < 1) return '$0';
    return `$${Math.round(v).toLocaleString()}`;
  }
}

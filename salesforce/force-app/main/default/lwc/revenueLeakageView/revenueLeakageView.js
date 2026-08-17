import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getLeakage from '@salesforce/apex/RevenueLeakageController.getLeakage';
import getCategoryByKey from '@salesforce/apex/CategoryDisplayController.getByKey';

const SEVERITY_OPTIONS = ['Critical', 'Warning', 'Info'];
const EFFORT_OPTIONS   = ['low', 'medium', 'high'];

export default class RevenueLeakageView extends NavigationMixin(LightningElement) {
  @track data;
  @track error;
  @track loading = true;
  @track searchTerm = '';
  @track severityFilters = [];
  @track effortFilters = [];
  @track openLeakId = null;
  @track openIssueDetailId = null;
  @track categoryMeta;  // Phase 20d
  /** Phase 22w — scope leakage rollup to the active Connected Org. */
  @track connectedOrgId = null;
  wiredResult;

  // Phase 25 — derived state cached imperatively. LWC getters re-run
  // on every reactive update; with 100+ findings the viewThemes walk
  // was running 3-5x per render (template, filteredCount getter,
  // findingCountLabel getter) and hanging the tab on filter clicks.
  @track _viewThemes = [];
  @track _filteredCount = 0;

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId
      || pageRef.state?.connectedOrgId || null;
  }

  @wire(getCategoryByKey, { categoryKey: 'revenue_leakage' })
  wireCategoryMeta({ data }) {
    if (data) this.categoryMeta = data;
  }

  get cardTitle() {
    return this.categoryMeta?.title || 'Revenue Leakage';
  }

  connectedCallback() { window.addEventListener('op:scan-completed', this.handleScanCompleted); }
  disconnectedCallback() { window.removeEventListener('op:scan-completed', this.handleScanCompleted); }
  handleScanCompleted = () => { if (this.wiredResult) refreshApex(this.wiredResult); };

  @wire(getLeakage, { connectedOrgId: '$connectedOrgId' })
  wireData(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
      this._recompute();
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasData() { return !this.loading && !this.error && this.data; }
  get isEmpty() { return this.hasData && (this.data.findingCount || 0) === 0; }
  get hasContent() { return this.hasData && !this.isEmpty; }

  // ── Header ──
  get confidenceLabel() {
    const c = this.data?.confidence || 'low';
    return c.charAt(0).toUpperCase() + c.slice(1) + ' confidence';
  }
  get confidenceChipClass() {
    return `op-rl__conf op-rl__conf--${this.data?.confidence || 'low'}`;
  }

  // ── Totals card ──
  get totalLabel() {
    return this.formatMoney(this.data?.totalUsd) + ' / year';
  }
  get verifiedLabel() {
    return this.formatMoney(this.data?.totalVerifiedUsd);
  }
  get estimatedLabel() {
    return this.formatMoney(this.data?.estimatedUsd || 0);
  }
  get pctOfRevenueLabel() {
    const pct = this.data?.percentOfRevenue || 0;
    if (!pct) return 'Opportunity baseline unavailable.';
    return `${pct.toFixed(1)}% of your annual revenue from Opportunity records`;
  }

  // ── Toolbar pills ──
  get severityPills() {
    return SEVERITY_OPTIONS.map((s) => ({
      label: s, value: s,
      active: this.severityFilters.includes(s),
      pillClass: this.severityFilters.includes(s)
        ? `op-rl__pill op-rl__pill--active op-rl__pill--${s.toLowerCase()}`
        : 'op-rl__pill',
    }));
  }
  get effortPills() {
    return EFFORT_OPTIONS.map((s) => ({
      label: s === 'low' ? 'Low' : s === 'medium' ? 'Med' : 'High',
      value: s,
      active: this.effortFilters.includes(s),
      pillClass: this.effortFilters.includes(s)
        ? 'op-rl__pill op-rl__pill--active op-rl__pill--effort'
        : 'op-rl__pill',
    }));
  }
  get findingCountLabel() {
    return `${this._filteredCount} findings`;
  }
  get headerFindingCount() {
    return `(${this.data?.findingCount || 0})`;
  }
  get filteredCount() {
    return this._filteredCount;
  }

  toggleSev(event) {
    const v = event.currentTarget.dataset.value;
    const next = new Set(this.severityFilters);
    next.has(v) ? next.delete(v) : next.add(v);
    this.severityFilters = Array.from(next);
    this._recompute();
  }
  toggleEffort(event) {
    const v = event.currentTarget.dataset.value;
    const next = new Set(this.effortFilters);
    next.has(v) ? next.delete(v) : next.add(v);
    this.effortFilters = Array.from(next);
    this._recompute();
  }
  handleSearch(event) {
    this.searchTerm = event.target.value;
    this._recompute();
  }

  // ── Theme grid ──
  passesFilters(row) {
    if (this.severityFilters.length > 0 && !this.severityFilters.includes(row.severity)) return false;
    if (this.effortFilters.length > 0 && !this.effortFilters.includes(row.effort)) return false;
    if (this.searchTerm) {
      const q = this.searchTerm.toLowerCase();
      const hit = (row.title || '').toLowerCase().includes(q)
               || (row.detectorId || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  }

  get viewThemes() {
    return this._viewThemes;
  }

  /** Recompute derived view state in one pass. Called when data lands,
   *  or when any filter input (severity / effort / search) changes.
   *  Replaces the prior pattern of three getters that all called
   *  viewThemes — which re-walked all themes 3-5x per render. */
  _recompute() {
    if (!this.data?.themes) {
      this._viewThemes = [];
      this._filteredCount = 0;
      return;
    }
    let totalFiltered = 0;
    const next = this.data.themes.map((t) => {
      const filtered = (t.topThree || []).filter((r) => this.passesFilters(r))
        .map((r) => this.decorateRow(r));
      totalFiltered += filtered.length;
      return {
        ...t,
        cardClass: `op-rl__theme op-rl__theme--${t.accent}`,
        accentLabelClass: `op-rl__theme-total op-rl__theme-total--${t.accent}`,
        rows: filtered,
        filteredCount: filtered.length,
        totalLabel: this.formatMoney(t.totalUsd),
        countLabel: t.count.toString(),
        showMore: t.moreCount > 0,
        moreLabel: `+ ${t.moreCount} more →`,
      };
    });
    this._viewThemes = next;
    this._filteredCount = totalFiltered;
  }

  decorateRow(r) {
    const sev = (r.severity || '').toLowerCase();
    return {
      ...r,
      sevChipClass: `op-rl__row-sev op-rl__row-sev--${sev}`,
      effortChipClass: `op-rl__row-effort op-rl__row-effort--${r.effort}`,
      gapLabel: this.formatMoney(r.gapUsd),
      effortLabel: r.effort === 'low' ? 'LOW' : r.effort === 'medium' ? 'MEDIUM' : 'HIGH',
      truncatedTitle: (r.title || '').length > 32 ? (r.title || '').substring(0, 32) + '…' : r.title,
    };
  }

  // ── Biggest leaks ──
  get viewBiggestLeaks() {
    if (!this.data?.biggestLeaks) return [];
    return this.data.biggestLeaks.map((r) => ({
      ...r,
      isOpen: this.openLeakId === r.id,
      chevronIcon: this.openLeakId === r.id ? 'utility:chevrondown' : 'utility:chevrondown', // rotate via CSS
      chevronClass: this.openLeakId === r.id ? 'op-rl__leak-chev op-rl__leak-chev--open' : 'op-rl__leak-chev',
      gapLabel: this.formatMoney(r.gapUsd),
    }));
  }

  handleLeakToggle(event) {
    const id = event.currentTarget.dataset.id;
    this.openLeakId = this.openLeakId === id ? null : id;
  }
  handleLeakToggleKey(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      this.handleLeakToggle(e);
    }
  }
  handleRowClick(event) {
    const id = event.currentTarget.dataset.id;
    this.openIssueDetailId = id;
  }
  handleRowClickKey(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      this.handleRowClick(e);
    }
  }
  handleIssueModalClose() { this.openIssueDetailId = null; }
  handleStatusChanged() { if (this.wiredResult) refreshApex(this.wiredResult); }
  get isIssueModalOpen() { return Boolean(this.openIssueDetailId); }

  // ── Action banners ──
  handleAttributionMap() {
    this[NavigationMixin.Navigate]({
      type: 'standard__navItemPage',
      attributes: { apiName: 'OrgPrism_AttributionMap' },
    });
  }
  handleRecoveryQueue() {
    this[NavigationMixin.Navigate]({
      type: 'standard__navItemPage',
      attributes: { apiName: 'OrgPrism_RecoveryQueue' },
    });
  }
  handleDownloadReport() {
    window.open('/apex/ExecutiveReport', '_blank');
  }

  // ── Utilities ──
  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    if (v < 1) return 'USD 0';
    return `$${Math.round(v).toLocaleString()}`;
  }
}

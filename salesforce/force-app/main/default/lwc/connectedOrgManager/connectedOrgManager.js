import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import listConnectedOrgsWithScanStats from '@salesforce/apex/RemoteOrgService.listConnectedOrgsWithScanStats';
import testConnection from '@salesforce/apex/RemoteOrgService.testConnection';
import startRemoteScan from '@salesforce/apex/ForensicScanService.startRemoteScan';

// Color stripe per product type (matches the web mockup gradient look).
const STRIPE = {
  ARM:           'background:linear-gradient(90deg,#f59e0b,#fb923c);',
  CPQ:           'background:linear-gradient(90deg,#3b82f6,#06b6d4);',
  'CPQ+Billing': 'background:linear-gradient(90deg,#3b82f6,#8b5cf6);',
  DEFAULT:       'background:linear-gradient(90deg,#94a3b8,#cbd5e1);',
};

const PRODUCT_LABEL = {
  'CPQ':         'CPQ',
  'CPQ+Billing': 'CPQ + Billing',
  'ARM':         'ARM',
};

const fmtAgo = (d) => {
  if (!d) return null;
  const ms = Date.now() - new Date(d).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(d).toLocaleDateString();
};

export default class ConnectedOrgManager extends NavigationMixin(LightningElement) {
  @track rows = [];
  @track error;
  @track loading = true;
  @track testingId = null;
  @track scanningId = null;
  @track sortKey = 'name';
  @track view = 'grid';
  wiredResult;

  @wire(listConnectedOrgsWithScanStats)
  wireRows(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.rows = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  // ─── Render flags ───
  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasRows() { return !this.loading && !this.error && this.rows.length > 0; }
  get isEmpty() { return !this.loading && !this.error && this.rows.length === 0; }
  get isAnyScanning() { return Boolean(this.scanningId); }
  get cannotCompare() { return this.rows.length < 2; }
  get gridClass() {
    return this.view === 'grid' ? 'op-co__grid' : 'op-co__grid op-co__grid--list';
  }
  get gridBtnClass() {
    return `op-co__view-btn ${this.view === 'grid' ? 'op-co__view-btn--active' : ''}`;
  }
  get listBtnClass() {
    return `op-co__view-btn ${this.view === 'list' ? 'op-co__view-btn--active' : ''}`;
  }

  // ─── KPIs (derived) ───
  get kpiOrgs() { return this.rows.length; }
  get kpiAvgScore() {
    const scored = this.rows.filter(r => r.score != null);
    if (!scored.length) return '—';
    return Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length);
  }
  get kpiAvgScoreClass() {
    const v = this.kpiAvgScore;
    if (v === '—' || v >= 80) return 'op-co__kpi-num op-co__kpi-num--good';
    if (v >= 60) return 'op-co__kpi-num op-co__kpi-num--mid';
    return 'op-co__kpi-num op-co__kpi-num--bad';
  }
  get kpiOrgsWithCritical() {
    return this.rows.filter(r => (r.criticalCount || 0) > 0).length;
  }
  get kpiCriticalFindings() {
    return this.rows.reduce((a, r) => a + (r.criticalCount || 0), 0);
  }

  // ─── Per-row view model ───
  get viewRows() {
    const sorted = [...this.rows].sort((a, b) => {
      if (this.sortKey === 'score') return (b.score || 0) - (a.score || 0);
      if (this.sortKey === 'scanned') {
        const ta = a.lastScanAt ? new Date(a.lastScanAt).getTime() : 0;
        const tb = b.lastScanAt ? new Date(b.lastScanAt).getTime() : 0;
        return tb - ta;
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    return sorted.map((r) => {
      const products = (r.productType || '').split(';').filter(Boolean);
      const chips = products.map(p => PRODUCT_LABEL[p] || p);
      const primary = products[0];
      const stripeStyle = STRIPE[primary] || STRIPE.DEFAULT;

      const scoreDisplay = (r.score == null) ? '—' : String(r.score);
      const scoreClass = (() => {
        if (r.score == null) return 'op-co__score op-co__score--none';
        if (r.score >= 80) return 'op-co__score op-co__score--good';
        if (r.score >= 60) return 'op-co__score op-co__score--mid';
        return 'op-co__score op-co__score--bad';
      })();

      let deltaDisplay = '— no change';
      let deltaClass = 'op-co__delta';
      if (r.scoreDelta == null) {
        deltaDisplay = r.lastScanAt ? '— no change' : '— first scan';
      } else if (r.scoreDelta > 0) {
        deltaDisplay = `▲ +${r.scoreDelta}`;
        deltaClass = 'op-co__delta op-co__delta--up';
      } else if (r.scoreDelta < 0) {
        deltaDisplay = `▼ ${r.scoreDelta}`;
        deltaClass = 'op-co__delta op-co__delta--down';
      }

      const isScanning = this.scanningId === r.id;
      const isConnected = r.status === 'Connected';

      return {
        ...r,
        productChips: chips,
        stripeStyle,
        scoreDisplay,
        scoreClass,
        deltaDisplay,
        deltaClass,
        hasLastScan: Boolean(r.lastScanAt),
        lastScanAgo: fmtAgo(r.lastScanAt),
        isScanning,
        isTesting: this.testingId === r.id,
        cannotScan: !isConnected || isScanning,
        cannotOpen: !r.latestScanId,
        scanBtnLabel: isScanning ? 'Scanning…' : 'Run Scan',
        scanTooltip: isConnected ? 'Run a full OrgPrism scan against this remote org' : 'Test connection first',
        testBtnLabel: this.testingId === r.id ? 'Testing…' : 'Test Connection',
        showError: r.status === 'Auth Failed' || r.status === 'Unreachable',
        statusShort: r.status,
      };
    });
  }

  // ─── Handlers ───
  handleSortChange(e) { this.sortKey = e.target.value; }
  handleViewChange(e) { this.view = e.currentTarget.dataset.view; }

  async handleTest(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.testingId) return;
    this.testingId = id;
    try {
      const res = await testConnection({ connectedOrgId: id });
      this.dispatchEvent(new ShowToastEvent({
        title: res.ok ? 'Connected' : 'Connection failed',
        message: res.ok ? `Reached ${res.remoteOrgName} (${res.remoteOrgId})` : (res.error || 'Unknown error'),
        variant: res.ok ? 'success' : 'error',
      }));
      await refreshApex(this.wiredResult);
    } catch (e) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'Connection failed',
        message: e.body?.message || e.message || 'Unknown error',
        variant: 'error',
      }));
    } finally {
      this.testingId = null;
    }
  }

  async handleScan(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.scanningId) return;
    await this._runScan(id);
  }

  async handleScanAll() {
    const connectable = this.rows.filter(r => r.status === 'Connected');
    if (!connectable.length) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'No connected orgs',
        message: 'Test the connection on at least one org before running Scan All.',
        variant: 'warning',
      }));
      return;
    }
    this.dispatchEvent(new ShowToastEvent({
      title: 'Scanning all',
      message: `Starting scans on ${connectable.length} org(s). This will run sequentially.`,
      variant: 'info',
    }));
    for (const r of connectable) {
      try { await this._runScan(r.id, true); }
      catch (e) { /* per-org errors already toasted inside _runScan */ }
    }
  }

  async _runScan(connectedOrgId, suppressRedirect = false) {
    this.scanningId = connectedOrgId;
    try {
      // For now default to CPQ. The org's ProductType__c will eventually
      // drive a per-product scan (Phase 8b — multi-product scan loop).
      const scanId = await startRemoteScan({ productType: 'CPQ', connectedOrgId });

      this.dispatchEvent(new ShowToastEvent({
        title: 'Scan complete',
        message: 'Remote scan finished. Opening dashboard...',
        variant: 'success',
      }));

      window.dispatchEvent(new CustomEvent('op:scan-completed'));
      await refreshApex(this.wiredResult);

      if (!suppressRedirect && scanId) {
        // Navigate to the OrgPrism Dashboard tab, scoped to this org.
        // The `c__connectedOrgId` state param is picked up by heroBlock's
        // CurrentPageReference wire, which filters the latest-scan query.
        this[NavigationMixin.Navigate]({
          type: 'standard__navItemPage',
          attributes: { apiName: 'OrgPrism_Dashboard' },
          state: { c__connectedOrgId: connectedOrgId },
        });
      }
    } catch (e) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'Remote scan failed',
        message: e.body?.message || e.message || 'Unknown error',
        variant: 'error',
      }));
      throw e;
    } finally {
      this.scanningId = null;
    }
  }

  handleOpen(event) {
    // Phase 8c: navigate to the OrgPrism Dashboard tab WITH the
    // connectedOrgId in URL state. heroBlock reads this via
    // CurrentPageReference and filters the latest-scan query.
    const orgId = event.currentTarget.dataset.id;
    this[NavigationMixin.Navigate]({
      type: 'standard__navItemPage',
      attributes: { apiName: 'OrgPrism_Dashboard' },
      state: orgId ? { c__connectedOrgId: orgId } : undefined,
    });
  }

  handleOpenRecord(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ConnectedOrg__c', actionName: 'view' },
    });
  }

  handleAddNew() {
    this[NavigationMixin.Navigate]({
      type: 'standard__objectPage',
      attributes: { objectApiName: 'ConnectedOrg__c', actionName: 'new' },
    });
  }

  handleCompare() {
    this.dispatchEvent(new ShowToastEvent({
      title: 'Coming soon',
      message: 'Multi-org compare will ship in Phase 8b. For now, run individual scans and use the Score Trend card to compare over time.',
      variant: 'info',
    }));
  }

  // ── Cross-LWC scan refresh + Accessibility ──
  connectedCallback() { window.addEventListener('op:scan-completed', this.handleScanCompleted); }
  disconnectedCallback() { window.removeEventListener('op:scan-completed', this.handleScanCompleted); }
  handleScanCompleted = () => { if (this.wiredResult) refreshApex(this.wiredResult); };
}

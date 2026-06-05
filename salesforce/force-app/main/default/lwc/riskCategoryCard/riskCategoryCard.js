import { LightningElement, api, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getFindingsByCategory from '@salesforce/apex/DashboardController.getFindingsByCategory';
import getCategoryByKey from '@salesforce/apex/CategoryDisplayController.getByKey';
import getCatalog from '@salesforce/apex/DetectorCatalogController.getCatalog';

/**
 * Phase 20b — category display metadata moved to Category__mdt.
 * Apex returns { title, subtitle, iconName, accent, summaryMode } per
 * key. The fallback below covers the moment between LWC load and the
 * @wire firing (and the case where mdt isn't seeded yet).
 */
const FALLBACK_META = {
  governance: {
    title: 'Governance Risk',
    subtitle: "Process and audit findings — the dollar amount isn't the story; the missing audit trail is.",
    iconName: 'utility:shield',
    accent: 'amber',
    summaryMode: 'count',
  },
  pipeline: {
    title: 'Pipeline Risk',
    subtitle: 'Revenue actively walking out the door — not lost yet, but it will be without action.',
    iconName: 'utility:trending',
    accent: 'sky',
    summaryMode: 'arr',
  },
};

/**
 * Phase 20d — DETECTOR_TITLES + DETECTOR_EFFORT are now fallbacks.
 * The live values come from Detector__mdt via @wire(getCatalog).
 * The hardcoded maps stay for the pre-wire first paint and as a
 * safety net when mdt isn't seeded.
 */
const FALLBACK_DETECTOR_TITLES = {
  'OPP-FOR-001': 'Closed-Won, no Quote',
  'CON-FOR-001': 'Contract activated, all subs expired',
  'AMD-FOR-001': 'Amendment missing effective date',
  'QL-FOR-002': 'Quote line approval skipped',
  'ORD-FOR-002': 'Q→O variance new business',
  'ORD-FOR-003': 'Q→O variance amendment',
  'PROV-FOR-002': 'Active subscription, no Asset',
  'REN-003': 'Quote expired, no renewal action',
  'REN-004': 'Renewal Quote stuck past contract end',
};

const FALLBACK_DETECTOR_EFFORT = {
  'REN-001': 'medium', 'REN-002': 'medium', 'REN-003': 'low', 'REN-004': 'low',
  'DSC-FOR-001': 'medium', 'DSC-FOR-002': 'medium',
  'QL-FOR-001': 'medium', 'QL-FOR-002': 'low',
  'ORD-FOR-001': 'high', 'ORD-FOR-002': 'medium', 'ORD-FOR-003': 'medium',
  'SUB-FOR-001': 'medium', 'PROV-FOR-001': 'high', 'PROV-FOR-002': 'medium',
  'OPP-FOR-001': 'low', 'CON-FOR-001': 'low', 'AMD-FOR-001': 'low',
  'AST-FOR-001': 'high', 'CT-FOR-001': 'medium', 'MDQ-FOR-001': 'high',
};

const SEVERITY_OPTIONS = ['Critical', 'Warning', 'Info'];
const EFFORT_OPTIONS = ['low', 'medium', 'high'];

export default class RiskCategoryCard extends NavigationMixin(LightningElement) {
  @api category = 'governance';
  @track data;
  @track error;
  @track loading = true;
  @track searchTerm = '';
  @track severityFilters = [];
  @track effortFilters = [];
  wiredResult;
  @track connectedOrgId = null;
  @track mdtMeta;  // Phase 20b — Category__mdt response
  @track catalogEntries = [];  // Phase 20d — Detector__mdt rows

  @wire(getCategoryByKey, { categoryKey: '$category' })
  wireCategoryMeta({ data }) {
    if (data) this.mdtMeta = data;
  }

  @wire(getCatalog)
  wireCatalog({ data }) {
    if (data) this.catalogEntries = data;
  }

  /**
   * Live detector-id → title map. Defaults from FALLBACK_DETECTOR_TITLES;
   * Detector__mdt.Label__c wins when present.
   */
  get detectorTitleMap() {
    const out = { ...FALLBACK_DETECTOR_TITLES };
    for (const e of this.catalogEntries || []) {
      if (e.label) out[e.detectorId] = e.label;
    }
    return out;
  }

  /** Same shape for effort. */
  get detectorEffortMap() {
    const out = { ...FALLBACK_DETECTOR_EFFORT };
    for (const e of this.catalogEntries || []) {
      if (e.effort) out[e.detectorId] = e.effort;
    }
    return out;
  }

  connectedCallback() { window.addEventListener('op:scan-completed', this.handleScanCompleted); }
  disconnectedCallback() { window.removeEventListener('op:scan-completed', this.handleScanCompleted); }
  handleScanCompleted = () => { if (this.wiredResult) refreshApex(this.wiredResult); };

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId || pageRef.state?.connectedOrgId || null;
  }

  @wire(getFindingsByCategory, { category: '$category', connectedOrgId: '$connectedOrgId' })
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

  get meta() {
    // Prefer Category__mdt-backed values (live-editable in Setup);
    // fall back to FALLBACK_META so the first paint isn't blank.
    if (this.mdtMeta) {
      return {
        title: this.mdtMeta.title,
        subtitle: this.mdtMeta.subtitle,
        iconName: this.mdtMeta.iconName,
        accent: this.mdtMeta.accent,
        summaryMode: this.mdtMeta.summaryMode,
      };
    }
    return FALLBACK_META[this.category] || FALLBACK_META.governance;
  }
  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasData() { return !this.loading && !this.error && this.data; }
  get isEmpty() { return this.hasData && (this.data.findingCount || 0) === 0; }
  get hasContent() { return this.hasData && (this.data.findingCount || 0) > 0; }

  get headerIconClass() { return `op-rc__head-icon op-rc__head-icon--${this.meta.accent}`; }
  get headerIconWrapClass() { return `op-rc__head-icon-wrap op-rc__head-icon-wrap--${this.meta.accent}`; }
  get summaryChipClass() { return `op-rc__summary op-rc__summary--${this.meta.accent}`; }

  get title() { return this.meta.title; }
  get subtitle() { return this.meta.subtitle; }
  get iconName() { return this.meta.iconName; }

  get summaryBig() { return (this.data?.findingCount || 0).toString(); }
  get summarySmall() {
    if (this.meta.summaryMode === 'arr') {
      return this.formatMoney(this.data?.totalUsd) + ' ARR';
    }
    return 'FINDINGS';
  }

  // ── Detector summary grid ──
  get detectorCards() {
    return (this.data?.byDetector || []).map((g) => ({
      ...g,
      title: this.detectorTitleMap[g.detectorId] || g.detectorId,
      countLabel: `${g.count} finding${g.count === 1 ? '' : 's'}`,
      gapLabel: (this.meta.summaryMode === 'arr' && g.totalUsd > 0)
        ? this.formatMoney(g.totalUsd)
        : null,
      accentBorder: `op-rc__det op-rc__det--${this.meta.accent}`,
    }));
  }

  // ── Toolbar ──
  get severityPills() {
    return SEVERITY_OPTIONS.map((s) => ({
      label: s, value: s,
      pillClass: this.severityFilters.includes(s)
        ? `op-rc__pill op-rc__pill--active op-rc__pill--${s.toLowerCase()}`
        : 'op-rc__pill',
    }));
  }
  get effortPills() {
    return EFFORT_OPTIONS.map((s) => ({
      label: s === 'low' ? 'Low' : s === 'medium' ? 'Med' : 'High',
      value: s,
      pillClass: this.effortFilters.includes(s)
        ? 'op-rc__pill op-rc__pill--active op-rc__pill--effort'
        : 'op-rc__pill',
    }));
  }
  handleSearch(event) { this.searchTerm = event.target.value; }
  toggleSev(event) {
    const v = event.currentTarget.dataset.value;
    const n = new Set(this.severityFilters);
    n.has(v) ? n.delete(v) : n.add(v);
    this.severityFilters = Array.from(n);
  }
  toggleEffort(event) {
    const v = event.currentTarget.dataset.value;
    const n = new Set(this.effortFilters);
    n.has(v) ? n.delete(v) : n.add(v);
    this.effortFilters = Array.from(n);
  }

  // ── Findings (flat list, filtered) ──
  get filteredFindings() {
    return (this.data?.findings || []).filter((f) => {
      if (this.severityFilters.length && !this.severityFilters.includes(f.severity)) return false;
      const effort = this.detectorEffortMap[f.detectorId] || 'medium';
      if (this.effortFilters.length && !this.effortFilters.includes(effort)) return false;
      if (this.searchTerm) {
        const q = this.searchTerm.toLowerCase();
        if (!(f.title || '').toLowerCase().includes(q) && !(f.detectorId || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }
  get filteredCountLabel() {
    const n = this.filteredFindings.length;
    return `${n} finding${n === 1 ? '' : 's'}`;
  }
  get findingsRows() {
    return this.filteredFindings.map((f) => {
      const effort = this.detectorEffortMap[f.detectorId] || 'medium';
      return {
        ...f,
        effortLabel: effort === 'low' ? 'LOW' : effort === 'medium' ? 'MED' : 'HIGH',
        effortChipClass: `op-rc__row-effort op-rc__row-effort--${effort}`,
        truncatedTitle: (f.title || '').length > 80 ? (f.title || '').substring(0, 80) + '…' : f.title,
        gapSuffix: f.gapUsd > 0 ? this.formatMoney(f.gapUsd) : null,
      };
    });
  }

  handleRowClick(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicFinding__c', actionName: 'view' },
    });
  }

  formatMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `USD ${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `USD ${(v / 1_000).toFixed(1)}K`;
    if (v < 1) return 'USD 0';
    return `USD ${Math.round(v).toLocaleString()}`;
  }
}

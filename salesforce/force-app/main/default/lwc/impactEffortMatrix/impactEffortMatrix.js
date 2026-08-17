import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getMatrixFindings from '@salesforce/apex/DashboardController.getMatrixFindings';
import getCatalog from '@salesforce/apex/DetectorCatalogController.getCatalog';

/**
 * "What to fix first" — 3x3 $-impact × effort matrix.
 *
 * Rows  (impact $):    High ≥$50K   Medium ≥$10K   Low <$10K
 * Cols  (effort):      Low          Medium         High
 *
 * Cell labels:
 *     QUICK WINS    WORTH DOING   STRATEGIC
 *     EASY          STANDARD      EVALUATE
 *     HOUSEKEEPING  SKIP?         DEFER
 *
 * Each populated cell shows: count + $ total + estimated hours
 * (count × per-effort hours). Click → modal with finding list,
 * rows navigate to ForensicFinding__c record.
 */

const IMPACT_HIGH = 50000;
const IMPACT_LOW = 10000;

const EFFORT_HOURS_PER_FINDING = { low: 0.5, medium: 2, high: 8 };

/**
 * Phase 20d — fallback when Detector__mdt.Effort__c isn't seeded yet.
 * Once mdt is populated, the component's @wire(getCatalog) overlays
 * live values on top of these defaults.
 */
const FALLBACK_DETECTOR_EFFORT = {
  'REN-001': 'medium', 'REN-002': 'medium', 'REN-003': 'low', 'REN-004': 'low',
  'DSC-FOR-001': 'medium', 'DSC-FOR-002': 'medium',
  'QL-FOR-001': 'medium', 'QL-FOR-002': 'low',
  'ORD-FOR-001': 'high', 'ORD-FOR-002': 'medium', 'ORD-FOR-003': 'medium',
  'SUB-FOR-001': 'medium', 'PROV-FOR-001': 'high', 'PROV-FOR-002': 'medium',
  'OPP-FOR-001': 'low', 'CON-FOR-001': 'low', 'AMD-FOR-001': 'low',
  'AST-FOR-001': 'high', 'CT-FOR-001': 'medium', 'MDQ-FOR-001': 'high',
};

const CELL_META = {
  'high-low':       { label: 'Quick wins',   theme: 'emerald', highlight: true },
  'high-medium':    { label: 'Worth doing',  theme: 'teal' },
  'high-high':      { label: 'Strategic',    theme: 'blue' },
  'medium-low':     { label: 'Easy',         theme: 'lime' },
  'medium-medium':  { label: 'Standard',     theme: 'amber' },
  'medium-high':    { label: 'Evaluate',     theme: 'orange' },
  'low-low':        { label: 'Housekeeping', theme: 'gray' },
  'low-medium':     { label: 'Skip?',        theme: 'gray' },
  'low-high':       { label: 'Defer',        theme: 'slate' },
};

const IMPACT_ORDER = ['high', 'medium', 'low'];
const EFFORT_ORDER = ['low', 'medium', 'high'];

function bucketImpact(g) {
  if (g >= IMPACT_HIGH) return 'high';
  if (g >= IMPACT_LOW) return 'medium';
  return 'low';
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v < 1) return '—';
  return `$${Math.round(v).toLocaleString()}`;
}

function fmtHours(h) {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 10) return `${h.toFixed(1)} hrs`;
  if (h < 80) return `${Math.round(h)} hrs`;
  return `${Math.round(h / 8)} days`;
}

export default class ImpactEffortMatrix extends NavigationMixin(LightningElement) {
  findings = [];
  error;
  loading = true;
  openCellKey = null;
  wiredResult;
  @track connectedOrgId = null;
  @track catalogEntries = [];
  // Phase 25 — matrix bucketing cached. get matrix() is read ~15x/render
  // (hasData/isEmpty/cells×9/footerLabel/quickWins/modalData), so an
  // uncached getter re-bucketed every finding on every render.
  @track _matrix = { buckets: {}, totalFindings: 0, totalUsd: 0, totalHours: 0 };
  // Guards one-time focus-move into the drill-down dialog when it opens.
  _modalFocused = false;

  @wire(getCatalog)
  wireCatalog({ data }) {
    if (data) {
      this.catalogEntries = data;
      this._matrix = this._computeMatrix();
    }
  }

  /** Phase 20d — merge fallback + live Detector__mdt.Effort__c. */
  get detectorEffortMap() {
    const out = { ...FALLBACK_DETECTOR_EFFORT };
    for (const e of this.catalogEntries || []) {
      if (e.effort) out[e.detectorId] = e.effort;
    }
    return out;
  }

  getEffort(detectorId) {
    return this.detectorEffortMap[detectorId] || 'medium';
  }

  connectedCallback() { window.addEventListener('op:scan-completed', this.handleScanCompleted); }
  disconnectedCallback() { window.removeEventListener('op:scan-completed', this.handleScanCompleted); }
  handleScanCompleted = () => { if (this.wiredResult) refreshApex(this.wiredResult); };

  // Move focus into the drill-down dialog once when it first opens; reset
  // when closed so it re-focuses on the next open. Guarded to avoid stealing
  // focus on every render.
  renderedCallback() {
    if (this.openCellKey && !this._modalFocused) {
      const backdrop = this.template.querySelector('.op-wtf__modal-backdrop');
      if (backdrop) {
        backdrop.focus();
        this._modalFocused = true;
      }
    } else if (!this.openCellKey && this._modalFocused) {
      this._modalFocused = false;
    }
  }

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId || pageRef.state?.connectedOrgId || null;
  }

  @wire(getMatrixFindings, { connectedOrgId: '$connectedOrgId' })
  wireFindings(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.findings = result.data;
      this.error = undefined;
      this._matrix = this._computeMatrix();
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  // ── Bucket findings into the 9 cells. Cached in _matrix, recomputed
  //    only when findings/catalog change; get matrix() returns the cache. ──
  _computeMatrix() {
    const buckets = {};
    let totalFindings = 0;
    let totalUsd = 0;
    let totalHours = 0;
    for (const f of this.findings || []) {
      const gap = Number(f.gapUsd) || 0;
      const impact = bucketImpact(gap);
      const effort = this.getEffort(f.detectorId);
      const key = `${impact}-${effort}`;
      if (!buckets[key]) buckets[key] = { count: 0, totalUsd: 0, totalHours: 0, findings: [] };
      const c = buckets[key];
      c.count += 1;
      c.totalUsd += gap;
      c.totalHours += EFFORT_HOURS_PER_FINDING[effort];
      c.findings.push(f);
      totalFindings += 1;
      totalUsd += gap;
      totalHours += EFFORT_HOURS_PER_FINDING[effort];
    }
    // Sort each cell's findings by $ desc
    for (const k of Object.keys(buckets)) {
      buckets[k].findings.sort((a, b) => (Number(b.gapUsd) || 0) - (Number(a.gapUsd) || 0));
    }
    return { buckets, totalFindings, totalUsd, totalHours };
  }

  get matrix() { return this._matrix; }

  get hasData() { return !this.loading && !this.error && this.matrix.totalFindings > 0; }
  get isEmpty() { return !this.loading && !this.error && this.matrix.totalFindings === 0; }
  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }

  // ── Cells rendered as a flat list of 9 ──
  get cells() {
    const out = [];
    for (const impact of IMPACT_ORDER) {
      for (const effort of EFFORT_ORDER) {
        const key = `${impact}-${effort}`;
        const meta = CELL_META[key];
        const c = this.matrix.buckets[key];
        const count = c?.count || 0;
        const isEmpty = count === 0;
        out.push({
          key,
          label: meta.label,
          themeClass: `op-wtf__cell op-wtf__cell--${meta.theme}` + (isEmpty ? ' op-wtf__cell--empty' : ''),
          isEmpty,
          highlight: !!meta.highlight && !isEmpty,
          count,
          totalFmt: isEmpty ? '—' : fmtMoney(c.totalUsd),
          hoursFmt: isEmpty ? '' : `~${fmtHours(c.totalHours)}`,
        });
      }
    }
    return out;
  }

  // ── Row labels for the Y axis ──
  get yLabels() {
    return [
      { key: 'high',   label: 'High',   sub: `≥USD ${IMPACT_HIGH / 1000}K` },
      { key: 'medium', label: 'Medium', sub: `≥USD ${IMPACT_LOW / 1000}K` },
      { key: 'low',    label: 'Low',    sub: `<USD ${IMPACT_LOW / 1000}K` },
    ];
  }

  // ── Footer summary ──
  get footerLabel() {
    const m = this.matrix;
    return `${m.totalFindings} total findings · ${fmtMoney(m.totalUsd)} verified · ~${fmtHours(m.totalHours)} estimated work.`;
  }

  // ── Quick wins pill (top right of header) ──
  get quickWins() {
    const c = this.matrix.buckets['high-low'];
    if (!c || c.count === 0) return null;
    return {
      count: c.count,
      label: `${c.count} finding${c.count === 1 ? '' : 's'} · ${fmtMoney(c.totalUsd)}`,
    };
  }
  get hasQuickWins() { return Boolean(this.quickWins); }

  // ── Modal ──
  get isModalOpen() { return Boolean(this.openCellKey); }
  get modalData() {
    if (!this.openCellKey) return null;
    const c = this.matrix.buckets[this.openCellKey];
    const meta = CELL_META[this.openCellKey];
    if (!c) return null;
    return {
      label: meta.label,
      themeClass: `op-wtf__modal-header op-wtf__modal-header--${meta.theme}`,
      summary: `${c.count} finding${c.count === 1 ? '' : 's'} · ${fmtMoney(c.totalUsd)}`,
      hoursLine: `~${fmtHours(c.totalHours)} estimated work`,
      rows: c.findings.map((f) => ({
        id: f.id,
        detectorId: f.detectorId,
        title: f.title || f.detectorId,
        gapFmt: fmtMoney(f.gapUsd),
      })),
    };
  }

  // ── Handlers ──
  handleCellClick(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) return;
    const cell = this.matrix.buckets[key];
    if (!cell || cell.count === 0) return; // empty cells aren't clickable
    this.openCellKey = key;
  }
  handleCloseModal() { this.openCellKey = null; }
  handleModalKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); this.handleCloseModal(); }
  }
  handleModalBackdrop(event) {
    // Close only when the backdrop itself is clicked (not inner content)
    if (event.target === event.currentTarget) this.openCellKey = null;
  }
  handleRowClick(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicFinding__c', actionName: 'view' },
    });
    this.openCellKey = null;
  }
}

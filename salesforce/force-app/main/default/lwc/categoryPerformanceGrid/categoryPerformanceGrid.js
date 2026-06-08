import { LightningElement, wire, track } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getCategoryScores from '@salesforce/apex/CategoryPerformanceController.getCategoryScores';

/**
 * Category Performance grid.
 *  - Two sections (CPQ + BILLING) with colored dot.
 *  - Each card: icon + label + score% + colored progress bar + severity line + chevron.
 *  - Drag to reorder within a section (order persisted to localStorage per user).
 *  - Click card → opens c-category-issues-modal filtered to that label.
 *  - Reset order link clears the localStorage override.
 */
const LS_KEY_PREFIX = 'orgprism.catperf.order.';

export default class CategoryPerformanceGrid extends LightningElement {
  @track sections;
  @track error;
  @track loading = true;
  @track openCategoryLabel = null;
  @track openDetectorIds = null;
  @track orderOverrides = {}; // { cpq: ['products', ...], billing: [...] }
  @track draggingKey = null;
  @track draggingSection = null;
  /** Phase 22r — scope cards to the current Connected Org's product type
   *  so an ARM dashboard shows only the ARM section (and vice-versa). */
  @track connectedOrgId = null;
  wiredResult;

  @wire(CurrentPageReference)
  wirePageRef(pageRef) {
    if (!pageRef) return;
    this.connectedOrgId = pageRef.state?.c__connectedOrgId
      || pageRef.state?.connectedOrgId
      || null;
  }

  connectedCallback() {
    this.loadOrderOverrides();
    window.addEventListener('op:scan-completed', this.handleScanCompleted);
  }
  disconnectedCallback() {
    window.removeEventListener('op:scan-completed', this.handleScanCompleted);
  }
  handleScanCompleted = () => { if (this.wiredResult) refreshApex(this.wiredResult); };

  loadOrderOverrides() {
    const out = {};
    try {
      for (const s of ['cpq', 'billing']) {
        const raw = window.localStorage?.getItem(LS_KEY_PREFIX + s);
        if (raw) out[s] = JSON.parse(raw);
      }
    } catch (e) { /* ignore parse failures */ }
    this.orderOverrides = out;
  }

  saveOrderOverride(sectionKey, ordering) {
    try {
      window.localStorage?.setItem(LS_KEY_PREFIX + sectionKey, JSON.stringify(ordering));
    } catch (e) { /* ignore */ }
  }

  @wire(getCategoryScores, { connectedOrgId: '$connectedOrgId' })
  wireData(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.sections = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return !this.loading && Boolean(this.error); }
  get hasData() { return !this.loading && !this.error && this.sections; }

  // Apply localStorage ordering + compute view-model decorations
  get viewSections() {
    if (!this.sections) return [];
    return this.sections.map((s) => {
      const order = this.orderOverrides[s.key];
      let cards = s.cards;
      if (order && order.length) {
        const byKey = new Map(cards.map((c) => [c.key, c]));
        const ordered = order.map((k) => byKey.get(k)).filter(Boolean);
        const remaining = cards.filter((c) => !order.includes(c.key));
        cards = [...ordered, ...remaining];
      }
      const decorated = cards.map((c) => this.decorateCard(c, s.key));
      return {
        ...s,
        cards: decorated,
        dotClass: `op-cp__dot op-cp__dot--${s.key}`,
      };
    });
  }

  decorateCard(c, sectionKey) {
    const score = c.score ?? 100;
    // Phase 24z-B — neutral "Not installed" treatment when every detector
    // mapped to this card was surface-gated on the latest scan. Better than
    // showing a deceptively green 100% for ARM Catalog on a non-ARM org.
    const tone = c.isNotInstalled
      ? 'na'
      : (score >= 90 ? 'good' : score >= 70 ? 'warn' : 'bad');
    const issueParts = [];
    if (c.criticalCount > 0) issueParts.push(`${c.criticalCount} critical`);
    if (c.warningCount > 0)  issueParts.push(`${c.warningCount} warning${c.warningCount === 1 ? '' : 's'}`);
    if (c.infoCount > 0)     issueParts.push(`${c.infoCount} info`);
    const issueLabel = c.isNotInstalled
      ? 'Not installed'
      : (issueParts.length === 0 ? 'No issues' : issueParts.join(', '));
    const detectorIdsStr = (c.detectorIds || []).join(',');
    return {
      ...c,
      sectionKey,
      score,
      // Don't draw a filled bar when the package isn't installed.
      barStyle: c.isNotInstalled ? 'width: 0%;' : `width: ${score}%;`,
      cardClass: `op-cp__card op-cp__card--${tone}`,
      scoreClass: `op-cp__score op-cp__score--${tone}`,
      barClass: `op-cp__bar-fill op-cp__bar-fill--${tone}`,
      issueClass: c.isNotInstalled ? 'op-cp__issues op-cp__issues--na'
                : c.criticalCount > 0 ? 'op-cp__issues op-cp__issues--bad'
                : c.warningCount > 0  ? 'op-cp__issues op-cp__issues--warn'
                : 'op-cp__issues',
      issueLabel,
      detectorIdsStr,
      scoreDisplay: c.isNotInstalled ? '—' : `${score}%`,
    };
  }

  // ── Drag handlers ──
  handleDragStart(event) {
    this.draggingKey = event.currentTarget.dataset.key;
    this.draggingSection = event.currentTarget.dataset.section;
    event.dataTransfer.effectAllowed = 'move';
  }
  handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }
  handleDrop(event) {
    event.preventDefault();
    const targetKey = event.currentTarget.dataset.key;
    const targetSection = event.currentTarget.dataset.section;
    if (!this.draggingKey || targetSection !== this.draggingSection || targetKey === this.draggingKey) {
      this.clearDragState();
      return;
    }
    // Reorder within the section
    const section = this.sections.find((s) => s.key === targetSection);
    if (!section) { this.clearDragState(); return; }
    const order = this.orderOverrides[targetSection] || section.cards.map((c) => c.key);
    const next = order.filter((k) => k !== this.draggingKey);
    const insertIdx = next.indexOf(targetKey);
    next.splice(insertIdx, 0, this.draggingKey);
    this.orderOverrides = { ...this.orderOverrides, [targetSection]: next };
    this.saveOrderOverride(targetSection, next);
    this.clearDragState();
  }
  clearDragState() {
    this.draggingKey = null;
    this.draggingSection = null;
  }

  handleReset() {
    try {
      window.localStorage?.removeItem(LS_KEY_PREFIX + 'cpq');
      window.localStorage?.removeItem(LS_KEY_PREFIX + 'billing');
    } catch (e) {}
    this.orderOverrides = {};
  }

  // ── Click card → open modal ──
  handleCardClick(event) {
    this.openCategoryLabel = event.currentTarget.dataset.label;
    this.openDetectorIds = event.currentTarget.dataset.detectorIds || '';
  }
  handleModalClose() {
    this.openCategoryLabel = null;
    this.openDetectorIds = null;
    refreshApex(this.wiredResult);
  }
  get isModalOpen() { return Boolean(this.openCategoryLabel); }
}

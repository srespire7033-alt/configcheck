import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getCategoryIssues from '@salesforce/apex/AiAnalysisController.getCategoryIssues';
import getIssuesByDetectorIds from '@salesforce/apex/AiAnalysisController.getIssuesByDetectorIds';
import getIssuesBySeverity from '@salesforce/apex/AiAnalysisController.getIssuesBySeverity';
import markFixed from '@salesforce/apex/AiAnalysisController.markFixed';

/**
 * Category Issues modal.
 * Three lookup modes (pick one):
 *   - `category-label`  → all issues mapped to that category
 *   - `detector-ids`    → comma-separated DetectorId__c filter
 *   - `severity`        → all findings of one severity on the latest scan
 *                         (Phase 22o — powers the hero tile click drilldown)
 *
 * Fires `closeissuesmodal` event when user closes.
 */
export default class CategoryIssuesModal extends NavigationMixin(LightningElement) {
  @api categoryLabel;
  /** Optional: comma-separated detector IDs. When provided, supersedes categoryLabel. */
  @api detectorIds;
  /** Optional severity filter — 'critical' | 'warning' | 'info'. Phase 22o. */
  @api severity;
  /** Optional: scope to a specific Connected Org. Phase 22o. */
  @api connectedOrgId;
  @track data;
  @track error;
  @track loading = true;
  @track fixingId = null;
  wiredResult;

  get usesDetectorIds() {
    return typeof this.detectorIds === 'string' && this.detectorIds.length > 0;
  }
  get usesSeverity() {
    return typeof this.severity === 'string' && this.severity.length > 0;
  }
  get detectorIdsList() {
    return this.usesDetectorIds ? this.detectorIds.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }

  @wire(getCategoryIssues, { categoryLabel: '$categoryLabel' })
  wireByLabel(result) {
    if (this.usesDetectorIds || this.usesSeverity) return; // other modes take over
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  @wire(getIssuesByDetectorIds, { detectorIds: '$detectorIdsList', headerLabel: '$categoryLabel' })
  wireByDetectors(result) {
    if (!this.usesDetectorIds || this.usesSeverity) return;
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  @wire(getIssuesBySeverity, { severity: '$severity', connectedOrgId: '$connectedOrgId' })
  wireBySeverity(result) {
    if (!this.usesSeverity) return;
    this.wiredResult = result;
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
  get hasData() { return !this.loading && !this.error && this.data; }
  get title() {
    // Apex returns its own label in data.categoryLabel for severity mode
    // ('Critical Issues' / 'Warnings' / 'Best Practices'). Prefer that
    // over the @api categoryLabel which may be unset for severity mode.
    const fromData = this.data?.categoryLabel;
    if (fromData) return fromData.endsWith('Issues') || fromData.endsWith('Practices') || fromData.endsWith('Warnings')
      ? fromData : `${fromData} Issues`;
    return this.categoryLabel ? `${this.categoryLabel} Issues` : 'Issues';
  }
  get totalCountLabel() {
    return this.data ? `(${this.data.totalCount} total)` : '';
  }

  get criticalCount() { return this.data?.critical?.length || 0; }
  get warningCount() { return this.data?.warning?.length || 0; }
  get infoCount() { return this.data?.info?.length || 0; }
  get hasCritical() { return this.criticalCount > 0; }
  get hasWarning() { return this.warningCount > 0; }
  get hasInfo() { return this.infoCount > 0; }
  get hasAnyIssues() { return this.data?.totalCount > 0; }

  // Phase 24w — group flat per-record findings by detectorId so the
  // list reads "Products missing tax rule — 79 records" expandable,
  // rather than 79 near-identical rows. The expand state is per-
  // detector; collapsing all by default keeps the panel scannable.
  @track expandedDetectors = new Set();

  get criticalGroups() { return this.groupByDetector(this.data?.critical, 'critical'); }
  get warningGroups() { return this.groupByDetector(this.data?.warning, 'warning'); }
  get infoGroups()    { return this.groupByDetector(this.data?.info,    'info'); }

  groupByDetector(rows, severityKey) {
    if (!rows || rows.length === 0) return [];
    const order = []; // preserve first-seen order (already severity-sorted by Apex)
    const map = new Map();
    for (const r of rows) {
      const id = r.detectorId || '(unknown)';
      if (!map.has(id)) {
        order.push(id);
        map.set(id, {
          detectorId: id,
          displayTitle: this.stripQuotedName(r.title || id),
          description: r.description || '',
          severityKey,
          rows: [],
          totalGap: 0,
        });
      }
      const g = map.get(id);
      g.rows.push(r);
      g.totalGap += (r.gapUsd || 0);
    }
    return order.map((id) => {
      const g = map.get(id);
      const expanded = this.expandedDetectors.has(id);
      return {
        ...g,
        count: g.rows.length,
        impactLabel: this.buildGroupImpact(g),
        isExpanded: expanded,
        chevronIcon: expanded ? 'utility:chevrondown' : 'utility:chevronright',
        iconWrapClass: `op-cim__row-icon-wrap op-cim__row-icon-wrap--${severityKey}`,
        iconName: severityKey === 'critical' ? 'utility:error'
                : severityKey === 'warning'  ? 'utility:warning'
                : 'utility:info',
        iconClass: `op-cim__row-icon op-cim__row-icon--${severityKey}`,
        decoratedRows: expanded ? this.decorate(g.rows, severityKey) : [],
      };
    });
  }

  // "Product \"Exterior Camera\" missing tax rule" → "Product missing tax rule"
  // Keeps the detector's verb, drops the per-record name. Falls back to
  // the original title when there's nothing to strip.
  stripQuotedName(title) {
    if (!title) return '';
    const stripped = title.replace(/\s*"[^"]*"\s*/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped || title;
  }

  buildGroupImpact(g) {
    const parts = [`${g.rows.length} record${g.rows.length === 1 ? '' : 's'} affected`];
    if (g.totalGap > 0) parts.push(`Est. ${this.fmtMoney(g.totalGap)} at risk`);
    return parts.join(' · ');
  }

  decorate(rows, severityKey) {
    if (!rows) return [];
    return rows.map((r) => ({
      ...r,
      iconWrapClass: `op-cim__row-icon-wrap op-cim__row-icon-wrap--${severityKey}`,
      iconName: severityKey === 'critical' ? 'utility:error'
              : severityKey === 'warning'  ? 'utility:warning'
              : 'utility:info',
      iconClass: `op-cim__row-icon op-cim__row-icon--${severityKey}`,
      impactLabel: this.buildImpact(r),
      isFixing: this.fixingId === r.id,
      isResolved: r.status === 'Resolved',
      markBtnLabel: r.status === 'Resolved' ? 'Resolved' : 'Mark Fixed',
      markBtnDisabled: this.fixingId === r.id || r.status === 'Resolved',
    }));
  }

  buildImpact(r) {
    const parts = [];
    parts.push('1 record affected');
    if (r.gapUsd && r.gapUsd > 0) {
      parts.push(`Est. ${this.fmtMoney(r.gapUsd)} at risk`);
    }
    return parts.join(' · ');
  }

  handleToggleGroup(e) {
    const id = e.currentTarget.dataset.detectorId;
    if (!id) return;
    if (this.expandedDetectors.has(id)) this.expandedDetectors.delete(id);
    else this.expandedDetectors.add(id);
    // Force reactive recompute by replacing the Set reference.
    this.expandedDetectors = new Set(this.expandedDetectors);
  }

  fmtMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    return `$${Math.round(v).toLocaleString()}`;
  }

  // ── Handlers ──
  handleClose() {
    this.dispatchEvent(new CustomEvent('closeissuesmodal'));
  }
  handleBackdrop(event) {
    if (event.target === event.currentTarget) this.handleClose();
  }

  // ── Accessibility ──
  connectedCallback() {
    this._keydownHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.handleClose(); }
    };
    window.addEventListener('keydown', this._keydownHandler);
  }
  disconnectedCallback() {
    if (this._keydownHandler) window.removeEventListener('keydown', this._keydownHandler);
  }
  renderedCallback() {
    if (this._focused) return;
    const closeBtn = this.template.querySelector('.op-cim__close');
    if (closeBtn) { closeBtn.focus(); this._focused = true; }
  }
  async handleMarkFixed(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.fixingId = id;
    try {
      await markFixed({ findingId: id });
      this.dispatchEvent(new ShowToastEvent({
        title: 'Marked as Fixed',
        message: 'Finding status set to Resolved.',
        variant: 'success',
      }));
      // refresh wired data so the row reflects new status
      await refreshApex(this.wiredResult);
    } catch (e) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'Could not mark fixed',
        message: e.body?.message || e.message || 'Unknown error',
        variant: 'error',
      }));
    } finally {
      this.fixingId = null;
    }
  }
  handleDetails(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: { recordId: id, objectApiName: 'ForensicFinding__c', actionName: 'view' },
    });
    this.handleClose();
  }
}

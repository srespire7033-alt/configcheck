import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getCategoryIssues from '@salesforce/apex/AiAnalysisController.getCategoryIssues';
import getIssuesByDetectorIds from '@salesforce/apex/AiAnalysisController.getIssuesByDetectorIds';
import getIssuesBySeverity from '@salesforce/apex/AiAnalysisController.getIssuesBySeverity';
import markFixed from '@salesforce/apex/AiAnalysisController.markFixed';
import loadIssuesPage from '@salesforce/apex/AiAnalysisController.loadIssuesPage';

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
  // Phase 28 — paging. The first page arrives via @wire; subsequent pages are
  // fetched imperatively and appended, so the modal can reach all 905 rows
  // instead of stopping at the 200-row cap.
  @track loadingMore = false;
  @track loadMoreError = null;

  get usesDetectorIds() {
    return typeof this.detectorIds === 'string' && this.detectorIds.length > 0;
  }
  get usesSeverity() {
    return typeof this.severity === 'string' && this.severity.length > 0;
  }
  get detectorIdsList() {
    return this.usesDetectorIds ? this.detectorIds.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }

  @wire(getCategoryIssues, { categoryLabel: '$categoryLabel', connectedOrgId: '$connectedOrgId' })
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

  @wire(getIssuesByDetectorIds, { detectorIds: '$detectorIdsList', headerLabel: '$categoryLabel', connectedOrgId: '$connectedOrgId' })
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
    if (!this.data) return '';
    const total = Number(this.data.totalCount) || 0;
    const shown = this.data.shownCount == null ? total : Number(this.data.shownCount);
    // Phase 28 — totalCount used to be the size of the TRUNCATED list, so this
    // read "(200 total)" on a category the dashboard card showed as 1,783.
    // Never imply completeness we don't have.
    return this.data.truncated
      ? `(showing ${shown.toLocaleString()} of ${total.toLocaleString()})`
      : `(${total.toLocaleString()} total)`;
  }
  get isTruncated() {
    return Boolean(this.data && this.data.truncated);
  }
  get truncatedNote() {
    if (!this.isTruncated) return '';
    const total = Number(this.data.totalCount) || 0;
    const shown = Number(this.data.shownCount) || 0;
    return `Showing the ${shown.toLocaleString()} highest-impact of ${total.toLocaleString()} findings.`
      + ` Export the full list to see the rest.`;
  }

  // Phase 28 — section counts come from the TRUE per-detector totals, not from
  // the returned rows. The row query is capped, so these used to read
  // "Warnings (199)" on a category that actually had 262.
  get criticalCount() { return this.severityTotal('Critical', 'critical'); }
  get warningCount()  { return this.severityTotal('Warning',  'warning'); }
  get infoCount()     { return this.severityTotal('Info',     'info'); }
  get hasCritical() { return this.criticalCount > 0; }
  get hasWarning() { return this.warningCount > 0; }
  get hasInfo() { return this.infoCount > 0; }
  get hasAnyIssues() { return this.data?.totalCount > 0; }

  severityTotal(sev, bucket) {
    const summaries = this.data?.detectorSummaries;
    if (!summaries || !summaries.length) return this.data?.[bucket]?.length || 0;
    return summaries
      .filter((s) => s.severity === sev)
      .reduce((n, s) => n + (s.count || 0), 0);
  }

  // Phase 24w — group flat per-record findings by detectorId so the
  // list reads "Products missing tax rule — 79 records" expandable,
  // rather than 79 near-identical rows. The expand state is per-
  // detector; collapsing all by default keeps the panel scannable.
  @track expandedDetectors = new Set();
  @track fetchingDetector = null;

  get criticalGroups() { return this.buildGroups('Critical', 'critical'); }
  get warningGroups()  { return this.buildGroups('Warning',  'warning'); }
  get infoGroups()     { return this.buildGroups('Info',     'info'); }

  /** Loaded rows indexed by detector id (across all three severity buckets). */
  get rowsByDetector() {
    const out = {};
    for (const bucket of ['critical', 'warning', 'info']) {
      for (const r of this.data?.[bucket] || []) {
        const id = r.detectorId || '(unknown)';
        if (!out[id]) out[id] = [];
        out[id].push(r);
      }
    }
    return out;
  }

  /**
   * Phase 28 — build the group list from detectorSummaries (EVERY detector on
   * the scan, with true counts), not from the rows we happened to receive.
   *
   * The row query is ORDER BY GapUsd DESC LIMIT 200, so a high-volume detector
   * filled the page and everything beneath it vanished. Measured on FS-0129:
   * PB-002 had 223 rows and ate the page, so PB-004 (37) and PB-006 (1) were not
   * merely truncated — they rendered nowhere at all. Driving the list off the
   * aggregate makes silent absence impossible: every detector shows with its real
   * badge, and its rows load on expand.
   */
  buildGroups(sev, severityKey) {
    const summaries = this.data?.detectorSummaries;
    const byDet = this.rowsByDetector;

    let list;
    if (summaries && summaries.length) {
      list = summaries.filter((s) => s.severity === sev);
    } else {
      // Fallback for a payload without summaries — derive from loaded rows.
      const seen = new Set();
      list = [];
      for (const r of this.data?.[severityKey] || []) {
        const id = r.detectorId || '(unknown)';
        if (!seen.has(id)) { seen.add(id); list.push({ detectorId: id, count: 0, severity: sev }); }
      }
    }

    return list
      .slice()
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .map((s) => {
        const id = s.detectorId;
        const rows = byDet[id] || [];
        const total = s.count || rows.length;
        const expanded = this.expandedDetectors.has(id);
        const first = rows[0];
        const totalGap = rows.reduce((n, r) => n + (r.gapUsd || 0), 0);
        const remaining = Math.max(0, total - rows.length);
        return {
          detectorId: id,
          // A group with zero loaded rows still needs a header — fall back to
          // the Detector__mdt label/description carried on the summary.
          displayTitle: first ? this.stripQuotedName(first.title || id) : (s.label || id),
          description: (first && first.description) || s.description || '',
          severityKey,
          count: total,
          loadedCount: rows.length,
          hasMore: remaining > 0,
          moreLabel: this.fetchingDetector === id
            ? 'Loading…'
            : `Load ${Math.min(200, remaining).toLocaleString()} more of ${total.toLocaleString()}`,
          isFetching: this.fetchingDetector === id,
          impactLabel: this.buildGroupImpact(total, totalGap, rows.length),
          isExpanded: expanded,
          chevronIcon: expanded ? 'utility:chevrondown' : 'utility:chevronright',
          iconWrapClass: `op-cim__row-icon-wrap op-cim__row-icon-wrap--${severityKey}`,
          iconName: severityKey === 'critical' ? 'utility:error'
                  : severityKey === 'warning'  ? 'utility:warning'
                  : 'utility:info',
          iconClass: `op-cim__row-icon op-cim__row-icon--${severityKey}`,
          decoratedRows: expanded ? this.decorate(rows, severityKey) : [],
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

  buildGroupImpact(total, totalGap, loaded) {
    const parts = [`${total.toLocaleString()} record${total === 1 ? '' : 's'} affected`];
    if (totalGap > 0) {
      // Be explicit that the $ is only over what we've loaded — quoting a
      // partial total as if it were the whole is the same class of lie as the
      // count bug this replaced.
      parts.push(`Est. ${this.fmtMoney(totalGap)} at risk${loaded < total ? ' (loaded so far)' : ''}`);
    }
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
    const wasExpanded = this.expandedDetectors.has(id);
    if (wasExpanded) this.expandedDetectors.delete(id);
    else this.expandedDetectors.add(id);
    // Force reactive recompute by replacing the Set reference.
    this.expandedDetectors = new Set(this.expandedDetectors);
    // Phase 28 — a group can exist with zero loaded rows (its detector was
    // pushed off the capped first page), so fetch on first expand.
    if (!wasExpanded) this.ensureRowsFor(id);
  }

  handleLoadMoreGroup(e) {
    const id = e.currentTarget.dataset.detectorId;
    if (id) this.ensureRowsFor(id);
  }

  /** Fetch the next page of rows for one detector and merge them in. */
  async ensureRowsFor(detectorId) {
    if (this.fetchingDetector) return;
    const summaries = this.data?.detectorSummaries || [];
    const s = summaries.find((x) => x.detectorId === detectorId);
    const loaded = (this.rowsByDetector[detectorId] || []).length;
    const total = s ? (s.count || 0) : loaded;
    if (loaded >= total) return;

    this.fetchingDetector = detectorId;
    this.loadMoreError = null;
    try {
      const page = await loadIssuesPage({
        mode: 'detectors',
        key: detectorId,
        connectedOrgId: this.connectedOrgId || null,
        offsetRows: loaded,
        pageSize: 200,
      });
      this.mergePage(page, detectorId);
    } catch (err) {
      this.loadMoreError = err?.body?.message || err?.message || 'Could not load more findings.';
    } finally {
      this.fetchingDetector = null;
    }
  }

  /** Append a fetched page, de-duping by record id so a re-click can't double up. */
  mergePage(page, detectorId) {
    if (!page || !this.data) return;
    const next = { ...this.data };
    for (const bucket of ['critical', 'warning', 'info']) {
      const incoming = (page[bucket] || []).filter((r) => r.detectorId === detectorId);
      if (!incoming.length) continue;
      const existing = next[bucket] || [];
      const seen = new Set(existing.map((r) => r.id));
      next[bucket] = existing.concat(incoming.filter((r) => !seen.has(r.id)));
    }
    next.shownCount = (next.critical?.length || 0)
      + (next.warning?.length || 0)
      + (next.info?.length || 0);
    next.truncated = next.shownCount < (next.totalCount || 0);
    this.data = next;   // reassign so the grouping getters recompute
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

import { LightningElement, wire } from 'lwc';
import getDashboardSummary from '@salesforce/apex/DashboardController.getDashboardSummary';

/**
 * Complexity / coverage breakdown derived from current scan findings.
 *
 * Unlike the SaaS version (which shows config-system complexity
 * across price rules / product rules / approval rules), the Salesforce
 * side measures FORENSIC complexity:
 *   - Detector coverage   — how many of v1.0's 5 detectors fired
 *   - Severity mix        — distribution of Critical / Warning / Info
 *   - Avg recoverability  — how confident we are recoverable $ is real
 *
 * This is honest to what the data actually is in Salesforce. When
 * we later sync the config-scan complexity from the SaaS into a
 * field on ForensicScan__c, we can render those metrics too.
 */
const TOTAL_DETECTORS_V1 = 5;

export default class ComplexityCard extends LightningElement {
  data;
  error;
  loading = true;

  @wire(getDashboardSummary)
  wireData(result) {
    this.loading = false;
    if (result.data) {
      this.data = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message || 'Failed to load complexity data';
    }
  }

  get isLoading() { return this.loading; }
  get hasError() { return Boolean(this.error); }
  get hasData() {
    return !this.loading && !this.error && this.data?.hasForensicData;
  }
  get isEmpty() {
    return !this.loading && !this.error && !this.data?.hasForensicData;
  }

  // ─── Derived metrics ───

  get detectorCoverage() {
    if (!this.data?.topFindings) return { triggered: 0, total: TOTAL_DETECTORS_V1, pct: 0 };
    const unique = new Set(this.data.topFindings.map((f) => f.detectorId));
    const triggered = unique.size;
    const pct = Math.round((triggered / TOTAL_DETECTORS_V1) * 100);
    return { triggered, total: TOTAL_DETECTORS_V1, pct };
  }

  get severityMix() {
    const c = this.data?.criticalCount || 0;
    const w = this.data?.warningCount || 0;
    const i = this.data?.infoCount || 0;
    const total = Math.max(1, c + w + i);
    return {
      critical: c,
      warning: w,
      info: i,
      criticalPct: Math.round((c / total) * 100),
      warningPct: Math.round((w / total) * 100),
      infoPct: Math.round((i / total) * 100),
    };
  }

  get avgRecoverability() {
    if (!this.data?.topFindings?.length) return { pct: 0, label: '—' };
    const scores = this.data.topFindings
      .map((f) => Number(f.recoverabilityScore))
      .filter((n) => Number.isFinite(n));
    if (!scores.length) return { pct: 0, label: '—' };
    const avg = scores.reduce((s, n) => s + n, 0) / scores.length;
    const pct = Math.round(avg * 100);
    const label = avg > 0.75 ? 'High confidence' : avg > 0.5 ? 'Moderate' : 'Lower confidence';
    return { pct, label };
  }

  // ─── Bar widths as CSS percent strings ───
  get coverageBarStyle() {
    return `width: ${this.detectorCoverage.pct}%;`;
  }
  get criticalBarStyle() {
    return `width: ${this.severityMix.criticalPct}%;`;
  }
  get warningBarStyle() {
    return `width: ${this.severityMix.warningPct}%;`;
  }
  get infoBarStyle() {
    return `width: ${this.severityMix.infoPct}%;`;
  }
  get recoverabilityBarStyle() {
    return `width: ${this.avgRecoverability.pct}%;`;
  }
}

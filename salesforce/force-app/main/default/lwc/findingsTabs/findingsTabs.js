import { LightningElement, wire, track } from 'lwc';
import getAll from '@salesforce/apex/CategoryDisplayController.getAll';

const FALLBACK_PILL_LABELS = {
  revenue_leakage: 'Revenue Leakage',
  governance: 'Governance & Pipeline',
  pricing: 'Pricing Discipline',
};

/**
 * Findings tab container — sub-pill switcher above the three category
 * sub-views. Mirrors the SaaS dashboard's "Findings" tab where Revenue
 * Leakage / Governance & Pipeline / Pricing Discipline were collapsed
 * from 3 top-level tabs into one parent with sub-pills.
 *
 * No URL sync at this level (the parent Lightning page handles tabs);
 * sub-pill state is purely in-memory.
 */
export default class FindingsTabs extends LightningElement {
  activeSub = 'leakage';
  @track catalogEntries = [];

  @wire(getAll)
  wireCategories({ data }) {
    if (data) this.catalogEntries = data;
  }

  /**
   * Phase 20d — pill labels resolve from Category__mdt. The pill ID
   * stays stable (leakage/governance/pricing) because it routes the
   * sub-view; only the human-readable label is mdt-driven.
   */
  get pills() {
    const byKey = {};
    for (const c of this.catalogEntries || []) {
      if (c.categoryKey) byKey[c.categoryKey] = c.title;
    }
    const labelOf = (mdtKey, fallback) =>
      byKey[mdtKey] || FALLBACK_PILL_LABELS[mdtKey] || fallback;

    return [
      { id: 'leakage',    label: labelOf('revenue_leakage', 'Revenue Leakage') },
      { id: 'governance', label: 'Governance & Pipeline' /* spans 2 mdt cats; keep static */ },
      { id: 'pricing',    label: labelOf('pricing', 'Pricing Discipline') },
      { id: 'performance', label: labelOf('performance', 'Performance & Scalability') },
    ].map((p) => ({
      ...p,
      cls: p.id === this.activeSub ? 'op-pill op-pill--active' : 'op-pill',
    }));
  }

  get showLeakage() { return this.activeSub === 'leakage'; }
  get showGovernance() { return this.activeSub === 'governance'; }
  get showPricing() { return this.activeSub === 'pricing'; }
  get showPerformance() { return this.activeSub === 'performance'; }

  handlePillClick(event) {
    const id = event.currentTarget.dataset.id;
    if (id) this.activeSub = id;
  }
}

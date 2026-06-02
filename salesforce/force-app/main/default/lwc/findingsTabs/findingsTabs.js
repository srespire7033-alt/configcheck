import { LightningElement } from 'lwc';

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

  get pills() {
    return [
      { id: 'leakage', label: 'Revenue Leakage' },
      { id: 'governance', label: 'Governance & Pipeline' },
      { id: 'pricing', label: 'Pricing Discipline' },
    ].map((p) => ({
      ...p,
      cls: p.id === this.activeSub ? 'op-pill op-pill--active' : 'op-pill',
    }));
  }

  get showLeakage() { return this.activeSub === 'leakage'; }
  get showGovernance() { return this.activeSub === 'governance'; }
  get showPricing() { return this.activeSub === 'pricing'; }

  handlePillClick(event) {
    const id = event.currentTarget.dataset.id;
    if (id) this.activeSub = id;
  }
}

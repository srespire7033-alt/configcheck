import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import testQuery from '@salesforce/apex/CustomDetectorService.testQuery';

/**
 * Phase 24s — Admin tester for CustomDetector__mdt SOQL.
 *
 * Paste a query, pick a target (host org / a connected org), hit Test.
 * Returns the row count and the first 5 rows so the admin can see
 * shape before saving the mdt record. Read-only on the Apex side
 * (DML keywords / multi-statement rejected).
 *
 * When mounted on a ConnectedOrg__c record page the target preselects
 * to that org; on an AppPage the admin picks via the productType +
 * an explicit connectedOrgId input.
 */
const PRODUCT_TYPES = [
  { label: 'CPQ', value: 'CPQ' },
  { label: 'CPQ + Billing', value: 'CPQ+Billing' },
  { label: 'ARM', value: 'ARM' },
];

export default class CustomDetectorTester extends LightningElement {
  @api recordId; // ConnectedOrg__c id when mounted on a record page

  @track soql = '';
  @track productType = 'CPQ';
  @track connectedOrgIdManual = '';
  @track running = false;
  @track result = null;
  @track error = null;

  productTypeOptions = PRODUCT_TYPES;

  get effectiveOrgId() {
    return this.recordId || (this.connectedOrgIdManual?.trim() || null);
  }
  get targetLabel() {
    return this.effectiveOrgId ? 'Connected org' : 'Host org (where OrgPrism is installed)';
  }
  get isRunDisabled() { return this.running || !this.soql.trim(); }
  get hasResult() { return Boolean(this.result) && !this.error; }
  get hasRows() { return this.hasResult && this.result.rowCount > 0; }
  get rowCountLabel() {
    if (!this.result) return '';
    const n = this.result.rowCount;
    return `${n} row${n === 1 ? '' : 's'} returned${n > 5 ? ' — showing first 5 below' : ''}`;
  }
  get tableRows() {
    if (!this.hasRows) return [];
    return this.result.sample.map((row, i) => ({
      key: i,
      cells: this.result.columns.map(col => ({ key: col, value: this.stringify(row[col]) })),
    }));
  }
  get columnHeaders() {
    return this.hasRows ? this.result.columns.map(c => ({ key: c, label: c })) : [];
  }

  stringify(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  handleSoqlChange(e) { this.soql = e.target.value; }
  handleProductChange(e) { this.productType = e.detail.value; }
  handleConnectedOrgChange(e) { this.connectedOrgIdManual = e.target.value; }

  async handleTest() {
    this.running = true;
    this.result = null;
    this.error = null;
    try {
      const out = await testQuery({
        soql: this.soql,
        productType: this.productType,
        connectedOrgId: this.effectiveOrgId,
      });
      this.result = out;
      if (out.error) {
        this.error = out.error;
      } else {
        this.dispatchEvent(new ShowToastEvent({
          title: 'Query ran',
          message: this.rowCountLabel,
          variant: 'success',
        }));
      }
    } catch (err) {
      this.error = err.body?.message || err.message || String(err);
    } finally {
      this.running = false;
    }
  }
}

import { LightningElement, api, wire, track } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getOverridesForOrg from '@salesforce/apex/DetectorOverrideController.getOverridesForOrg';
import saveOverrides from '@salesforce/apex/DetectorOverrideController.saveOverrides';

/**
 * Phase 24q — Per-org Detector Override admin UI.
 * Renders every detector with its catalog default severity and any
 * existing override; lets the admin set/clear overrides + a note.
 * Save round-trips to DetectorOverrideController.saveOverrides.
 *
 * Mounted on the ConnectedOrg__c record page (record.Id flows into
 * @api recordId), or on an AppPage with the connectedOrgId property.
 */
const SEVERITY_OPTIONS = [
  { label: '(Use default)', value: '' },
  { label: 'Critical', value: 'Critical' },
  { label: 'Warning', value: 'Warning' },
  { label: 'Info', value: 'Info' },
  { label: 'Not Applicable (skip detector)', value: 'Not Applicable' },
];

export default class DetectorOverrides extends LightningElement {
  @api recordId;
  @api connectedOrgId;

  @track rows = [];
  @track filter = '';
  @track loading = true;
  @track saving = false;
  @track dirtyKeys = new Set();
  wiredResult;

  severityOptions = SEVERITY_OPTIONS;

  get effectiveOrgId() { return this.connectedOrgId || this.recordId; }

  @wire(getOverridesForOrg, { connectedOrgId: '$effectiveOrgId' })
  wireData(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.rows = result.data.map(r => ({
        ...r,
        // Empty string in the combobox = no override.
        overrideSeverityValue: r.overrideSeverity || '',
        isActiveValue: r.isActive === false ? false : true,
      }));
      this.dirtyKeys = new Set();
    }
  }

  get filteredRows() {
    if (!this.filter) return this.rows;
    const q = this.filter.toLowerCase();
    return this.rows.filter(r =>
      (r.detectorId || '').toLowerCase().includes(q) ||
      (r.label || '').toLowerCase().includes(q) ||
      (r.category || '').toLowerCase().includes(q)
    );
  }

  get hasRows() { return !this.loading && this.rows.length > 0; }
  get isEmpty() { return !this.loading && this.rows.length === 0; }
  get isDirty() { return this.dirtyKeys.size > 0; }
  get saveLabel() {
    return this.isDirty ? `Save ${this.dirtyKeys.size} change${this.dirtyKeys.size === 1 ? '' : 's'}` : 'Save';
  }
  get isSaveDisabled() { return this.saving || !this.isDirty; }

  handleFilter(e) { this.filter = e.target.value; }

  handleSeverityChange(e) {
    const did = e.target.dataset.detectorId;
    const row = this.rows.find(r => r.detectorId === did);
    if (!row) return;
    row.overrideSeverityValue = e.detail.value;
    row.overrideSeverity = e.detail.value || null;
    this.dirtyKeys.add(did);
    this.rows = [...this.rows]; // trigger reactivity
  }

  handleActiveChange(e) {
    const did = e.target.dataset.detectorId;
    const row = this.rows.find(r => r.detectorId === did);
    if (!row) return;
    row.isActiveValue = e.target.checked;
    row.isActive = e.target.checked;
    this.dirtyKeys.add(did);
    this.rows = [...this.rows];
  }

  handleNotesChange(e) {
    const did = e.target.dataset.detectorId;
    const row = this.rows.find(r => r.detectorId === did);
    if (!row) return;
    row.notes = e.target.value;
    this.dirtyKeys.add(did);
  }

  async handleSave() {
    if (!this.isDirty || !this.effectiveOrgId) return;
    this.saving = true;
    try {
      // Send only the dirty rows. Server upserts when overrideSeverity
      // is set; deletes when it's null but recordId exists.
      const payload = this.rows
        .filter(r => this.dirtyKeys.has(r.detectorId))
        .map(r => ({
          detectorId: r.detectorId,
          overrideSeverity: r.overrideSeverity || null,
          isActive: r.isActiveValue,
          notes: r.notes,
          overrideRecordId: r.overrideRecordId,
        }));
      await saveOverrides({ connectedOrgId: this.effectiveOrgId, rows: payload });
      this.dispatchEvent(new ShowToastEvent({
        title: 'Overrides saved',
        message: `${payload.length} change${payload.length === 1 ? '' : 's'} applied. Next scan will use them.`,
        variant: 'success',
      }));
      this.dirtyKeys = new Set();
      await refreshApex(this.wiredResult);
    } catch (err) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'Save failed',
        message: err.body?.message || err.message || String(err),
        variant: 'error',
      }));
    } finally {
      this.saving = false;
    }
  }
}

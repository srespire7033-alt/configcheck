import { LightningElement, api, track, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

import getFindingDetail from '@salesforce/apex/FindingsListController.getFindingDetail';
import updateNote from '@salesforce/apex/FindingsListController.updateNote';
import stageFinding from '@salesforce/apex/RecoveryActionService.stageFinding';
import approveAction from '@salesforce/apex/RecoveryActionService.approve';
import rejectAction from '@salesforce/apex/RecoveryActionService.reject';
import markCommitted from '@salesforce/apex/RecoveryActionService.markCommitted';
import restageAction from '@salesforce/apex/RecoveryActionService.restage';

const SEVERITY_BADGE = {
  Critical: 'slds-theme_error',
  Warning: 'slds-theme_warning',
  Info: 'slds-theme_inverse',
};

export default class FindingDetail extends NavigationMixin(LightningElement) {
  @api recordId; // ForensicFinding__c Id when used on a Record Page
  @track detail = null;
  @track noteDraft = '';
  @track busy = false;
  wiredDetail;

  @wire(getFindingDetail, { findingId: '$recordId' })
  wireDetail(result) {
    this.wiredDetail = result;
    if (result.data) {
      this.detail = result.data;
      this.noteDraft = result.data.raw.ConsultantNote__c || '';
    }
  }

  get cardTitle() {
    return this.detail?.finding?.title || 'Finding';
  }

  get severityBadgeClass() {
    return SEVERITY_BADGE[this.detail?.finding?.severity] || 'slds-theme_default';
  }

  get hasAffectedRecord() {
    return !!this.detail?.finding?.primaryRecordId;
  }

  get hasTraces() {
    return (this.detail?.traces?.length || 0) > 0;
  }

  get noteDirty() {
    const saved = this.detail?.raw?.ConsultantNote__c || '';
    return this.noteDraft !== saved;
  }

  // Recovery state-machine button visibility — drives which CTAs render.
  get recoveryStatus() {
    return this.detail?.recoveryAction?.ApprovalStatus__c;
  }
  get showStageButton() {
    const s = this.recoveryStatus;
    return !this.detail?.recoveryAction || s === 'Rejected' || s === 'Expired';
  }
  get showApproveButton() {
    return this.recoveryStatus === 'Pending';
  }
  get showCommitButton() {
    return this.recoveryStatus === 'Approved';
  }
  get showRestageButton() {
    return this.recoveryStatus === 'Committed';
  }

  handleNoteChange(event) {
    this.noteDraft = event.target.value;
  }

  async handleNoteSave() {
    this.busy = true;
    try {
      await updateNote({ findingId: this.recordId, note: this.noteDraft });
      await refreshApex(this.wiredDetail);
      this.toast('Note saved', 'Your note has been updated', 'success');
    } catch (e) {
      this.toast('Save failed', this.errMessage(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  async handleStage() {
    this.busy = true;
    try {
      await stageFinding({ findingId: this.recordId });
      await refreshApex(this.wiredDetail);
      this.toast('Staged', 'Finding moved to Pending', 'success');
    } catch (e) {
      this.toast('Stage failed', this.errMessage(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  async handleApprove() {
    await this.runAction(approveAction, 'Approved');
  }

  async handleReject() {
    await this.runAction(rejectAction, 'Rejected');
  }

  async handleCommit() {
    // Phase 14a — markCommitted now auto-verifies in the same
    // transaction and returns { verdict: { status, message } }.
    // Surface the verdict in the toast so the consultant sees the
    // verification outcome immediately.
    this.busy = true;
    try {
      const result = await markCommitted({ actionId: this.detail.recoveryAction.Id });
      await refreshApex(this.wiredDetail);
      const verdict = result?.verdict;
      if (verdict?.status === 'verified') {
        this.toast('Committed and verified', verdict.message || '', 'success');
      } else if (verdict?.status === 'regressed') {
        this.toast('Committed — verification failed', verdict.message || '', 'warning');
      } else {
        this.toast('Marked as committed', verdict?.message || '', 'success');
      }
    } catch (e) {
      this.toast('Action failed', this.errMessage(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  async handleRestage() {
    await this.runAction(restageAction, 'Restaged to Pending');
  }

  async runAction(fn, successMsg) {
    this.busy = true;
    try {
      await fn({ actionId: this.detail.recoveryAction.Id });
      await refreshApex(this.wiredDetail);
      this.toast(successMsg, '', 'success');
    } catch (e) {
      this.toast('Action failed', this.errMessage(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  openAffectedRecord() {
    this[NavigationMixin.Navigate]({
      type: 'standard__recordPage',
      attributes: {
        recordId: this.detail.finding.primaryRecordId,
        actionName: 'view',
      },
    });
  }

  toast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }

  errMessage(e) {
    return e?.body?.message || e?.message || 'Unknown error';
  }
}

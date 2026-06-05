import { LightningElement, api, wire, track } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getNoteBundle from '@salesforce/apex/FindingNoteService.getNoteBundle';
import saveNote from '@salesforce/apex/FindingNoteService.saveNote';

/**
 * Consultant notes on a finding (Phase 13) + suggestion chips (Phase 16c).
 *
 * Loads notes + 3 detector-specific suggestion templates in one call
 * via getNoteBundle. Clicking a chip inserts the suggestion text into
 * the textarea (replaces if empty, appends on a new line otherwise).
 * Consultant can edit before saving on blur.
 */
const SAVED_FLASH_MS = 1500;

export default class FindingNotes extends LightningElement {
  @api recordId;
  @track value = '';
  @track originalValue = '';
  @track suggestions = [];
  @track saving = false;
  @track justSaved = false;
  wiredResult;

  @wire(getNoteBundle, { findingId: '$recordId' })
  wireData(result) {
    this.wiredResult = result;
    if (result.data) {
      this.value = result.data.notes || '';
      this.originalValue = this.value;
      this.suggestions = result.data.suggestions || [];
    }
  }

  get hasUnsavedChanges() {
    return this.value !== this.originalValue && !this.saving;
  }

  get hasSuggestions() {
    return Array.isArray(this.suggestions) && this.suggestions.length > 0;
  }

  get suggestionChips() {
    // LWC for:each needs a stable key + indexed access
    return this.suggestions.map((s, i) => ({
      key: 'sug-' + i,
      text: s,
      // Slightly truncated display label so long suggestions stay one-line
      displayText: s.length > 60 ? s.substring(0, 60) + '…' : s,
    }));
  }

  get charCount() {
    return (this.value || '').length;
  }

  get charCountClass() {
    return this.charCount > 30000
      ? 'op-fn__count op-fn__count--warn'
      : 'op-fn__count';
  }

  get savedBadgeClass() {
    return this.justSaved
      ? 'op-fn__saved op-fn__saved--visible'
      : 'op-fn__saved';
  }

  handleChange(event) {
    this.value = event.target.value;
    this.justSaved = false;
  }

  /**
   * Insert the suggestion text into the textarea. If the textarea is
   * empty, replace; otherwise append on a new line so the consultant
   * can layer multiple suggestions or combine with their own prose.
   */
  handleChipClick(event) {
    const text = event.currentTarget.dataset.text;
    if (!text) return;
    if (!this.value || this.value.trim() === '') {
      this.value = text;
    } else {
      this.value = this.value.trimEnd() + '\n' + text;
    }
    this.justSaved = false;
    // Focus the textarea so the consultant can keep typing
    const ta = this.template.querySelector('textarea.op-fn__textarea');
    if (ta) {
      ta.focus();
      // Move cursor to end
      const len = this.value.length;
      ta.setSelectionRange(len, len);
    }
  }

  async handleBlur() {
    if (this.value === this.originalValue) return;
    await this.persist();
  }

  async handleSaveClick() {
    if (!this.hasUnsavedChanges) return;
    await this.persist();
  }

  async persist() {
    this.saving = true;
    try {
      const saved = await saveNote({
        findingId: this.recordId,
        notes: this.value,
      });
      this.value = saved;
      this.originalValue = saved;
      this.justSaved = true;
      setTimeout(() => { this.justSaved = false; }, SAVED_FLASH_MS);
      if (this.wiredResult) refreshApex(this.wiredResult);
    } catch (err) {
      this.dispatchEvent(new ShowToastEvent({
        title: 'Could not save note',
        message: err.body?.message || err.message || 'Unknown error',
        variant: 'error',
      }));
    } finally {
      this.saving = false;
    }
  }
}

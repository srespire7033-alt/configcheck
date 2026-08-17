import { LightningElement } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getFindingsCsv from '@salesforce/apex/ExportController.getFindingsCsv';
import getRecoveryActionsCsv from '@salesforce/apex/ExportController.getRecoveryActionsCsv';

/**
 * Download menu — produces consultant-deliverable CSVs from the
 * latest scan. Apex returns the CSV body as a string; the LWC wraps
 * it in a Blob and triggers a browser download via an anchor tag.
 *
 * Why CSV not PDF: consultants brand reports in Excel/Google Sheets
 * anyway. CSV is the universal pivot-and-ship format. PDF generation
 * (with branded layouts) is deferred to a later sub-phase that adds
 * a Visualforce-rendered-as-PDF page.
 *
 * Future additions:
 *   - PDF executive summary (via VF page renderAs="pdf")
 *   - Excel (.xlsx) using a Static Resource template
 *   - Attribution map export
 */

function downloadCsv(content, filename) {
  // Lightning Locker allows Blob + createObjectURL + anchor click —
  // the standard cross-browser download trick.
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the blob URL after the download. ~10s is plenty for the
  // browser to start the download and is well under the GC threshold.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export default class ExportMenu extends LightningElement {
  open = false;
  busy = false;

  // A11y — dismiss the open menu on Escape or an outside click so the
  // popup behaves like a proper menu for keyboard + pointer users.
  _outsideClickHandler = null;
  _escKeyHandler = null;
  connectedCallback() {
    this._outsideClickHandler = (e) => {
      if (!this.open) return;
      // On a document-level listener the event target retargets to this
      // component's host element for any click inside the shadow tree,
      // so a target that is NOT the host means the click landed outside.
      if (e.target !== this.template.host) {
        this.open = false;
      }
    };
    this._escKeyHandler = (e) => {
      if (e.key === 'Escape' && this.open) {
        this.open = false;
      }
    };
    document.addEventListener('click', this._outsideClickHandler);
    document.addEventListener('keydown', this._escKeyHandler);
  }
  disconnectedCallback() {
    if (this._outsideClickHandler) {
      document.removeEventListener('click', this._outsideClickHandler);
    }
    if (this._escKeyHandler) {
      document.removeEventListener('keydown', this._escKeyHandler);
    }
  }

  toggleMenu() {
    if (this.busy) return;
    this.open = !this.open;
  }

  get triggerLabel() {
    return this.busy ? 'Exporting…' : 'Export';
  }

  get menuClass() {
    return this.open ? 'op-em__menu op-em__menu--open' : 'op-em__menu';
  }

  async handleFindings() {
    this.open = false;
    this.busy = true;
    try {
      const csv = await getFindingsCsv();
      if (!csv || csv.length === 0) {
        this.toast('Nothing to export — no findings in the latest scan.', 'info');
        return;
      }
      downloadCsv(csv, `orgprism-findings-${timestamp()}.csv`);
      this.toast('Findings exported', 'success');
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  handlePdf() {
    this.open = false;
    // Open the Visualforce-rendered PDF in a new tab. The page reads
    // the latest scan automatically (or accepts ?scanId=... if we
    // ever want to deep-link to a specific scan).
    const url = '/apex/ExecutiveReport';
    window.open(url, '_blank', 'noopener');
  }

  async handleRecovery() {
    this.open = false;
    this.busy = true;
    try {
      const csv = await getRecoveryActionsCsv();
      // Recovery CSV always has at least the header row, so a length
      // check vs the header threshold is more meaningful than truthy.
      if (!csv || csv.length < 50) {
        this.toast('Nothing to export — no recovery actions yet.', 'info');
        return;
      }
      downloadCsv(csv, `orgprism-recovery-${timestamp()}.csv`);
      this.toast('Recovery actions exported', 'success');
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  toast(message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title: message, variant }));
  }
  errMsg(e) {
    return e?.body?.message || e?.message || 'Export failed';
  }
}

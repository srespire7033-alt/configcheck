import { LightningElement, track } from 'lwc';

/**
 * Phase 22z — full-screen scan-in-progress overlay.
 *
 * Triggered via window events so any LWC that kicks off a scan can
 * raise the overlay without holding a direct reference:
 *   - `op:scan-starting`  → show overlay (event.detail.label optional)
 *   - `op:scan-completed` → hide overlay
 *
 * Used by heroBlock.handleNewScan() and connectedOrgManager._runScan().
 * Rendered once at the top of dashboardPreview so it sits above every
 * card without interfering with their layout.
 */
export default class ScanOverlay extends LightningElement {
  @track visible = false;
  @track label = 'Scanning Salesforce org…';
  @track sub = 'This usually takes 30–90 seconds. Please don’t close this tab.';

  handleStart = (e) => {
    const detail = e?.detail || {};
    this.label = detail.label || 'Scanning Salesforce org…';
    this.sub = detail.sub || 'This usually takes 30–90 seconds. Please don’t close this tab.';
    this.visible = true;
    // Prevent background scroll while the overlay is up.
    try { document.body.style.overflow = 'hidden'; } catch (_) {}
  };

  handleDone = () => {
    this.visible = false;
    try { document.body.style.overflow = ''; } catch (_) {}
  };

  connectedCallback() {
    window.addEventListener('op:scan-starting', this.handleStart);
    window.addEventListener('op:scan-completed', this.handleDone);
  }
  disconnectedCallback() {
    window.removeEventListener('op:scan-starting', this.handleStart);
    window.removeEventListener('op:scan-completed', this.handleDone);
    try { document.body.style.overflow = ''; } catch (_) {}
  }
}

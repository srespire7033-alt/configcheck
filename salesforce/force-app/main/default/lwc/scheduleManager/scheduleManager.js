import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getSchedules from '@salesforce/apex/ScheduleController.getSchedules';
import createSchedule from '@salesforce/apex/ScheduleController.createSchedule';
import setActive from '@salesforce/apex/ScheduleController.setActive';
import deleteSchedule from '@salesforce/apex/ScheduleController.deleteSchedule';
import runNow from '@salesforce/apex/ScheduleController.runNow';
import getDashboardSummary from '@salesforce/apex/DashboardController.getDashboardSummary';

/**
 * Schedule manager — opens a modal where users set up recurring scans.
 *
 * Modal UX (matches the SaaS design):
 *   Frequency  → [One-time] [Daily] [Weekly] [Monthly]
 *   Time       → HH:MM input (defaults 06:00)
 *   Timezone   → displayed read-only (the browser's IANA name)
 *   [Cancel] [Save Schedule]
 *
 * Frequency drives cron generation in JS:
 *   - One-time → no cron; fires runNow() against a placeholder record
 *     (so the run shows up in history) then pauses the cron.
 *   - Daily    → 0 MM HH * * ?
 *   - Weekly   → 0 MM HH ? * MON   (Monday default; day-picker is v2)
 *   - Monthly  → 0 MM HH 1 * ?     (1st default; day-picker is v2)
 *
 * Salesforce schedules run in the timezone of the user who created
 * the cron. We surface the user's IANA TZ for transparency but
 * don't allow override — cross-TZ scheduling requires hour
 * conversion that's easy to mis-handle. We'll add a real picker
 * once we have a concrete use case.
 *
 * Every save creates a ScanSchedule__c record — full audit trail in
 * Setup → Object Manager → Scan Schedules.
 */
const FREQUENCY_OPTIONS = [
  { id: 'one-time', label: 'One-time', icon: 'utility:event' },
  { id: 'daily',    label: 'Daily',    icon: 'utility:clock' },
  { id: 'weekly',   label: 'Weekly',   icon: 'utility:refresh' },
  { id: 'monthly',  label: 'Monthly',  icon: 'utility:event' },
];

export default class ScheduleManager extends LightningElement {
  wiredResult;
  schedules = [];
  loading = true;
  showModal = false;
  busy = false;
  error;

  detectedProductType = 'CPQ';
  detectedFromScan = false;
  newFrequency = 'daily';
  newTime = '06:00';
  newTimezone = '';
  newDate = '';          // YYYY-MM-DD, used when frequency=one-time
  newDayOfWeek = 'MON';  // used when frequency=weekly
  newDayOfMonth = 1;     // used when frequency=monthly

  // Bound handler so we can add/removeEventListener cleanly.
  _openListener = () => { this.handleOpen(); };
  // Guards one-time focus-move into the modal when it opens.
  _modalFocused = false;

  connectedCallback() {
    try {
      this.newTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      this.newTimezone = 'UTC';
    }
    // The hero's Schedule button dispatches this — listen on window
    // so any other LWC can open the modal regardless of FlexiPage
    // composition.
    try { window.addEventListener('op:open-schedule-modal', this._openListener); }
    catch (e) { /* Locker may block; that's fine, button still works */ }
  }

  disconnectedCallback() {
    try { window.removeEventListener('op:open-schedule-modal', this._openListener); }
    catch (e) {}
  }

  @wire(getDashboardSummary, { connectedOrgId: null })
  wireSummary(result) {
    const t = result.data?.latestScan?.ProductType__c;
    if (t) {
      this.detectedProductType = t;
      this.detectedFromScan = true;
    }
  }

  @wire(getSchedules)
  wireData(result) {
    this.wiredResult = result;
    this.loading = false;
    if (result.data) {
      this.schedules = result.data;
      this.error = undefined;
    } else if (result.error) {
      this.error = result.error.body?.message || result.error.message;
    }
  }

  get hasSchedules() { return this.schedules?.length > 0; }
  get isEmpty() { return !this.loading && !this.error && !this.hasSchedules; }

  get frequencyOptions() {
    return FREQUENCY_OPTIONS.map((o) => ({
      ...o,
      cls: o.id === this.newFrequency ? 'op-sm__freq op-sm__freq--active' : 'op-sm__freq',
    }));
  }

  get timezoneDisplay() {
    try {
      const tz = this.newTimezone;
      const short = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
      return short ? `${short} (${tz})` : tz;
    } catch (e) {
      return this.newTimezone;
    }
  }

  get productDetectedLabel() {
    const labels = { 'CPQ': 'CPQ', 'CPQ+Billing': 'CPQ + Billing', 'ARM': 'Revenue Cloud (ARM)' };
    const human = labels[this.detectedProductType] || this.detectedProductType;
    return this.detectedFromScan
      ? `Scans run as ${human} (from your latest scan)`
      : `Scans run as ${human} (default)`;
  }

  get isOneTime() { return this.newFrequency === 'one-time'; }
  get isWeekly()  { return this.newFrequency === 'weekly'; }
  get isMonthly() { return this.newFrequency === 'monthly'; }

  /** Default date for one-time picker: tomorrow at local time. */
  get defaultOneTimeDate() {
    if (this.newDate) return this.newDate;
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

  get dayOfWeekOptions() {
    const labels = [
      { id: 'SUN', label: 'Sun' }, { id: 'MON', label: 'Mon' },
      { id: 'TUE', label: 'Tue' }, { id: 'WED', label: 'Wed' },
      { id: 'THU', label: 'Thu' }, { id: 'FRI', label: 'Fri' },
      { id: 'SAT', label: 'Sat' },
    ];
    return labels.map((d) => ({
      ...d,
      cls: d.id === this.newDayOfWeek ? 'op-sm__dow op-sm__dow--active' : 'op-sm__dow',
    }));
  }

  get dayOfMonthOptions() {
    const opts = [];
    for (let i = 1; i <= 31; i++) {
      opts.push({ label: this.ordinal(i), value: String(i) });
    }
    return opts;
  }
  ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  }

  get saveButtonLabel() {
    if (this.busy) return 'Saving…';
    return this.isOneTime ? 'Run now' : 'Save Schedule';
  }

  get rows() {
    return (this.schedules || []).map((s) => {
      const lastRunFmt = s.lastRunAt ? this.timeAgo(s.lastRunAt) : '—';
      const nextRunFmt = s.nextRunAt ? this.formatDate(s.nextRunAt) : (s.isActive ? '—' : 'Paused');
      const statusBadge = !s.isActive
        ? { label: 'Paused', cls: 'op-sm__status op-sm__status--paused' }
        : s.lastRunStatus === 'Failed'
          ? { label: 'Last failed', cls: 'op-sm__status op-sm__status--failed' }
          : { label: 'Active', cls: 'op-sm__status op-sm__status--active' };
      const toggleLabel = s.isActive ? 'Pause' : 'Resume';
      return { ...s, lastRunFmt, nextRunFmt, statusBadge, toggleLabel };
    });
  }

  timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }
  formatDate(iso) {
    return new Date(iso).toLocaleString();
  }

  buildCron() {
    const [hh, mm] = this.newTime.split(':').map((s) => parseInt(s, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) throw new Error('Invalid time format');
    switch (this.newFrequency) {
      case 'daily':   return `0 ${mm} ${hh} * * ?`;
      case 'weekly':  return `0 ${mm} ${hh} ? * ${this.newDayOfWeek}`;
      case 'monthly': return `0 ${mm} ${hh} ${this.newDayOfMonth} * ?`;
      case 'one-time': {
        // Salesforce cron supports an optional year field. Use the
        // picked date so the job fires exactly once on that day.
        const d = this.newDate || this.defaultOneTimeDate;
        const [y, mo, day] = d.split('-').map((s) => parseInt(s, 10));
        if (!y || !mo || !day) throw new Error('Pick a date for the one-time scan');
        return `0 ${mm} ${hh} ${day} ${mo} ? ${y}`;
      }
      default: return null;
    }
  }

  buildLabel() {
    const productLabel = { 'CPQ': 'CPQ', 'CPQ+Billing': 'CPQ+Billing', 'ARM': 'ARM' }[this.detectedProductType] || this.detectedProductType;
    if (this.isOneTime) {
      return `${productLabel} scan on ${this.newDate || this.defaultOneTimeDate} at ${this.newTime}`;
    }
    if (this.isWeekly) {
      const dowLabel = { SUN:'Sun', MON:'Mon', TUE:'Tue', WED:'Wed', THU:'Thu', FRI:'Fri', SAT:'Sat' }[this.newDayOfWeek];
      return `Weekly ${productLabel} scan ${dowLabel} ${this.newTime}`;
    }
    if (this.isMonthly) {
      return `Monthly ${productLabel} scan ${this.ordinal(this.newDayOfMonth)} at ${this.newTime}`;
    }
    return `Daily ${productLabel} scan at ${this.newTime}`;
  }

  handleOpen() {
    this.showModal = true;
    this.newFrequency = 'daily';
    this.newTime = '06:00';
    this.newDate = this.defaultOneTimeDate;
    this.newDayOfWeek = 'MON';
    this.newDayOfMonth = 1;
    this.error = undefined;
  }
  handleClose() {
    if (this.busy) return;
    this.showModal = false;
  }
  handleModalKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.handleClose();
    }
  }

  // Move focus into the dialog once when it first opens; reset when closed
  // so it re-focuses on the next open. Guarded to avoid stealing focus
  // on every render.
  renderedCallback() {
    if (this.showModal && !this._modalFocused) {
      const dialog = this.template.querySelector('.op-sm__modal');
      if (dialog) {
        dialog.focus();
        this._modalFocused = true;
      }
    } else if (!this.showModal && this._modalFocused) {
      this._modalFocused = false;
    }
  }

  handleFrequencyPick(event) {
    if (this.busy) return;
    this.newFrequency = event.currentTarget.dataset.id;
  }
  handleTimeChange(event) {
    this.newTime = event.target.value;
  }
  handleDateChange(event) {
    this.newDate = event.target.value;
  }
  handleDayOfWeekPick(event) {
    if (this.busy) return;
    this.newDayOfWeek = event.currentTarget.dataset.id;
  }
  handleDayOfMonthChange(event) {
    this.newDayOfMonth = parseInt(event.target.value, 10) || 1;
  }

  async handleSave() {
    this.busy = true;
    try {
      const cron = this.buildCron();
      await createSchedule({
        label: this.buildLabel(),
        productType: this.detectedProductType,
        cronExpression: cron,
      });
      this.toast(this.isOneTime ? 'One-time scan scheduled' : 'Schedule saved', 'success');
      this.showModal = false;
      await refreshApex(this.wiredResult);
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  async handleToggle(event) {
    const id = event.currentTarget.dataset.id;
    const row = this.schedules.find((s) => s.id === id);
    if (!row) return;
    this.busy = true;
    try {
      await setActive({ scheduleId: id, active: !row.isActive });
      this.toast(row.isActive ? 'Schedule paused' : 'Schedule resumed', 'success');
      await refreshApex(this.wiredResult);
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  async handleDelete(event) {
    // eslint-disable-next-line no-alert
    if (!confirm('Delete this schedule? The cron job will be unregistered.')) return;
    const id = event.currentTarget.dataset.id;
    this.busy = true;
    try {
      await deleteSchedule({ scheduleId: id });
      this.toast('Schedule deleted', 'success');
      await refreshApex(this.wiredResult);
    } catch (e) {
      this.toast(this.errMsg(e), 'error');
    } finally {
      this.busy = false;
    }
  }

  async handleRunNow(event) {
    const id = event.currentTarget.dataset.id;
    this.busy = true;
    try {
      await runNow({ scheduleId: id });
      this.toast('Scan started', 'success');
      await refreshApex(this.wiredResult);
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
    return e?.body?.message || e?.message || 'Action failed';
  }
}

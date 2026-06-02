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
 * Schedule manager — opens a modal where users can create/toggle/
 * delete cron-driven scheduled scans. Uses preset cron expressions
 * to keep the UI simple — power users can edit the raw cron string.
 *
 * Salesforce's minimum cron frequency is hourly. Anything more
 * frequent than `0 0 * * * ?` (hourly) is rejected at System.schedule
 * level — we don't expose those options in the UI.
 */
const PRESETS = [
  { id: 'daily-9',       label: 'Daily · 9 AM',         cron: '0 0 9 * * ?' },
  { id: 'daily-6',       label: 'Daily · 6 AM',         cron: '0 0 6 * * ?' },
  { id: 'weekly-mon',    label: 'Weekly · Mon 9 AM',    cron: '0 0 9 ? * MON' },
  { id: 'weekly-fri',    label: 'Weekly · Fri 5 PM',    cron: '0 0 17 ? * FRI' },
  { id: 'monthly-1st',   label: 'Monthly · 1st 9 AM',   cron: '0 0 9 1 * ?' },
  { id: 'hourly',        label: 'Hourly · top of hour', cron: '0 0 * * * ?' },
];

export default class ScheduleManager extends LightningElement {
  wiredResult;
  schedules = [];
  loading = true;
  showModal = false;
  busy = false;
  error;

  // Create-form state. Product type is auto-detected from the latest
  // scan (or defaults to CPQ if no scans yet). Users rarely audit
  // multiple product types per org, so hiding the picker simplifies
  // the form. A power-user override could come later if needed.
  newLabel = '';
  detectedProductType = 'CPQ';
  detectedFromScan = false;
  newPresetId = 'daily-9';
  newCron = '0 0 9 * * ?';

  @wire(getDashboardSummary)
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

  get presetOptions() {
    return PRESETS.map((p) => ({ ...p, cls: p.id === this.newPresetId ? 'op-sm__preset op-sm__preset--active' : 'op-sm__preset' }));
  }
  get productDetectedLabel() {
    const labels = { 'CPQ': 'CPQ', 'CPQ+Billing': 'CPQ + Billing', 'ARM': 'Revenue Cloud (ARM)' };
    const human = labels[this.detectedProductType] || this.detectedProductType;
    return this.detectedFromScan
      ? `Will scan as ${human} (detected from your latest scan)`
      : `Will scan as ${human} (default)`;
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
    const d = new Date(iso);
    return d.toLocaleString();
  }

  // ── Modal lifecycle ──

  handleOpen() {
    this.showModal = true;
    this.resetForm();
  }
  handleClose() {
    if (this.busy) return;
    this.showModal = false;
  }
  resetForm() {
    this.newLabel = '';
    this.newPresetId = 'daily-9';
    this.newCron = '0 0 9 * * ?';
    this.error = undefined;
    // detectedProductType stays sticky from the wire result.
  }

  // ── Form handlers ──

  handleLabelChange(event) { this.newLabel = event.target.value; }
  handlePresetPick(event) {
    if (this.busy) return;
    const id = event.currentTarget.dataset.id;
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) {
      this.newPresetId = preset.id;
      this.newCron = preset.cron;
    }
  }
  handleCronChange(event) {
    // User editing the raw cron — drop preset selection.
    this.newCron = event.target.value;
    this.newPresetId = null;
  }

  // ── Actions ──

  async handleCreate() {
    this.busy = true;
    try {
      await createSchedule({
        label: this.newLabel,
        productType: this.detectedProductType,
        cronExpression: this.newCron,
      });
      this.toast('Schedule created', 'success');
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

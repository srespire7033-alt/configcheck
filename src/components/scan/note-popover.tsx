'use client';

/**
 * NotePopover — inline note editor that opens on click of a row's
 * note icon. Lets a consultant capture engagement context without
 * navigating to the finding detail page.
 *
 * UX choices:
 *   - Click outside or Escape closes (cancels unsaved changes;
 *     we display a 'unsaved' badge so the user knows)
 *   - Save is explicit (button) so an accidental click-away doesn't
 *     auto-commit
 *   - Renders as a fixed-position panel anchored to the trigger
 *     (handles viewport edges so it never overflows off-screen)
 *
 * The trigger button is rendered by the parent — this component is
 * just the panel content + portal positioning. Parent owns
 * open/close state via the `open` prop and `onClose` callback.
 */

import { useEffect, useRef, useState } from 'react';
import { StickyNote, Save, Loader2, X } from 'lucide-react';

interface Props {
  open: boolean;
  /** The element the popover positions itself relative to. */
  anchorRef: React.RefObject<HTMLElement | null>;
  findingId: string;
  initialNote: string | null;
  /** Called after a successful save with the updated note (or null on clear). */
  onSaved?: (note: string | null) => void;
  onClose: () => void;
}

export function NotePopover({ open, anchorRef, findingId, initialNote, onSaved, onClose }: Props) {
  const [note, setNote] = useState(initialNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Recompute position when the popover opens. The trigger may be
  // anywhere in the row; we anchor the panel slightly below it. If
  // the panel would overflow the viewport's right edge, shift left.
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const panelWidth = 360;
    const margin = 8;
    let left = r.left;
    if (left + panelWidth + margin > window.innerWidth) {
      left = window.innerWidth - panelWidth - margin;
    }
    if (left < margin) left = margin;
    setPosition({ top: r.bottom + 4, left });
  }, [open, anchorRef]);

  // Reset textarea content when the popover reopens for a different
  // finding (or after a save).
  useEffect(() => {
    if (open) {
      setNote(initialNote ?? '');
      setError(null);
    }
  }, [open, initialNote]);

  // Close on click-outside (mousedown outside both trigger + panel).
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open, onClose, anchorRef]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open || !position) return null;

  const dirty = note !== (initialNote ?? '');

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/forensic-findings/${findingId}/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() === '' ? null : note }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as { consultant_note: string | null };
      onSaved?.(data.consultant_note);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={panelRef}
      style={{ top: position.top, left: position.left, width: 360 }}
      className="fixed z-50 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111827] p-4"
      role="dialog"
      aria-label="Edit finding note"
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {initialNote ? 'Edit note' : 'Add note'}
          </p>
          {dirty && (
            <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/30 rounded">
              Unsaved
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={4000}
        rows={4}
        autoFocus
        placeholder="e.g. 'Client says by design — save for Phase 2'"
        className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-700/40"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Private. {note.length}/4000
        </p>
        <div className="flex items-center gap-2">
          {error && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">{error}</p>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { createServiceClient } from '@/lib/db/client';

/**
 * Per-user AI call throttle.
 *
 * Free Gemini tier caps at 10 requests/minute. A user who clicks "AI
 * explain" on three issues in two seconds, plus the scan engine's
 * deferred executive-summary and remediation-plan calls, can easily burn
 * through that budget and trip 429s.
 *
 * This function reads the user's `last_ai_call_at` timestamp and, if it
 * was within `minGapMs`, sleeps until the gap elapses before returning.
 * After returning, it updates `last_ai_call_at` to "now" so the next call
 * waits its turn.
 *
 * The pattern is intentionally simple — a single timestamp column, no
 * distributed lock. Two simultaneous requests for the same user CAN both
 * pass the check in a tiny race window, in which case worst case is one
 * extra call (still safely inside the 10 RPM budget given the 6s default
 * gap).
 *
 * Default gap: 6 seconds = 10 RPM ceiling. Override with `minGapMs` for
 * Tier 1 customers if/when we activate billing — they can run at 1 RPS.
 *
 * Skipped entirely in test environments so unit tests don't sleep.
 */
export async function throttleAi(userId: string | null | undefined, minGapMs = 6000): Promise<void> {
  if (!userId) return;
  if (process.env.NODE_ENV === 'test') return;

  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('users')
      .select('last_ai_call_at')
      .eq('id', userId)
      .single();

    const last = data?.last_ai_call_at ? new Date(data.last_ai_call_at).getTime() : 0;
    const elapsed = Date.now() - last;
    if (last > 0 && elapsed < minGapMs) {
      const wait = minGapMs - elapsed;
      console.log(`[ai-throttle] user=${userId.slice(0, 8)} sleeping ${wait}ms to respect free-tier RPM`);
      await new Promise((r) => setTimeout(r, wait));
    }

    // Mark "now" as the latest AI call time. We update BEFORE the actual
    // Gemini call so a concurrent second request sees the latest stamp
    // and waits — narrows the race window.
    await supabase
      .from('users')
      .update({ last_ai_call_at: new Date().toISOString() })
      .eq('id', userId);
  } catch (err) {
    // Throttle must never break the AI call. Log and proceed without delay.
    console.error('[ai-throttle] read/write failed (proceeding without throttle):', err);
  }
}

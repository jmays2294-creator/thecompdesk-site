/**
 * calc-history-sync.js — cross-surface live sync for saved calculations.
 *
 * The promise: when a save/update/delete happens on the iOS/Android app, or in
 * another browser tab, the surface you are looking at repaints itself instead
 * of making you hit Refresh.
 *
 * History — read this before changing anything here
 * ─────────────────────────────────────────────────
 * This module was imported by `dashboard/my-cases.html` from May 8, 2026 but
 * was NEVER WRITTEN. Because a static ESM import that fails to resolve aborts
 * the ENTIRE `<script type="module">` block, the missing file did not degrade
 * live sync — it took the whole page down. Every visitor to My Cases, at every
 * tier, sat on "Verifying your subscription…" forever, because the code that
 * hides that overlay lived in the same dead module.
 *
 * The lesson is encoded in this file's hardest rule:
 *
 *   THIS MODULE MUST NEVER THROW — not at import, not from startCalcHistorySync,
 *   not from stopCalcHistorySync. Live sync is a nice-to-have layered on top of
 *   a working page. It must never again be able to take the page with it.
 *
 * Everything below is wrapped accordingly, and every failure path degrades to
 * the manual Refresh button while shouting on the console and on a
 * `calchistory:error` window event (the "fail loud, never silent" rule).
 *
 * Contract (matches the call sites in dashboard/my-cases.html):
 *   const handle = startCalcHistorySync({ supabase, userId, onChange });
 *   stopCalcHistorySync(handle);   // safe with null / undefined / anything
 */

import { supabase as sharedClient } from '/js/supabase-client.js';

const TABLE = 'calculation_history';
const LOG = '[calc-history-sync]';

/** Collapse bursts (a bulk delete fires N events) into one refetch. */
const DEBOUNCE_MS = 250;

/** How long to wait for SUBSCRIBED before declaring the channel dead. */
const SUBSCRIBE_TIMEOUT_MS = 10_000;

/** Degraded-mode poll interval, used only when Realtime could not connect. */
const POLL_MS = 30_000;

/**
 * Announce a degradation. Deferred to a macrotask on purpose: my-cases.html
 * registers its `calchistory:error` listener on the line AFTER it calls
 * startCalcHistorySync, so a synchronous dispatch would fire into a void.
 */
function reportError(reason, detail) {
  try {
    console.warn(`${LOG} ${reason}`, detail ?? '');
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent('calchistory:error', {
          detail: { reason, detail: detail ? String(detail) : undefined },
        }));
      } catch { /* CustomEvent unavailable — console warning already stands */ }
    }, 0);
  } catch { /* never let telemetry break the caller */ }
}

/**
 * Start listening for changes to this user's calculation history.
 *
 * @param {object}   opts
 * @param {object}  [opts.supabase] Supabase client. Falls back to the shared one.
 * @param {string}   opts.userId    The signed-in user's id.
 * @param {Function} opts.onChange  Called (debounced) whenever anything changed.
 * @returns {object|null} An opaque handle for stopCalcHistorySync, or null.
 */
export function startCalcHistorySync(opts) {
  try {
    const { supabase: passedClient, userId, onChange } = opts || {};
    const sb = passedClient || sharedClient;

    if (!sb || typeof sb.channel !== 'function') {
      reportError('no-supabase-client', 'live sync disabled; Refresh still works');
      return null;
    }
    if (!userId) {
      reportError('no-user-id', 'live sync disabled; Refresh still works');
      return null;
    }
    if (typeof onChange !== 'function') {
      reportError('no-onchange-callback', 'nothing to notify; live sync disabled');
      return null;
    }

    const handle = {
      client: sb,          // tear down against the SAME client we subscribed on
      channel: null,
      pollTimer: null,
      debounceTimer: null,
      subscribeTimer: null,
      stopped: false,
      degraded: false,
    };

    const fire = (why) => {
      if (handle.stopped) return;
      clearTimeout(handle.debounceTimer);
      handle.debounceTimer = setTimeout(() => {
        if (handle.stopped) return;
        try {
          // onChange is async in practice; catch both sync throws and rejections
          // so a caller-side error can never surface as an unhandled rejection.
          Promise.resolve(onChange(why)).catch((e) =>
            reportError('onchange-failed', e?.message || e));
        } catch (e) {
          reportError('onchange-threw', e?.message || e);
        }
      }, DEBOUNCE_MS);
    };

    /** Degraded mode: poll instead of subscribing. Never more than one timer. */
    const startPolling = (why) => {
      if (handle.stopped || handle.pollTimer) return;
      handle.degraded = true;
      reportError(why, `falling back to a ${POLL_MS / 1000}s poll`);
      handle.pollTimer = setInterval(() => fire('poll'), POLL_MS);
    };

    // ── Realtime subscription ────────────────────────────────────────────
    //
    // INSERT and UPDATE are filtered server-side to this user's rows: the new
    // record carries every column, so `user_id=eq.<id>` matches.
    //
    // DELETE deliberately is NOT filtered. `calculation_history` has REPLICA
    // IDENTITY DEFAULT, so a delete's `old_record` contains ONLY the primary
    // key — `user_id` is simply not in the payload, and a filter on it can
    // therefore never match. Filtering DELETE would produce a subscription
    // that looks correct, connects cleanly, and silently drops every
    // cross-surface delete forever.
    //
    // We do still RECEIVE those deletes, because (per Supabase's Realtime
    // docs) "RLS policies are not applied to DELETE statements, because there
    // is no way for Postgres to verify that a user has access to a deleted
    // record." So the events arrive for every subscriber, carrying nothing but
    // a row id. We let the refetch sort it out: `onChange` re-reads through
    // RLS, so another user's delete costs us one redundant — and correctly
    // scoped — refetch, and discloses nothing.
    //
    // Setting the table to REPLICA IDENTITY FULL would make DELETE filterable,
    // at the cost of writing every column's old values to WAL on every write.
    // Not worth it at this table's size; revisit if delete traffic grows.
    const channelName = `calc-history:${userId}`;

    handle.channel = sb
      .channel(channelName)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: TABLE, filter: `user_id=eq.${userId}` },
        () => fire('insert'))
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: TABLE, filter: `user_id=eq.${userId}` },
        () => fire('update'))
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: TABLE },
        () => fire('delete'))
      .subscribe((status, err) => {
        if (handle.stopped) return;

        if (status === 'SUBSCRIBED') {
          clearTimeout(handle.subscribeTimer);
          console.log(`${LOG} live sync active for ${TABLE}`);
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(handle.subscribeTimer);
          startPolling(`realtime-${status.toLowerCase()}`);
          if (err) reportError('realtime-error-detail', err?.message || err);
        }
        // 'CLOSED' during teardown is expected and intentionally not reported.
      });

    // Belt and braces: if the subscribe callback never fires at all (the truly
    // silent failure — no error, no SUBSCRIBED), degrade anyway.
    handle.subscribeTimer = setTimeout(() => {
      if (!handle.stopped && !handle.degraded) startPolling('realtime-never-subscribed');
    }, SUBSCRIBE_TIMEOUT_MS);

    return handle;
  } catch (e) {
    // Absolute last resort. A sync failure must never take the page down again.
    reportError('start-failed', e?.message || e);
    return null;
  }
}

/**
 * Tear down a sync handle. Safe to call with null, undefined, a stale handle,
 * or twice — callers wire this to `beforeunload` and should never have to guard.
 */
export function stopCalcHistorySync(handle) {
  try {
    if (!handle || typeof handle !== 'object') return;
    handle.stopped = true;
    clearTimeout(handle.debounceTimer);
    clearTimeout(handle.subscribeTimer);
    clearInterval(handle.pollTimer);
    handle.pollTimer = null;
    if (handle.channel) {
      try {
        // Remove via the client the channel was actually created on — using the
        // shared client here would leave a channel from a caller-supplied
        // client subscribed forever.
        const client = handle.client || sharedClient;
        // removeChannel returns a promise; swallow rejection on a dying page.
        Promise.resolve(
          client?.removeChannel?.(handle.channel) ?? handle.channel.unsubscribe?.()
        ).catch(() => {});
      } catch { /* ignore */ }
      handle.channel = null;
    }
  } catch (e) {
    console.warn(`${LOG} stop failed (ignored)`, e);
  }
}

export default { startCalcHistorySync, stopCalcHistorySync };

/* persistence.js — Supabase-backed save/load for the Pro Workspace.
 *
 * Replaces the artifact's sessionStorage block with UPSERTs to attorney_workspaces
 * (one row per user, JSONB workspace_data, integer version). Uses last-write-wins
 * with an optimistic version check so concurrent device edits surface a conflict
 * the realtime layer can react to.
 *
 * Per the Apr 27 RLS-recursion incident in CLAUDE.md, this layer ALSO surfaces
 * read errors loudly. Silent fallback to "free tier" / empty workspace is the
 * exact failure mode that took down Pro on the website. We log with a sentinel
 * prefix and dispatch a CustomEvent so callers can render a toast.
 *
 * Globals consumed:
 *   - window.supa            — Supabase client (set by auth-module.js or shell)
 *   - window.workspaceUserId — current auth uid (set by shell once session known)
 */

(function () {
  'use strict';

  let _currentVersion = 0;
  let _lastError = null;

  // --- Session-integrity state (2026-07-30 silent-anon-degrade incident) ------
  // We proved a row exists for this user (loadWorkspace saw it, or we wrote it).
  // Once true, an "empty" SELECT can only mean the row went INVISIBLE to this
  // client — i.e. we are no longer authenticated as its owner. It must NEVER be
  // read as "first-time user, go INSERT".
  let _rowKnown = false;
  // Stale-local-version deadlock detector: if the remote version is NOT moving
  // but our guarded UPDATE keeps matching 0 rows, nobody else is writing and our
  // local counter is simply behind. Adopt + retry rather than deadlock forever.
  let _conflictStreak = 0;
  let _lastConflictRemote = null;
  let _authDead = false;

  function _log(level, code, ...rest) {
    const line = `[workspace] ${code}`;
    if (level === 'error') console.error(line, ...rest);
    else if (level === 'warn') console.warn(line, ...rest);
    else console.log(line, ...rest);
  }

  function _emit(eventName, detail) {
    try { window.dispatchEvent(new CustomEvent(eventName, { detail })); }
    catch (e) { /* SSR-shaped envs */ }
  }

  function getCurrentVersion() { return _currentVersion; }
  function getLastError()      { return _lastError; }
  function isAuthDead()        { return _authDead; }

  /**
   * Prove we still hold a LIVE session for window.workspaceUserId before we
   * touch PostgREST.
   *
   * Why this exists (2026-07-30): when the refresh token is rejected
   * (POST /auth/v1/token?grant_type=refresh_token → 400), supabase-js keeps
   * answering requests but with no Authorization header — so every call runs as
   * the `anon` role. Under RLS that is NOT an error: the SELECT just returns an
   * empty set (200, []) and the guarded UPDATE matches 0 rows (200, []). The old
   * code read "no row" as "first-time user" and fired an INSERT, which 401'd —
   * autosave died silently for the rest of the session while the header still
   * said "Pro · synced". Same failure shape as the Apr 27 RLS incident: a
   * permission failure wearing an empty-result costume.
   *
   * Returns the session, or null after emitting workspace:auth-expired.
   */
  async function _liveSession() {
    const supa = window.supa;
    const userId = window.workspaceUserId;
    if (!supa || !supa.auth || !userId) return null;

    let session = null;
    try {
      const { data } = await supa.auth.getSession();
      session = (data && data.session) || null;
    } catch (e) { session = null; }

    // getSession() refreshes an already-expired token itself; this catches the
    // about-to-expire window so a save can't race the expiry.
    if (session && session.expires_at &&
        (session.expires_at * 1000 - Date.now() < 30000)) {
      try {
        const { data, error } = await supa.auth.refreshSession();
        session = (!error && data && data.session) || null;
      } catch (e) { session = null; }
    }

    if (!session || !session.user || session.user.id !== userId) {
      if (!_authDead) {
        _authDead = true;
        _log('error', 'WORKSPACE_AUTH_EXPIRED',
          { expectedUser: userId, gotUser: session && session.user && session.user.id });
        _emit('workspace:auth-expired', { userId });
      }
      return null;
    }

    _authDead = false;
    return session;
  }

  /**
   * Load the current user's workspace. Returns the JSONB payload or null
   * (first-time user). Throws on real errors so the caller can decide how
   * to fail loudly — DO NOT swallow into "empty workspace".
   */
  async function loadWorkspace() {
    const supa = window.supa;
    if (!supa) throw new Error('WORKSPACE_LOAD_NO_CLIENT');
    const userId = window.workspaceUserId;
    if (!userId) throw new Error('WORKSPACE_LOAD_NO_USER');

    // Fail loud rather than handing back a plausible-looking empty workspace
    // that the next autosave would then try to persist over the real one.
    if (!(await _liveSession())) throw new Error('WORKSPACE_LOAD_AUTH_EXPIRED');

    const { data, error } = await supa
      .from('attorney_workspaces')
      .select('workspace_data, version')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      _lastError = error;
      _log('error', 'WORKSPACE_LOAD_FAILED', error);
      _emit('workspace:load-error', { error });
      throw error;
    }

    if (!data) { // first-time user — empty row will be created on first save
      _currentVersion = 0;
      _rowKnown = false;
      return null;
    }

    _currentVersion = data.version || 0;
    _rowKnown = true;
    _lastError = null;
    return data.workspace_data;
  }

  /**
   * Save (UPSERT) the user's workspace. Bumps the version monotonically
   * for optimistic concurrency. Returns { ok: true, version } on success;
   * { ok: false, conflict: true, remoteVersion } if the remote has moved
   * forward since we loaded; { ok: false, error } for everything else.
   */
  async function saveWorkspace(workspaceData) {
    const supa = window.supa;
    if (!supa) return { ok: false, error: new Error('WORKSPACE_SAVE_NO_CLIENT') };
    const userId = window.workspaceUserId;
    if (!userId) return { ok: false, error: new Error('WORKSPACE_SAVE_NO_USER') };

    // No live session → do not write. As `anon` every call below "succeeds"
    // with an empty result set and we'd mistake that for a first-time save.
    if (!(await _liveSession())) {
      _lastError = new Error('WORKSPACE_SAVE_AUTH_EXPIRED');
      _emit('workspace:save-error', { error: _lastError, authExpired: true });
      return { ok: false, authExpired: true, error: _lastError };
    }

    const newVersion = _currentVersion + 1;

    // Optimistic-concurrency UPSERT: if a row already exists, we only allow the
    // write when the existing version is exactly _currentVersion. We do this in
    // two phases so we can detect conflicts without a stored procedure.
    //
    // Phase 1: try UPDATE with version guard; if it returns 0 rows AND a row
    // exists, we hit a conflict. If it returns 0 rows AND no row exists, we
    // INSERT. If it returns 1 row, we're done.
    const { data: updRows, error: updErr } = await supa
      .from('attorney_workspaces')
      .update({
        workspace_data: workspaceData,
        version: newVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('version', _currentVersion)
      .select('version');

    if (updErr) {
      _lastError = updErr;
      _log('error', 'WORKSPACE_SAVE_FAILED', updErr);
      _emit('workspace:save-error', { error: updErr });
      return { ok: false, error: updErr };
    }

    if (updRows && updRows.length === 1) {
      _currentVersion = updRows[0].version;
      _rowKnown = true;
      _conflictStreak = 0;
      _lastConflictRemote = null;
      _lastError = null;
      _emit('workspace:saved', { version: _currentVersion });
      return { ok: true, version: _currentVersion };
    }

    // Either no row yet (first save) or version conflict — disambiguate.
    const { data: existing, error: selErr } = await supa
      .from('attorney_workspaces')
      .select('version')
      .eq('user_id', userId)
      .maybeSingle();

    if (selErr) {
      _lastError = selErr;
      _log('error', 'WORKSPACE_SAVE_VERSION_CHECK_FAILED', selErr);
      return { ok: false, error: selErr };
    }

    if (!existing && (_rowKnown || _currentVersion > 0)) {
      // We have SEEN this row this session, and now it is invisible. That is a
      // permission/identity failure (dead session, wrong user), never a
      // first-time save. Inserting here is how a half-authenticated tab
      // clobbers a real workspace — refuse, and say so out loud.
      _lastError = new Error('WORKSPACE_ROW_INVISIBLE');
      _log('error', 'WORKSPACE_ROW_INVISIBLE',
        { userId, localVersion: _currentVersion });
      _authDead = true;
      _emit('workspace:auth-expired', { userId, reason: 'row-invisible' });
      _emit('workspace:save-error', { error: _lastError, authExpired: true });
      return { ok: false, authExpired: true, error: _lastError };
    }

    if (!existing) {
      // First save — INSERT
      const { data: insRow, error: insErr } = await supa
        .from('attorney_workspaces')
        .insert({
          user_id: userId,
          workspace_data: workspaceData,
          version: newVersion,
        })
        .select('version')
        .single();

      if (insErr) {
        _lastError = insErr;
        _log('error', 'WORKSPACE_INSERT_FAILED', insErr);
        _emit('workspace:save-error', { error: insErr });
        return { ok: false, error: insErr };
      }
      _currentVersion = insRow.version;
      _rowKnown = true;
      _emit('workspace:saved', { version: _currentVersion });
      return { ok: true, version: _currentVersion };
    }

    // Version mismatch. Two very different causes share this shape:
    //   (a) another device really is writing — remote.version keeps MOVING;
    //   (b) our local counter went stale (missed realtime frame, sleep/wake,
    //       reconnect) — remote.version is FROZEN and every future save is
    //       guarded against a version that will never come back. That second
    //       case used to deadlock autosave for the rest of the session.
    // Distinguish them by watching whether the remote version moves.
    if (_lastConflictRemote === existing.version) {
      _conflictStreak += 1;
    } else {
      _conflictStreak = 1;
      _lastConflictRemote = existing.version;
    }

    if (_conflictStreak >= 3) {
      // Remote hasn't budged across three attempts — no competing writer.
      // Adopt the remote version and retry once so autosave self-heals.
      _log('warn', 'WORKSPACE_SAVE_VERSION_RESYNC',
        { local: _currentVersion, adopted: existing.version });
      _currentVersion = existing.version;
      _rowKnown = true;
      _conflictStreak = 0;
      _lastConflictRemote = null;
      return saveWorkspace(workspaceData);
    }

    // Real conflict: remote moved on without us.
    _log('warn', 'WORKSPACE_SAVE_CONFLICT',
      { local: _currentVersion, remote: existing.version });
    _emit('workspace:save-conflict', {
      localVersion: _currentVersion,
      remoteVersion: existing.version,
    });
    return { ok: false, conflict: true, remoteVersion: existing.version };
  }

  /**
   * Sync the lightweight attorney_cases index. One row per tab so the strip
   * can be queried without unpacking JSONB.
   * Strategy: delete-then-insert is racy in pure SQL but fine here because
   * all writes for a user are serialized through this single client.
   */
  async function syncCaseIndex(tabs) {
    const supa = window.supa;
    const userId = window.workspaceUserId;
    if (!supa || !userId) return;
    if (_authDead) return; // never fan out writes on a dead session

    try {
      await supa.from('attorney_cases').delete().eq('user_id', userId);
      const rows = (tabs || [])
        .filter(t => t.synced !== false) // free-tier locals are filtered out by caller
        .map((t, i) => ({
          user_id: userId,
          tab_id: t.id,
          title: t.name || t.clientName || 'New Case',
          client_name: t.clientName || null,
          wcb_number: t.wcbNumber || null,
          position: i,
          widget_count: Array.isArray(t.tiles) ? t.tiles.length : 0,
        }));
      if (rows.length > 0) {
        const { error } = await supa.from('attorney_cases').insert(rows);
        if (error) _log('warn', 'WORKSPACE_CASE_INDEX_FAILED', error);
      }
    } catch (e) {
      _log('warn', 'WORKSPACE_CASE_INDEX_EXCEPTION', e);
    }
  }

  // Expose
  window.WorkspacePersistence = {
    loadWorkspace,
    saveWorkspace,
    syncCaseIndex,
    getCurrentVersion,
    getLastError,
    isAuthDead,
    _setVersion(v) { _currentVersion = v || 0; _rowKnown = true; }, // sync.js, after remote reload
    // Called by the bootstrap when a fresh session arrives (sign-in in another
    // tab, token recovered) so a stuck workspace resumes saving without a
    // reload — which would throw away everything typed since the token died.
    _sessionRecovered() {
      _authDead = false;
      _conflictStreak = 0;
      _lastConflictRemote = null;
      _lastError = null;
    },
  };
})();

/* persistence.js — Supabase-backed save/load for the Pro Attorney Workspace.
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
      return null;
    }

    _currentVersion = data.version || 0;
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
      _emit('workspace:saved', { version: _currentVersion });
      return { ok: true, version: _currentVersion };
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
    _setVersion(v) { _currentVersion = v || 0; }, // for sync.js after remote reload
  };
})();

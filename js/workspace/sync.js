/* sync.js — realtime workspace sync via Supabase Realtime.
 *
 * Listens for UPDATE events on attorney_workspaces filtered to the current
 * user. When the remote version > our last-saved version we emit a
 * 'workspace:remote-change' CustomEvent with the new payload. The app
 * decides whether to silently reload (no local edits pending) or surface
 * a "Workspace updated on another device" toast (local edits pending).
 */

(function () {
  'use strict';

  let _channel = null;

  function startSync() {
    const supa = window.supa;
    const userId = window.workspaceUserId;
    if (!supa || !userId) return;
    if (_channel) return; // already subscribed

    _channel = supa
      .channel('attorney-workspace-' + userId)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'attorney_workspaces',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const remoteVersion = payload.new && payload.new.version;
          const localVersion = window.WorkspacePersistence
            ? window.WorkspacePersistence.getCurrentVersion()
            : 0;
          if (remoteVersion && remoteVersion > localVersion) {
            window.dispatchEvent(new CustomEvent('workspace:remote-change', {
              detail: {
                remoteVersion,
                workspace_data: payload.new.workspace_data,
              },
            }));
          }
        }
      )
      .subscribe();
  }

  function stopSync() {
    if (_channel) {
      try { window.supa.removeChannel(_channel); } catch (e) {}
      _channel = null;
    }
  }

  window.WorkspaceSync = { startSync, stopSync };
})();

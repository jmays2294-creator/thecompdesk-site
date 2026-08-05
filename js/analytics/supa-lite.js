/* ============================================================================
 * supa-lite.js — WEBSITE-ONLY PostgREST shim behind js/analytics/track.js.
 * ----------------------------------------------------------------------------
 * events.js / queue.js / track.js in this directory are byte-identical copies
 * of the app's www/js/analytics/* (the SSOT — re-copy wholesale to update,
 * never hand-edit them here). track.js expects a Supabase client at
 * window.CD.supa / window.supa; the cover page deliberately ships no
 * supabase-js, so this shim provides the two call shapes track.js actually
 * uses, over raw PostgREST:
 *
 *   supa.from(t).insert(rows)                        -> Promise<{error}>
 *   supa.from(t).select(cols).eq(c, v).maybeSingle() -> Promise<{data, error}>
 *
 * insert() uses fetch keepalive so a batch flushed by the segment picker's
 * click -> navigation still delivers after the page unloads. Load this
 * BEFORE track.js. If a page already provides a real client (window.supa /
 * CD.supa), this file is a no-op.
 * ==========================================================================*/
(function () {
  'use strict';
  if ((window.CD && window.CD.supa) || window.supa) return;

  var URL = 'https://ltibymvlytodkemdeeox.supabase.co';
  var KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0aWJ5bXZseXRvZGtlbWRlZW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjA1NjYsImV4cCI6MjA5MDM5NjU2Nn0.b5oQqQIdgJRc0DEP2k7kMVdCRzfyfnuAwjVNZlbVyak';

  function from(table) {
    return {
      insert: function (rows) {
        return fetch(URL + '/rest/v1/' + table, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            'apikey': KEY,
            'Authorization': 'Bearer ' + KEY,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(rows)
        }).then(function (r) {
          return { error: r.ok ? null : { status: r.status } };
        }, function (e) {
          return { error: e };
        });
      },
      select: function (cols) {
        var params = ['select=' + encodeURIComponent(cols || '*')];
        var chain = {
          eq: function (col, val) {
            params.push(encodeURIComponent(col) + '=eq.' + encodeURIComponent(val));
            return chain;
          },
          maybeSingle: function () {
            return fetch(URL + '/rest/v1/' + table + '?' + params.join('&'), {
              headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY }
            }).then(function (r) { return r.ok ? r.json() : []; })
              .then(function (rows) {
                return { data: (rows && rows[0]) || null, error: null };
              }, function (e) {
                return { data: null, error: e };
              });
          }
        };
        return chain;
      }
    };
  }

  window.supa = { from: from };
})();

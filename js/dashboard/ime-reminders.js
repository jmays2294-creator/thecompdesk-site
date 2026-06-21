// ime-reminders.js — IME Reminder scheduling, Supabase CRUD, offline cache
// The Comp Desk — Phase C Feature 2
(function() {
'use strict';
window.CD = window.CD || {};

// ─── REMINDER OFFSETS ───
const REMINDER_OFFSETS = [
  { label: '1 week',  ms: 7 * 24 * 60 * 60 * 1000, title: 'IME in 1 Week',  bodyPrefix: 'on ' },
  { label: '1 day',   ms: 1 * 24 * 60 * 60 * 1000, title: 'IME Tomorrow',   bodyPrefix: '' },
  { label: '2 hours', ms: 2 * 60 * 60 * 1000,       title: 'IME in 2 Hours', bodyPrefix: '' }
];

// ─── HELPERS ───
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0; // 32-bit int
  }
  return hash;
}

function generateNotificationId(imeId, reminderIndex) {
  return Math.abs(hashCode(imeId + '-' + reminderIndex)) % 2147483647;
}

function buildReminderBody(label, ime) {
  const dt = new Date(ime.ime_date || ime.dateTime);
  const dateStr = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const caseStr = ime.case_number ? ' (Case: ' + ime.case_number + ')' : '';
  const doctorStr = ime.doctor_name ? ' with ' + ime.doctor_name : '';
  if (label === '1 week') {
    return 'Your IME is on ' + dateStr + ' at ' + timeStr + doctorStr + '. Location: ' + ime.address + '.' + caseStr + ' Start preparing now.';
  } else if (label === '1 day') {
    return 'Your IME is tomorrow at ' + timeStr + doctorStr + '. Location: ' + ime.address + '.' + caseStr + " Don't forget to bring your ID.";
  } else {
    return 'Your IME is at ' + timeStr + ' at ' + ime.address + '.' + doctorStr + caseStr + ' Tap for directions.';
  }
}

// ─── PLUGIN AVAILABILITY CHECK ───
// Capacitor injects native plugins on window.Capacitor.Plugins. This app loads JS
// via plain <script> tags (no bundler / import map), so a bare-specifier
// import('@capacitor/...') cannot resolve inside the WebView and silently rejects —
// which left IME native notifications quietly broken on device. Resolve off
// window.Capacitor.Plugins instead (same fix as revenuecat-module.js). (Jun 18 2026)
// Kept async so existing `await get*()` call sites are unaffected.
async function getLocalNotifications() {
  const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
  if (!LN) {
    console.warn('LocalNotifications plugin not available on window.Capacitor.Plugins');
    return null;
  }
  return LN;
}

async function getCapacitor() {
  // Capacitor core is exposed as a UMD global on window — no import needed.
  return window.Capacitor || null;
}

async function getPreferences() {
  const Prefs = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
  if (!Prefs) {
    console.warn('Preferences plugin not available on window.Capacitor.Plugins');
    return null;
  }
  return Prefs;
}

// ─── WEB NOTIFICATIONS SEAM ───
// The native app schedules true background local notifications via the Capacitor
// LocalNotifications plugin. The browser can't fire reliable background local
// notifications, so on the web we degrade GRACEFULLY but never silently:
//   • request the browser Notification permission,
//   • arm FOREGROUND timers (fire while the dashboard tab is open),
//   • always surface in-dashboard countdown badges + reminder dots (the render
//     UI below) so a reminder is never lost even if notifications are blocked.
// The 3 reminder offsets are still persisted in Supabase (notification_ids),
// exactly like the native path, so eCase/sync logic is identical.
function webNotifySupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}
// setTimeout caps at a 32-bit ms delay (~24.8 days); skip arming beyond that.
var MAX_TIMER_MS = 2147483000;
var _webTimers = {}; // notifId -> timeout handle (foreground only)

async function requestWebNotificationPermission() {
  if (!webNotifySupported()) return 'unavailable';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const res = await Notification.requestPermission();
    return res || Notification.permission;
  } catch (e) {
    // Older Safari uses the callback form.
    try { return await new Promise(function (r) { Notification.requestPermission(r); }); }
    catch (e2) { return Notification.permission; }
  }
}

function fireWebNotification(title, body, ime) {
  if (!webNotifySupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body: body, tag: 'ime-' + (ime && ime.id), badge: undefined });
    n.onclick = function () { try { window.focus(); } catch (e) {} if (ime && ime.address) openDirections(ime.address); n.close(); };
  } catch (e) { /* notification construction can throw on some browsers */ }
}

// Arm foreground timers for an IME's still-future reminder offsets. Returns the
// deterministic notification ids (same as the native path) for persistence.
function scheduleWebReminders(ime) {
  const now = Date.now();
  const imeDate = new Date(ime.ime_date || ime.dateTime).getTime();
  const ids = [];
  for (let i = 0; i < REMINDER_OFFSETS.length; i++) {
    const offset = REMINDER_OFFSETS[i];
    const fireAt = imeDate - offset.ms;
    const delay = fireAt - now;
    if (delay <= 0) continue;
    const id = generateNotificationId(ime.id, i);
    ids.push(id);
    if (delay < MAX_TIMER_MS) {
      if (_webTimers[id]) clearTimeout(_webTimers[id]);
      _webTimers[id] = setTimeout(function () {
        fireWebNotification(offset.title, buildReminderBody(offset.label, ime), ime);
        delete _webTimers[id];
      }, delay);
    }
  }
  return ids;
}

function cancelWebReminders(notificationIds) {
  (notificationIds || []).forEach(function (id) {
    if (_webTimers[id]) { clearTimeout(_webTimers[id]); delete _webTimers[id]; }
  });
}

// ─── NOTIFICATION PERMISSION ───
async function checkNotificationPermission() {
  const LN = await getLocalNotifications();
  if (!LN) {
    // Web path — fail loud, not silent: 'unsupported' is distinct from 'denied'
    // so the UI can explain that reminders show as in-app countdowns instead.
    if (!webNotifySupported()) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    return requestWebNotificationPermission();
  }
  const Cap = await getCapacitor();
  // iOS auto-grants for local notifications
  if (Cap && Cap.getPlatform() === 'ios') return 'granted';
  try {
    const perms = await LN.checkPermissions();
    if (perms.display === 'granted') return 'granted';
    const result = await LN.requestPermissions();
    return result.display;
  } catch (e) {
    console.error('Permission check failed:', e);
    return 'denied';
  }
}

// ─── REGISTER ACTION TYPES (call on app init) ───
async function registerIMEActionTypes() {
  const LN = await getLocalNotifications();
  if (!LN) return;
  try {
    await LN.registerActionTypes({
      types: [{
        id: 'IME_REMINDER',
        actions: [
          { id: 'directions', title: 'Get Directions' },
          { id: 'dismiss', title: 'Dismiss', destructive: true }
        ]
      }]
    });
  } catch (e) {
    console.warn('Failed to register action types:', e);
  }
}

// ─── ACTION LISTENER ───
async function setupActionListener() {
  const LN = await getLocalNotifications();
  if (!LN) return;
  try {
    LN.addListener('localNotificationActionPerformed', (action) => {
      if (action.actionId === 'directions') {
        const address = action.notification.extra && action.notification.extra.address;
        if (address) openDirections(address);
      }
    });
  } catch (e) {
    console.warn('Failed to set up action listener:', e);
  }
}

// ─── DIRECTIONS ───
function openDirections(address) {
  const encoded = encodeURIComponent(address);
  const Cap = window.Capacitor;
  if (Cap && Cap.getPlatform() === 'ios') {
    window.open('maps://maps.apple.com/?daddr=' + encoded);
  } else {
    window.open('https://www.google.com/maps/dir/?api=1&destination=' + encoded, '_blank');
  }
}

// ─── SCHEDULE NOTIFICATIONS ───
async function scheduleIMEReminders(ime) {
  const LN = await getLocalNotifications();
  if (!LN) {
    // Web path — arm foreground timers + return the deterministic ids so they
    // persist to Supabase exactly like native. Reminders also always surface as
    // in-dashboard countdowns (render UI), so nothing is silently dropped.
    if (webNotifySupported() && Notification.permission !== 'granted') {
      try { await requestWebNotificationPermission(); } catch (e) {}
    }
    return scheduleWebReminders(ime);
  }
  // Check permissions (Android 13+)
  const perm = await checkNotificationPermission();
  if (perm !== 'granted' && perm !== 'unavailable') {
    console.warn('Notification permission not granted');
    return [];
  }

  const now = Date.now();
  const imeDate = new Date(ime.ime_date || ime.dateTime).getTime();
  const notifications = [];

  for (let i = 0; i < REMINDER_OFFSETS.length; i++) {
    const offset = REMINDER_OFFSETS[i];
    const fireTime = new Date(imeDate - offset.ms);
    if (fireTime.getTime() > now) {
      notifications.push({
        id: generateNotificationId(ime.id, i),
        title: offset.title,
        body: buildReminderBody(offset.label, ime),
        schedule: { at: fireTime, allowWhileIdle: true },
        actionTypeId: 'IME_REMINDER',
        extra: {
          imeId: ime.id,
          address: ime.address,
          caseNumber: ime.case_number || '',
          doctorName: ime.doctor_name || ''
        }
      });
    }
  }

  if (notifications.length > 0) {
    try {
      await LN.schedule({ notifications });
    } catch (e) {
      console.error('Failed to schedule notifications:', e);
      return [];
    }
  }
  return notifications.map(n => n.id);
}

// ─── CANCEL NOTIFICATIONS ───
async function cancelIMEReminders(notificationIds) {
  if (!notificationIds || !notificationIds.length) return;
  const LN = await getLocalNotifications();
  if (!LN) { cancelWebReminders(notificationIds); return; }
  try {
    await LN.cancel({
      notifications: notificationIds.map(id => ({ id }))
    });
  } catch (e) {
    console.error('Failed to cancel notifications:', e);
  }
}

// ─── RESCHEDULE ───
async function rescheduleIME(ime, oldIds) {
  await cancelIMEReminders(oldIds);
  return scheduleIMEReminders(ime);
}

// ─── APP LAUNCH SYNC ───
async function syncIMEReminders() {
  if (!CD.currentUser) return;
  const LN = await getLocalNotifications();
  if (!LN) {
    // Web path — foreground timers don't survive a reload, so re-arm them for
    // every upcoming IME each time the dashboard loads.
    try {
      const imes = await getUpcomingIMEs();
      for (const ime of imes) scheduleWebReminders(ime);
    } catch (e) { console.error('syncIMEReminders (web) failed:', e); }
    return;
  }

  try {
    const imes = await getUpcomingIMEs();
    const pending = await LN.getPending();
    const pendingIds = new Set((pending.notifications || []).map(n => n.id));

    for (const ime of imes) {
      const expectedIds = ime.notification_ids || [];
      const missing = expectedIds.filter(id => !pendingIds.has(id));
      if (missing.length > 0 || expectedIds.length === 0) {
        // Reschedule all for this IME
        const newIds = await scheduleIMEReminders(ime);
        if (newIds.length > 0) {
          await updateIMENotificationIds(ime.id, newIds);
        }
      }
    }
  } catch (e) {
    console.error('syncIMEReminders failed:', e);
  }
}

// ─── SUPABASE CRUD ───
// Platform seam: the app shell sets window._supabase / CD.supabase; the website
// dashboard host sets CD.supa. Resolve from whichever is present so the single
// source in www/js/ persists on both surfaces.
function getSupabase() {
  return window._supabase || (window.CD && (CD.supa || CD.supabase)) || null;
}

async function addIME(imeData) {
  const sb = getSupabase();
  if (!sb || !CD.currentUser) return { error: 'Not authenticated' };

  const row = {
    user_id: CD.currentUser.id,
    case_number: imeData.caseNumber || null,
    ime_date: imeData.dateTime,
    address: imeData.address,
    doctor_name: imeData.doctorName || null,
    notes: imeData.notes || null,
    status: 'upcoming'
  };

  const { data, error } = await sb.from('ime_events').insert(row).select().single();
  if (error) return { error: error.message };

  // Schedule notifications
  const notifIds = await scheduleIMEReminders(data);
  if (notifIds.length > 0) {
    await sb.from('ime_events').update({ notification_ids: notifIds }).eq('id', data.id);
    data.notification_ids = notifIds;
  }

  // Update cache
  await refreshIMECache();
  return { data };
}

async function updateIME(id, updates) {
  const sb = getSupabase();
  if (!sb || !CD.currentUser) return { error: 'Not authenticated' };

  updates.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('ime_events').update(updates).eq('id', id).select().single();
  if (error) return { error: error.message };

  // If date changed, reschedule
  if (updates.ime_date) {
    const oldIds = data.notification_ids || [];
    await cancelIMEReminders(oldIds);
    const newIds = await scheduleIMEReminders(data);
    await sb.from('ime_events').update({ notification_ids: newIds }).eq('id', id);
    data.notification_ids = newIds;
  }

  await refreshIMECache();
  return { data };
}

async function deleteIME(id) {
  const sb = getSupabase();
  if (!sb || !CD.currentUser) return { error: 'Not authenticated' };

  // Get current data to cancel notifications
  const { data: existing } = await sb.from('ime_events').select('notification_ids').eq('id', id).single();
  if (existing && existing.notification_ids) {
    await cancelIMEReminders(existing.notification_ids);
  }

  const { error } = await sb.from('ime_events').delete().eq('id', id);
  if (error) return { error: error.message };

  await refreshIMECache();
  return { success: true };
}

async function updateIMEStatus(id, status) {
  return updateIME(id, { status });
}

async function updateIMENotificationIds(id, notifIds) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('ime_events').update({ notification_ids: notifIds }).eq('id', id);
}

async function getUpcomingIMEs() {
  const sb = getSupabase();
  if (!sb || !CD.currentUser) {
    // Fall back to cache
    return getCachedIMEs().filter(e => e.status === 'upcoming');
  }
  try {
    const { data, error } = await sb
      .from('ime_events')
      .select('*')
      .eq('user_id', CD.currentUser.id)
      .eq('status', 'upcoming')
      .gte('ime_date', new Date().toISOString())
      .order('ime_date', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('getUpcomingIMEs failed:', e);
    return getCachedIMEs().filter(ev => ev.status === 'upcoming');
  }
}

async function getPastIMEs() {
  const sb = getSupabase();
  if (!sb || !CD.currentUser) {
    return getCachedIMEs().filter(e => e.status !== 'upcoming' || new Date(e.ime_date) <= new Date());
  }
  try {
    const { data, error } = await sb
      .from('ime_events')
      .select('*')
      .eq('user_id', CD.currentUser.id)
      .or('status.neq.upcoming,ime_date.lte.' + new Date().toISOString())
      .order('ime_date', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('getPastIMEs failed:', e);
    return getCachedIMEs().filter(ev => ev.status !== 'upcoming');
  }
}

async function getAllIMEs() {
  const sb = getSupabase();
  if (!sb || !CD.currentUser) return getCachedIMEs();
  try {
    const { data, error } = await sb
      .from('ime_events')
      .select('*')
      .eq('user_id', CD.currentUser.id)
      .order('ime_date', { ascending: true });
    if (error) throw error;
    // Update cache
    cacheIMEs(data || []);
    return data || [];
  } catch (e) {
    console.error('getAllIMEs failed:', e);
    return getCachedIMEs();
  }
}

// ─── OFFLINE CACHE (Capacitor Preferences or localStorage fallback) ───
let _imeCache = null;

async function cacheIMEs(events) {
  _imeCache = events;
  const Prefs = await getPreferences();
  const json = JSON.stringify(events);
  if (Prefs) {
    try { await Prefs.set({ key: 'ime_events', value: json }); } catch {}
  } else if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem('cd_ime_events', json); } catch {}
  }
}

function getCachedIMEs() {
  if (_imeCache) return _imeCache;
  // Try localStorage fallback (Preferences needs async)
  if (typeof localStorage !== 'undefined') {
    try {
      const val = localStorage.getItem('cd_ime_events');
      if (val) { _imeCache = JSON.parse(val); return _imeCache; }
    } catch {}
  }
  return [];
}

async function loadIMECache() {
  const Prefs = await getPreferences();
  if (Prefs) {
    try {
      const { value } = await Prefs.get({ key: 'ime_events' });
      if (value) { _imeCache = JSON.parse(value); return _imeCache; }
    } catch {}
  }
  return getCachedIMEs();
}

async function refreshIMECache() {
  if (!CD.currentUser) return;
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { data } = await sb.from('ime_events').select('*').eq('user_id', CD.currentUser.id).order('ime_date', { ascending: true });
    if (data) cacheIMEs(data);
  } catch {}
}

// ─── COUNTDOWN HELPERS ───
function getCountdown(imeDate) {
  const now = Date.now();
  const target = new Date(imeDate).getTime();
  const diff = target - now;
  if (diff <= 0) return 'Past';
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 1) return 'In ' + days + ' days';
  if (days === 1) return 'Tomorrow';
  if (hrs >= 1) return 'In ' + hrs + ' hour' + (hrs !== 1 ? 's' : '');
  return 'In ' + mins + ' min' + (mins !== 1 ? 's' : '');
}

function getReminderStatuses(ime) {
  const imeTime = new Date(ime.ime_date).getTime();
  const now = Date.now();
  return REMINDER_OFFSETS.map((offset, i) => {
    const fireTime = imeTime - offset.ms;
    if (fireTime <= 0) return 'skipped';       // IME date was too close at creation
    if (fireTime <= now) return 'fired';        // Already fired
    return 'scheduled';                          // Still pending
  });
}

function getSkippedRemindersMessage(ime) {
  const imeTime = new Date(ime.ime_date).getTime();
  const now = Date.now();
  const diff = imeTime - now;
  if (diff <= 2 * 60 * 60 * 1000) return 'IME is very soon — no reminders scheduled';
  if (diff <= 24 * 60 * 60 * 1000) return '1-week and 1-day reminders skipped (IME is less than 1 day away)';
  if (diff <= 7 * 24 * 60 * 60 * 1000) return '1-week reminder skipped (IME is less than 7 days away)';
  return null;
}

function formatIMEDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatIMETime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ─── INIT (call on app launch) ───
async function initIMEReminders() {
  await loadIMECache();
  await registerIMEActionTypes();
  await setupActionListener();
  // Sync on launch
  if (CD.currentUser) {
    setTimeout(() => syncIMEReminders(), 2000); // Slight delay to let Supabase init
  }
}

// ─── IN-MEMORY STATE FOR UI ───
// Track which view the IME screen is on
if (!window._imeView) window._imeView = 'list'; // 'list' | 'add' | 'edit'
if (!window._imeEditId) window._imeEditId = null;
if (!window._imeForm) window._imeForm = { dateTime: '', address: '', caseNumber: '', doctorName: '', notes: '' };
if (!window._imeLoaded) window._imeLoaded = false;
if (!window._imeData) window._imeData = null;
if (!window._imePastOpen) window._imePastOpen = false;

function resetIMEForm() {
  window._imeForm = { dateTime: '', address: '', caseNumber: '', doctorName: '', notes: '' };
}

/* ============================================================================
 * render(ctx) — self-contained IME Reminders UI (web + native parity)
 * ----------------------------------------------------------------------------
 * Authored ONCE here and vendored to the website by sync-dashboard.sh. The
 * native app keeps its in-shell screen (ui-controller.js renderIMEReminders);
 * this render() is what the website dashboard host mounts in-place for
 * showScreen('ime' | 'appointments'). Supabase CRUD + the notification seam
 * (native LocalNotifications vs browser Notifications + foreground timers +
 * countdown badges) live in the data layer above. Reminders are NEVER silently
 * dropped — countdowns + reminder dots always render.
 *
 * ctx (all optional):  supabase, user, profile, isNative, toast
 * ========================================================================== */
function _imeEl(tag, attrs, children) {
  var n = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (k) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k === 'text') n.textContent = attrs[k];
    else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  });
  (children || []).forEach(function (c) {
    if (c == null) return;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return n;
}

function ensureIMEStyles() {
  if (document.getElementById('cd-ime-styles')) return;
  var css = [
    '.cd-ime{--im-card:#1a1d28;--im-card2:#252836;--im-bd:#2e3145;--im-tx:#e8eaed;--im-tx2:#9ba1b0;--im-mut:#6b7280;--im-ac:#3b82f6;--im-acl:rgba(59,130,246,.15);--im-rd:#ef4444;--im-gn:#22c55e;--im-wn:#f59e0b;color:var(--im-tx);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.5}',
    '.cd-ime *{box-sizing:border-box}',
    '.cd-ime .im-title{font-size:18px;font-weight:700;margin:0 0 2px}',
    '.cd-ime .im-sub{font-size:13px;color:var(--im-tx2);margin:0 0 14px}',
    '.cd-ime .im-add{width:100%;padding:13px;background:var(--im-ac);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:14px;font-family:inherit}',
    '.cd-ime .im-perm{background:var(--im-acl);border:1px solid rgba(59,130,246,.3);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:13px;color:var(--im-tx2)}',
    '.cd-ime .im-perm.warn{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.3)}',
    '.cd-ime .im-perm button{margin-top:8px;background:var(--im-ac);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}',
    '.cd-ime .im-sec-title{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--im-mut);margin:6px 2px 8px;font-weight:700}',
    '.cd-ime .im-card{background:var(--im-card);border:1px solid var(--im-bd);border-radius:12px;padding:14px;margin-bottom:10px}',
    '.cd-ime .im-card.past{opacity:.7}',
    '.cd-ime .im-card-hd{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}',
    '.cd-ime .im-date{font-size:15px;font-weight:700;color:var(--im-tx)}',
    '.cd-ime .im-time{font-size:13px;color:var(--im-tx2)}',
    '.cd-ime .im-cd{font-size:12px;font-weight:700;color:var(--im-ac);background:var(--im-acl);padding:3px 10px;border-radius:12px;white-space:nowrap}',
    '.cd-ime .im-badge{font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;text-transform:capitalize}',
    '.cd-ime .im-badge.completed{background:rgba(34,197,94,.15);color:var(--im-gn)}',
    '.cd-ime .im-badge.missed{background:rgba(239,68,68,.15);color:var(--im-rd)}',
    '.cd-ime .im-badge.cancelled{background:rgba(107,114,128,.2);color:var(--im-mut)}',
    '.cd-ime .im-det{font-size:13px;color:var(--im-tx2);margin-top:8px;line-height:1.6}',
    '.cd-ime .im-det b{color:var(--im-tx);font-weight:600}',
    '.cd-ime .im-skip{font-size:11px;color:var(--im-wn);margin-top:8px}',
    '.cd-ime .im-foot{display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:8px;flex-wrap:wrap}',
    '.cd-ime .im-dots{display:flex;gap:6px}',
    '.cd-ime .im-dot{width:9px;height:9px;border-radius:50%;background:var(--im-bd)}',
    '.cd-ime .im-dot.scheduled{background:var(--im-ac)}',
    '.cd-ime .im-dot.fired{background:var(--im-gn)}',
    '.cd-ime .im-dot.skipped{background:var(--im-mut)}',
    '.cd-ime .im-acts{display:flex;gap:6px;flex-wrap:wrap}',
    '.cd-ime .im-btn{padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--im-bd);background:var(--im-card2);color:var(--im-tx);font-family:inherit}',
    '.cd-ime .im-btn.danger{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.3);color:var(--im-rd)}',
    '.cd-ime .im-btn.ok{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.3);color:var(--im-gn)}',
    '.cd-ime .im-field{margin-bottom:12px}',
    '.cd-ime .im-label{display:block;font-size:12px;font-weight:600;color:var(--im-tx2);margin-bottom:5px}',
    '.cd-ime .im-input,.cd-ime textarea.im-input{width:100%;padding:11px 12px;background:var(--im-card2);border:1px solid var(--im-bd);border-radius:8px;color:var(--im-tx);font-size:15px;font-family:inherit;-webkit-appearance:none}',
    '.cd-ime textarea.im-input{resize:vertical;min-height:70px}',
    '.cd-ime .im-input:focus{outline:none;border-color:var(--im-ac)}',
    '.cd-ime .im-submit{width:100%;padding:13px;background:var(--im-ac);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;margin-top:6px;font-family:inherit}',
    '.cd-ime .im-submit:disabled{opacity:.5;cursor:not-allowed}',
    '.cd-ime .im-err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#fca5a5;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:10px}',
    '.cd-ime .im-prev{background:var(--im-card);border:1px solid var(--im-bd);border-radius:10px;padding:12px;margin-bottom:10px}',
    '.cd-ime .im-prev-row{display:flex;align-items:center;gap:10px;padding:5px 0}',
    '.cd-ime .im-empty{text-align:center;color:var(--im-mut);font-size:13px;padding:26px 16px;line-height:1.6}',
    '.cd-ime .im-back{background:none;border:none;color:var(--im-ac);font-size:13px;cursor:pointer;padding:4px 0;margin-bottom:8px;font-family:inherit}',
    '.cd-ime .im-prep{margin-top:16px}',
    '.cd-ime .im-prep .im-card-title{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--im-mut);font-weight:700;margin-bottom:8px}',
    '.cd-ime .im-prep-item{font-size:13px;color:var(--im-tx2);padding:3px 0}',
    '.cd-ime .im-disc{font-size:11px;color:var(--im-mut);text-align:center;padding:14px 8px;line-height:1.6}'
  ].join('\n');
  var s = document.createElement('style');
  s.id = 'cd-ime-styles';
  s.textContent = css;
  document.head.appendChild(s);
}

function renderIMEReminders(ctx) {
  ctx = ctx || {};
  ensureIMEStyles();
  if (ctx.supabase && !(window.CD && (CD.supa || CD.supabase)) && !window._supabase) CD.supa = ctx.supabase;
  if (ctx.user && !CD.currentUser) CD.currentUser = ctx.user;

  var isNative = !!ctx.isNative || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  var st = { view: 'list', data: null, loaded: false, editId: null, pastOpen: false,
    form: { dateTime: '', address: '', caseNumber: '', doctorName: '', notes: '' } };

  function toast(msg) {
    if (typeof ctx.toast === 'function') { try { ctx.toast(msg); return; } catch (e) {} }
    try { alert(msg); } catch (e) {}
  }

  var root = _imeEl('div', { class: 'cd-ime' });
  function rebuild() {
    root.innerHTML = '';
    if (st.view === 'add') { root.appendChild(buildForm(false)); return; }
    if (st.view === 'edit') { root.appendChild(buildForm(true)); return; }
    root.appendChild(buildList());
  }

  // ---- permission banner (web only) ----
  function buildPermBanner() {
    if (isNative) return null;
    if (!webNotifySupported()) {
      return _imeEl('div', { class: 'im-perm warn' }, [
        'Your browser doesn’t support notifications. Your reminders are still tracked here as live countdowns — check this page before each IME.'
      ]);
    }
    if (Notification.permission === 'granted') return null;
    if (Notification.permission === 'denied') {
      return _imeEl('div', { class: 'im-perm warn' }, [
        'Notifications are blocked in your browser. Reminders show here as countdowns; enable notifications in your browser settings to get pop-up alerts while this tab is open.'
      ]);
    }
    var banner = _imeEl('div', { class: 'im-perm' }, ['Get pop-up reminders before your IME (while this tab is open).']);
    banner.appendChild(_imeEl('button', {
      onclick: function () {
        requestWebNotificationPermission().then(function () {
          // Re-arm timers for upcoming IMEs now that permission may be granted.
          (st.data || []).filter(function (e) { return e.status === 'upcoming' && new Date(e.ime_date) > new Date(); })
            .forEach(function (e) { scheduleWebReminders(e); });
          rebuild();
        });
      }
    }, ['Enable reminders']));
    return banner;
  }

  // ---- list view ----
  function buildList() {
    var frag = document.createDocumentFragment();
    frag.appendChild(_imeEl('div', { class: 'im-title', text: 'IME Reminders' }));
    frag.appendChild(_imeEl('div', { class: 'im-sub', text: 'Track your Independent Medical Exams and get reminded before each one.' }));

    frag.appendChild(_imeEl('button', {
      class: 'im-add', onclick: function () { resetIMEForm(); st.form = { dateTime: '', address: '', caseNumber: '', doctorName: '', notes: '' }; st.view = 'add'; rebuild(); }
    }, ['+  Schedule New IME']));

    if (!CD.currentUser) {
      frag.appendChild(_imeEl('div', { class: 'im-empty', text: 'Sign in to schedule and track your IME appointments.' }));
      return frag;
    }

    var pb = buildPermBanner();
    if (pb) frag.appendChild(pb);

    if (!st.loaded) {
      frag.appendChild(_imeEl('div', { class: 'im-empty', text: 'Loading…' }));
      getAllIMEs().then(function (data) { st.data = data || []; st.loaded = true; rebuild(); });
      return frag;
    }

    var all = st.data || [];
    var now = new Date();
    var upcoming = all.filter(function (e) { return e.status === 'upcoming' && new Date(e.ime_date) > now; });
    var past = all.filter(function (e) { return e.status !== 'upcoming' || new Date(e.ime_date) <= now; });

    if (upcoming.length === 0 && past.length === 0) {
      frag.appendChild(_imeEl('div', { class: 'im-empty', html: '🔔<br>No IME appointments scheduled yet.<br><span style="font-size:11px;color:#6b7280">Tap the button above to add your first IME.</span>' }));
    } else {
      if (upcoming.length) {
        frag.appendChild(_imeEl('div', { class: 'im-sec-title', text: 'Upcoming (' + upcoming.length + ')' }));
        upcoming.forEach(function (ime) { frag.appendChild(imeCard(ime, false)); });
      }
      if (past.length) {
        frag.appendChild(_imeEl('div', { class: 'im-sec-title', text: 'Past (' + past.length + ')' }));
        var head = _imeEl('button', { class: 'im-back', onclick: function () { st.pastOpen = !st.pastOpen; rebuild(); } }, [st.pastOpen ? '▲ Hide past IMEs' : '▼ Show past IMEs']);
        frag.appendChild(head);
        if (st.pastOpen) past.forEach(function (ime) { frag.appendChild(imeCard(ime, true)); });
      }
    }

    frag.appendChild(buildPrep());
    frag.appendChild(_imeEl('div', { class: 'im-disc', text: 'This reminder is for informational purposes only. Always confirm your IME appointment details directly with the scheduling party.' }));
    return frag;
  }

  function imeCard(ime, isPast) {
    var card = _imeEl('div', { class: 'im-card' + (isPast ? ' past' : '') });
    var hd = _imeEl('div', { class: 'im-card-hd' });
    var col = _imeEl('div');
    col.appendChild(_imeEl('div', { class: 'im-date', text: formatIMEDate(ime.ime_date) }));
    col.appendChild(_imeEl('div', { class: 'im-time', text: formatIMETime(ime.ime_date) }));
    hd.appendChild(col);
    if (!isPast) {
      hd.appendChild(_imeEl('div', { class: 'im-cd', text: getCountdown(ime.ime_date) }));
    } else {
      var status = ime.status === 'upcoming' ? 'missed' : ime.status;
      hd.appendChild(_imeEl('span', { class: 'im-badge ' + status, text: status }));
    }
    card.appendChild(hd);

    var det = _imeEl('div', { class: 'im-det' });
    if (ime.doctor_name) det.appendChild(_imeEl('div', { html: '<b>Doctor:</b> ' + escIME(ime.doctor_name) }));
    det.appendChild(_imeEl('div', { html: '<b>Location:</b> ' + escIME(ime.address) }));
    if (ime.case_number) det.appendChild(_imeEl('div', { html: '<b>Case:</b> ' + escIME(ime.case_number) }));
    card.appendChild(det);

    if (!isPast) {
      var skip = getSkippedRemindersMessage(ime);
      if (skip) card.appendChild(_imeEl('div', { class: 'im-skip', text: skip }));
    }

    var foot = _imeEl('div', { class: 'im-foot' });
    if (!isPast) {
      var dots = _imeEl('div', { class: 'im-dots' });
      var statuses = getReminderStatuses(ime);
      var labels = ['1wk', '1d', '2hr'];
      statuses.forEach(function (s, i) { dots.appendChild(_imeEl('div', { class: 'im-dot ' + s, title: labels[i] + ': ' + s })); });
      foot.appendChild(dots);
      var acts = _imeEl('div', { class: 'im-acts' });
      acts.appendChild(_imeEl('button', { class: 'im-btn', onclick: function () { openDirections(ime.address); } }, ['Directions']));
      acts.appendChild(_imeEl('button', { class: 'im-btn', onclick: function () {
        st.editId = ime.id;
        st.form = { dateTime: ime.ime_date ? ime.ime_date.slice(0, 16) : '', address: ime.address || '', caseNumber: ime.case_number || '', doctorName: ime.doctor_name || '', notes: ime.notes || '' };
        st.view = 'edit'; rebuild();
      } }, ['Edit']));
      acts.appendChild(_imeEl('button', { class: 'im-btn danger', onclick: function () {
        if (!confirm('Delete this IME appointment?')) return;
        deleteIME(ime.id).then(function () { st.loaded = false; st.data = null; rebuild(); });
      } }, ['Delete']));
      foot.appendChild(acts);
    } else if (ime.status === 'upcoming') {
      // past-due but never marked — offer a status update
      var marks = _imeEl('div', { class: 'im-acts' });
      marks.appendChild(_imeEl('button', { class: 'im-btn ok', onclick: function () { updateIMEStatus(ime.id, 'completed').then(function () { st.loaded = false; st.data = null; rebuild(); }); } }, ['Attended']));
      marks.appendChild(_imeEl('button', { class: 'im-btn danger', onclick: function () { updateIMEStatus(ime.id, 'missed').then(function () { st.loaded = false; st.data = null; rebuild(); }); } }, ['Missed']));
      marks.appendChild(_imeEl('button', { class: 'im-btn', onclick: function () { updateIMEStatus(ime.id, 'cancelled').then(function () { st.loaded = false; st.data = null; rebuild(); }); } }, ['Cancelled']));
      foot.appendChild(marks);
    }
    card.appendChild(foot);
    return card;
  }

  // ---- add / edit form ----
  function buildForm(isEdit) {
    var frag = document.createDocumentFragment();
    frag.appendChild(_imeEl('button', { class: 'im-back', onclick: function () { st.view = 'list'; st.editId = null; resetIMEForm(); rebuild(); } }, ['← Back']));
    frag.appendChild(_imeEl('div', { class: 'im-title', text: isEdit ? 'Edit IME' : 'Add IME' }));

    var f = st.form;
    var card = _imeEl('div', { class: 'im-card' });
    function field(label, input) { return _imeEl('div', { class: 'im-field' }, [_imeEl('label', { class: 'im-label', text: label }), input]); }

    var dt = _imeEl('input', { type: 'datetime-local', class: 'im-input', value: f.dateTime || '' });
    dt.addEventListener('change', function () { f.dateTime = dt.value; rebuild(); });
    card.appendChild(field('Date & Time *', dt));

    var addr = _imeEl('input', { type: 'text', class: 'im-input', placeholder: '123 Main St, Brooklyn, NY 11201', value: f.address || '' });
    addr.addEventListener('input', function () { f.address = addr.value; });
    addr.addEventListener('change', function () { f.address = addr.value; rebuild(); });
    card.appendChild(field('Address *', addr));

    var cn = _imeEl('input', { type: 'text', class: 'im-input', placeholder: 'G1234567 (optional)', value: f.caseNumber || '' });
    cn.addEventListener('input', function () { f.caseNumber = cn.value; });
    card.appendChild(field('Case Number', cn));

    var dn = _imeEl('input', { type: 'text', class: 'im-input', placeholder: 'Dr. Smith (optional)', value: f.doctorName || '' });
    dn.addEventListener('input', function () { f.doctorName = dn.value; });
    card.appendChild(field('Doctor Name', dn));

    var nt = _imeEl('textarea', { class: 'im-input', placeholder: 'Any notes about this appointment (optional)' });
    nt.value = f.notes || '';
    nt.addEventListener('input', function () { f.notes = nt.value; });
    card.appendChild(field('Notes', nt));
    frag.appendChild(card);

    var imeDate = f.dateTime ? new Date(f.dateTime) : null;
    var valid = !!(f.dateTime && f.address && imeDate && imeDate > new Date());
    if (imeDate && imeDate <= new Date()) frag.appendChild(_imeEl('div', { class: 'im-err', text: 'IME date must be in the future.' }));
    if (valid) frag.appendChild(buildPreview(imeDate));

    var btn = _imeEl('button', { class: 'im-submit', disabled: valid ? null : '' }, [isEdit ? 'Save Changes' : 'Schedule Reminders']);
    btn.addEventListener('click', function () {
      btn.disabled = true; btn.textContent = isEdit ? 'Saving…' : 'Scheduling…';
      var done = function (result) {
        if (result && result.error) { btn.disabled = false; btn.textContent = isEdit ? 'Save Changes' : 'Schedule Reminders'; toast('Error: ' + result.error); return; }
        st.view = 'list'; st.editId = null; st.loaded = false; st.data = null; resetIMEForm(); rebuild();
      };
      if (isEdit) {
        updateIME(st.editId, { ime_date: f.dateTime, address: f.address, case_number: f.caseNumber || null, doctor_name: f.doctorName || null, notes: f.notes || null }).then(done);
      } else {
        addIME({ dateTime: f.dateTime, address: f.address, caseNumber: f.caseNumber, doctorName: f.doctorName, notes: f.notes }).then(done);
      }
    });
    frag.appendChild(btn);
    frag.appendChild(_imeEl('div', { class: 'im-disc', text: 'This reminder is for informational purposes only. Always confirm your IME appointment details directly with the scheduling party.' }));
    return frag;
  }

  function buildPreview(imeDate) {
    var now = Date.now(), target = imeDate.getTime();
    var prev = _imeEl('div', { class: 'im-prev' }, [_imeEl('div', { class: 'im-sec-title', text: 'Scheduled reminders' })]);
    var scheduled = 0;
    REMINDER_OFFSETS.forEach(function (offset) {
      var fireTime = target - offset.ms;
      var willFire = fireTime > now;
      var fd = new Date(fireTime);
      var row = _imeEl('div', { class: 'im-prev-row' });
      row.appendChild(_imeEl('div', { class: 'im-dot ' + (willFire ? 'scheduled' : 'skipped') }));
      var info = _imeEl('div');
      info.appendChild(_imeEl('div', { style: 'font-size:13px;font-weight:600', text: offset.title }));
      info.appendChild(_imeEl('div', { style: 'font-size:12px;color:#9ba1b0', text: willFire ? (fd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' at ' + fd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })) : 'Skipped (too close)' }));
      row.appendChild(info);
      prev.appendChild(row);
      if (willFire) scheduled++;
    });
    if (scheduled === 0) prev.appendChild(_imeEl('div', { class: 'im-skip', text: 'IME is very soon — no reminders will be scheduled. The appointment will still be tracked.' }));
    return prev;
  }

  function buildPrep() {
    var sec = _imeEl('div', { class: 'im-prep' });
    var card = _imeEl('div', { class: 'im-card' }, [_imeEl('div', { class: 'im-card-title', text: 'What to bring' })]);
    ['Photo ID', 'Insurance card', 'Medical records', 'Medications list', 'Doctor’s letters', 'Notepad and pen'].forEach(function (item) {
      card.appendChild(_imeEl('div', { class: 'im-prep-item', text: '• ' + item }));
    });
    sec.appendChild(card);
    return sec;
  }

  function escIME(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  rebuild();
  return root;
}

// ─── EXPORTS ───
CD.IME = {
  REMINDER_OFFSETS,
  addIME,
  updateIME,
  deleteIME,
  updateIMEStatus,
  getUpcomingIMEs,
  getPastIMEs,
  getAllIMEs,
  scheduleIMEReminders,
  cancelIMEReminders,
  rescheduleIME,
  syncIMEReminders,
  openDirections,
  checkNotificationPermission,
  initIMEReminders,
  getCountdown,
  getReminderStatuses,
  getSkippedRemindersMessage,
  formatIMEDate,
  formatIMETime,
  resetIMEForm,
  refreshIMECache,
  hashCode,
  generateNotificationId,
  requestWebNotificationPermission,
  webNotifySupported,
  render: renderIMEReminders
};

// Top-level alias mirroring CD.renderFindDoctor / CD.renderJobBuddy so the web
// dashboard host can mount this screen the same way as the others.
CD.renderIMEReminders = renderIMEReminders;

})();

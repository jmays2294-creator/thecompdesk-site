/* feeapp.js — OC-400.1 (Application for Fee by Claimant's Attorney)
 * generator for the Pro Attorney Workspace.  v1.2.2.
 *
 * v1.2.2 — Profile cache flow
 * ---------------------------
 * Each user can store up to 3 attorney/firm profile caches in
 * public.oc400_profiles (RLS owner-only, max-3 enforced by trigger).
 * Triggering the fee app now branches on the cache count:
 *
 *   0 profiles → IntakeWizard (seeded from public.profiles)
 *                → save → FeeAppModal pre-filled
 *   1 profile  → FeeAppModal pre-filled directly (no chooser friction)
 *   2-3        → ProfileChooser → pick → FeeAppModal pre-filled
 *
 * Inside the FeeAppModal, the user can "Switch profile" (re-opens chooser)
 * or "Edit / Add" (opens wizard in edit / create mode).
 *
 * v1.2.1 features (unchanged)
 * ---------------------------
 * Hard-coded OC400_FIELD_MAP keyed off the actual XFA field names; signature
 * image overlaid on the page-2 signature line rect; persistFeeApp() against
 * the existing fee_applications schema.
 */

(function () {
  'use strict';

  const { useState, useEffect, useRef, useMemo } = React;

  const PDF_LIB_URL = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  const TEMPLATE_URL = '/assets/forms/OC-400.1.pdf';
  const MAX_PROFILES = 3;

  // ------------------------------------------------------------------
  // OC-400.1 field map (hard-coded; verified against the WCB 1-23 PDF)
  // ------------------------------------------------------------------
  const OC400_FIELD_MAP = {
    'F[0].P1[0].#area[0].WCBCaseNos[0]':         'wcbNumber',
    'F[0].P1[0].#area[0].ClaimantsName[0]':      'claimantName',
    'F[0].P1[0].#area[0].RepresentativeIDNo[0]': 'attorneyId',
    'F[0].P1[0].#area[0].DateRetained[0]':       'dateRetained',
    'F[0].P1[0].TextField2[0]':                  'firmName',           // 'I, [firm], a duly retained attorney…'
    'F[0].P1[0].TextField2[1]':                  'feeRequestedDollar',
    'F[0].P1[0].FeeRequestExplanation[0]':       'feeEquation',
    'F[0].P1[0].OtherText[0]':                   'otherReasonText',     // text next to 'Other' checkbox
    'F[0].P2[0].WCBCaseNo[0]':                   'wcbNumber',
    'F[0].P2[0].ClaimantsName[0]':               'claimantName',
    'F[0].P2[0].TextField2[1]':                  'firmName',            // Print Name = firm
    // P2.TextField2[0] (signature line) — REMOVED. The visual signature
    // image is drawn on its rect via SIGNATURE_RECT_PAGE2; no typed name.
    'F[0].P2[0].TextField2[4]':                  'dateSubmitted',
    'F[0].P2[0].TextField2[2]':                  'attorneyAddress',
    'F[0].P2[0].TextField2[3]':                  'attorneyPhone',
  };

  // Date fields that need YYYY-MM-DD → MM/DD/YYYY conversion before fill.
  const OC400_DATE_KEYS = new Set(['dateRetained', 'dateSubmitted']);

  // Section B checkbox group → modal context key. Each group is mutually
  // exclusive; we check exactly one of the names per group, based on the
  // user's radio selection in the modal.
  const OC400_SECTION_B_GROUPS = {
    // Are you the claimant's CURRENT attorney, OR were you SUBSTITUTED FOR?
    currentRole: { current: 'AreYou', substituted: 'WereYou' },
    // Has the claimant previously retained any other attorney/rep?
    priorRetained: { yes: 'RetainedYes', no: 'RetainedNo' },
    // Have you served or been served a Notice of Substitution?
    servedNotice: { yes: 'ServedYes', no: 'ServedNo', na: 'ServedNA' },
    // Aware of any fee requests from other attorneys/reps?
    otherFees: { yes: 'OtherFeeYes', no: 'OtherFeeNo', na: 'OtherFeeNA' },
  };
  const SIGNATURE_RECT_PAGE2 = { x: 261, y: 690, width: 218, height: 30 };

  // ------------------------------------------------------------------
  // Checkbox rects (PDF coords, ~9×9 pt boxes). All on page 1.
  // pdf-lib's PDFCheckBox.check() doesn't render reliably on this XFA
  // form — getFields() returns generic PDFField instances rather than
  // PDFCheckBox subclasses, so .check() is undefined and the box stays
  // empty. We draw a 2-stroke X via drawLine() at the rect instead.
  // ------------------------------------------------------------------
  const CHECKBOX_RECTS = {
    // § A fee reasons (left margin column)
    FeeReason1:     { page: 0, x: 59,  y: 533, w: 9, h: 9 },  // continuation TT/TR
    FeeReason2:     { page: 0, x: 59,  y: 506, w: 9, h: 9 },  // increase prior period
    FeeReason3:     { page: 0, x: 59,  y: 477, w: 9, h: 9 },  // SLU / facial disfigurement
    FeeReason4:     { page: 0, x: 59,  y: 447, w: 9, h: 9 },  // perm total / non-schedule PPD
    FeeReason5:     { page: 0, x: 59,  y: 419, w: 9, h: 9 },  // death benefits §16
    FeeReason6:     { page: 0, x: 59,  y: 397, w: 9, h: 9 },  // §32 settlement
    FeeReasonOther: { page: 0, x: 59,  y: 376, w: 9, h: 9 },  // other (with OtherText input)
    // § B substitution + other-fee questions
    AreYou:         { page: 0, x: 95,  y: 178, w: 9, h: 9 },  // current attorney
    WereYou:        { page: 0, x: 349, y: 178, w: 9, h: 9 },  // were substituted for
    RetainedYes:    { page: 0, x: 402, y: 155, w: 9, h: 9 },
    RetainedNo:     { page: 0, x: 440, y: 155, w: 9, h: 9 },
    ServedYes:      { page: 0, x: 298, y: 135, w: 9, h: 9 },
    ServedNo:       { page: 0, x: 336, y: 135, w: 9, h: 9 },
    ServedNA:       { page: 0, x: 375, y: 135, w: 9, h: 9 },
    OtherFeeYes:    { page: 0, x: 426, y: 112, w: 9, h: 9 },
    OtherFeeNo:     { page: 0, x: 464, y: 112, w: 9, h: 9 },
    OtherFeeNA:     { page: 0, x: 503, y: 112, w: 9, h: 9 },
  };

  // Draw a 2-stroke X centered in the rect with a small inset so the
  // strokes don't run over the box border.
  function drawCheckMark(page, rect) {
    const { rgb } = window.PDFLib;
    const inset = 1.4;
    const x1 = rect.x + inset;
    const y1 = rect.y + inset;
    const x2 = rect.x + rect.w - inset;
    const y2 = rect.y + rect.h - inset;
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1.4, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: x1, y: y2 }, end: { x: x2, y: y1 }, thickness: 1.4, color: rgb(0, 0, 0) });
  }

  // Build the set of checkbox names we should mark — from tile-derived
  // feeReasons, manual extras (death/other), and Section B group radios.
  function buildCheckSet(ctx) {
    const set = new Set();
    (ctx.feeReasons || []).forEach(r => r && set.add(r));
    if (ctx.deathBenefits) set.add('FeeReason5');
    if (ctx.otherReasonChecked) set.add('FeeReasonOther');
    Object.entries(OC400_SECTION_B_GROUPS).forEach(([groupKey, opts]) => {
      const choice = ctx[groupKey];
      if (choice && opts[choice]) set.add(opts[choice]);
    });
    return set;
  }


  // ------------------------------------------------------------------
  // sanitizeText — pdf-lib's StandardFonts use WinAnsi (codepage 1252)
  // which can't encode U+2212 (math minus) and a handful of other
  // common Unicode chars that the workspace's equation builder emits
  // for visual polish. Map the ones we know about to WinAnsi-safe
  // equivalents BEFORE the string hits pdf-lib (form.setText, drawText,
  // metadata, etc.). U+2014 em-dash IS preserved (WinAnsi has it at 0x97).
  // ------------------------------------------------------------------
  function sanitizeText(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/\u2212/g, '-')   // − minus sign
      .replace(/\u2013/g, '-')   // – en-dash
      .replace(/\u2010/g, '-')   // ‐ Unicode hyphen
      .replace(/\u2018/g, "'")   // ' left single quote
      .replace(/\u2019/g, "'")   // ' right single quote
      .replace(/\u201C/g, '"')   // " left double quote
      .replace(/\u201D/g, '"')   // " right double quote
      .replace(/\u2026/g, '...') // … ellipsis
      .replace(/\u00A0/g, ' ');  // non-breaking space
  }

  // formatDateMDY — workspace dates come from <input type="date"> as
  // YYYY-MM-DD; the OC-400.1 form expects MM/DD/YYYY. Pure string
  // transform — no Date() to avoid timezone shifts for date-only values.
  function formatDateMDY(s) {
    if (!s) return '';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(s);
    return `${m[2]}/${m[3]}/${m[1]}`;
  }

  // stripRPrefix — the OC-400.1 form pre-prints 'R-' before the
  // RepresentativeIDNo input area, so the user's stored value
  // 'R-12345' would render as 'R- R-12345'. Accept any leading R/r
  // followed by optional dash/whitespace, drop it, return the rest.
  function stripRPrefix(s) {
    return String(s || '').trim().replace(/^[Rr][\-\s]*/, '').trim();
  }


  // floor5(n) — round dollars DOWN to nearest $5. Used for the
  // auto-populated "Fee Requested" field. Joel's spec: "the fee
  // requested should automatically generate the nearest $5 number
  // below the eligible fee." So $4,876.32 → $4,875; $5,000 → $5,000.
  function floor5(x) {
    const v = Number(x);
    if (!isFinite(v) || v <= 0) return '';
    return Math.floor(v / 5) * 5;
  }

  // ------------------------------------------------------------------
  // Supabase helpers
  // ------------------------------------------------------------------
  function getSupa() { return window.supa; }
  function getUserId() { return window.workspaceUserId; }

  async function listProfiles() {
    const supa = getSupa(); const userId = getUserId();
    if (!supa || !userId) return [];
    const { data, error } = await supa
      .from('oc400_profiles')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) { console.warn('[feeapp] listProfiles failed:', error); return []; }
    return data || [];
  }

  async function createProfile(profile) {
    const supa = getSupa(); const userId = getUserId();
    if (!supa || !userId) return { ok: false, reason: 'no-client' };
    const { data, error } = await supa
      .from('oc400_profiles')
      .insert({ ...profile, user_id: userId })
      .select()
      .single();
    if (error) return { ok: false, reason: error.message };
    return { ok: true, profile: data };
  }

  async function updateProfile(id, patch) {
    const supa = getSupa();
    if (!supa) return { ok: false, reason: 'no-client' };
    const { data, error } = await supa
      .from('oc400_profiles')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return { ok: false, reason: error.message };
    return { ok: true, profile: data };
  }

  async function deleteProfile(id) {
    const supa = getSupa();
    if (!supa) return { ok: false, reason: 'no-client' };
    const { error } = await supa.from('oc400_profiles').delete().eq('id', id);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  }

  // Fallback seed for first-time users — pulls from public.profiles.
  async function loadProfileSeed() {
    try {
      const supa = getSupa(); const userId = getUserId();
      if (!supa || !userId) return {};
      const { data } = await supa
        .from('profiles')
        .select('full_name, display_name, firm_name, firm_address, phone')
        .eq('id', userId)
        .maybeSingle();
      if (!data) return {};
      return {
        attorney_name:    data.full_name || data.display_name || '',
        attorney_address: data.firm_address || '',
        attorney_phone:   data.phone || '',
        firm_name:        data.firm_name || '',
      };
    } catch (e) { return {}; }
  }

  // Map a stored profile row → the modal's context shape
  function profileToCtx(profile) {
    if (!profile) return {};
    return {
      attorneyName:      profile.attorney_name    || '',
      attorneyId:        profile.attorney_id      || '',
      attorneyPhone:     profile.attorney_phone   || '',
      attorneyAddress:   profile.attorney_address || '',
      firmName:          profile.firm_name        || '',
      signatureDataUrl:  profile.signature_data_url || '',
    };
  }

  // ------------------------------------------------------------------
  // pdf-lib loader
  // ------------------------------------------------------------------
  let _pdfLibPromise = null;
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (_pdfLibPromise) return _pdfLibPromise;
    _pdfLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDF_LIB_URL;
      s.onload = () => window.PDFLib ? resolve(window.PDFLib) : reject(new Error('pdf-lib loaded but PDFLib global missing'));
      s.onerror = () => reject(new Error('Failed to load pdf-lib'));
      document.head.appendChild(s);
    });
    return _pdfLibPromise;
  }

  // ------------------------------------------------------------------
  // Signature canvas (HiDPI, mouse + touch + pen)
  // ------------------------------------------------------------------
  function SignatureCanvas({ onChange, initialDataUrl }) {
    const canvasRef = useRef(null);
    const drawingRef = useRef(false);
    const lastRef = useRef({ x: 0, y: 0 });
    const dirtyRef = useRef(false);

    useEffect(() => {
      const c = canvasRef.current;
      if (!c) return;
      const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        const rect = c.getBoundingClientRect();
        c.width = Math.round(rect.width * dpr);
        c.height = Math.round(rect.height * dpr);
        const ctx = c.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = 2; ctx.strokeStyle = '#0a0f1a';
      };
      resize();
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }, []);

    const getPoint = (e) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    };
    const start = (e) => { e.preventDefault(); drawingRef.current = true; lastRef.current = getPoint(e); };
    const move = (e) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      const ctx = canvasRef.current.getContext('2d');
      const p = getPoint(e);
      ctx.beginPath(); ctx.moveTo(lastRef.current.x, lastRef.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      lastRef.current = p;
      if (!dirtyRef.current) { dirtyRef.current = true; onChange?.(true); }
    };
    const end = () => { drawingRef.current = false; };
    const clear = () => {
      const c = canvasRef.current;
      const ctx = c.getContext('2d');
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
      dirtyRef.current = false; onChange?.(false);
    };

    useEffect(() => {
      if (!canvasRef.current) return;
      canvasRef.current.__getSignaturePNG = () => dirtyRef.current ? canvasRef.current.toDataURL('image/png') : null;
      canvasRef.current.__clearSignature = clear;
    }, []);

    // Paint a stored signature onto the canvas when one is provided.
    // Runs after the resize() useEffect so the canvas is sized correctly.
    // Marks dirty=true so the parent's must-sign gate passes immediately.
    useEffect(() => {
      if (!initialDataUrl || !canvasRef.current) return;
      const c = canvasRef.current;
      const img = new Image();
      img.onload = () => {
        // Canvas transform is dpr-scaled in resize(); draw in CSS px.
        const rect = c.getBoundingClientRect();
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        dirtyRef.current = true;
        onChange?.(true);
      };
      img.src = initialDataUrl;
    }, [initialDataUrl]);

    return (
      <div className="feeapp-sig-canvas-wrap">
        <canvas ref={canvasRef} className="feeapp-sig-canvas"
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end}/>
        <div className="feeapp-sig-actions">
          <span>Sign above using mouse, pen, or finger.</span>
          <button type="button" className="btn tiny ghost" onClick={clear}>Clear</button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Form fill + PDF generation
  // ------------------------------------------------------------------
  function fillFormFromMap(form, ctx) {
    const fields = form.getFields();
    const filled = []; const missed = [];

    for (const f of fields) {
      const name = f.getName();
      const ctxKey = OC400_FIELD_MAP[name];
      if (!ctxKey) continue;
      let value = ctx[ctxKey];
      if (value === undefined || value === null || value === '') continue;

      // Date conversion: YYYY-MM-DD → MM/DD/YYYY
      if (OC400_DATE_KEYS.has(ctxKey)) value = formatDateMDY(value);

      // Strip leading 'R-' from attorney_id — form pre-prints 'R-' as
      // static text before the input area, so filling 'R-12345' would
      // produce 'R- R-12345' on the rendered PDF.
      if (ctxKey === 'attorneyId') value = stripRPrefix(value);

      try {
        if (typeof f.setText === 'function') { f.setText(sanitizeText(value)); filled.push({ name, ctxKey }); }
      } catch (e) { missed.push({ name, ctxKey, error: String(e) }); }
    }
    return { filled, missed };
  }

  // Render X marks for every checkbox in `checkSet` by drawing two
  // diagonal lines at the rect on the right page. Also tries the
  // pdf-lib CheckBox.check() API as a soft attempt — but the X overlay
  // is the bulletproof path on this XFA form.
  function drawCheckSet(form, pdfDoc, checkSet) {
    const pages = pdfDoc.getPages();
    const checked = []; const noRect = [];
    for (const name of checkSet) {
      // Soft attempt: pdf-lib typed CheckBox API (no-op on failure)
      try { form.getCheckBox(name).check(); } catch (e) { /* ignore */ }

      // Bulletproof: draw X at the rect coordinates
      const rect = CHECKBOX_RECTS[name];
      if (!rect) { noRect.push(name); continue; }
      const page = pages[rect.page];
      if (!page) { noRect.push(name); continue; }
      drawCheckMark(page, rect);
      checked.push(name);
    }
    return { checked, noRect };
  }

  async function renderFromScratch(ctx, pdfDoc, sigPngBytes) {
    const { StandardFonts, rgb } = window.PDFLib;
    const page = pdfDoc.addPage([612, 792]);
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const margin = 50;
    let y = 762;
    const draw = (text, opts = {}) => {
      const font = opts.bold ? helvB : helv;
      const size = opts.size || 11;
      page.drawText(sanitizeText(String(text || '')), { x: opts.x ?? margin, y: opts.y ?? y, size, font, color: rgb(0, 0, 0) });
      if (opts.y === undefined) y -= (opts.lh || size + 4);
    };
    const hr = (gap = 8) => { y -= gap; page.drawLine({ start: { x: margin, y }, end: { x: 612 - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) }); y -= gap; };
    draw('NEW YORK STATE WORKERS\' COMPENSATION BOARD', { bold: true, size: 13 });
    draw('OC-400.1 — Application for Fee by Claimant\'s Attorney', { bold: true, size: 11 });
    draw('DRAFT — generated by The Comp Desk Pro Workspace', { size: 9 });
    hr();
    draw('Case Identifiers', { bold: true, size: 12 });
    draw(`Claimant:          ${ctx.claimantName || '—'}`);
    draw(`WCB #:             ${ctx.wcbNumber || '—'}`);
    draw(`Date Retained:     ${ctx.dateRetained || '—'}`);
    draw(`Representative ID: ${ctx.attorneyId || '—'}`);
    hr();
    draw('Fee Request', { bold: true, size: 12 });
    draw(`Amount Requested:  ${ctx.feeRequestedDollar ? '$' + ctx.feeRequestedDollar : '—'}`);
    draw('Basis:');
    for (const ln of (ctx.feeEquation || '').split('\n').slice(0, 8)) draw('  ' + ln, { size: 10 });
    hr();
    draw('Attorney / Representative', { bold: true, size: 12 });
    draw(`Name:    ${ctx.attorneyName || '—'}`);
    draw(`Firm:    ${ctx.firmName || '—'}`);
    draw(`Address: ${ctx.attorneyAddress || '—'}`);
    draw(`Phone:   ${ctx.attorneyPhone || '—'}`);
    hr();
    draw('Signature', { bold: true, size: 12 });
    if (sigPngBytes) {
      const sigImg = await pdfDoc.embedPng(sigPngBytes);
      const sigW = 220;
      const sigH = sigW * (sigImg.height / sigImg.width);
      page.drawImage(sigImg, { x: margin, y: y - sigH, width: sigW, height: sigH });
      y -= (sigH + 8);
    }
    page.drawLine({ start: { x: margin, y }, end: { x: margin + 240, y }, thickness: 0.5, color: rgb(0, 0, 0) });
    y -= 14;
    draw(`Signed: ${ctx.dateSubmitted || new Date().toISOString().slice(0, 10)}`, { size: 10 });
    page.drawText(sanitizeText('This is a Comp Desk-generated draft. Replace with the official OC-400.1 form template before submission.'),
      { x: margin, y: 30, size: 8, font: helv, color: rgb(0.5, 0.5, 0.5) });
  }

  async function generatePdf(ctx, sigPngDataUrl) {
    const PDFLib = await loadPdfLib();
    const { PDFDocument } = PDFLib;
    let sigPngBytes = null;
    if (sigPngDataUrl) {
      const base64 = sigPngDataUrl.split(',')[1];
      const bin = atob(base64);
      sigPngBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) sigPngBytes[i] = bin.charCodeAt(i);
    }
    let pdfDoc = null; let usedTemplate = false; let fillReport = null;
    try {
      const r = await fetch(TEMPLATE_URL, { cache: 'force-cache' });
      if (r.ok) { const buf = await r.arrayBuffer(); pdfDoc = await PDFDocument.load(buf); usedTemplate = true; }
    } catch (e) {}
    if (!pdfDoc) pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(sanitizeText(`OC-400.1 — ${ctx.claimantName || 'Fee Application'}`));
    pdfDoc.setAuthor(sanitizeText(ctx.attorneyName || 'The Comp Desk'));
    pdfDoc.setProducer(sanitizeText('The Comp Desk Pro Workspace'));
    if (usedTemplate) {
      try {
        const form = pdfDoc.getForm();
        fillReport = fillFormFromMap(form, ctx);
        // Draw X marks for every checkbox that should be checked. Runs
        // BEFORE form.flatten() so the strokes are baked into the page.
        const checkSet = buildCheckSet(ctx);
        const checkReport = drawCheckSet(form, pdfDoc, checkSet);
        fillReport.checked = checkReport.checked;
        fillReport.noRect  = checkReport.noRect;
        if (sigPngBytes) {
          const sigImg = await pdfDoc.embedPng(sigPngBytes);
          const pages = pdfDoc.getPages();
          const page2 = pages[1] || pages[pages.length - 1];
          const r = SIGNATURE_RECT_PAGE2;
          const imgRatio = sigImg.height / sigImg.width;
          let sigW = r.width; let sigH = sigW * imgRatio;
          if (sigH > r.height) { sigH = r.height; sigW = sigH / imgRatio; }
          page2.drawImage(sigImg, { x: r.x, y: r.y, width: sigW, height: sigH });
        }
        try { form.flatten(); } catch (e) {}
      } catch (e) { console.warn('[feeapp] AcroForm fill failed', e); usedTemplate = false; }
    }
    if (!usedTemplate) await renderFromScratch(ctx, pdfDoc, sigPngBytes);
    const bytes = await pdfDoc.save();
    return { bytes, usedTemplate, fillReport };
  }

  async function persistFeeApp(ctx, pdfBytes, meta) {
    try {
      const supa = getSupa(); const userId = getUserId();
      if (!supa || !userId) return { ok: false, reason: 'no-client' };
      const caseName = ctx.caseName || ctx.claimantName || ctx.wcbNumber || 'OC-400.1';
      const feeAmount = ctx.feeRequestedDollar
        ? Number(String(ctx.feeRequestedDollar).replace(/[^0-9.\-]/g, ''))
        : null;
      const calcData = {
        doi: ctx.doi || null, aww: ctx.aww || null,
        fee_equation: ctx.feeEquation || null,
        attorney_name: ctx.attorneyName || null, attorney_id: ctx.attorneyId || null,
        attorney_phone: ctx.attorneyPhone || null, attorney_address: ctx.attorneyAddress || null,
        firm_name: ctx.firmName || null,
        date_retained: ctx.dateRetained || null, date_submitted: ctx.dateSubmitted || null,
        used_template: !!meta?.usedTemplate, fill_report: meta?.fillReport || null,
        pdf_byte_length: pdfBytes ? pdfBytes.length : null,
        profile_id: ctx._profileId || null,
      };
      const row = {
        user_id: userId, case_name: caseName, wcb_case_number: ctx.wcbNumber || null,
        claimant_name: ctx.claimantName || null, fee_amount: feeAmount,
        calculator_type: 'oc-400.1', calculation_data: calcData,
      };
      const { error } = await supa.from('fee_applications').insert(row);
      if (error) return { ok: false, reason: error.message };
      return { ok: true };
    } catch (e) { return { ok: false, reason: String(e) }; }
  }

  // ==================================================================
  // IntakeWizard — create or edit a profile cache
  // ==================================================================
  function IntakeWizard({ initial, profileCount, onSave, onCancel, isEdit }) {
    const [p, setP] = useState({
      label:              initial?.label              || '',
      attorney_name:      initial?.attorney_name      || '',
      attorney_id:        initial?.attorney_id        || '',
      attorney_phone:     initial?.attorney_phone     || '',
      attorney_address:   initial?.attorney_address   || '',
      firm_name:          initial?.firm_name          || '',
      signature_data_url: initial?.signature_data_url || '',
    });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    // First-time wizard: seed from public.profiles
    useEffect(() => {
      if (isEdit) return;
      let cancelled = false;
      loadProfileSeed().then(seed => {
        if (cancelled) return;
        setP(prev => ({
          ...prev,
          attorney_name:    prev.attorney_name    || seed.attorney_name    || '',
          attorney_address: prev.attorney_address || seed.attorney_address || '',
          attorney_phone:   prev.attorney_phone   || seed.attorney_phone   || '',
          firm_name:        prev.firm_name        || seed.firm_name        || '',
        }));
      });
      return () => { cancelled = true; };
    }, [isEdit]);

    const set = (patch) => setP(c => ({ ...c, ...patch }));

    const onSubmit = async () => {
      if (!p.label.trim()) { setErr('Profile label is required (e.g. "Personal" or your firm name).'); return; }
      setBusy(true); setErr('');
      try {
        // Capture signature if user drew one. The canvas exposes
        // __getSignaturePNG which returns null when nothing was drawn —
        // in edit mode we keep the existing sig (initial.signature_data_url);
        // in create mode an unsigned profile saves with NULL signature.
        const sigEl = document.querySelector('.feeapp-wizard-sig .feeapp-sig-canvas');
        const drawnSig = sigEl?.__getSignaturePNG?.() || null;
        const payload = {
          ...p,
          signature_data_url: drawnSig || (isEdit ? (initial.signature_data_url || null) : null),
        };
        const result = isEdit
          ? await updateProfile(initial.id, payload)
          : await createProfile(payload);
        if (!result.ok) { setErr('Save failed: ' + result.reason); setBusy(false); return; }
        onSave(result.profile);
      } catch (e) { setErr(String(e)); setBusy(false); }
    };

    const titleText = isEdit
      ? `Edit profile — ${initial.label}`
      : (profileCount === 0 ? 'Set up your attorney profile' : 'Add a new profile');
    const subText = isEdit
      ? 'Update the autofill values for this profile cache.'
      : (profileCount === 0
          ? 'First time generating an OC-400.1. Save your firm + attorney info once and we\'ll pre-fill it on every fee app from now on. You can save up to 3 profiles (e.g. solo + two firms).'
          : `You have ${profileCount}/${MAX_PROFILES} profiles saved. Add another to switch between firms.`);

    return (
      <div className="feeapp-modal-backdrop">
        <div className="feeapp-modal" role="dialog" aria-labelledby="feeapp-wiz-title">
          <h3 id="feeapp-wiz-title">{titleText}</h3>
          <div className="sub">{subText}</div>

          <div className="feeapp-fields">
            <div className="f-group">
              <label className="f-label">Profile label *</label>
              <input className="f-input" value={p.label}
                onChange={e => set({ label: e.target.value })}
                placeholder="e.g. Personal · Shulman & Hill · Smith firm"/>
            </div>
            <div className="row2">
              <div className="f-group">
                <label className="f-label">Attorney Name</label>
                <input className="f-input" value={p.attorney_name}
                  onChange={e => set({ attorney_name: e.target.value })}/>
              </div>
              <div className="f-group">
                <label className="f-label">Representative ID (R-#)</label>
                <input className="f-input" value={p.attorney_id}
                  onChange={e => set({ attorney_id: e.target.value })}
                  placeholder="R-12345"/>
              </div>
            </div>
            <div className="row2">
              <div className="f-group">
                <label className="f-label">Firm</label>
                <input className="f-input" value={p.firm_name}
                  onChange={e => set({ firm_name: e.target.value })}/>
              </div>
              <div className="f-group">
                <label className="f-label">Phone #</label>
                <input className="f-input" value={p.attorney_phone}
                  onChange={e => set({ attorney_phone: e.target.value })}/>
              </div>
            </div>
            <div className="f-group">
              <label className="f-label">Address</label>
              <input className="f-input" value={p.attorney_address}
                onChange={e => set({ attorney_address: e.target.value })}/>
            </div>
            <div className="f-group feeapp-wizard-sig">
              <label className="f-label">Signature (optional — preloads on every fee app)</label>
              <SignatureCanvas initialDataUrl={p.signature_data_url || ''} />
              {p.signature_data_url && !isEdit && (
                <div className="feeapp-help">A signature is already loaded from your profile seed. Re-sign here to replace it, or skip and we'll keep the existing one.</div>
              )}
            </div>
          </div>

          {err && <div className="feeapp-status error">{err}</div>}

          <div className="feeapp-actions">
            <button className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
            <button className="btn primary" onClick={onSubmit} disabled={busy || !p.label.trim()}>
              {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Save & continue')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================================================================
  // ProfileChooser — pick which profile to autofill from (also list mgmt)
  // ==================================================================
  function ProfileChooser({ profiles, onPick, onEdit, onDelete, onAddNew, onCancel }) {
    const canAdd = profiles.length < MAX_PROFILES;
    return (
      <div className="feeapp-modal-backdrop">
        <div className="feeapp-modal" role="dialog" aria-labelledby="feeapp-chooser-title">
          <h3 id="feeapp-chooser-title">Choose attorney info</h3>
          <div className="sub">Pick which saved profile should autofill the OC-400.1. Each user can keep up to {MAX_PROFILES} caches.</div>

          <div className="feeapp-profile-list">
            {profiles.map(p => (
              <div key={p.id} className="feeapp-profile-card">
                <div className="feeapp-profile-card-main" onClick={() => onPick(p)}>
                  <div className="feeapp-profile-label">{p.label}</div>
                  <div className="feeapp-profile-meta">
                    {p.attorney_name || '—'}
                    {p.firm_name ? ' · ' + p.firm_name : ''}
                    {p.attorney_id ? ' · ' + p.attorney_id : ''}
                  </div>
                  {p.signature_data_url && (
                    <img className="feeapp-profile-sig-thumb" src={p.signature_data_url} alt="" />
                  )}
                </div>
                <div className="feeapp-profile-actions">
                  <button className="btn tiny ghost" onClick={(e) => { e.stopPropagation(); onEdit(p); }}>Edit</button>
                  <button className="btn tiny ghost danger" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete profile "${p.label}"?`)) onDelete(p); }}>Delete</button>
                </div>
              </div>
            ))}
            {canAdd && (
              <button className="feeapp-profile-add" onClick={onAddNew}>
                + Add new profile {`(${profiles.length}/${MAX_PROFILES})`}
              </button>
            )}
            {!canAdd && (
              <div className="feeapp-profile-cap-note">
                Maximum of {MAX_PROFILES} profiles reached. Delete one to add another.
              </div>
            )}
          </div>

          <div className="feeapp-actions">
            <button className="btn ghost" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ==================================================================
  // FeeAppModal — pre-filled from active workspace + chosen profile
  // ==================================================================
  function FeeAppModal({ initialContext, activeProfile, profileCount, onSwitchProfile, onEditCurrent, onClose }) {
    const [ctx, setCtx] = useState({
      claimantName:        initialContext?.claimantName        || '',
      wcbNumber:           initialContext?.wcbNumber           || '',
      doi:                 initialContext?.doi                 || '',
      aww:                 initialContext?.aww                 || '',
      feeRequestedDollar:  initialContext?.feeRequestedDollar || floor5(initialContext?.feeRequested) || '',
      feeEquation:         initialContext?.feeEquation         || '',
      attorneyName:        initialContext?.attorneyName        || '',
      attorneyId:          initialContext?.attorneyId          || '',
      attorneyAddress:     initialContext?.attorneyAddress     || '',
      attorneyPhone:       initialContext?.attorneyPhone       || '',
      firmName:            initialContext?.firmName            || '',
      dateRetained:        initialContext?.dateRetained        || '',
      dateSubmitted:       initialContext?.dateSubmitted       || new Date().toISOString().slice(0, 10),
      _profileId:          activeProfile?.id                   || null,
      // v1.2.4 — tile-derived fee reasons (carried through; merged with
      // manual selections at generate time)
      feeReasons:          Array.isArray(initialContext?.feeReasons) ? initialContext.feeReasons : [],
      // v1.2.4 — manual fee-reason additions (Section A)
      deathBenefits:       false,
      otherReasonChecked:  false,
      otherReasonText:     '',
      // v1.2.4 — Section B answers (radios). '' = unanswered (no box checked)
      currentRole:         '',  // 'current' | 'substituted'
      priorRetained:       '',  // 'yes' | 'no'
      servedNotice:        '',  // 'yes' | 'no' | 'na'
      otherFees:           '',  // 'yes' | 'no' | 'na'
    });
    const [hasSig, setHasSig] = useState(false);
    const [status, setStatus] = useState({ text: '', kind: '' });
    const [busy, setBusy] = useState(false);

    const update = (patch) => setCtx(c => ({ ...c, ...patch }));

    const onGenerate = async () => {
      setBusy(true);
      setStatus({ text: 'Generating PDF…', kind: '' });
      try {
        const sigEl = document.querySelector('.feeapp-sig-canvas');
        const sigData = sigEl?.__getSignaturePNG?.();
        if (!sigData) {
          setStatus({ text: 'Please sign before generating.', kind: 'error' });
          setBusy(false); return;
        }
        const { bytes, usedTemplate, fillReport } = await generatePdf(ctx, sigData);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = (ctx.claimantName || 'fee-app').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        a.download = `OC-400.1-${safeName}-${Date.now()}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);

        const filledCount = fillReport?.filled?.length || 0;
        const baseMsg = usedTemplate
          ? `PDF generated from official OC-400.1 template (${filledCount} fields filled).`
          : 'PDF generated (from-scratch DRAFT — official template missing).';
        persistFeeApp(ctx, bytes, { usedTemplate, fillReport }).then(res => {
          if (res.ok) setStatus({ text: baseMsg + ' Saved to history.', kind: 'ok' });
          else setStatus({ text: baseMsg + ' (history insert failed: ' + res.reason + ')', kind: 'ok' });
        });
      } catch (e) {
        console.error('[feeapp] generate failed', e);
        setStatus({ text: 'Failed to generate: ' + (e.message || e), kind: 'error' });
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="feeapp-modal-backdrop" onClick={(e) => { if (e.target.classList.contains('feeapp-modal-backdrop')) onClose(); }}>
        <div className="feeapp-modal" role="dialog" aria-labelledby="feeapp-title">
          <h3 id="feeapp-title">OC-400.1 — Fee Application</h3>
          <div className="sub">Generates a court-ready Application for Fee. Pre-filled from the active workspace tab + your saved profile; review and sign before download.</div>

          {/* Profile bar */}
          {activeProfile && (
            <div className="feeapp-profile-bar">
              <span className="feeapp-profile-bar-label">
                Profile: <strong>{activeProfile.label}</strong>
              </span>
              <div className="feeapp-profile-bar-actions">
                <button className="btn tiny ghost" onClick={onEditCurrent}>Edit</button>
                {profileCount > 1 && (
                  <button className="btn tiny ghost" onClick={onSwitchProfile}>Switch / Manage</button>
                )}
                {profileCount === 1 && (
                  <button className="btn tiny ghost" onClick={onSwitchProfile}>Manage / Add</button>
                )}
              </div>
            </div>
          )}

          <div className="feeapp-fields">
            <div className="row2">
              <div className="f-group">
                <label className="f-label">Claimant</label>
                <input className="f-input" value={ctx.claimantName} onChange={e => update({ claimantName: e.target.value })}/>
              </div>
              <div className="f-group">
                <label className="f-label">WCB #</label>
                <input className="f-input" value={ctx.wcbNumber} onChange={e => update({ wcbNumber: e.target.value })}/>
              </div>
            </div>
            <div className="row2">
              <div className="f-group">
                <label className="f-label">Date of Injury</label>
                <input className="f-input" type="date" value={ctx.doi} onChange={e => update({ doi: e.target.value })}/>
              </div>
              <div className="f-group">
                <label className="f-label">Date Retained</label>
                <input className="f-input" type="date" value={ctx.dateRetained} onChange={e => update({ dateRetained: e.target.value })}/>
              </div>
            </div>
            <div className="row2">
              <div className="f-group">
                <label className="f-label">AWW (workspace)</label>
                <div className="f-input-wrap"><span className="prefix">$</span>
                  <input className="f-input with-prefix" type="number" value={ctx.aww} onChange={e => update({ aww: e.target.value })}/>
                </div>
              </div>
              <div className="f-group">
                <label className="f-label">Fee Requested</label>
                <div className="f-input-wrap"><span className="prefix">$</span>
                  <input className="f-input with-prefix" type="number" value={ctx.feeRequestedDollar} onChange={e => update({ feeRequestedDollar: e.target.value })}/>
                </div>
              </div>
            </div>
            <div className="f-group">
              <label className="f-label">Fee Basis / Explanation</label>
              <textarea className="f-input" rows="3" value={ctx.feeEquation}
                onChange={e => update({ feeEquation: e.target.value })}
                placeholder="e.g. 15% of $42,000 moving award + ⅓ of $9,000 CCP = $9,300"/>
            </div>
            <div className="row2">
              <div className="f-group">
                <label className="f-label">Attorney Name</label>
                <input className="f-input" value={ctx.attorneyName} onChange={e => update({ attorneyName: e.target.value })}/>
              </div>
              <div className="f-group">
                <label className="f-label">Representative ID (R-#)</label>
                <input className="f-input" value={ctx.attorneyId} onChange={e => update({ attorneyId: e.target.value })} placeholder="R-12345"/>
              </div>
            </div>
            <div className="row2">
              <div className="f-group">
                <label className="f-label">Firm</label>
                <input className="f-input" value={ctx.firmName} onChange={e => update({ firmName: e.target.value })}/>
              </div>
              <div className="f-group">
                <label className="f-label">Phone #</label>
                <input className="f-input" value={ctx.attorneyPhone} onChange={e => update({ attorneyPhone: e.target.value })}/>
              </div>
            </div>
            <div className="f-group">
              <label className="f-label">Address</label>
              <input className="f-input" value={ctx.attorneyAddress} onChange={e => update({ attorneyAddress: e.target.value })}/>
            </div>
            <div className="f-group">
              <label className="f-label">Date Submitted</label>
              <input className="f-input" type="date" value={ctx.dateSubmitted} onChange={e => update({ dateSubmitted: e.target.value })}/>
            </div>
            {/* v1.2.4 — § A fee reasons (auto from tile + manual extras) */}
            <div className="feeapp-section-divider">Section A — Fee Reasons</div>
            <div className="feeapp-help">
              {(ctx.feeReasons || []).length > 0
                ? 'Auto-checked from the tile: ' + (ctx.feeReasons || []).join(', ') + '. Add more below if applicable.'
                : 'No fee reasons auto-detected from the tile. Add at least one manually.'}
            </div>
            <div className="f-group">
              <label className="feeapp-checkbox-row">
                <input type="checkbox" checked={!!ctx.deathBenefits}
                  onChange={e => update({ deathBenefits: e.target.checked })}/>
                Death benefits (WCL § 16, § 24[2][e])
              </label>
              <label className="feeapp-checkbox-row">
                <input type="checkbox" checked={!!ctx.otherReasonChecked}
                  onChange={e => update({ otherReasonChecked: e.target.checked })}/>
                Other (specify)
              </label>
              {ctx.otherReasonChecked && (
                <input className="f-input" value={ctx.otherReasonText}
                  placeholder="Describe the other fee reason"
                  onChange={e => update({ otherReasonText: e.target.value })}/>
              )}
            </div>

            {/* v1.2.4 — § B substitution + other-fee questions */}
            <div className="feeapp-section-divider">Section B — Substitution &amp; Other Fees</div>
            <div className="f-group">
              <div className="f-label">Are you the claimant's current attorney/representative, or were you substituted for?</div>
              <div className="feeapp-radio-row">
                <label><input type="radio" name="currentRole" checked={ctx.currentRole==='current'}
                  onChange={() => update({ currentRole: 'current' })}/> Current attorney</label>
                <label><input type="radio" name="currentRole" checked={ctx.currentRole==='substituted'}
                  onChange={() => update({ currentRole: 'substituted' })}/> Substituted for</label>
              </div>
            </div>
            <div className="f-group">
              <div className="f-label">Has the claimant previously retained any other attorney or licensed representative?</div>
              <div className="feeapp-radio-row">
                <label><input type="radio" name="priorRetained" checked={ctx.priorRetained==='yes'}
                  onChange={() => update({ priorRetained: 'yes' })}/> Yes</label>
                <label><input type="radio" name="priorRetained" checked={ctx.priorRetained==='no'}
                  onChange={() => update({ priorRetained: 'no' })}/> No</label>
              </div>
            </div>
            <div className="f-group">
              <div className="f-label">Have you served or been served a Notice of Substitution?</div>
              <div className="feeapp-radio-row">
                <label><input type="radio" name="servedNotice" checked={ctx.servedNotice==='yes'}
                  onChange={() => update({ servedNotice: 'yes' })}/> Yes</label>
                <label><input type="radio" name="servedNotice" checked={ctx.servedNotice==='no'}
                  onChange={() => update({ servedNotice: 'no' })}/> No</label>
                <label><input type="radio" name="servedNotice" checked={ctx.servedNotice==='na'}
                  onChange={() => update({ servedNotice: 'na' })}/> N/A</label>
              </div>
            </div>
            <div className="f-group">
              <div className="f-label">Are you aware of any fee requests from other attorneys and/or licensed representatives?</div>
              <div className="feeapp-radio-row">
                <label><input type="radio" name="otherFees" checked={ctx.otherFees==='yes'}
                  onChange={() => update({ otherFees: 'yes' })}/> Yes</label>
                <label><input type="radio" name="otherFees" checked={ctx.otherFees==='no'}
                  onChange={() => update({ otherFees: 'no' })}/> No</label>
                <label><input type="radio" name="otherFees" checked={ctx.otherFees==='na'}
                  onChange={() => update({ otherFees: 'na' })}/> N/A</label>
              </div>
            </div>

            <div className="feeapp-section-divider">Section C — Certification</div>
            <div className="f-group">
              <label className="f-label">Signature</label>
              <SignatureCanvas onChange={setHasSig} initialDataUrl={activeProfile?.signature_data_url || ''} />
            </div>
          </div>

          {status.text && <div className={'feeapp-status ' + status.kind}>{status.text}</div>}

          <div className="feeapp-actions">
            <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn primary" onClick={onGenerate} disabled={busy || !hasSig}>
              {busy ? 'Generating…' : 'Generate & Download PDF'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================================================================
  // FeeAppFlow — orchestrates wizard / chooser / modal state machine
  // ==================================================================
  function FeeAppFlow({ initialContext, onClose }) {
    // screen: 'loading' | 'wizard' | 'chooser' | 'modal'
    const [screen, setScreen] = useState('loading');
    const [profiles, setProfiles] = useState([]);
    const [activeProfile, setActiveProfile] = useState(null);
    // editingProfile: when set, we're editing this profile (null = new)
    const [editingProfile, setEditingProfile] = useState(undefined);

    // initial fetch
    useEffect(() => {
      let cancelled = false;
      listProfiles().then(list => {
        if (cancelled) return;
        setProfiles(list);
        if (list.length === 0) {
          setScreen('wizard');
          setEditingProfile(null);
        } else if (list.length === 1) {
          setActiveProfile(list[0]);
          setScreen('modal');
        } else {
          // pick the default if present, but still show chooser so user
          // can confirm or switch
          setScreen('chooser');
        }
      });
      return () => { cancelled = true; };
    }, []);

    // wizard save → if first profile, jump to modal; else back to chooser
    const onWizardSave = (profile) => {
      const wasEdit = !!(editingProfile && editingProfile.id);
      if (wasEdit) {
        setProfiles(prev => prev.map(p => p.id === profile.id ? profile : p));
        // If we edited the active one, refresh it in the modal
        if (activeProfile && activeProfile.id === profile.id) setActiveProfile(profile);
        setScreen(profiles.length === 1 ? 'modal' : 'chooser');
        setEditingProfile(undefined);
      } else {
        const next = [...profiles, profile];
        setProfiles(next);
        if (next.length === 1) {
          setActiveProfile(profile);
          setScreen('modal');
        } else {
          setActiveProfile(profile);
          setScreen('chooser');
        }
        setEditingProfile(undefined);
      }
    };

    const onWizardCancel = () => {
      // First-time wizard cancel → close everything (no profile to fall back on)
      if (profiles.length === 0) onClose();
      else setScreen(profiles.length === 1 ? 'modal' : 'chooser');
      setEditingProfile(undefined);
    };

    const onChooserPick = (profile) => {
      setActiveProfile(profile);
      setScreen('modal');
    };

    const onChooserEdit = (profile) => {
      setEditingProfile(profile);
      setScreen('wizard');
    };

    const onChooserDelete = async (profile) => {
      const result = await deleteProfile(profile.id);
      if (!result.ok) { alert('Delete failed: ' + result.reason); return; }
      const next = profiles.filter(p => p.id !== profile.id);
      setProfiles(next);
      if (activeProfile && activeProfile.id === profile.id) setActiveProfile(next[0] || null);
      if (next.length === 0) {
        // No profiles left — bounce to wizard
        setScreen('wizard');
        setEditingProfile(null);
      }
    };

    const onChooserAddNew = () => {
      setEditingProfile(null);
      setScreen('wizard');
    };

    const onSwitchFromModal = () => {
      setScreen('chooser');
    };

    const onEditFromModal = () => {
      setEditingProfile(activeProfile);
      setScreen('wizard');
    };

    if (screen === 'loading') {
      return (
        <div className="feeapp-modal-backdrop">
          <div className="feeapp-modal" role="dialog">
            <div className="feeapp-status">Loading your profile caches…</div>
          </div>
        </div>
      );
    }
    if (screen === 'wizard') {
      return <IntakeWizard
        initial={editingProfile || null}
        isEdit={!!(editingProfile && editingProfile.id)}
        profileCount={profiles.length}
        onSave={onWizardSave}
        onCancel={onWizardCancel}/>;
    }
    if (screen === 'chooser') {
      return <ProfileChooser
        profiles={profiles}
        onPick={onChooserPick}
        onEdit={onChooserEdit}
        onDelete={onChooserDelete}
        onAddNew={onChooserAddNew}
        onCancel={onClose}/>;
    }
    // 'modal' — merge the workspace ctx with the active profile's ctx.
    // Profile WINS for the attorney/firm/signature keys (the workspace's
    // attorneyName falls back to email-prefix garbage; we want the saved
    // profile's full name). Workspace ctx still wins for case data —
    // claimantName, wcbNumber, doi, aww, feeEquation, feeRequested —
    // since profileToCtx doesn't include those keys.
    const merged = { ...(initialContext || {}), ...profileToCtx(activeProfile) };
    return <FeeAppModal
      initialContext={merged}
      activeProfile={activeProfile}
      profileCount={profiles.length}
      onSwitchProfile={onSwitchFromModal}
      onEditCurrent={onEditFromModal}
      onClose={onClose}/>;
  }

  // ------------------------------------------------------------------
  // Mount + Pro/Firm gate
  // ------------------------------------------------------------------
  let _hostRoot = null;
  function ensureHost() {
    if (_hostRoot) return _hostRoot;
    const el = document.createElement('div');
    el.id = '__feeapp_host';
    document.body.appendChild(el);
    _hostRoot = ReactDOM.createRoot(el);
    return _hostRoot;
  }

  function openFlow(ctx) {
    const host = ensureHost();
    const close = () => host.render(null);
    host.render(<FeeAppFlow initialContext={ctx} onClose={close} />);
  }

  window.triggerFeeApp = function (ctx) {
    const tier = window.currentTier || 'free';
    if (tier !== 'pro' && tier !== 'firm') {
      window.dispatchEvent(new CustomEvent('feeapp:paywall'));
      return;
    }
    const merged = ctx || window.WorkspaceFeeAppContext || {};
    openFlow(merged);
  };

  window.__feeappReady = true;
})();

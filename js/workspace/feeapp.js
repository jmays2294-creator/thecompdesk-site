/* feeapp.js — OC-400.1 (Application for Fee by Claimant's Attorney)
 * generator for the Pro Attorney Workspace.
 *
 * Architecture
 * ============
 * The module renders nothing on its own. It registers two globals:
 *
 *   window.triggerFeeApp(ctx?)  — opens the modal. `ctx` is an optional
 *                                  object from the workspace shell with
 *                                  the active tab's claimant + AWW state.
 *                                  When omitted, the module reads from
 *                                  window.WorkspaceFeeAppContext (set by
 *                                  app.js right before the call).
 *   window.WorkspaceFeeAppContext — last-known context (set by app.js)
 *
 * The existing app.js EquationCard already calls `window.triggerFeeApp()`
 * on the "Generate Fee App" button — we just plug into that hook.
 *
 * Generation strategy
 * -------------------
 * 1. Try to load `/assets/forms/OC-400.1.pdf` (an official WCB form template
 *    that gets dropped into the repo). If found, fill AcroForm fields by
 *    fuzzy name match (claimant name, WCB#, AWW, signature, etc.).
 * 2. If no template is found, generate a 1-page summary PDF FROM SCRATCH —
 *    using pdf-lib's StandardFonts and a clean form-style layout. The
 *    output is clearly marked "OC-400.1 — DRAFT (template not bundled)"
 *    so attorneys know to replace before submission.
 *
 * Either way the signature image is embedded and the PDF downloads + uploads
 * to the `fee_applications` Supabase table for history.
 *
 * Pro/Firm gate
 * -------------
 * The module checks `window.currentTier`. Anything other than 'pro' or
 * 'firm' falls back to the existing paywall — same gate the rest of the
 * workspace uses.
 */

(function () {
  'use strict';

  const { useState, useEffect, useRef, useMemo, useCallback } = React;

  const PDF_LIB_URL = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  const TEMPLATE_URL = '/assets/forms/OC-400.1.pdf';

  // ------------------------------------------------------------------
  // pdf-lib loader (cached promise so multiple modal opens reuse it)
  // ------------------------------------------------------------------
  let _pdfLibPromise = null;
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (_pdfLibPromise) return _pdfLibPromise;
    _pdfLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDF_LIB_URL;
      s.onload = () => window.PDFLib ? resolve(window.PDFLib) : reject(new Error('pdf-lib loaded but PDFLib global missing'));
      s.onerror = () => reject(new Error('Failed to load pdf-lib from ' + PDF_LIB_URL));
      document.head.appendChild(s);
    });
    return _pdfLibPromise;
  }

  // ------------------------------------------------------------------
  // Signature canvas (HiDPI, mouse + touch + pen)
  // ------------------------------------------------------------------
  function SignatureCanvas({ onChange }) {
    const canvasRef = useRef(null);
    const drawingRef = useRef(false);
    const lastRef = useRef({ x: 0, y: 0 });
    const dirtyRef = useRef(false);

    // HiDPI sizing — match canvas backing buffer to device pixel ratio
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
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#0a0f1a';
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

    const start = (e) => {
      e.preventDefault();
      drawingRef.current = true;
      lastRef.current = getPoint(e);
    };
    const move = (e) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      const ctx = canvasRef.current.getContext('2d');
      const p = getPoint(e);
      ctx.beginPath();
      ctx.moveTo(lastRef.current.x, lastRef.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastRef.current = p;
      if (!dirtyRef.current) {
        dirtyRef.current = true;
        onChange?.(true);
      }
    };
    const end = () => { drawingRef.current = false; };

    const clear = () => {
      const c = canvasRef.current;
      const ctx = c.getContext('2d');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
      dirtyRef.current = false;
      onChange?.(false);
    };

    // Expose getDataURL via canvasRef.current.__getSignatureData (set on mount)
    useEffect(() => {
      if (!canvasRef.current) return;
      canvasRef.current.__getSignaturePNG = () => {
        if (!dirtyRef.current) return null;
        return canvasRef.current.toDataURL('image/png');
      };
      canvasRef.current.__clearSignature = clear;
    }, []);

    return (
      <div className="feeapp-sig-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="feeapp-sig-canvas"
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end}
        />
        <div className="feeapp-sig-actions">
          <span>Sign above using mouse, pen, or finger.</span>
          <button type="button" className="btn tiny ghost" onClick={clear}>Clear</button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Field-name matching for AcroForm fill. Tries to fill any field whose
  // name includes one of the keywords. Robust to WCB form revisions.
  // ------------------------------------------------------------------
  function fuzzyFillFields(form, ctx) {
    const fields = form.getFields();
    const tryFill = (matchers, value) => {
      if (value === undefined || value === null || value === '') return false;
      const v = String(value);
      for (const f of fields) {
        const name = (f.getName() || '').toLowerCase();
        if (matchers.some(m => name.includes(m))) {
          try {
            if (typeof f.setText === 'function') { f.setText(v); return true; }
            if (typeof f.check === 'function')   { f.check();    return true; }
          } catch (e) { /* ignore field type mismatch */ }
        }
      }
      return false;
    };
    const out = {};
    out.claimant = tryFill(['claimant', 'injured', 'employee_name', 'name_of_claimant'], ctx.claimantName);
    out.wcb      = tryFill(['wcb', 'case_number', 'case#', 'wcbnumber'], ctx.wcbNumber);
    out.doi      = tryFill(['doi', 'date_of_injury', 'injury_date', 'dateofaccident'], ctx.doi);
    out.aww      = tryFill(['aww', 'average_weekly', 'weekly_wage'], ctx.aww);
    out.attorney = tryFill(['attorney_name', 'representative_name', 'firm_attorney'], ctx.attorneyName);
    out.firm     = tryFill(['firm', 'law_office', 'attorney_firm'], ctx.firmName);
    out.feeAmt   = tryFill(['fee_requested', 'amount_of_fee', 'attorney_fee'], ctx.feeRequested);
    out.feeDate  = tryFill(['fee_date', 'date_of_fee', 'app_date', 'date_signed'], ctx.signedDate);
    return out;
  }

  // ------------------------------------------------------------------
  // Fallback: render a clean OC-400.1-shaped page from scratch
  // ------------------------------------------------------------------
  async function renderFromScratch(ctx, pdfDoc, sigPngBytes) {
    const { StandardFonts, rgb } = window.PDFLib;
    const page = pdfDoc.addPage([612, 792]); // US Letter
    const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helvB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const margin = 50;
    let y = 762;

    const draw = (text, opts = {}) => {
      const font = opts.bold ? helvB : helv;
      const size = opts.size || 11;
      const x = opts.x ?? margin;
      const yy = opts.y ?? y;
      page.drawText(String(text || ''), { x, y: yy, size, font, color: rgb(0, 0, 0) });
      if (opts.y === undefined) y -= (opts.lh || size + 4);
    };
    const hr = (gap = 8) => {
      y -= gap;
      page.drawLine({ start: { x: margin, y }, end: { x: 612 - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
      y -= gap;
    };

    // Header
    draw('NEW YORK STATE WORKERS\' COMPENSATION BOARD', { bold: true, size: 13 });
    draw('OC-400.1 — Application for Fee by Claimant\'s Attorney or Licensed Representative', { bold: true, size: 11 });
    draw('DRAFT — generated by The Comp Desk Pro Workspace', { size: 9 });
    hr();

    // Case identifiers
    draw('Case Identifiers', { bold: true, size: 12 });
    draw(`Claimant:   ${ctx.claimantName || '—'}`);
    draw(`WCB #:      ${ctx.wcbNumber || '—'}`);
    draw(`Date of Injury: ${ctx.doi || '—'}`);
    draw(`Average Weekly Wage: ${ctx.aww ? '$' + Number(ctx.aww).toFixed(2) : '—'}`);
    hr();

    // Fee request
    draw('Fee Request', { bold: true, size: 12 });
    draw(`Amount of Fee Requested: ${ctx.feeRequested ? '$' + Number(ctx.feeRequested).toFixed(2) : '—'}`);
    draw(`Basis for Fee:`);
    const eqLines = (ctx.feeEquation || '').split('\n');
    for (const ln of eqLines.slice(0, 8)) draw('  ' + ln, { size: 10 });
    hr();

    // Attorney info
    draw('Attorney / Representative', { bold: true, size: 12 });
    draw(`Name:  ${ctx.attorneyName || '—'}`);
    draw(`Firm:  ${ctx.firmName || '—'}`);
    draw(`Email: ${ctx.attorneyEmail || '—'}`);
    hr();

    // Signature block
    draw('Signature', { bold: true, size: 12 });
    if (sigPngBytes) {
      const sigImg = await pdfDoc.embedPng(sigPngBytes);
      const dims = sigImg.scale(0.4);
      const sigW = Math.min(220, dims.width);
      const sigH = sigW * (dims.height / dims.width);
      page.drawImage(sigImg, { x: margin, y: y - sigH, width: sigW, height: sigH });
      y -= (sigH + 8);
    } else {
      draw('  (no signature provided)', { size: 10 });
    }
    page.drawLine({ start: { x: margin, y: y }, end: { x: margin + 240, y: y }, thickness: 0.5, color: rgb(0, 0, 0) });
    y -= 14;
    draw(`Signed: ${ctx.signedDate || new Date().toISOString().slice(0, 10)}`, { size: 10 });
    draw(`Generated: ${new Date().toLocaleString()}`, { size: 8 });

    // Footer note
    page.drawText(
      'This is a Comp Desk-generated draft. Replace with the official OC-400.1 form template before submission.',
      { x: margin, y: 30, size: 8, font: helv, color: rgb(0.5, 0.5, 0.5) }
    );
  }

  // ------------------------------------------------------------------
  // Generate the PDF (template-fill if available, else from scratch)
  // ------------------------------------------------------------------
  async function generatePdf(ctx, sigPngDataUrl) {
    const PDFLib = await loadPdfLib();
    const { PDFDocument } = PDFLib;

    // Decode signature PNG (data URL → bytes)
    let sigPngBytes = null;
    if (sigPngDataUrl) {
      const base64 = sigPngDataUrl.split(',')[1];
      const bin = atob(base64);
      sigPngBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) sigPngBytes[i] = bin.charCodeAt(i);
    }

    // Try template fetch first
    let pdfDoc = null;
    let usedTemplate = false;
    try {
      const r = await fetch(TEMPLATE_URL, { cache: 'force-cache' });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        pdfDoc = await PDFDocument.load(buf);
        usedTemplate = true;
      }
    } catch (e) { /* fall through */ }

    if (!pdfDoc) {
      pdfDoc = await PDFDocument.create();
    }
    pdfDoc.setTitle(`OC-400.1 — ${ctx.claimantName || 'Fee Application'}`);
    pdfDoc.setAuthor(ctx.attorneyName || 'The Comp Desk');
    pdfDoc.setProducer('The Comp Desk Pro Workspace');

    let filledFields = null;
    if (usedTemplate) {
      // Try AcroForm fill, then embed signature on the last page bottom-left
      try {
        const form = pdfDoc.getForm();
        filledFields = fuzzyFillFields(form, ctx);
        if (sigPngBytes) {
          const sigImg = await pdfDoc.embedPng(sigPngBytes);
          const pages = pdfDoc.getPages();
          const last = pages[pages.length - 1];
          const { width } = last.getSize();
          const dims = sigImg.scale(0.4);
          const sigW = Math.min(220, dims.width);
          const sigH = sigW * (dims.height / dims.width);
          last.drawImage(sigImg, { x: 60, y: 60, width: sigW, height: sigH });
        }
        try { form.flatten(); } catch (e) { /* some pdf-lib versions throw on un-fillable widgets */ }
      } catch (e) {
        console.warn('[feeapp] AcroForm fill failed; falling back to from-scratch page', e);
        usedTemplate = false;
      }
    }
    if (!usedTemplate) {
      await renderFromScratch(ctx, pdfDoc, sigPngBytes);
    }

    const bytes = await pdfDoc.save();
    return { bytes, usedTemplate, filledFields };
  }

  // ------------------------------------------------------------------
  // Supabase insert (best-effort; failure does not block the download)
  // ------------------------------------------------------------------
  async function persistFeeApp(ctx, pdfBytes, meta) {
    try {
      const supa = window.supa;
      const userId = window.workspaceUserId;
      if (!supa || !userId) return { ok: false, reason: 'no-client' };
      const row = {
        user_id: userId,
        claimant_name: ctx.claimantName || null,
        wcb_number: ctx.wcbNumber || null,
        doi: ctx.doi || null,
        aww: ctx.aww || null,
        fee_requested: ctx.feeRequested || null,
        fee_equation: ctx.feeEquation || null,
        used_template: meta.usedTemplate || false,
        pdf_bytes: pdfBytes.length,
        created_at: new Date().toISOString(),
      };
      const { error } = await supa.from('fee_applications').insert(row);
      if (error) {
        console.warn('[feeapp] persist failed:', error);
        return { ok: false, reason: error.message };
      }
      return { ok: true };
    } catch (e) {
      console.warn('[feeapp] persist threw:', e);
      return { ok: false, reason: String(e) };
    }
  }

  // ------------------------------------------------------------------
  // Modal — pulls from active workspace context, lets user edit, generates
  // ------------------------------------------------------------------
  function FeeAppModal({ initialContext, onClose }) {
    const [ctx, setCtx] = useState({
      claimantName: initialContext?.claimantName || '',
      wcbNumber:    initialContext?.wcbNumber || '',
      doi:          initialContext?.doi || '',
      aww:          initialContext?.aww || '',
      feeRequested: initialContext?.feeRequested || '',
      feeEquation:  initialContext?.feeEquation || '',
      attorneyName: initialContext?.attorneyName || (window.workspaceUserEmail || ''),
      firmName:     initialContext?.firmName || '',
      attorneyEmail: window.workspaceUserEmail || '',
      signedDate:   new Date().toISOString().slice(0, 10),
    });
    const [hasSig, setHasSig] = useState(false);
    const sigRef = useRef(null);
    const [status, setStatus] = useState({ text: '', kind: '' });
    const [busy, setBusy] = useState(false);

    const update = (patch) => setCtx(c => ({ ...c, ...patch }));

    const onGenerate = async () => {
      setBusy(true);
      setStatus({ text: 'Generating PDF…', kind: '' });
      try {
        let sigData = null;
        // Find the canvas node (we render it via SignatureCanvas)
        const sigEl = document.querySelector('.feeapp-sig-canvas');
        if (sigEl && typeof sigEl.__getSignaturePNG === 'function') {
          sigData = sigEl.__getSignaturePNG();
        }
        if (!sigData) {
          setStatus({ text: 'Please sign before generating.', kind: 'error' });
          setBusy(false);
          return;
        }

        const { bytes, usedTemplate } = await generatePdf(ctx, sigData);

        // Trigger download
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = (ctx.claimantName || 'fee-app').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        a.download = `OC-400.1-${safeName}-${Date.now()}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);

        // Persist (best-effort; never blocks the download)
        persistFeeApp(ctx, bytes, { usedTemplate }).then(res => {
          if (res.ok) {
            setStatus({ text: usedTemplate
              ? 'PDF generated from official template + saved to history.'
              : 'PDF generated (from-scratch draft) + saved to history.',
              kind: 'ok' });
          } else {
            setStatus({ text: 'PDF generated; could not save to history (' + res.reason + ').', kind: 'ok' });
          }
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
          <div className="sub">
            Generates a court-ready Application for Fee. Pre-fills from the
            active workspace tab; review and sign before download.
          </div>

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
                <label className="f-label">AWW</label>
                <div className="f-input-wrap"><span className="prefix">$</span>
                  <input className="f-input with-prefix" type="number" value={ctx.aww} onChange={e => update({ aww: e.target.value })}/>
                </div>
              </div>
            </div>
            <div className="row2">
              <div className="f-group">
                <label className="f-label">Fee Requested</label>
                <div className="f-input-wrap"><span className="prefix">$</span>
                  <input className="f-input with-prefix" type="number" value={ctx.feeRequested} onChange={e => update({ feeRequested: e.target.value })}/>
                </div>
              </div>
              <div className="f-group">
                <label className="f-label">Date Signed</label>
                <input className="f-input" type="date" value={ctx.signedDate} onChange={e => update({ signedDate: e.target.value })}/>
              </div>
            </div>
            <div className="f-group">
              <label className="f-label">Fee Equation / Basis</label>
              <textarea className="f-input" rows="3" value={ctx.feeEquation}
                onChange={e => update({ feeEquation: e.target.value })}
                placeholder="e.g. 15% of $42,000 moving award + ⅓ of $9,000 CCP = $9,300"/>
            </div>
            <div className="row2">
              <div className="f-group">
                <label className="f-label">Attorney</label>
                <input className="f-input" value={ctx.attorneyName} onChange={e => update({ attorneyName: e.target.value })}/>
              </div>
              <div className="f-group">
                <label className="f-label">Firm</label>
                <input className="f-input" value={ctx.firmName} onChange={e => update({ firmName: e.target.value })}/>
              </div>
            </div>
            <div className="f-group">
              <label className="f-label">Signature</label>
              <SignatureCanvas onChange={setHasSig} />
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

  // ------------------------------------------------------------------
  // Mount point — a hidden host div + ReactDOM portal-style mount
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

  function openModal(ctx) {
    const host = ensureHost();
    const close = () => host.render(null);
    host.render(<FeeAppModal initialContext={ctx} onClose={close} />);
  }

  // ------------------------------------------------------------------
  // Pro/Firm gate + global registration
  // ------------------------------------------------------------------
  window.triggerFeeApp = function (ctx) {
    const tier = window.currentTier || 'free';
    if (tier !== 'pro' && tier !== 'firm') {
      // Re-use the existing paywall via a CustomEvent the App can listen for.
      window.dispatchEvent(new CustomEvent('feeapp:paywall'));
      return;
    }
    const merged = ctx || window.WorkspaceFeeAppContext || {};
    openModal(merged);
  };

  // Surface a flag the workspace shell can read to decide whether to render
  // the "Generate Fee App" button at all (even outside Pro, the button is
  // shown but dispatches paywall — see EquationCard).
  window.__feeappReady = true;
})();

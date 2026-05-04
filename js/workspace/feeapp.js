/* feeapp.js — OC-400.1 (Application for Fee by Claimant's Attorney)
 * generator for the Pro Attorney Workspace.  v1.2.1.
 *
 * v1.2.1 changes vs. v1.2:
 *   - Replace fuzzy field-name matcher with a HARD-CODED OC400_FIELD_MAP
 *     keyed off the official form's actual XFA field names (verified
 *     against the WCB-published OC-400.1 1-23 PDF, 2 pages, 40 fields).
 *   - Embed the signature image directly on the page-2 signature line
 *     rect (not just bottom-left of the last page).
 *   - Pre-populate modal from public.profiles (full_name, firm_name,
 *     firm_address, phone) so the attorney's certification block fills
 *     itself without retyping.
 *   - persistFeeApp() rewritten to match the EXISTING fee_applications
 *     schema (case_name + calculator_type are NOT NULL; calculation_data
 *     is jsonb; my v1.2 migration was never applied).
 *
 * Architecture (unchanged from v1.2):
 *   window.triggerFeeApp(ctx?) opens the modal. ctx (optional) comes
 *   from the workspace shell — see app.js's onFeeApp handler.
 *
 * Pro/Firm gate via window.currentTier; non-Pro dispatches feeapp:paywall.
 */

(function () {
  'use strict';

  const { useState, useEffect, useRef } = React;

  const PDF_LIB_URL = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  const TEMPLATE_URL = '/assets/forms/OC-400.1.pdf';

  // ------------------------------------------------------------------
  // Hard-coded OC-400.1 field map. Keys are the full XFA field names;
  // values are the modal context keys whose value should fill them.
  // Verified visually against the rendered template — see
  // ops/dev/oc400-fieldmap.md (or this skill's reference render).
  // ------------------------------------------------------------------
  const OC400_FIELD_MAP = {
    // Page 1 — top header
    'F[0].P1[0].#area[0].WCBCaseNos[0]':         'wcbNumber',
    'F[0].P1[0].#area[0].ClaimantsName[0]':      'claimantName',
    'F[0].P1[0].#area[0].RepresentativeIDNo[0]': 'attorneyId',     // R-XXXXX
    'F[0].P1[0].#area[0].DateRetained[0]':       'dateRetained',   // mm/dd/yyyy
    // Page 1 — Section A "Fee Request"
    'F[0].P1[0].TextField2[0]':                  'attorneyName',         // "I, [name]" attorney name in sentence
    'F[0].P1[0].TextField2[1]':                  'feeRequestedDollar',   // "$ [amount]" fee amount
    'F[0].P1[0].FeeRequestExplanation[0]':       'feeEquation',          // explanation textarea
    // FeeReason1..6, FeeReasonOther, OtherText, AreYou, WereYou,
    // RetainedYes/No, ServedYes/No/NA, OtherFeeYes/No/NA — left for the
    // attorney to check manually; auto-checking would be presumptuous.
    // Page 2 — top header
    'F[0].P2[0].WCBCaseNo[0]':                   'wcbNumber',
    'F[0].P2[0].ClaimantsName[0]':               'claimantName',
    // Page 2 — Section C "Attorney/Licensed Representative Certification"
    'F[0].P2[0].TextField2[1]':                  'attorneyName',     // Print Name
    'F[0].P2[0].TextField2[0]':                  'attorneyName',     // Signature line (typed); image overlaid separately
    'F[0].P2[0].TextField2[4]':                  'dateSubmitted',    // Date Submitted
    'F[0].P2[0].TextField2[2]':                  'attorneyAddress',  // Address
    'F[0].P2[0].TextField2[3]':                  'attorneyPhone',    // Phone #
    // TextField2[5..7] — "Internal Use Only" (Date / Amount Approved /
    // WCLJ Initials), filled by the WCLJ at the hearing. Leave blank.
  };

  // Page-2 signature line rect from the AcroForm widget (PDF coords).
  // The WCB form expects the visual signature on page 2, on the line
  // labeled "Signature of Attorney/Licensed Representative".
  const SIGNATURE_RECT_PAGE2 = { x: 261, y: 690, width: 218, height: 30 };

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
      s.onerror = () => reject(new Error('Failed to load pdf-lib from ' + PDF_LIB_URL));
      document.head.appendChild(s);
    });
    return _pdfLibPromise;
  }

  // ------------------------------------------------------------------
  // Profile loader — pre-populate the modal from public.profiles
  // ------------------------------------------------------------------
  async function loadAttorneyProfile() {
    try {
      const supa = window.supa;
      const userId = window.workspaceUserId;
      if (!supa || !userId) return {};
      const { data, error } = await supa
        .from('profiles')
        .select('full_name, display_name, firm_name, firm_address, phone')
        .eq('id', userId)
        .maybeSingle();
      if (error || !data) return {};
      return {
        attorneyName:    data.full_name || data.display_name || '',
        attorneyAddress: data.firm_address || '',
        attorneyPhone:   data.phone || '',
        firmName:        data.firm_name || '',
      };
    } catch (e) {
      console.warn('[feeapp] profile load failed:', e);
      return {};
    }
  }

  // ------------------------------------------------------------------
  // Signature canvas (HiDPI, mouse + touch + pen) — unchanged from v1.2
  // ------------------------------------------------------------------
  function SignatureCanvas({ onChange }) {
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
  // AcroForm fill — hard-coded map keyed on full XFA field names
  // ------------------------------------------------------------------
  function fillFormFromMap(form, ctx) {
    const fields = form.getFields();
    const filled = [];
    const missed = [];
    for (const f of fields) {
      const name = f.getName();
      const ctxKey = OC400_FIELD_MAP[name];
      if (!ctxKey) continue;
      const value = ctx[ctxKey];
      if (value === undefined || value === null || value === '') continue;
      try {
        if (typeof f.setText === 'function') {
          f.setText(String(value));
          filled.push({ name, ctxKey });
        }
      } catch (e) {
        missed.push({ name, ctxKey, error: String(e) });
      }
    }
    return { filled, missed };
  }

  // ------------------------------------------------------------------
  // From-scratch fallback (unchanged) — runs only when the template fetch fails
  // ------------------------------------------------------------------
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
      page.drawText(String(text || ''), { x: opts.x ?? margin, y: opts.y ?? y, size, font, color: rgb(0, 0, 0) });
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
    page.drawText(
      'This is a Comp Desk-generated draft. Replace with the official OC-400.1 form template before submission.',
      { x: margin, y: 30, size: 8, font: helv, color: rgb(0.5, 0.5, 0.5) }
    );
  }

  // ------------------------------------------------------------------
  // Generate the PDF
  // ------------------------------------------------------------------
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

    let pdfDoc = null;
    let usedTemplate = false;
    let fillReport = null;
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

    if (usedTemplate) {
      try {
        const form = pdfDoc.getForm();
        fillReport = fillFormFromMap(form, ctx);
        if (sigPngBytes) {
          // Overlay signature on page-2 signature line. The form's
          // TextField2[0] on page 2 (typed name) sits in the same rect;
          // overlaying the image visually replaces it.
          const sigImg = await pdfDoc.embedPng(sigPngBytes);
          const pages = pdfDoc.getPages();
          const page2 = pages[1] || pages[pages.length - 1];
          const r = SIGNATURE_RECT_PAGE2;
          // Constrain image to rect while preserving aspect
          const imgRatio = sigImg.height / sigImg.width;
          let sigW = r.width;
          let sigH = sigW * imgRatio;
          if (sigH > r.height) {
            sigH = r.height;
            sigW = sigH / imgRatio;
          }
          page2.drawImage(sigImg, { x: r.x, y: r.y, width: sigW, height: sigH });
        }
        try { form.flatten(); } catch (e) { /* some pdf-lib versions can't flatten certain widgets */ }
      } catch (e) {
        console.warn('[feeapp] AcroForm fill failed; rendering from-scratch fallback', e);
        usedTemplate = false;
      }
    }
    if (!usedTemplate) {
      await renderFromScratch(ctx, pdfDoc, sigPngBytes);
    }

    const bytes = await pdfDoc.save();
    return { bytes, usedTemplate, fillReport };
  }

  // ------------------------------------------------------------------
  // Persist to public.fee_applications (existing schema, NOT my migration)
  // ------------------------------------------------------------------
  async function persistFeeApp(ctx, pdfBytes, meta) {
    try {
      const supa = window.supa;
      const userId = window.workspaceUserId;
      if (!supa || !userId) return { ok: false, reason: 'no-client' };

      // Map workspace ctx → existing schema
      const caseName = ctx.caseName
        || ctx.claimantName
        || ctx.wcbNumber
        || 'OC-400.1';
      const calcType = 'oc-400.1';
      const feeAmount = ctx.feeRequestedDollar
        ? Number(String(ctx.feeRequestedDollar).replace(/[^0-9.\-]/g, ''))
        : null;
      const calcData = {
        // Everything that doesn't map to a column lives in calculation_data.
        doi:               ctx.doi || null,
        aww:               ctx.aww || null,
        fee_equation:      ctx.feeEquation || null,
        attorney_name:     ctx.attorneyName || null,
        attorney_id:       ctx.attorneyId || null,
        attorney_phone:    ctx.attorneyPhone || null,
        attorney_address:  ctx.attorneyAddress || null,
        firm_name:         ctx.firmName || null,
        date_retained:     ctx.dateRetained || null,
        date_submitted:    ctx.dateSubmitted || null,
        used_template:     !!meta?.usedTemplate,
        fill_report:       meta?.fillReport || null,
        pdf_byte_length:   pdfBytes ? pdfBytes.length : null,
      };

      const row = {
        user_id:         userId,
        case_name:       caseName,
        wcb_case_number: ctx.wcbNumber || null,
        claimant_name:   ctx.claimantName || null,
        fee_amount:      feeAmount,
        calculator_type: calcType,
        calculation_data: calcData,
        // status defaults to 'generated'
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
  // Modal
  // ------------------------------------------------------------------
  function FeeAppModal({ initialContext, onClose }) {
    const [ctx, setCtx] = useState({
      claimantName:        initialContext?.claimantName        || '',
      wcbNumber:           initialContext?.wcbNumber           || '',
      doi:                 initialContext?.doi                 || '',
      aww:                 initialContext?.aww                 || '',
      feeRequestedDollar:  initialContext?.feeRequested        || initialContext?.feeRequestedDollar || '',
      feeEquation:         initialContext?.feeEquation         || '',
      attorneyName:        initialContext?.attorneyName        || '',
      attorneyId:          initialContext?.attorneyId          || '',
      attorneyAddress:     initialContext?.attorneyAddress     || '',
      attorneyPhone:       initialContext?.attorneyPhone       || '',
      firmName:            initialContext?.firmName            || '',
      dateRetained:        initialContext?.dateRetained        || '',
      dateSubmitted:       initialContext?.dateSubmitted       || new Date().toISOString().slice(0, 10),
    });
    const [hasSig, setHasSig] = useState(false);
    const [status, setStatus] = useState({ text: '', kind: '' });
    const [busy, setBusy] = useState(false);

    // On mount, fold in profile data (won't clobber any field already set
    // from initialContext).
    useEffect(() => {
      let cancelled = false;
      loadAttorneyProfile().then(p => {
        if (cancelled) return;
        setCtx(c => ({
          ...c,
          attorneyName:    c.attorneyName    || p.attorneyName    || '',
          attorneyAddress: c.attorneyAddress || p.attorneyAddress || '',
          attorneyPhone:   c.attorneyPhone   || p.attorneyPhone   || '',
          firmName:        c.firmName        || p.firmName        || '',
        }));
      });
      return () => { cancelled = true; };
    }, []);

    const update = (patch) => setCtx(c => ({ ...c, ...patch }));

    const onGenerate = async () => {
      setBusy(true);
      setStatus({ text: 'Generating PDF…', kind: '' });
      try {
        const sigEl = document.querySelector('.feeapp-sig-canvas');
        const sigData = sigEl?.__getSignaturePNG?.();
        if (!sigData) {
          setStatus({ text: 'Please sign before generating.', kind: 'error' });
          setBusy(false);
          return;
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
          <div className="sub">Generates a court-ready Application for Fee. Pre-fills from the active workspace tab + your profile; review and sign before download.</div>

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

  function openModal(ctx) {
    const host = ensureHost();
    const close = () => host.render(null);
    host.render(<FeeAppModal initialContext={ctx} onClose={close} />);
  }

  window.triggerFeeApp = function (ctx) {
    const tier = window.currentTier || 'free';
    if (tier !== 'pro' && tier !== 'firm') {
      window.dispatchEvent(new CustomEvent('feeapp:paywall'));
      return;
    }
    const merged = ctx || window.WorkspaceFeeAppContext || {};
    openModal(merged);
  };

  window.__feeappReady = true;
})();

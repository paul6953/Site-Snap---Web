// PDF export — continuous-flow 2-column layout.
// Page 1: full floor plan with numbered coloured markers.
// Subsequent pages: all pins' photos flow through a shared 2-column grid.
// Each pin is introduced by a full-width section header; photos follow in the
// grid until the page is full, then continue on the next page.

const PW = 612, PH = 792, M = 36;
const COLS = 2, COL_GAP = 14;
const CELL_W  = (PW - M * 2 - COL_GAP) / COLS;   // 264 pt
const CELL_H  = 210;                               // photo cell total height
const IMG_H   = 170;                               // image area inside cell
const CAP_H   = CELL_H - IMG_H;                   // 40 pt for date + caption
const ROW_GAP = 12;
const HDR_H   = 28;                               // section header row height
const GRID_TOP = M;                               // grid starts at top margin on each page
const MAX_Y    = PH - M;                          // bottom margin

// ─── Utilities ───────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#007AFF');
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) }
           : { r: 0, g: 122, b: 255 };
}
function imgFmt(dataUrl) {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
}
function loadMeta(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight, url });
    i.onerror = rej;
    i.src = url;
  });
}
function toDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
function aspectFit(iw, ih, bw, bh) {
  const s = Math.min(bw / iw, bh / ih);
  return { w: iw * s, h: ih * s };
}

function drawMarker(doc, num, cx, cy, colorHex, r = 1) {
  const { r: cr, g: cg, b: cb } = hexToRgb(colorHex);
  doc.setFillColor(cr, cg, cb);
  doc.circle(cx, cy, r, 'F');
  // Ring and number only render at larger sizes — too small to fit at r=1
  if (r >= 4) {
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(Math.max(0.5, r * 0.12));
    doc.circle(cx, cy, r - 0.4, 'S');
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(Math.max(4, Math.round(r)));
    doc.text(String(num), cx, cy, { align: 'center', baseline: 'middle' });
  }
}

// ─── Layout engine ────────────────────────────────────────────────────────────
// Simulates placing items without drawing; returns {pageNumber, y, col} per item.
function simulate(items) {
  let page = 1, y = GRID_TOP, col = 0;
  const layout = [];

  for (const item of items) {
    if (item.type === 'header') {
      if (col > 0) { col = 0; y += CELL_H + ROW_GAP; } // finish row
      if (y + HDR_H + CELL_H > MAX_Y && y > GRID_TOP) { page++; y = GRID_TOP; col = 0; }
      layout.push({ page, y, col: 0 });
      y += HDR_H;
    } else {
      if (col >= COLS) { col = 0; y += CELL_H + ROW_GAP; }
      if (y + CELL_H > MAX_Y && y > GRID_TOP) { page++; y = GRID_TOP; col = 0; }
      layout.push({ page, y, col });
      col++;
    }
  }
  return { layout, totalPages: page };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function exportFloorPlanPdf(floorPlan, pins, photosByPin) {
  if (!window.jspdf?.jsPDF) {
    throw new Error('PDF library failed to load. Close and reopen the app, then try again.');
  }
  const { jsPDF } = window.jspdf;

  // Build flat item list
  const items = [];
  for (let i = 0; i < pins.length; i++) {
    const pin    = pins[i];
    const photos = photosByPin[pin.id] || [];
    items.push({ type: 'header', pin, pinIndex: i });
    for (const photo of photos) {
      items.push({ type: 'photo', photo, pin, pinIndex: i });
    }
  }

  // Simulate layout to get page numbers per item (for GoTo links on floor plan)
  const { layout } = simulate(items);
  const pinFirstPage = {};
  layout.forEach((pos, idx) => {
    if (items[idx].type === 'header') {
      const { pinIndex } = items[idx];
      if (pinFirstPage[pinIndex] === undefined) pinFirstPage[pinIndex] = pos.page + 1;
    }
  });

  // ── Page 1: floor plan fills a page sized to its own aspect ratio ────────
  // Load image first so we can size the page before creating the doc.
  const fpMeta = await loadMeta(floorPlan.imageBlob);
  const fpData = await toDataUrl(floorPlan.imageBlob);
  URL.revokeObjectURL(fpMeta.url);

  // Scale so the longer edge = 792 pt, preserving aspect ratio.
  const FP_MAX  = 792;
  const fpScale = FP_MAX / Math.max(fpMeta.w, fpMeta.h);
  const fpPageW = Math.round(fpMeta.w * fpScale);
  const fpPageH = Math.round(fpMeta.h * fpScale);

  const doc = new jsPDF({ unit: 'pt', format: [fpPageW, fpPageH] });

  // Floor plan fills the entire page edge-to-edge.
  doc.addImage(fpData, imgFmt(fpData), 0, 0, fpPageW, fpPageH);

  // Thin white title bar at top so the floor plan name is always readable.
  const titleH = 18;
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, fpPageW, titleH, 'F');
  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(floorPlan.name, 6, 13);

  // Pins sit directly on the full-page image — no margin offset needed.
  const markerR = 1;
  pins.forEach((pin, i) => {
    const cx = pin.xNorm * fpPageW;
    const cy = pin.yNorm * fpPageH;
    drawMarker(doc, i + 1, cx, cy, pin.color, markerR);
    const targetPage = pinFirstPage[i];
    if (targetPage) doc.link(cx - markerR - 4, cy - markerR - 4, (markerR + 4) * 2, (markerR + 4) * 2, { pageNumber: targetPage });
  });

  if (items.length === 0) { doc.save(`SiteSnap-${floorPlan.name}.pdf`); return; }

  // ── Body pages: letter-size continuous 2-col flow ────────────────────────
  let currentPage = 1;
  doc.addPage([PW, PH]); // body starts on page 2 (letter size)

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const { page, y, col } = layout[idx];

    // Switch to the correct page
    while (currentPage < page) {
      doc.addPage([PW, PH]);
      currentPage++;
      // "< Floor Plan" back link on every body page
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0, 122, 255);
      doc.text('‹ Floor Plan', M, M - 6);
      doc.link(M, M - 14, 55, 11, { pageNumber: 1 });
    }

    const cellX = M + col * (CELL_W + COL_GAP);

    if (item.type === 'header') {
      const { pin, pinIndex } = item;
      const label = `Pin ${pinIndex + 1}${pin.name ? '  —  ' + pin.name : ''}`;
      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      doc.text(label, M, y + 10);

      // Colour swatch
      const { r: cr, g: cg, b: cb } = hexToRgb(pin.color);
      doc.setFillColor(cr, cg, cb);
      doc.circle(PW - M - 8, y + 7, 5, 'F');

      if (pin.note) {
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(pin.note, M, y + 22, { maxWidth: PW - M * 2 - 20 });
      }

      // Horizontal rule
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.5);
      doc.line(M, y + HDR_H - 4, PW - M, y + HDR_H - 4);

    } else {
      const { photo } = item;
      const meta = await loadMeta(photo.blob);
      const data = await toDataUrl(photo.blob);
      URL.revokeObjectURL(meta.url);

      const { w: iw, h: ih } = aspectFit(meta.w, meta.h, CELL_W, IMG_H);
      const ix = cellX + (CELL_W - iw) / 2;
      doc.addImage(data, imgFmt(data), ix, y, iw, ih);

      // Thin image border
      doc.setDrawColor(235, 235, 235);
      doc.setLineWidth(0.5);
      doc.rect(ix, y, iw, ih, 'S');

      // Date
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 140);
      doc.text(new Date(photo.capturedAt).toLocaleString(), cellX, y + IMG_H + 12);

      // Caption (bold, second line)
      if (photo.caption) {
        doc.setFont(undefined, 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(30, 30, 30);
        doc.text(photo.caption, cellX, y + IMG_H + 24, { maxWidth: CELL_W });
      }
    }
  }

  doc.save(`SiteSnap-${floorPlan.name.replace(/[^a-z0-9]/gi, '_')}-Report.pdf`);
}

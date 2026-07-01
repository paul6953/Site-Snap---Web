// PDF export — US Letter, 72 dpi points.
// Page 1 : full floor plan with coloured numbered markers + optional legend.
// Pages 2+: one section per pin — 2 × 3 photo grid with captions.
//           Each photo page links back to page 1; each floor-plan marker
//           links forward to its photo page (real PDF GoTo annotations).

const PW = 612, PH = 792, M = 36;       // page width/height/margin
const COLS = 2, ROWS = 3;               // photo grid columns/rows
const COL_GAP = 12, ROW_GAP = 12;

const cellW = (PW - M * 2 - COL_GAP) / COLS;            // 264
const HDR_H = 62;                                         // per-pin page header height
const gridH = PH - M - (M + HDR_H);                      // available grid height
const cellH = (gridH - ROW_GAP * (ROWS - 1)) / ROWS;     // per cell
const imgH  = cellH - 26;                                 // photo image height (26 for caption)
const CELLS_PER_PAGE = COLS * ROWS;                       // 6

// ─── Helpers ────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#d62828');
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) }
           : { r: 214, g: 40, b: 40 };
}

function dataUrlFormat(dataUrl) {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
}

async function loadMeta(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight, url });
    img.onerror = reject;
    img.src = url;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function aspectFitRect(iw, ih, box) {
  const s = Math.min(box.w / iw, box.h / ih);
  return { x: box.x + (box.w - iw * s) / 2, y: box.y + (box.h - ih * s) / 2, w: iw * s, h: ih * s };
}

function drawPinMarker(doc, num, cx, cy, colorHex) {
  const r = 10;
  const { r: cr, g: cg, b: cb } = hexToRgb(colorHex);
  doc.setFillColor(cr, cg, cb);
  doc.circle(cx, cy, r, 'F');
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(1.5);
  doc.circle(cx, cy, r - 0.5, 'S');
  doc.setTextColor(255, 255, 255);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(9);
  doc.text(String(num), cx, cy, { align: 'center', baseline: 'middle' });
}

// ─── Main export function ────────────────────────────────────────────────────

async function exportFloorPlanPdf(floorPlan, pins, photosByPin) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  // Pre-compute first-page number for each pin (for GoTo links)
  let pageCounter = 2;
  const firstPage = pins.map((pin) => {
    const start = pageCounter;
    const photos = photosByPin[pin.id] || [];
    pageCounter += Math.max(1, Math.ceil(photos.length / CELLS_PER_PAGE));
    return start;
  });

  // ── Page 1: floor plan overview ──────────────────────────────────────────
  const fpMeta = await loadMeta(floorPlan.imageBlob);
  const fpUrl  = await blobToDataUrl(floorPlan.imageBlob);
  const fpFmt  = dataUrlFormat(fpUrl);
  URL.revokeObjectURL(fpMeta.url);

  // Title
  doc.setFont(undefined, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 34, 64);
  doc.text(floorPlan.name, M, M + 12);

  // Legend (show if any pin has a name)
  const namedPins = pins.filter((p) => p.name);
  const legendH = namedPins.length ? Math.min(namedPins.length, 8) * 14 + 20 : 0;

  const imageBox = { x: M, y: M + 28, w: PW - M * 2, h: PH - M * 2 - 28 - legendH - (legendH ? 10 : 0) };
  const fit = aspectFitRect(fpMeta.w, fpMeta.h, imageBox);
  doc.addImage(fpUrl, fpFmt, fit.x, fit.y, fit.w, fit.h);

  // Draw coloured markers + add GoTo links
  pins.forEach((pin, i) => {
    const cx = fit.x + pin.xNorm * fit.w;
    const cy = fit.y + pin.yNorm * fit.h;
    drawPinMarker(doc, i + 1, cx, cy, pin.color);
    doc.link(cx - 11, cy - 11, 22, 22, { pageNumber: firstPage[i] });
  });

  // Legend block
  if (legendH) {
    const ly0 = fit.y + fit.h + 10;
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text('LEGEND', M, ly0 + 8);
    namedPins.slice(0, 8).forEach((pin, i) => {
      const idx = pins.indexOf(pin);
      const ly = ly0 + 20 + i * 14;
      const { r, g, b } = hexToRgb(pin.color);
      doc.setFillColor(r, g, b);
      doc.circle(M + 5, ly, 4, 'F');
      doc.setFont(undefined, 'normal');
      doc.setTextColor(30, 30, 30);
      doc.text(`${idx + 1}  ${pin.name}`, M + 14, ly + 1, { baseline: 'middle' });
    });
  }

  // ── Per-pin pages ─────────────────────────────────────────────────────────
  for (let i = 0; i < pins.length; i++) {
    const pin    = pins[i];
    const photos = photosByPin[pin.id] || [];
    const pages  = Math.max(1, Math.ceil(photos.length / CELLS_PER_PAGE));

    for (let p = 0; p < pages; p++) {
      doc.addPage();

      // Back link
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(30, 80, 180);
      doc.text('‹ Floor Plan', M, M + 5);
      doc.link(M, M - 4, 60, 12, { pageNumber: 1 });

      // Pin header
      const pinLabel = `Pin ${i + 1}${pin.name ? '  —  ' + pin.name : ''}`;
      doc.setFont(undefined, 'bold');
      doc.setFontSize(15);
      doc.setTextColor(15, 34, 64);
      doc.text(pinLabel, M, M + 22);

      // Colour swatch next to pin number
      const { r: cr, g: cg, b: cb } = hexToRgb(pin.color);
      doc.setFillColor(cr, cg, cb);
      doc.circle(PW - M - 8, M + 18, 7, 'F');

      if (pin.note) {
        doc.setFont(undefined, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(90, 90, 90);
        doc.text(pin.note, M, M + 38, { maxWidth: PW - M * 2 });
      }

      if (photos.length === 0) {
        doc.setFontSize(10);
        doc.setTextColor(150, 150, 150);
        doc.text('No photos yet.', M, M + HDR_H + 20);
        continue;
      }

      const slice = photos.slice(p * CELLS_PER_PAGE, (p + 1) * CELLS_PER_PAGE);
      const gridTop = M + HDR_H;

      for (let s = 0; s < slice.length; s++) {
        const photo = slice[s];
        const col   = s % COLS;
        const row   = Math.floor(s / COLS);
        const cellX = M + col * (cellW + COL_GAP);
        const cellY = gridTop + row * (cellH + ROW_GAP);

        const meta   = await loadMeta(photo.blob);
        const dataUrl = await blobToDataUrl(photo.blob);
        const fmt    = dataUrlFormat(dataUrl);
        URL.revokeObjectURL(meta.url);

        const imgRect = aspectFitRect(meta.w, meta.h, { x: cellX, y: cellY, w: cellW, h: imgH });
        doc.addImage(dataUrl, fmt, imgRect.x, imgRect.y, imgRect.w, imgRect.h);

        // Thin border around image
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.5);
        doc.rect(imgRect.x, imgRect.y, imgRect.w, imgRect.h, 'S');

        // Date
        const captionY = cellY + imgH + 8;
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(110, 110, 110);
        doc.text(new Date(photo.capturedAt).toLocaleString(), cellX, captionY);

        // User caption
        if (photo.caption) {
          doc.setFont(undefined, 'bold');
          doc.setFontSize(8.5);
          doc.setTextColor(30, 30, 30);
          doc.text(photo.caption, cellX, captionY + 12, { maxWidth: cellW });
        }
      }

      // Page number footer
      const totalPages = firstPage[i] + pages - 2;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(7);
      doc.setTextColor(160, 160, 160);
      doc.text(`Pin ${i + 1}  —  Page ${p + 1} of ${pages}`, PW - M, PH - M + 4, { align: 'right' });
    }
  }

  doc.save(`SiteSnap-${floorPlan.name.replace(/[^a-z0-9]/gi, '_')}-Report.pdf`);
}

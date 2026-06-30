// PDF export. Markers on the floor-plan page are real PDF "GoTo" link
// annotations (doc.link with a pageNumber target) pointing at each pin's
// photo-log page — these are native PDF navigation, so they work in any PDF
// reader, offline, with no JavaScript or network required by the viewer.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;

function loadImageMeta(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, url });
    img.onerror = reject;
    img.src = url;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function aspectFitRect(imgW, imgH, container) {
  const scale = Math.min(container.w / imgW, container.h / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return {
    x: container.x + (container.w - w) / 2,
    y: container.y + (container.h - h) / 2,
    w, h,
  };
}

function drawPinMarker(doc, number, cx, cy) {
  const r = 10;
  doc.setFillColor(214, 40, 40);
  doc.circle(cx, cy, r, 'F');
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(1);
  doc.circle(cx, cy, r - 1, 'S');
  doc.setTextColor(255, 255, 255);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.text(String(number), cx, cy, { align: 'center', baseline: 'middle' });
}

async function exportFloorPlanPdf(floorPlan, pins, photosByPin) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  // Precompute which page each pin's photo log starts on, so the floor-plan
  // page's links can target pages that don't exist yet (jsPDF resolves the
  // pageNumber lazily once the document is finalized).
  const cols = 2, rows = 2, cellsPerPage = cols * rows;
  let pageCounter = 2; // page 1 is the floor plan overview
  const startPage = [];
  for (const pin of pins) {
    startPage.push(pageCounter);
    const photoCount = Math.max(1, (photosByPin[pin.id] || []).length);
    pageCounter += Math.ceil(photoCount / cellsPerPage);
  }

  // --- Page 1: floor plan with numbered, clickable pin markers ---
  doc.setFont(undefined, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20, 20, 20);
  doc.text(floorPlan.name, MARGIN, MARGIN + 10);

  const contentRect = { x: MARGIN, y: MARGIN + 30, w: PAGE_W - MARGIN * 2, h: PAGE_H - MARGIN * 2 - 30 };
  const fpMeta = await loadImageMeta(floorPlan.imageBlob);
  const fpDataUrl = await blobToDataUrl(floorPlan.imageBlob);
  const fitRect = aspectFitRect(fpMeta.width, fpMeta.height, contentRect);
  doc.addImage(fpDataUrl, 'JPEG', fitRect.x, fitRect.y, fitRect.w, fitRect.h);
  URL.revokeObjectURL(fpMeta.url);

  pins.forEach((pin, index) => {
    const cx = fitRect.x + pin.xNorm * fitRect.w;
    const cy = fitRect.y + pin.yNorm * fitRect.h;
    drawPinMarker(doc, index + 1, cx, cy);
    const r = 10;
    doc.link(cx - r, cy - r, r * 2, r * 2, { pageNumber: startPage[index] });
  });

  // --- Subsequent pages: per-pin photo log ---
  const contentWidth = PAGE_W - MARGIN * 2;
  const headerHeight = 50;
  const gridTop = MARGIN + headerHeight;
  const spacing = 14;
  const cellWidth = (contentWidth - spacing) / cols;
  const gridAvailableHeight = PAGE_H - MARGIN - gridTop;
  const cellHeight = (gridAvailableHeight - spacing) / rows;
  const imageHeight = cellWidth * 0.75;

  for (let i = 0; i < pins.length; i++) {
    const pin = pins[i];
    const photos = photosByPin[pin.id] || [];
    const pageCount = Math.max(1, Math.ceil(photos.length / cellsPerPage));

    for (let p = 0; p < pageCount; p++) {
      doc.addPage();
      doc.setFont(undefined, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(40, 90, 200);
      doc.text('< Back to Floor Plan', MARGIN, MARGIN + 4);
      doc.link(MARGIN, MARGIN - 8, 110, 14, { pageNumber: 1 });

      doc.setFont(undefined, 'bold');
      doc.setFontSize(14);
      doc.setTextColor(20, 20, 20);
      const title = `Pin ${i + 1}` + (pin.note ? ` — ${pin.note}` : '');
      doc.text(title, MARGIN, MARGIN + 26);

      if (photos.length === 0) {
        doc.setFont(undefined, 'normal');
        doc.setFontSize(11);
        doc.setTextColor(120, 120, 120);
        doc.text('No photos.', MARGIN, gridTop + 20);
        continue;
      }

      const pageSlice = photos.slice(p * cellsPerPage, (p + 1) * cellsPerPage);
      for (let slot = 0; slot < pageSlice.length; slot++) {
        const photo = pageSlice[slot];
        const col = slot % cols;
        const row = Math.floor(slot / cols);
        const cellX = MARGIN + col * (cellWidth + spacing);
        const cellY = gridTop + row * (cellHeight + spacing);

        const meta = await loadImageMeta(photo.blob);
        const dataUrl = await blobToDataUrl(photo.blob);
        const imgRect = aspectFitRect(meta.width, meta.height, { x: cellX, y: cellY, w: cellWidth, h: imageHeight });
        doc.addImage(dataUrl, 'JPEG', imgRect.x, imgRect.y, imgRect.w, imgRect.h);
        URL.revokeObjectURL(meta.url);

        doc.setFont(undefined, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(90, 90, 90);
        const caption = new Date(photo.capturedAt).toLocaleString();
        doc.text(caption, cellX, cellY + imageHeight + 14);
        if (photo.note) {
          doc.setTextColor(40, 40, 40);
          doc.text(photo.note, cellX, cellY + imageHeight + 28, { maxWidth: cellWidth });
        }
      }
    }
  }

  doc.save(`SiteSnap-${floorPlan.name}-Report.pdf`);
}

// Rasterizes page 1 of an imported PDF floor plan into a PNG blob, so the
// rest of the app (floor plan view, IndexedDB, PDF export) only ever has to
// deal with plain raster images, regardless of what format was imported.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';

async function renderPdfFirstPageToBlob(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);

  const baseViewport = page.getViewport({ scale: 1 });
  const targetMaxDimension = 2200;
  const scale = Math.min(4, targetMaxDimension / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not rasterize PDF page.'));
    }, 'image/png');
  });
}

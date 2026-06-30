// ─── DOM refs ────────────────────────────────────────────────────────────────
const screenHome      = document.getElementById('screen-home');
const screenFloorPlan = document.getElementById('screen-floorplan');
const floorPlanList   = document.getElementById('floorplan-list');
const emptyState      = document.getElementById('empty-state');
const importBtn       = document.getElementById('import-btn');
const importInput     = document.getElementById('import-input');

const backBtn         = document.getElementById('back-btn');
const fpTitle         = document.getElementById('fp-title');
const fpContainer     = document.getElementById('fp-container');
const exportBtn       = document.getElementById('export-btn');

const loadingOverlay  = document.getElementById('loading-overlay');
const loadingText     = document.getElementById('loading-text');

const photoViewer     = document.getElementById('photo-viewer');
const pvImage         = document.getElementById('pv-image');
const pvCaption       = document.getElementById('pv-caption');
const pvNote          = document.getElementById('pv-note');
const pvPosition      = document.getElementById('pv-position');
const pvPrev          = document.getElementById('pv-prev');
const pvNext          = document.getElementById('pv-next');
const pvClose         = document.getElementById('pv-close');
const pvAddPhoto      = document.getElementById('pv-add-photo');
const pvDelete        = document.getElementById('pv-delete');

// ─── State ───────────────────────────────────────────────────────────────────
let homeThumbUrls        = [];
let currentFloorPlan     = null;
let currentFpImageUrl    = null;
let currentFloorPlanView = null;
let currentPins          = [];

let viewerPin    = null;
let viewerPhotos = [];
let viewerIndex  = 0;
let viewerImgUrl = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function showLoading(text) { loadingText.textContent = text; loadingOverlay.style.display = 'flex'; }
function hideLoading()     { loadingOverlay.style.display = 'none'; }

function showScreen(name) {
  screenHome.style.display      = name === 'home'      ? 'flex' : 'none';
  screenFloorPlan.style.display = name === 'floorplan' ? 'flex' : 'none';
}

// ─── Home screen ─────────────────────────────────────────────────────────────
async function renderHome() {
  homeThumbUrls.forEach((u) => URL.revokeObjectURL(u));
  homeThumbUrls = [];
  const fps = await DB.getFloorPlans();
  floorPlanList.innerHTML = '';
  emptyState.style.display = fps.length === 0 ? 'block' : 'none';

  for (const fp of fps) {
    const thumbUrl = URL.createObjectURL(fp.imageBlob);
    homeThumbUrls.push(thumbUrl);
    const card = document.createElement('div');
    card.className = 'fp-card';
    card.innerHTML = `
      <img src="${thumbUrl}" />
      <div class="fp-card-info">
        <div class="fp-card-name"></div>
        <div class="fp-card-meta"></div>
      </div>
    `;
    card.querySelector('.fp-card-name').textContent = fp.name;
    card.querySelector('.fp-card-meta').textContent = new Date(fp.createdAt).toLocaleDateString();
    card.addEventListener('click', () => openFloorPlan(fp.id));
    floorPlanList.appendChild(card);
  }
}

importBtn.addEventListener('click', () => importInput.click());

importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  importInput.value = '';
  if (!file) return;
  const name = file.name.replace(/\.[^/.]+$/, '') || 'Floor Plan';
  let imageBlob = file;

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    showLoading('Converting PDF…');
    try { imageBlob = await renderPdfFirstPageToBlob(file); }
    catch (err) { hideLoading(); alert('Could not read that PDF: ' + err.message); return; }
    hideLoading();
  }

  const fp = await DB.addFloorPlan({ name, imageBlob });
  await openFloorPlan(fp.id);
});

// ─── Floor plan screen ───────────────────────────────────────────────────────
async function openFloorPlan(id) {
  const fp = await DB.getFloorPlan(id);
  if (!fp) return;
  currentFloorPlan = fp;
  currentPins      = await DB.getPinsForFloorPlan(id);
  fpTitle.textContent = fp.name;
  showScreen('floorplan');

  if (currentFpImageUrl) URL.revokeObjectURL(currentFpImageUrl);
  currentFpImageUrl = URL.createObjectURL(fp.imageBlob);

  const dims = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = currentFpImageUrl;
  });

  if (currentFloorPlanView) currentFloorPlanView.destroy();
  currentFloorPlanView = createFloorPlanView(fpContainer, {
    imageUrl:      currentFpImageUrl,
    naturalWidth:  dims.w,
    naturalHeight: dims.h,
    onTapEmpty: handleTapEmpty,
    onTapPin:   handleTapPin,
  });
  currentFloorPlanView.setPins(currentPins);
}

// Tap empty spot → open camera → pin photo at that location
async function handleTapEmpty(xNorm, yNorm) {
  const blob = await Camera.capture();
  if (!blob) return;
  const pin = await DB.addPin({ floorPlanId: currentFloorPlan.id, xNorm, yNorm });
  await DB.addPhoto({ pinId: pin.id, blob });
  currentPins = await DB.getPinsForFloorPlan(currentFloorPlan.id);
  currentFloorPlanView.setPins(currentPins);
}

// Tap existing pin → open photo viewer
async function handleTapPin(pin) {
  viewerPin    = pin;
  viewerPhotos = await DB.getPhotosForPin(pin.id);
  viewerIndex  = viewerPhotos.length - 1;
  pvNote.value = pin.note || '';
  photoViewer.style.display = 'flex';
  renderViewerPhoto();
}

backBtn.addEventListener('click', () => {
  if (currentFloorPlanView) { currentFloorPlanView.destroy(); currentFloorPlanView = null; }
  if (currentFpImageUrl)    { URL.revokeObjectURL(currentFpImageUrl); currentFpImageUrl = null; }
  currentFloorPlan = null;
  showScreen('home');
  renderHome();
});

exportBtn.addEventListener('click', async () => {
  if (!currentFloorPlan || currentPins.length === 0) {
    alert('Add at least one photo pin before exporting.');
    return;
  }
  showLoading('Generating PDF…');
  try {
    const photosByPin = {};
    for (const pin of currentPins) {
      photosByPin[pin.id] = await DB.getPhotosForPin(pin.id);
    }
    await exportFloorPlanPdf(currentFloorPlan, currentPins, photosByPin);
  } catch (err) {
    alert('Export failed: ' + err.message);
  } finally {
    hideLoading();
  }
});

// ─── Photo viewer ─────────────────────────────────────────────────────────────
function renderViewerPhoto() {
  if (viewerImgUrl) { URL.revokeObjectURL(viewerImgUrl); viewerImgUrl = null; }
  if (!viewerPhotos.length) {
    pvImage.removeAttribute('src');
    pvCaption.textContent = 'No photos.';
    pvPosition.textContent = '';
    return;
  }
  const photo = viewerPhotos[viewerIndex];
  viewerImgUrl = URL.createObjectURL(photo.blob);
  pvImage.src = viewerImgUrl;
  pvCaption.textContent = new Date(photo.capturedAt).toLocaleString();
  pvPosition.textContent = `${viewerIndex + 1} / ${viewerPhotos.length}`;
}

pvPrev.addEventListener('click', () => {
  if (!viewerPhotos.length) return;
  viewerIndex = (viewerIndex - 1 + viewerPhotos.length) % viewerPhotos.length;
  renderViewerPhoto();
});
pvNext.addEventListener('click', () => {
  if (!viewerPhotos.length) return;
  viewerIndex = (viewerIndex + 1) % viewerPhotos.length;
  renderViewerPhoto();
});
pvNote.addEventListener('change', async () => {
  if (!viewerPin) return;
  await DB.updatePinNote(viewerPin.id, pvNote.value.trim());
  viewerPin.note = pvNote.value.trim() || null;
});
pvAddPhoto.addEventListener('click', async () => {
  if (!viewerPin) return;
  const blob = await Camera.capture();
  if (!blob) return;
  await DB.addPhoto({ pinId: viewerPin.id, blob });
  viewerPhotos = await DB.getPhotosForPin(viewerPin.id);
  viewerIndex  = viewerPhotos.length - 1;
  renderViewerPhoto();
});
pvDelete.addEventListener('click', async () => {
  if (!viewerPin || !viewerPhotos.length) return;
  if (!confirm('Delete this photo?')) return;
  await DB.deletePhoto(viewerPhotos[viewerIndex].id);
  viewerPhotos = await DB.getPhotosForPin(viewerPin.id);
  viewerIndex  = Math.max(0, Math.min(viewerIndex, viewerPhotos.length - 1));
  renderViewerPhoto();
});
pvClose.addEventListener('click', async () => {
  photoViewer.style.display = 'none';
  if (viewerImgUrl) { URL.revokeObjectURL(viewerImgUrl); viewerImgUrl = null; }
  viewerPin = null; viewerPhotos = [];
  if (currentFloorPlan) {
    currentPins = await DB.getPinsForFloorPlan(currentFloorPlan.id);
    if (currentFloorPlanView) currentFloorPlanView.setPins(currentPins);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
renderHome();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

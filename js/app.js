const screenHome = document.getElementById('screen-home');
const screenFloorPlan = document.getElementById('screen-floorplan');
const floorPlanList = document.getElementById('floorplan-list');
const emptyState = document.getElementById('empty-state');
const importBtn = document.getElementById('import-btn');
const importInput = document.getElementById('import-input');
const backBtn = document.getElementById('back-btn');
const calibrateBtn = document.getElementById('calibrate-btn');
const exportBtn = document.getElementById('export-btn');
const fpTitle = document.getElementById('fp-title');
const fpContainer = document.getElementById('fp-container');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

const photoViewer = document.getElementById('photo-viewer');
const pvImage = document.getElementById('pv-image');
const pvCaption = document.getElementById('pv-caption');
const pvNote = document.getElementById('pv-note');
const pvPosition = document.getElementById('pv-position');
const pvDistance = document.getElementById('pv-distance');
const pvPrev = document.getElementById('pv-prev');
const pvNext = document.getElementById('pv-next');
const pvClose = document.getElementById('pv-close');
const pvAddPhoto = document.getElementById('pv-add-photo');
const pvDelete = document.getElementById('pv-delete');

let homeThumbUrls = [];
let currentFloorPlan = null;
let currentFpImageUrl = null;
let currentFloorPlanView = null;
let currentFpDims = null;
let currentPins = [];

let viewerPin = null;
let viewerPhotos = [];
let viewerIndex = 0;
let viewerImageUrl = null;

function showLoading(text) {
  loadingText.textContent = text;
  loadingOverlay.style.display = 'flex';
}
function hideLoading() {
  loadingOverlay.style.display = 'none';
}

function showScreen(name) {
  screenHome.style.display = name === 'home' ? 'flex' : 'none';
  screenFloorPlan.style.display = name === 'floorplan' ? 'flex' : 'none';
}

// --- Home screen ---

async function renderHome() {
  homeThumbUrls.forEach((u) => URL.revokeObjectURL(u));
  homeThumbUrls = [];

  const floorPlans = await DB.getFloorPlans();
  floorPlanList.innerHTML = '';
  emptyState.style.display = floorPlans.length === 0 ? 'block' : 'none';

  for (const fp of floorPlans) {
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
    try {
      imageBlob = await renderPdfFirstPageToBlob(file);
    } catch (err) {
      hideLoading();
      alert('Could not read that PDF: ' + err.message);
      return;
    }
    hideLoading();
  }

  const fp = await DB.addFloorPlan({ name, imageBlob });
  await openFloorPlan(fp.id);
});

// --- Floor plan screen ---

async function openFloorPlan(id) {
  const fp = await DB.getFloorPlan(id);
  if (!fp) return;
  currentFloorPlan = fp;
  currentPins = await DB.getPinsForFloorPlan(id);

  fpTitle.textContent = fp.name;
  showScreen('floorplan');

  if (currentFpImageUrl) URL.revokeObjectURL(currentFpImageUrl);
  currentFpImageUrl = URL.createObjectURL(fp.imageBlob);

  const dims = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = currentFpImageUrl;
  });
  currentFpDims = dims;

  if (currentFloorPlanView) currentFloorPlanView.destroy();
  currentFloorPlanView = createFloorPlanView(fpContainer, {
    imageUrl: currentFpImageUrl,
    naturalWidth: dims.w,
    naturalHeight: dims.h,
    onTapEmpty: handleTapEmpty,
    onTapPin: handleTapPin,
  });
  currentFloorPlanView.setPins(currentPins);
}

async function handleTapEmpty(xNorm, yNorm) {
  const blob = await Camera.capture();
  if (!blob) return;
  const pin = await DB.addPin({ floorPlanId: currentFloorPlan.id, xNorm, yNorm });
  await DB.addPhoto({ pinId: pin.id, blob });
  currentPins = await DB.getPinsForFloorPlan(currentFloorPlan.id);
  currentFloorPlanView.setPins(currentPins);
}

async function handleTapPin(pin) {
  await openPhotoViewer(pin);
}

function pixelDistanceBetween(a, b, dims) {
  const dx = (b.xNorm - a.xNorm) * dims.w;
  const dy = (b.yNorm - a.yNorm) * dims.h;
  return Math.hypot(dx, dy);
}

function parseDistanceInput(input) {
  const match = input.trim().match(/^([\d.]+)\s*(m|meters?|ft|feet|')?$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!isFinite(value) || value <= 0) return null;
  const unitRaw = (match[2] || 'm').toLowerCase();
  const isFeet = unitRaw.startsWith('f') || unitRaw === "'";
  return { meters: isFeet ? value * 0.3048 : value, unit: isFeet ? 'ft' : 'm' };
}

function formatPinDistance(pinA, pinB) {
  const cal = currentFloorPlan && currentFloorPlan.calibration;
  if (!cal || !currentFpDims) return null;
  const calPixelDist = pixelDistanceBetween(cal.p1, cal.p2, currentFpDims);
  if (!calPixelDist) return null;
  const metersPerPixel = cal.realMeters / calPixelDist;
  const pixelDist = pixelDistanceBetween(pinA, pinB, currentFpDims);
  const meters = pixelDist * metersPerPixel;
  const display = cal.unit === 'ft' ? meters / 0.3048 : meters;
  return `${display.toFixed(1)} ${cal.unit}`;
}

calibrateBtn.addEventListener('click', () => {
  if (!currentFloorPlanView) return;
  if (currentFloorPlanView.isCalibrating()) {
    currentFloorPlanView.cancelCalibration();
    return;
  }
  alert('Tap two points on the floor plan that are a known real-world distance apart (e.g. both ends of a hallway).');
  currentFloorPlanView.startCalibration(async (p1, p2) => {
    const input = prompt('Real-world distance between those two points? (e.g. "12 m" or "40 ft")');
    if (!input) return;
    const parsed = parseDistanceInput(input);
    if (!parsed) {
      alert('Could not understand that distance. Try a format like "12 m" or "40 ft".');
      return;
    }
    const calibration = { p1, p2, realMeters: parsed.meters, unit: parsed.unit };
    await DB.updateFloorPlanCalibration(currentFloorPlan.id, calibration);
    currentFloorPlan.calibration = calibration;
    alert('Scale calibrated. Pin-to-pin distances will now show when viewing a pin.');
  });
});

backBtn.addEventListener('click', () => {
  if (currentFloorPlanView) {
    if (currentFloorPlanView.isCalibrating()) currentFloorPlanView.cancelCalibration();
    currentFloorPlanView.destroy();
    currentFloorPlanView = null;
  }
  if (currentFpImageUrl) {
    URL.revokeObjectURL(currentFpImageUrl);
    currentFpImageUrl = null;
  }
  currentFloorPlan = null;
  showScreen('home');
  renderHome();
});

exportBtn.addEventListener('click', async () => {
  if (!currentFloorPlan || currentPins.length === 0) {
    alert('Add at least one pin before exporting.');
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

// --- Photo viewer modal ---

async function openPhotoViewer(pin) {
  viewerPin = pin;
  viewerPhotos = await DB.getPhotosForPin(pin.id);
  viewerIndex = viewerPhotos.length - 1;
  pvNote.value = pin.note || '';

  const idx = currentPins.findIndex((p) => p.id === pin.id);
  const prevPin = idx > 0 ? currentPins[idx - 1] : null;
  const distance = prevPin ? formatPinDistance(prevPin, pin) : null;
  pvDistance.textContent = distance ? `${distance} from previous pin` : '';

  photoViewer.style.display = 'flex';
  renderViewerPhoto();
}

function renderViewerPhoto() {
  if (viewerImageUrl) {
    URL.revokeObjectURL(viewerImageUrl);
    viewerImageUrl = null;
  }
  if (viewerPhotos.length === 0) {
    pvImage.removeAttribute('src');
    pvCaption.textContent = 'No photos yet.';
    pvPosition.textContent = '';
    return;
  }
  const photo = viewerPhotos[viewerIndex];
  viewerImageUrl = URL.createObjectURL(photo.blob);
  pvImage.src = viewerImageUrl;
  pvCaption.textContent = new Date(photo.capturedAt).toLocaleString();
  pvPosition.textContent = `${viewerIndex + 1} / ${viewerPhotos.length}`;
}

pvPrev.addEventListener('click', () => {
  if (viewerPhotos.length === 0) return;
  viewerIndex = (viewerIndex - 1 + viewerPhotos.length) % viewerPhotos.length;
  renderViewerPhoto();
});
pvNext.addEventListener('click', () => {
  if (viewerPhotos.length === 0) return;
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
  viewerIndex = viewerPhotos.length - 1;
  renderViewerPhoto();
});

pvDelete.addEventListener('click', async () => {
  if (!viewerPin || viewerPhotos.length === 0) return;
  if (!confirm('Delete this photo?')) return;
  const photo = viewerPhotos[viewerIndex];
  await DB.deletePhoto(photo.id);
  viewerPhotos = await DB.getPhotosForPin(viewerPin.id);
  viewerIndex = Math.max(0, Math.min(viewerIndex, viewerPhotos.length - 1));
  renderViewerPhoto();
});

pvClose.addEventListener('click', closePhotoViewer);

async function closePhotoViewer() {
  photoViewer.style.display = 'none';
  if (viewerImageUrl) {
    URL.revokeObjectURL(viewerImageUrl);
    viewerImageUrl = null;
  }
  viewerPin = null;
  viewerPhotos = [];
  // Refresh markers in case pin count/order changed (e.g. note updates don't
  // affect ordering, but keep state consistent regardless).
  if (currentFloorPlan) {
    currentPins = await DB.getPinsForFloorPlan(currentFloorPlan.id);
    if (currentFloorPlanView) currentFloorPlanView.setPins(currentPins);
  }
}

// --- Init ---
renderHome();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

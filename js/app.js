// ─── DOM refs ────────────────────────────────────────────────────────────────
const screenHome      = document.getElementById('screen-home');
const screenFloorPlan = document.getElementById('screen-floorplan');
const floorPlanList   = document.getElementById('floorplan-list');
const emptyState      = document.getElementById('empty-state');
const importBtn       = document.getElementById('import-btn');
const importInput     = document.getElementById('import-input');

const backBtn         = document.getElementById('back-btn');
const fpTitle         = document.getElementById('fp-title');
const fpBanner        = document.getElementById('fp-banner');
const fpContainer     = document.getElementById('fp-container');
const exportBtn       = document.getElementById('export-btn');
const takePhotoBtn    = document.getElementById('take-photo-btn');
const gpsStatusEl     = document.getElementById('gps-status');

const loadingOverlay  = document.getElementById('loading-overlay');
const loadingText     = document.getElementById('loading-text');

const photoViewer     = document.getElementById('photo-viewer');
const pvImage         = document.getElementById('pv-image');
const pvCaption       = document.getElementById('pv-caption');
const pvNote          = document.getElementById('pv-note');
const pvPosition      = document.getElementById('pv-position');
const pvDistance      = document.getElementById('pv-distance');
const pvPrev          = document.getElementById('pv-prev');
const pvNext          = document.getElementById('pv-next');
const pvClose         = document.getElementById('pv-close');
const pvAddPhoto      = document.getElementById('pv-add-photo');
const pvDelete        = document.getElementById('pv-delete');

// ─── State ───────────────────────────────────────────────────────────────────
let homeThumbUrls     = [];
let currentFloorPlan  = null;
let currentFpImageUrl = null;
let currentFpDims     = null;
let currentFloorPlanView = null;
let currentPins       = [];
let calibrationPending = false;
let gpsUnsubscribe    = null;
let smoothedPos       = null;   // exponential-moving-average position on the floor plan
let lastPosTime       = 0;      // ms timestamp of the last accepted GPS fix

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

function setBanner(text) {
  fpBanner.textContent    = text || '';
  fpBanner.style.display  = text ? 'block' : 'none';
}

function updateGpsStatus(pos) {
  if (!gpsStatusEl) return;
  if (!pos) { gpsStatusEl.textContent = 'GPS: searching…'; gpsStatusEl.className = 'gps-status gps-weak'; return; }
  const acc = Math.round(pos.accuracy);
  if (acc <= 20) {
    gpsStatusEl.textContent = `GPS: ±${acc}m`;
    gpsStatusEl.className = 'gps-status gps-good';
  } else if (acc <= 60) {
    gpsStatusEl.textContent = `GPS: ±${acc}m`;
    gpsStatusEl.className = 'gps-status gps-ok';
  } else {
    gpsStatusEl.textContent = `GPS: weak (±${acc}m)`;
    gpsStatusEl.className = 'gps-status gps-weak';
  }
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
    card.querySelector('.fp-card-meta').textContent =
      new Date(fp.createdAt).toLocaleDateString() + (fp.calibration ? '  ✓ calibrated' : '  — needs calibration');
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

  currentFpDims = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = currentFpImageUrl;
  });

  if (currentFloorPlanView) currentFloorPlanView.destroy();
  currentFloorPlanView = createFloorPlanView(fpContainer, {
    imageUrl: currentFpImageUrl,
    naturalWidth:  currentFpDims.w,
    naturalHeight: currentFpDims.h,
    onTapPin: handleTapPin,
  });
  currentFloorPlanView.setPins(currentPins);

  // Start GPS always so it's ready for calibration and photo capture.
  GPS.start();
  GPS.onUpdate(updateGpsStatus);

  calibrationPending = !fp.calibration;
  if (calibrationPending) {
    setBanner('Step 1 of 2: Go outdoors for best GPS. Stand at a known spot (e.g. a column or door corner), then tap that exact location on the floor plan. Choose two points ≥ 10 m apart for best accuracy.');
    runCalibrationStep();
  } else {
    setBanner('');
    startLiveTracking();
  }
}

// ─── GPS calibration (2-point GPS anchor flow) ───────────────────────────────
let calibFirst = null;

function runCalibrationStep() {
  if (!currentFloorPlanView) return;
  if (currentFloorPlanView.isCalibrating()) return;

  currentFloorPlanView.startCalibration(async (point, tapIndex) => {
    try {
      const gps = GPS.getPosition();
      if (!gps) {
        alert('No GPS fix yet.\n\nMake sure Location Services are enabled for this site in Safari Settings, wait for the GPS bar to turn green, then tap the two points again.');
        calibFirst = null;
        currentFloorPlanView.cancelCalibration();
        currentFloorPlanView.clearCalibMarkers();
        setBanner('Step 1 of 2: Stand at a known spot, then tap that exact location on the floor plan.');
        setTimeout(runCalibrationStep, 50);
        return;
      }

      if (tapIndex === 1) {
        calibFirst = { xNorm: point.xNorm, yNorm: point.yNorm, lat: gps.lat, lng: gps.lng };
        setBanner('Step 2 of 2: Walk to a DIFFERENT reference point, stand there, then tap that location.');
      } else if (tapIndex === 2) {
        if (!calibFirst) {
          // Should not happen, but guard against it
          alert('Something went wrong — please tap the two reference points again.');
          currentFloorPlanView.clearCalibMarkers();
          setBanner('Step 1 of 2: Stand at a known spot, then tap that exact location on the floor plan.');
          setTimeout(runCalibrationStep, 50);
          return;
        }
        const p2 = { xNorm: point.xNorm, yNorm: point.yNorm, lat: gps.lat, lng: gps.lng };
        await saveCalibration(calibFirst, p2);
      }
    } catch (err) {
      console.error('Calibration error:', err);
      alert('Calibration error: ' + err.message + '\n\nPlease try again.');
      calibFirst = null;
      currentFloorPlanView.clearCalibMarkers();
      setBanner('Step 1 of 2: Stand at a known spot, then tap that exact location on the floor plan.');
      setTimeout(runCalibrationStep, 50);
    }
  });
}

async function saveCalibration(p1, p2) {
  const calibration = { p1, p2 };
  await DB.updateFloorPlanCalibration(currentFloorPlan.id, calibration);
  currentFloorPlan.calibration = calibration;
  currentFloorPlanView.clearCalibMarkers();
  calibrationPending = false;
  setBanner('');
  alert('Calibration done! Your live position now appears on the floor plan. Use the "Take Photo" button at the bottom to document locations.');
  startLiveTracking();
}

// Manual recalibration via toolbar button
function recalibrate() {
  if (!currentFloorPlanView) return;
  calibFirst = null;
  calibrationPending = true;
  currentFloorPlanView.clearLivePosition();
  if (gpsUnsubscribe) { gpsUnsubscribe(); gpsUnsubscribe = null; }
  setBanner('Step 1 of 2: Stand at a known spot, then tap that exact location on the floor plan.');
  if (currentFloorPlanView.isCalibrating()) currentFloorPlanView.cancelCalibration();
  runCalibrationStep();
}
document.getElementById('calibrate-btn').addEventListener('click', recalibrate);

// ─── Live GPS tracking with smoothing ────────────────────────────────────────
//
// Raw GPS on a phone jumps ±5-20 m between readings even when standing still.
// Three layers of filtering make the live-position dot usable in practice:
//
//  1. Accuracy gate  — drop readings worse than 80 m (pure noise at that level)
//  2. Velocity cap   — walking speed on a site is ≤ 2 m/s; a larger single-
//                      frame jump is a GPS glitch, so we clamp it
//  3. Weighted EMA   — better-accuracy readings pull the smoothed position
//                      toward them faster; poor readings barely move the dot
//
function applyPositionSmoothing(rawCoords, accuracyMetres, ppm, nowMs) {
  const dt = Math.min((nowMs - lastPosTime) / 1000, 2); // seconds since last fix, capped at 2s
  lastPosTime = nowMs;

  if (!smoothedPos) {
    smoothedPos = { xNorm: rawCoords.xNorm, yNorm: rawCoords.yNorm };
    return smoothedPos;
  }

  // Velocity cap: max 2 m/s walking speed → max pixel jump per dt
  const maxPixelJump = 2 * ppm * dt;
  const dxPx = (rawCoords.xNorm - smoothedPos.xNorm) * (currentFpDims?.w || 1);
  const dyPx = (rawCoords.yNorm - smoothedPos.yNorm) * (currentFpDims?.h || 1);
  const jumpPx = Math.hypot(dxPx, dyPx);

  let targetCoords = rawCoords;
  if (jumpPx > maxPixelJump && maxPixelJump > 0) {
    // Clamp the jump to the velocity limit
    const scale = maxPixelJump / jumpPx;
    targetCoords = {
      xNorm: smoothedPos.xNorm + (rawCoords.xNorm - smoothedPos.xNorm) * scale,
      yNorm: smoothedPos.yNorm + (rawCoords.yNorm - smoothedPos.yNorm) * scale,
    };
  }

  // Weighted EMA: alpha ∝ GPS quality. Good fix (5 m) → alpha 0.7 (responsive).
  // Poor fix (50 m) → alpha 0.07 (sluggish but stable).
  const alpha = Math.min(0.85, Math.max(0.05, 3.5 / Math.max(1, accuracyMetres)));
  smoothedPos = {
    xNorm: smoothedPos.xNorm + alpha * (targetCoords.xNorm - smoothedPos.xNorm),
    yNorm: smoothedPos.yNorm + alpha * (targetCoords.yNorm - smoothedPos.yNorm),
  };
  return smoothedPos;
}

function startLiveTracking() {
  if (gpsUnsubscribe) gpsUnsubscribe();
  smoothedPos = null;
  lastPosTime = 0;

  gpsUnsubscribe = GPS.onUpdate((pos) => {
    updateGpsStatus(pos);
    if (!currentFloorPlan?.calibration || !currentFpDims || !currentFloorPlanView) return;

    // Accuracy gate: readings worse than 80 m are useless for positioning
    if (pos.accuracy > 80) return;

    const raw = gpsToFloorPlan(pos.lat, pos.lng, currentFloorPlan.calibration, currentFpDims);
    if (!raw) return;

    const ppm = pixelsPerMetre(currentFloorPlan.calibration, currentFpDims);
    const smooth = applyPositionSmoothing(raw, pos.accuracy, ppm, Date.now());

    currentFloorPlanView.updateLivePosition(
      Math.max(0, Math.min(1, smooth.xNorm)),
      Math.max(0, Math.min(1, smooth.yNorm)),
      pos.accuracy,
      ppm
    );
  });
}

// ─── Take Photo (bottom button) ───────────────────────────────────────────────
takePhotoBtn.addEventListener('click', async () => {
  if (!currentFloorPlan) return;
  if (calibrationPending) {
    alert('Complete calibration first — tap two reference points on the floor plan.');
    return;
  }

  const gps = GPS.getPosition();
  if (!gps) {
    alert('No GPS signal. Enable Location Services for this site, wait a moment, then try again.');
    return;
  }

  const blob = await Camera.capture({ lat: gps.lat, lng: gps.lng });
  if (!blob) return;

  let xNorm = 0.5, yNorm = 0.5;
  const coords = gpsToFloorPlan(gps.lat, gps.lng, currentFloorPlan.calibration, currentFpDims);
  if (coords) {
    xNorm = Math.max(0, Math.min(1, coords.xNorm));
    yNorm = Math.max(0, Math.min(1, coords.yNorm));
  }

  const pin = await DB.addPin({
    floorPlanId: currentFloorPlan.id,
    xNorm, yNorm,
    lat: gps.lat,
    lng: gps.lng,
  });
  await DB.addPhoto({ pinId: pin.id, blob });
  currentPins = await DB.getPinsForFloorPlan(currentFloorPlan.id);
  currentFloorPlanView.setPins(currentPins);
});

// ─── Back ─────────────────────────────────────────────────────────────────────
backBtn.addEventListener('click', () => {
  if (gpsUnsubscribe) { gpsUnsubscribe(); gpsUnsubscribe = null; }
  GPS.stop();
  smoothedPos = null;
  lastPosTime = 0;
  if (currentFloorPlanView) {
    if (currentFloorPlanView.isCalibrating()) currentFloorPlanView.cancelCalibration();
    currentFloorPlanView.destroy();
    currentFloorPlanView = null;
  }
  if (currentFpImageUrl) { URL.revokeObjectURL(currentFpImageUrl); currentFpImageUrl = null; }
  currentFloorPlan = null;
  calibrationPending = false;
  calibFirst = null;
  showScreen('home');
  renderHome();
});

// ─── Export ───────────────────────────────────────────────────────────────────
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

// ─── Tap existing pin → photo viewer ─────────────────────────────────────────
async function handleTapPin(pin) {
  viewerPin    = pin;
  viewerPhotos = await DB.getPhotosForPin(pin.id);
  viewerIndex  = viewerPhotos.length - 1;
  pvNote.value = pin.note || '';

  const idx = currentPins.findIndex((p) => p.id === pin.id);
  const prev = idx > 0 ? currentPins[idx - 1] : null;
  if (prev && currentFloorPlan?.calibration && currentFpDims) {
    const ppm = pixelsPerMetre(currentFloorPlan.calibration, currentFpDims);
    const pixDist = Math.hypot(
      (pin.xNorm - prev.xNorm) * currentFpDims.w,
      (pin.yNorm - prev.yNorm) * currentFpDims.h
    );
    const metres = pixDist / ppm;
    pvDistance.textContent = `${metres.toFixed(1)} m from previous pin`;
  } else {
    pvDistance.textContent = '';
  }

  photoViewer.style.display = 'flex';
  renderViewerPhoto();
}

function renderViewerPhoto() {
  if (viewerImgUrl) { URL.revokeObjectURL(viewerImgUrl); viewerImgUrl = null; }
  if (viewerPhotos.length === 0) {
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
  const gps = GPS.getPosition();
  const blob = await Camera.capture({ lat: gps?.lat, lng: gps?.lng });
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

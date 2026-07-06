// ─── DOM ─────────────────────────────────────────────────────────────────────
const screenHome      = document.getElementById('screen-home');
const screenFP        = document.getElementById('screen-floorplan');
const floorPlanList   = document.getElementById('floorplan-list');
const emptyState      = document.getElementById('empty-state');
const importBtn       = document.getElementById('import-btn');
const importInput     = document.getElementById('import-input');

const backBtn         = document.getElementById('back-btn');
const fpTitle         = document.getElementById('fp-title');
const fpBanner        = document.getElementById('fp-banner');
const fpContainer     = document.getElementById('fp-container');
const editBtn         = document.getElementById('edit-btn');
const exportBtn       = document.getElementById('export-btn');
const editToolbar     = document.getElementById('edit-toolbar');
const addPinBtn       = document.getElementById('add-pin-btn');
const colorDotsEl     = document.getElementById('color-dots');

const labelSheet      = document.getElementById('label-sheet');
const lsName          = document.getElementById('ls-name');
const lsNote          = document.getElementById('ls-note');
const lsCaption       = document.getElementById('ls-caption');
const lsSkip          = document.getElementById('ls-skip');
const lsSave          = document.getElementById('ls-save');

const pinEditSheet    = document.getElementById('pin-edit-sheet');
const pesHeading      = document.getElementById('pes-heading');
const pesName         = document.getElementById('pes-name');
const pesNote         = document.getElementById('pes-note');
const pesColorDots    = document.getElementById('pes-color-dots');
const pesDelete       = document.getElementById('pes-delete');
const pesSave         = document.getElementById('pes-save');

const photoViewer     = document.getElementById('photo-viewer');
const pvImage         = document.getElementById('pv-image');
const pvCaption       = document.getElementById('pv-caption');
const pvPhotoCaption  = document.getElementById('pv-photo-caption');
const pvPinName       = document.getElementById('pv-pin-name');
const pvPosition      = document.getElementById('pv-position');
const pvNote          = document.getElementById('pv-note');
const pvPrev          = document.getElementById('pv-prev');
const pvNext          = document.getElementById('pv-next');
const pvClose         = document.getElementById('pv-close');
const pvAddPhoto      = document.getElementById('pv-add-photo');
const pvDelete        = document.getElementById('pv-delete');

const loadingOverlay  = document.getElementById('loading-overlay');
const loadingText     = document.getElementById('loading-text');

// ─── State ────────────────────────────────────────────────────────────────────
let _permissionRequested = false;
let homeThumbUrls        = [];
let currentFP            = null;
let currentFpUrl         = null;
let currentFpView        = null;
let currentPins          = [];
let editMode             = false;
let addingPin            = false;
let selectedColor        = '#007AFF';
let viewerPin            = null;
let viewerPhotos         = [];
let viewerIndex          = 0;
let viewerImgUrl         = null;
let viewerCurrentPhoto   = null;

// ─── Utils ────────────────────────────────────────────────────────────────────
function showLoading(t) { loadingText.textContent = t; loadingOverlay.style.display = 'flex'; }
function hideLoading()   { loadingOverlay.style.display = 'none'; }
function showScreen(n) {
  screenHome.style.display = n === 'home'      ? 'flex' : 'none';
  screenFP.style.display   = n === 'floorplan' ? 'flex' : 'none';
}

// ─── Home screen ──────────────────────────────────────────────────────────────
async function renderHome() {
  homeThumbUrls.forEach(URL.revokeObjectURL, URL);
  homeThumbUrls = [];
  const fps = await DB.getFloorPlans();
  floorPlanList.innerHTML = '';
  emptyState.style.display = fps.length === 0 ? 'flex' : 'none';

  for (const fp of fps) {
    const thumbUrl = URL.createObjectURL(fp.imageBlob);
    homeThumbUrls.push(thumbUrl);

    const card = document.createElement('div');
    card.className = 'fp-card';
    card.innerHTML = `
      <img class="fp-card-thumb" src="${thumbUrl}" />
      <div class="fp-card-info">
        <div class="fp-card-name"></div>
        <div class="fp-card-meta"></div>
      </div>
      <button class="fp-card-more" aria-label="More options">···</button>
    `;
    card.querySelector('.fp-card-name').textContent = fp.name;
    card.querySelector('.fp-card-meta').textContent = new Date(fp.createdAt).toLocaleDateString();

    card.querySelector('.fp-card-more').addEventListener('click', async (e) => {
      e.stopPropagation();
      showActionSheet([
        { label: 'Rename', action: async () => {
          const n = prompt('Rename floor plan:', fp.name);
          if (n && n.trim() && n.trim() !== fp.name) {
            await DB.renameFloorPlan(fp.id, n.trim()); renderHome();
          }
        }},
        { label: 'Delete', destructive: true, action: async () => {
          if (!confirm(`Delete "${fp.name}"? This cannot be undone.`)) return;
          await DB.deleteFloorPlan(fp.id); renderHome();
        }},
      ]);
    });
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
  let pageWidthPt, pageHeightPt;
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    showLoading('Converting PDF…');
    try {
      const result = await renderPdfFirstPageToBlob(file);
      imageBlob    = result.blob;
      pageWidthPt  = result.pageWidthPt;
      pageHeightPt = result.pageHeightPt;
    }
    catch (err) { hideLoading(); alert('Could not read PDF: ' + err.message); return; }
    hideLoading();
  }
  const fp = await DB.addFloorPlan({ name, imageBlob, pageWidthPt, pageHeightPt });
  await openFloorPlan(fp.id);
});

// ─── Floor plan screen ────────────────────────────────────────────────────────
async function openFloorPlan(id) {
  const fp = await DB.getFloorPlan(id);
  if (!fp) return;
  currentFP   = fp;
  currentPins = await DB.getPinsForFloorPlan(id);
  fpTitle.textContent = fp.name;
  showScreen('floorplan');
  editMode   = false;
  addingPin  = false;
  updateEditUI();

  if (currentFpUrl) URL.revokeObjectURL(currentFpUrl);
  currentFpUrl = URL.createObjectURL(fp.imageBlob);

  const dims = await new Promise((r) => {
    const i = new Image();
    i.onload = () => r({ w: i.naturalWidth, h: i.naturalHeight });
    i.src = currentFpUrl;
  });

  if (currentFpView) currentFpView.destroy();
  currentFpView = createFloorPlanView(fpContainer, {
    imageUrl:      currentFpUrl,
    naturalWidth:  dims.w,
    naturalHeight: dims.h,
    onTapEmpty:    handleTapEmpty,
    onTapPin:      handleTapPin,
    onEditPin:     handleEditPin,
    onPinMoved:    handlePinMoved,
  });
  currentFpView.setPins(currentPins);

  // Pre-warm camera + geolocation permissions once per session.
  if (!_permissionRequested) {
    _permissionRequested = true;
    Camera.requestPermission();
  }
}

// ─── Edit mode ────────────────────────────────────────────────────────────────
function updateEditUI() {
  editBtn.textContent       = editMode ? 'Done' : 'Edit';
  editToolbar.style.display = editMode ? 'flex' : 'none';
  document.querySelector('.color-bar').style.display = editMode ? 'none' : 'flex';
  document.querySelector('.hint').style.display      = editMode ? 'none' : 'block';
  if (currentFpView) currentFpView.setEditMode(editMode);
  if (currentFpView) currentFpView.setPins(currentPins);
}

editBtn.addEventListener('click', () => {
  editMode = !editMode;
  addingPin = false;
  fpBanner.style.display = 'none';
  updateEditUI();
});

addPinBtn.addEventListener('click', () => {
  addingPin = !addingPin;
  fpBanner.textContent   = addingPin ? 'Tap where you want to add a new pin.' : '';
  fpBanner.style.display = addingPin ? 'block' : 'none';
  addPinBtn.textContent  = addingPin ? '✕ Cancel' : '+ Add Pin';
});

// ─── Tap empty area ───────────────────────────────────────────────────────────
async function handleTapEmpty(xNorm, yNorm) {
  // In edit mode only allow taps when the user explicitly pressed + Add Pin
  if (editMode && !addingPin) return;
  const blob = await Camera.capture();
  if (!blob) return;

  const pin   = await DB.addPin({ floorPlanId: currentFP.id, xNorm, yNorm, color: selectedColor });
  const photo = await DB.addPhoto({ pinId: pin.id, blob });
  currentPins = await DB.getPinsForFloorPlan(currentFP.id);
  currentFpView.setPins(currentPins);
  currentFpView.setEditMode(editMode);

  if (editMode) { addingPin = false; fpBanner.style.display = 'none'; addPinBtn.textContent = '+ Add Pin'; }

  await showLabelSheet(pin, photo);
}

// ─── Post-photo label sheet ───────────────────────────────────────────────────
function showLabelSheet(pin, photo) {
  return new Promise((resolve) => {
    lsName.value = pin.name || '';
    lsNote.value = pin.note || '';
    lsCaption.value = '';
    labelSheet.style.display = 'flex';

    const close = async (save) => {
      labelSheet.style.display = 'none';
      lsSkip.onclick = lsSave.onclick = null;
      if (save) {
        const updates = {};
        if (lsName.value.trim())    updates.name = lsName.value.trim();
        if (lsNote.value.trim())    updates.note = lsNote.value.trim();
        if (Object.keys(updates).length) await DB.updatePin(pin.id, updates);
        if (lsCaption.value.trim()) await DB.updatePhotoCaption(photo.id, lsCaption.value.trim());
        currentPins = await DB.getPinsForFloorPlan(currentFP.id);
        currentFpView.setPins(currentPins);
        currentFpView.setEditMode(editMode);
      }
      resolve();
    };
    lsSkip.onclick = () => close(false);
    lsSave.onclick = () => close(true);
  });
}

// ─── Edit-mode pin handlers ───────────────────────────────────────────────────
async function handleEditPin(pin) {
  const idx = currentPins.findIndex((p) => p.id === pin.id);
  pesHeading.textContent = pin.name ? `Edit — ${pin.name}` : `Edit Pin ${idx + 1}`;
  pesName.value = pin.name || '';
  pesNote.value = pin.note || '';

  // Colour selector in edit sheet
  let editPinColor = pin.color || '#ef4444';
  pesColorDots.querySelectorAll('.cdot').forEach((d) => {
    d.classList.toggle('active', d.dataset.color === editPinColor);
    d.onclick = () => {
      editPinColor = d.dataset.color;
      pesColorDots.querySelectorAll('.cdot').forEach((x) => x.classList.remove('active'));
      d.classList.add('active');
    };
  });

  pinEditSheet.style.display = 'flex';

  await new Promise((resolve) => {
    pesDelete.onclick = async () => {
      pinEditSheet.style.display = 'none';
      if (!confirm('Delete this pin and all its photos?')) { resolve(); return; }
      await DB.deletePin(pin.id);
      currentPins = await DB.getPinsForFloorPlan(currentFP.id);
      currentFpView.setPins(currentPins);
      currentFpView.setEditMode(editMode);
      resolve();
    };
    pesSave.onclick = async () => {
      pinEditSheet.style.display = 'none';
      await DB.updatePin(pin.id, {
        name:  pesName.value.trim() || null,
        note:  pesNote.value.trim() || null,
        color: editPinColor,
      });
      currentPins = await DB.getPinsForFloorPlan(currentFP.id);
      currentFpView.setPins(currentPins);
      currentFpView.setEditMode(editMode);
      resolve();
    };
  });
}

async function handlePinMoved(pin, xNorm, yNorm) {
  await DB.updatePin(pin.id, { xNorm, yNorm });
  currentPins = await DB.getPinsForFloorPlan(currentFP.id);
  currentFpView.setPins(currentPins);
  currentFpView.setEditMode(editMode);
}

// ─── Colour picker ────────────────────────────────────────────────────────────
colorDotsEl.querySelectorAll('.cdot').forEach((dot) => {
  dot.addEventListener('click', () => {
    selectedColor = dot.dataset.color;
    colorDotsEl.querySelectorAll('.cdot').forEach((d) => d.classList.remove('active'));
    dot.classList.add('active');
  });
});

// ─── Back ─────────────────────────────────────────────────────────────────────
backBtn.addEventListener('click', () => {
  labelSheet.style.display = pinEditSheet.style.display = 'none';
  if (currentFpView) { currentFpView.destroy(); currentFpView = null; }
  if (currentFpUrl)  { URL.revokeObjectURL(currentFpUrl); currentFpUrl = null; }
  currentFP = null; editMode = false; addingPin = false;
  showScreen('home');
  renderHome();
});

// ─── Export ───────────────────────────────────────────────────────────────────
exportBtn.addEventListener('click', async () => {
  if (!currentFP) return;
  showLoading('Generating PDF…');
  try {
    // Always re-fetch so any rename or edits since opening are included
    const freshFP   = await DB.getFloorPlan(currentFP.id);
    const freshPins = await DB.getPinsForFloorPlan(currentFP.id);
    if (freshPins.length === 0) { hideLoading(); alert('Add at least one pin before exporting.'); return; }
    const photosByPin = {};
    for (const pin of freshPins) photosByPin[pin.id] = await DB.getPhotosForPin(pin.id);
    await exportFloorPlanPdf(freshFP, freshPins, photosByPin);
  } catch (err) {
    console.error('Export error:', err);
    alert('Export failed: ' + (err.message || 'Unknown error') + '\n\nIf this keeps happening, close and reopen the app.');
  }
  finally { hideLoading(); }
});

// ─── Tap existing pin → photo viewer ─────────────────────────────────────────
async function handleTapPin(pin) {
  viewerPin    = pin;
  viewerPhotos = await DB.getPhotosForPin(pin.id);
  viewerIndex  = viewerPhotos.length - 1;
  const idx    = currentPins.findIndex((p) => p.id === pin.id);
  pvPinName.textContent = pin.name || `Pin ${idx + 1}`;
  pvNote.value  = pin.note || '';
  photoViewer.style.display = 'flex';
  renderViewerPhoto();
}

function renderViewerPhoto() {
  if (viewerImgUrl) { URL.revokeObjectURL(viewerImgUrl); viewerImgUrl = null; }
  if (!viewerPhotos.length) { pvImage.removeAttribute('src'); pvCaption.textContent = 'No photos.'; pvPosition.textContent = ''; return; }
  viewerCurrentPhoto = viewerPhotos[viewerIndex];
  viewerImgUrl = URL.createObjectURL(viewerCurrentPhoto.blob);
  pvImage.src  = viewerImgUrl;
  pvCaption.textContent = new Date(viewerCurrentPhoto.capturedAt).toLocaleString();
  pvPhotoCaption.value  = viewerCurrentPhoto.caption || '';
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
  await DB.updatePin(viewerPin.id, { note: pvNote.value.trim() || null });
  viewerPin.note = pvNote.value.trim() || null;
});

pvPhotoCaption.addEventListener('change', async () => {
  if (!viewerCurrentPhoto) return;
  const caption = pvPhotoCaption.value.trim() || null;
  await DB.updatePhotoCaption(viewerCurrentPhoto.id, caption);
  viewerCurrentPhoto.caption = caption;
});

pvAddPhoto.addEventListener('click', async () => {
  if (!viewerPin) return;
  const blob = await Camera.capture();
  if (!blob) return;
  const photo = await DB.addPhoto({ pinId: viewerPin.id, blob });
  viewerPhotos = await DB.getPhotosForPin(viewerPin.id);
  viewerIndex  = viewerPhotos.length - 1;
  renderViewerPhoto();
  await showLabelSheet(viewerPin, photo);
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
  viewerPin = null; viewerPhotos = []; viewerCurrentPhoto = null;
  currentPins = await DB.getPinsForFloorPlan(currentFP.id);
  if (currentFpView) { currentFpView.setPins(currentPins); currentFpView.setEditMode(editMode); }
});

// ─── Action sheet ─────────────────────────────────────────────────────────────
function showActionSheet(options) {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = '<div class="sheet-handle"></div>';
  options.forEach(({ label, destructive, action }) => {
    const btn = document.createElement('button');
    btn.className = 'action-sheet-btn' + (destructive ? ' destructive' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => { overlay.remove(); action(); });
    sheet.appendChild(btn);
  });
  const cancel = document.createElement('button');
  cancel.className = 'action-sheet-btn action-sheet-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => overlay.remove());
  sheet.appendChild(cancel);
  overlay.appendChild(sheet);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ─── Manpower ─────────────────────────────────────────────────────────────────
document.getElementById('mp-open-btn').addEventListener('click', openManpowerScreen);

// ─── Init ─────────────────────────────────────────────────────────────────────
renderHome();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

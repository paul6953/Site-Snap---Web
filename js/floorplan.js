// Zoomable/pannable floor plan view.
// Pins and the live-position marker are children of the same transformed stage,
// so they ride along with zoom/pan automatically.
function createFloorPlanView(container, { imageUrl, naturalWidth, naturalHeight, onTapPin }) {
  container.innerHTML = `
    <div class="fp-viewport">
      <div class="fp-stage">
        <img class="fp-image" src="${imageUrl}" draggable="false" />
        <div class="fp-pins"></div>
        <div class="fp-calib"></div>
        <div class="fp-you" style="display:none">
          <div class="you-ring"></div>
          <div class="you-dot"></div>
        </div>
      </div>
    </div>
  `;

  const viewport = container.querySelector('.fp-viewport');
  const stage    = container.querySelector('.fp-stage');
  const img      = container.querySelector('.fp-image');
  const pinsLayer  = container.querySelector('.fp-pins');
  const calibLayer = container.querySelector('.fp-calib');
  const youMarker  = container.querySelector('.fp-you');
  const youRing    = container.querySelector('.you-ring');

  stage.style.width  = naturalWidth  + 'px';
  stage.style.height = naturalHeight + 'px';

  let scale = 1, tx = 0, ty = 0, gestureMoved = false;

  function applyTransform() {
    stage.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
  }

  function fitToViewport() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    scale = Math.min(vw / naturalWidth, vh / naturalHeight);
    tx = (vw - naturalWidth  * scale) / 2;
    ty = (vh - naturalHeight * scale) / 2;
    applyTransform();
  }

  if (img.complete) fitToViewport();
  else img.addEventListener('load', fitToViewport);
  window.addEventListener('resize', fitToViewport);

  function clampScale(s) { return Math.min(Math.max(s, 0.15), 8); }

  function zoomAt(vx, vy, newScaleRaw) {
    const s = clampScale(newScaleRaw);
    const r = s / scale;
    tx = vx - (vx - tx) * r;
    ty = vy - (vy - ty) * r;
    scale = s;
    applyTransform();
  }

  // --- Pointer tracking: pan + pinch zoom ---
  const pointers = new Map();
  let pinchStartDist = 0, pinchStartScale = 1;

  viewport.addEventListener('pointerdown', (e) => {
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gestureMoved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist  = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartScale = scale;
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const curr = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, curr);

    if (pointers.size === 1) {
      const dx = curr.x - prev.x, dy = curr.y - prev.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) gestureMoved = true;
      tx += dx; ty += dy;
      applyTransform();
    } else if (pointers.size === 2) {
      gestureMoved = true;
      const [a, b] = [...pointers.values()];
      const d   = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = viewport.getBoundingClientRect();
      zoomAt(mid.x - rect.left, mid.y - rect.top, pinchStartScale * (d / pinchStartDist));
    }
  });

  function endPointer(e) { pointers.delete(e.pointerId); }
  viewport.addEventListener('pointerup',     endPointer);
  viewport.addEventListener('pointercancel', endPointer);

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });

  // --- Tap: calibration or pin ---
  function normFromEvent(e) {
    const rect = viewport.getBoundingClientRect();
    return {
      xNorm: Math.min(1, Math.max(0, (e.clientX - rect.left  - tx) / (scale * naturalWidth))),
      yNorm: Math.min(1, Math.max(0, (e.clientY - rect.top   - ty) / (scale * naturalHeight))),
    };
  }

  let calibrationMode = false, calibTapCallback = null, calibTapCount = 0;

  function renderCalibMarker(xNorm, yNorm, label) {
    const el = document.createElement('div');
    el.className = 'calib-marker';
    el.style.left = (xNorm * 100) + '%';
    el.style.top  = (yNorm * 100) + '%';
    el.textContent = label;
    calibLayer.appendChild(el);
  }

  function exitCalibration() {
    calibrationMode = false;
    calibTapCallback = null;
    calibTapCount = 0;
    pinsLayer.style.pointerEvents = '';
  }

  viewport.addEventListener('click', (e) => {
    const pt = normFromEvent(e);

    if (calibrationMode) {
      // Never filter calibration taps by gestureMoved — a slightly drifting
      // finger on a touchscreen would silently drop the tap with no feedback.
      calibTapCount++;
      renderCalibMarker(pt.xNorm, pt.yNorm, String(calibTapCount));
      const idx = calibTapCount;
      const cb = calibTapCallback; // save before exitCalibration() nulls it
      if (idx >= 2) exitCalibration();
      cb && cb(pt, idx);
      return;
    }

    // Normal mode: only filter taps that were actually a drag.
    if (gestureMoved) return;
  });

  // --- Pin markers ---
  function renderPins(pins) {
    pinsLayer.innerHTML = '';
    pins.forEach((pin, i) => {
      const el = document.createElement('div');
      el.className = 'pin-marker';
      el.style.left = (pin.xNorm * 100) + '%';
      el.style.top  = (pin.yNorm * 100) + '%';
      el.textContent = String(i + 1);
      el.addEventListener('click', (e) => { e.stopPropagation(); onTapPin(pin); });
      pinsLayer.appendChild(el);
    });
  }

  // --- Live "you are here" marker ---
  function updateLivePosition(xNorm, yNorm, accuracyMetres, pxPerMetre) {
    youMarker.style.display = 'block';
    youMarker.style.left = (xNorm * 100) + '%';
    youMarker.style.top  = (yNorm * 100) + '%';
    const ringDiameter = Math.round(accuracyMetres * pxPerMetre * 2);
    youRing.style.width  = ringDiameter + 'px';
    youRing.style.height = ringDiameter + 'px';
    youRing.style.marginLeft = (-ringDiameter / 2) + 'px';
    youRing.style.marginTop  = (-ringDiameter / 2) + 'px';
  }

  function clearLivePosition() {
    youMarker.style.display = 'none';
  }

  return {
    setPins: renderPins,
    updateLivePosition,
    clearLivePosition,
    resetView: fitToViewport,
    clearCalibMarkers() { calibLayer.innerHTML = ''; },

    startCalibration(onTapped) {
      calibrationMode = true;
      calibTapCount   = 0;
      calibTapCallback = onTapped;
      pinsLayer.style.pointerEvents = 'none';
      calibLayer.innerHTML = '';
    },
    cancelCalibration: exitCalibration,
    isCalibrating() { return calibrationMode; },

    destroy() { window.removeEventListener('resize', fitToViewport); },
  };
}

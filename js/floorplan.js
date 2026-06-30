// Zoomable/pannable floor plan view. Pins are children of the same transformed
// "stage" element as the image, so they ride along with zoom/pan automatically
// (no manual scale/offset math needed when positioning markers).
function createFloorPlanView(container, { imageUrl, naturalWidth, naturalHeight, onTapEmpty, onTapPin }) {
  container.innerHTML = `
    <div class="fp-viewport">
      <div class="fp-stage">
        <img class="fp-image" src="${imageUrl}" draggable="false" />
        <div class="fp-pins"></div>
        <div class="fp-calib"></div>
      </div>
    </div>
  `;
  const viewport = container.querySelector('.fp-viewport');
  const stage = container.querySelector('.fp-stage');
  const img = container.querySelector('.fp-image');
  const pinsLayer = container.querySelector('.fp-pins');
  const calibLayer = container.querySelector('.fp-calib');

  let calibrationMode = false;
  let calibrationCallback = null;
  let calibrationPoints = [];

  stage.style.width = naturalWidth + 'px';
  stage.style.height = naturalHeight + 'px';

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let gestureMoved = false;

  function applyTransform() {
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  function fitToViewport() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const fitScale = Math.min(vw / naturalWidth, vh / naturalHeight);
    scale = fitScale;
    tx = (vw - naturalWidth * scale) / 2;
    ty = (vh - naturalHeight * scale) / 2;
    applyTransform();
  }

  if (img.complete) fitToViewport();
  else img.addEventListener('load', fitToViewport);
  window.addEventListener('resize', fitToViewport);

  function clampScale(s) {
    return Math.min(Math.max(s, 0.2), 6);
  }

  function zoomAt(viewportX, viewportY, newScaleRaw) {
    const newScale = clampScale(newScaleRaw);
    const ratio = newScale / scale;
    tx = viewportX - (viewportX - tx) * ratio;
    ty = viewportY - (viewportY - ty) * ratio;
    scale = newScale;
    applyTransform();
  }

  // --- Pointer tracking for pan + pinch zoom ---
  const pointers = new Map();
  let pinchStartDist = 0;
  let pinchStartScale = 1;

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  viewport.addEventListener('pointerdown', (e) => {
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gestureMoved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist = dist(a, b);
      pinchStartScale = scale;
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const curr = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, curr);

    if (pointers.size === 1) {
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) gestureMoved = true;
      tx += dx;
      ty += dy;
      applyTransform();
    } else if (pointers.size === 2) {
      gestureMoved = true;
      const [a, b] = [...pointers.values()];
      const newDist = dist(a, b);
      const mid = midpoint(a, b);
      const rect = viewport.getBoundingClientRect();
      const localMid = { x: mid.x - rect.left, y: mid.y - rect.top };
      const newScale = pinchStartScale * (newDist / pinchStartDist);
      zoomAt(localMid.x, localMid.y, newScale);
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
  }
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(localX, localY, scale * factor);
  }, { passive: false });

  function normFromEvent(e) {
    const rect = viewport.getBoundingClientRect();
    const viewportX = e.clientX - rect.left;
    const viewportY = e.clientY - rect.top;
    const stageX = (viewportX - tx) / scale;
    const stageY = (viewportY - ty) / scale;
    return {
      xNorm: Math.min(1, Math.max(0, stageX / naturalWidth)),
      yNorm: Math.min(1, Math.max(0, stageY / naturalHeight)),
    };
  }

  function renderCalibMarker(xNorm, yNorm, label) {
    const marker = document.createElement('div');
    marker.className = 'calib-marker';
    marker.style.left = (xNorm * 100) + '%';
    marker.style.top = (yNorm * 100) + '%';
    marker.textContent = label;
    calibLayer.appendChild(marker);
  }

  function exitCalibration() {
    calibrationMode = false;
    calibrationCallback = null;
    calibrationPoints = [];
    pinsLayer.style.pointerEvents = '';
    calibLayer.innerHTML = '';
  }

  viewport.addEventListener('click', (e) => {
    if (gestureMoved) return;
    const point = normFromEvent(e);
    if (calibrationMode) {
      calibrationPoints.push(point);
      renderCalibMarker(point.xNorm, point.yNorm, String(calibrationPoints.length));
      if (calibrationPoints.length === 2) {
        const [p1, p2] = calibrationPoints;
        const callback = calibrationCallback;
        exitCalibration();
        callback(p1, p2);
      }
      return;
    }
    onTapEmpty(point.xNorm, point.yNorm);
  });

  function renderPins(pins) {
    pinsLayer.innerHTML = '';
    pins.forEach((pin, index) => {
      const marker = document.createElement('div');
      marker.className = 'pin-marker';
      marker.style.left = (pin.xNorm * 100) + '%';
      marker.style.top = (pin.yNorm * 100) + '%';
      marker.textContent = String(index + 1);
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        onTapPin(pin);
      });
      pinsLayer.appendChild(marker);
    });
  }

  return {
    setPins: renderPins,
    resetView: fitToViewport,
    startCalibration(onComplete) {
      calibrationMode = true;
      calibrationPoints = [];
      calibrationCallback = onComplete;
      pinsLayer.style.pointerEvents = 'none';
      calibLayer.innerHTML = '';
    },
    cancelCalibration: exitCalibration,
    isCalibrating() {
      return calibrationMode;
    },
    destroy() {
      window.removeEventListener('resize', fitToViewport);
    },
  };
}

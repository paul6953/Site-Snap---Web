// Zoomable / pannable floor plan view.
// All tap and drag interactions are handled at the viewport level so they
// work reliably on iOS Safari inside CSS-transformed containers.
function createFloorPlanView(container, { imageUrl, naturalWidth, naturalHeight,
    onTapPin, onTapEmpty, onEditPin, onPinMoved }) {

  container.innerHTML = `
    <div class="fp-viewport">
      <div class="fp-stage">
        <img class="fp-image" src="${imageUrl}" draggable="false" />
        <div class="fp-pins"></div>
        <div class="fp-calib"></div>
      </div>
    </div>`;

  const viewport   = container.querySelector('.fp-viewport');
  const stage      = container.querySelector('.fp-stage');
  const img        = container.querySelector('.fp-image');
  const pinsLayer  = container.querySelector('.fp-pins');
  const calibLayer = container.querySelector('.fp-calib');

  stage.style.width  = naturalWidth  + 'px';
  stage.style.height = naturalHeight + 'px';

  let scale = 1, tx = 0, ty = 0;
  let editMode = false;
  let pinsList = [];           // kept in sync by setPins()

  // ── Transform ──────────────────────────────────────────────────────────────
  function applyTransform() {
    stage.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
  }
  function fitToViewport() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    scale = Math.min(vw / naturalWidth, vh / naturalHeight);
    tx = (vw - naturalWidth  * scale) / 2;
    ty = (vh - naturalHeight * scale) / 2;
    applyTransform();
  }
  if (img.complete) fitToViewport();
  else img.addEventListener('load', fitToViewport);
  window.addEventListener('resize', fitToViewport);

  function clampScale(s) { return Math.min(Math.max(s, 0.15), 8); }
  function zoomAt(vx, vy, ns) {
    const s = clampScale(ns), r = s / scale;
    tx = vx - (vx - tx) * r; ty = vy - (vy - ty) * r; scale = s;
    applyTransform();
  }

  // ── Convert screen → normalised coords ────────────────────────────────────
  function norm(clientX, clientY) {
    const r = viewport.getBoundingClientRect();
    return {
      xNorm: Math.min(1, Math.max(0, (clientX - r.left - tx) / (scale * naturalWidth))),
      yNorm: Math.min(1, Math.max(0, (clientY - r.top  - ty) / (scale * naturalHeight))),
    };
  }

  // Screen-pixel distance between a tap and a pin marker
  function screenDist(clientX, clientY, pin) {
    const pinScreenX = tx + pin.xNorm * naturalWidth  * scale;
    const pinScreenY = ty + pin.yNorm * naturalHeight * scale;
    const r = viewport.getBoundingClientRect();
    return Math.hypot(clientX - r.left - pinScreenX,
                      clientY - r.top  - pinScreenY);
  }

  const HIT_PX = 30; // pixels — generous hit target for fingertip

  function pinAtPoint(clientX, clientY) {
    return pinsList.slice().reverse().find(p => screenDist(clientX, clientY, p) < HIT_PX);
  }

  // ── Pointer state ─────────────────────────────────────────────────────────
  const pointers = new Map();
  let pinchStartDist = 0, pinchStartScale = 1;

  // Drag state (edit mode)
  let dragPin     = null;
  let dragEl      = null;
  let dragStartX  = 0, dragStartY  = 0;
  let dragMoved   = false;

  // Tap detection (normal mode)
  let tapStartX = 0, tapStartY = 0, tapMoved = false;

  viewport.addEventListener('pointerdown', (e) => {
    const { clientX, clientY } = e;

    if (editMode) {
      const hit = pinAtPoint(clientX, clientY);
      if (hit) {
        // Start potential drag on this pin
        dragPin    = hit;
        dragEl     = pinsLayer.querySelector(`[data-pin-id="${hit.id}"]`);
        dragStartX = clientX;
        dragStartY = clientY;
        dragMoved  = false;
        viewport.setPointerCapture(e.pointerId);
        return; // don't add to pan pointer map
      }
      // Tapped empty space in edit mode — handled in click path via addingPin flag
    }

    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: clientX, y: clientY });
    tapStartX = clientX; tapStartY = clientY; tapMoved = false;

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist  = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartScale = scale;
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    const { clientX, clientY } = e;

    // Dragging a pin in edit mode
    if (dragPin) {
      const d = Math.hypot(clientX - dragStartX, clientY - dragStartY);
      if (d > 6) dragMoved = true;
      if (dragMoved && dragEl) {
        const pt = norm(clientX, clientY);
        dragEl.style.left = (pt.xNorm * 100) + '%';
        dragEl.style.top  = (pt.yNorm * 100) + '%';
        dragEl._xNorm = pt.xNorm;
        dragEl._yNorm = pt.yNorm;
      }
      return;
    }

    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId), curr = { x: clientX, y: clientY };
    pointers.set(e.pointerId, curr);

    if (Math.hypot(clientX - tapStartX, clientY - tapStartY) > 5) tapMoved = true;

    if (pointers.size === 1) {
      tx += curr.x - prev.x; ty += curr.y - prev.y;
      applyTransform();
    } else if (pointers.size === 2) {
      tapMoved = true;
      const [a, b] = [...pointers.values()];
      const d   = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r   = viewport.getBoundingClientRect();
      zoomAt(mid.x - r.left, mid.y - r.top, pinchStartScale * (d / pinchStartDist));
    }
  });

  viewport.addEventListener('pointerup', (e) => {
    // ── Finish pin drag (edit mode) ──
    if (dragPin) {
      if (dragMoved && dragEl?._xNorm !== undefined) {
        onPinMoved && onPinMoved(dragPin, dragEl._xNorm, dragEl._yNorm);
      } else {
        onEditPin && onEditPin(dragPin);   // short tap → edit sheet
      }
      dragPin = dragEl = null; dragMoved = false;
      return;
    }

    pointers.delete(e.pointerId);
    if (tapMoved || pointers.size > 0) return;

    // ── Single tap resolved ──────────────────────────────────────────────────
    const { clientX, clientY } = e;

    // Calibration mode intercepts all taps
    if (calibMode) {
      calibCount++;
      const pt = norm(clientX, clientY);
      renderCalibMarker(pt.xNorm, pt.yNorm, String(calibCount));
      const idx = calibCount, cb = calibCallback;
      if (idx >= 2) exitCalib();
      cb && cb(pt, idx);
      return;
    }

    const hit = pinAtPoint(clientX, clientY);
    if (hit) {
      if (!editMode) onTapPin && onTapPin(hit);
      // In edit mode, pin taps are handled via the dragPin path above
    } else {
      const pt = norm(clientX, clientY);
      onTapEmpty && onTapEmpty(pt.xNorm, pt.yNorm);
    }
  });

  viewport.addEventListener('pointercancel', (e) => {
    dragPin = dragEl = null; dragMoved = false;
    pointers.delete(e.pointerId);
  });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });

  let calibMode = false, calibCallback = null, calibCount = 0;

  function exitCalib() {
    calibMode = false; calibCallback = null; calibCount = 0;
    pinsLayer.style.pointerEvents = '';
  }
  function renderCalibMarker(xNorm, yNorm, label) {
    const el = document.createElement('div');
    el.className = 'calib-marker';
    el.style.left = (xNorm * 100) + '%';
    el.style.top  = (yNorm * 100) + '%';
    el.textContent = label;
    calibLayer.appendChild(el);
  }

  // ── Render pins ────────────────────────────────────────────────────────────
  function renderPins(pins) {
    pinsList = pins;
    pinsLayer.innerHTML = '';
    pins.forEach((pin, i) => {
      const el = document.createElement('div');
      el.className = 'pin-marker' + (editMode ? ' pin-edit' : '');
      el.dataset.pinId   = pin.id;
      el.style.left      = (pin.xNorm * 100) + '%';
      el.style.top       = (pin.yNorm * 100) + '%';
      el.style.background = pin.color || '#007AFF';
      el.textContent     = pin.name ? pin.name.slice(0, 2).toUpperCase() : String(i + 1);
      pinsLayer.appendChild(el);
    });
  }

  return {
    setPins(pins)       { renderPins(pins); },
    setEditMode(on)     { editMode = on; },

    startCalibration(cb) {
      calibMode = true; calibCount = 0; calibCallback = cb;
      pinsLayer.style.pointerEvents = 'none';
      calibLayer.innerHTML = '';
    },
    cancelCalibration() { exitCalib(); },
    isCalibrating()     { return calibMode; },
    clearCalibMarkers() { calibLayer.innerHTML = ''; },
    resetView:          fitToViewport,
    destroy()           { window.removeEventListener('resize', fitToViewport); },
  };
}

// Zoomable/pannable floor plan view.
// Supports two modes:
//   Normal — tap pin → onTapPin; tap empty → onTapEmpty
//   Edit   — tap pin → onEditPin; drag pin → onPinMoved; tap empty → nothing
function createFloorPlanView(container, { imageUrl, naturalWidth, naturalHeight, onTapPin, onTapEmpty, onEditPin, onPinMoved }) {
  container.innerHTML = `
    <div class="fp-viewport">
      <div class="fp-stage">
        <img class="fp-image" src="${imageUrl}" draggable="false" />
        <div class="fp-pins"></div>
        <div class="fp-calib"></div>
      </div>
    </div>
  `;

  const viewport    = container.querySelector('.fp-viewport');
  const stage       = container.querySelector('.fp-stage');
  const img         = container.querySelector('.fp-image');
  const pinsLayer   = container.querySelector('.fp-pins');
  const calibLayer  = container.querySelector('.fp-calib');

  stage.style.width  = naturalWidth  + 'px';
  stage.style.height = naturalHeight + 'px';

  let scale = 1, tx = 0, ty = 0, gestureMoved = false;
  let editMode = false;

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

  function normFromViewport(clientX, clientY) {
    const r = viewport.getBoundingClientRect();
    return {
      xNorm: Math.min(1, Math.max(0, (clientX - r.left - tx) / (scale * naturalWidth))),
      yNorm: Math.min(1, Math.max(0, (clientY - r.top  - ty) / (scale * naturalHeight))),
    };
  }

  function clampScale(s) { return Math.min(Math.max(s, 0.15), 8); }
  function zoomAt(vx, vy, ns) {
    const s = clampScale(ns), r = s / scale;
    tx = vx - (vx - tx) * r; ty = vy - (vy - ty) * r; scale = s;
    applyTransform();
  }

  // ── Viewport pan / pinch zoom ──────────────────────────────────────────────
  const pointers = new Map();
  let pinchStartDist = 0, pinchStartScale = 1;

  viewport.addEventListener('pointerdown', (e) => {
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gestureMoved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartScale = scale;
    }
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId), curr = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, curr);
    if (pointers.size === 1) {
      const dx = curr.x - prev.x, dy = curr.y - prev.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) gestureMoved = true;
      tx += dx; ty += dy; applyTransform();
    } else if (pointers.size === 2) {
      gestureMoved = true;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = viewport.getBoundingClientRect();
      zoomAt(mid.x - r.left, mid.y - r.top, pinchStartScale * (d / pinchStartDist));
    }
  });
  function endPointer(e) { pointers.delete(e.pointerId); }
  viewport.addEventListener('pointerup',     endPointer);
  viewport.addEventListener('pointercancel', endPointer);
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });

  // ── Background tap (normal mode only) ─────────────────────────────────────
  let calibMode = false, calibCallback = null, calibCount = 0;

  viewport.addEventListener('click', (e) => {
    const pt = normFromViewport(e.clientX, e.clientY);
    if (calibMode) {
      calibCount++;
      renderCalibMarker(pt.xNorm, pt.yNorm, String(calibCount));
      const idx = calibCount, cb = calibCallback;
      if (idx >= 2) exitCalib();
      cb && cb(pt, idx);
      return;
    }
    if (gestureMoved || editMode) return;
    onTapEmpty && onTapEmpty(pt.xNorm, pt.yNorm);
  });

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
    pinsLayer.innerHTML = '';
    pins.forEach((pin, i) => {
      const color = pin.color || '#d62828';
      const label = pin.name ? pin.name.slice(0, 2).toUpperCase() : String(i + 1);

      const el = document.createElement('div');
      el.className = 'pin-marker' + (editMode ? ' pin-marker--edit' : '');
      el.style.left       = (pin.xNorm * 100) + '%';
      el.style.top        = (pin.yNorm * 100) + '%';
      el.style.background = color;
      el.textContent      = label;

      if (editMode) {
        // Drag to move
        let dragStartX = 0, dragStartY = 0, moved = false;

        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          el.setPointerCapture(e.pointerId);
          dragStartX = e.clientX; dragStartY = e.clientY;
          moved = false;
        });
        el.addEventListener('pointermove', (e) => {
          e.stopPropagation();
          if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 6) moved = true;
          if (!moved) return;
          const pt = normFromViewport(e.clientX, e.clientY);
          el.style.left = (pt.xNorm * 100) + '%';
          el.style.top  = (pt.yNorm * 100) + '%';
          el._xNorm = pt.xNorm; el._yNorm = pt.yNorm;
        });
        el.addEventListener('pointerup', (e) => {
          e.stopPropagation();
          if (moved && el._xNorm !== undefined) {
            onPinMoved && onPinMoved(pin, el._xNorm, el._yNorm);
          } else {
            onEditPin && onEditPin(pin);
          }
        });
      } else {
        el.addEventListener('click', (e) => { e.stopPropagation(); onTapPin && onTapPin(pin); });
      }

      pinsLayer.appendChild(el);
    });
  }

  return {
    setPins(pins) { renderPins(pins); },
    setEditMode(on) { editMode = on; },

    startCalibration(cb) {
      calibMode = true; calibCount = 0; calibCallback = cb;
      pinsLayer.style.pointerEvents = 'none';
      calibLayer.innerHTML = '';
    },
    cancelCalibration: exitCalib,
    isCalibrating()   { return calibMode; },
    clearCalibMarkers() { calibLayer.innerHTML = ''; },

    resetView: fitToViewport,
    destroy() { window.removeEventListener('resize', fitToViewport); },
  };
}

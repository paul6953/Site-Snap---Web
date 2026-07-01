// Full-screen camera. Returns Promise<Blob|null>.
// Timestamp + approximate address (from reverse geocoding) are shown live
// in the top-right corner of the viewfinder and burned into the captured photo.

const Camera = {
  async capture() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'camera-overlay';
      overlay.innerHTML = `
        <div class="camera-topbar">
          <button class="btn-ghost camera-cancel">Cancel</button>
        </div>
        <video class="camera-video" autoplay playsinline muted></video>
        <canvas class="camera-canvas" style="display:none"></canvas>
        <div class="camera-stamp-overlay"></div>
        <div class="camera-bottom">
          <button class="camera-shutter" aria-label="Take photo"></button>
        </div>
        <div class="camera-confirm-row" style="display:none">
          <button class="btn-ghost camera-retake">Retake</button>
          <button class="btn-accent camera-use">Use Photo</button>
        </div>
      `;
      document.body.appendChild(overlay);

      const video      = overlay.querySelector('.camera-video');
      const canvas     = overlay.querySelector('.camera-canvas');
      const stampDiv   = overlay.querySelector('.camera-stamp-overlay');
      const cancelBtn  = overlay.querySelector('.camera-cancel');
      const shutterBtn = overlay.querySelector('.camera-shutter');
      const retakeBtn  = overlay.querySelector('.camera-retake');
      const useBtn     = overlay.querySelector('.camera-use');
      const bottomBar  = overlay.querySelector('.camera-bottom');
      const confirmRow = overlay.querySelector('.camera-confirm-row');

      let stream = null;
      let capturedBlob = null;
      let stampInterval = null;
      let locationLine = '';   // filled async from reverse geocoding

      // ── Address lookup ──────────────────────────────────────────────────
      function fetchAddress() {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
          async ({ coords: { latitude: lat, longitude: lng } }) => {
            try {
              const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
              const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
              const data = await res.json();
              const a    = data.address || {};
              const parts = [
                a.building || a.amenity || a.mall || a.office || '',
                a.house_number ? `${a.house_number} ${a.road || ''}`.trim() : (a.road || ''),
                a.suburb || a.neighbourhood || a.city_district || a.city || '',
              ].map(s => s.trim()).filter(Boolean);
              locationLine = parts.slice(0, 2).join(', ');
            } catch (_) {
              locationLine = `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
            }
          },
          () => { locationLine = ''; },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
        );
      }
      fetchAddress();

      // ── Live stamp in viewfinder ────────────────────────────────────────
      function getTimeLine() {
        return new Date().toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
      }
      function updateStamp() {
        stampDiv.innerHTML = '';
        const t = document.createElement('div');
        t.textContent = getTimeLine();
        stampDiv.appendChild(t);
        if (locationLine) {
          const l = document.createElement('div');
          l.textContent = locationLine;
          stampDiv.appendChild(l);
        }
      }
      stampInterval = setInterval(updateStamp, 1000);
      updateStamp();

      // ── Camera stream ───────────────────────────────────────────────────
      function cleanup(result) {
        clearInterval(stampInterval);
        if (stream) stream.getTracks().forEach(t => t.stop());
        overlay.remove();
        resolve(result);
      }
      cancelBtn.addEventListener('click', () => cleanup(null));

      async function startStream() {
        const attempts = [
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
          { video: true, audio: false },
        ];
        for (const c of attempts) {
          try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
          catch (e) { console.warn('getUserMedia:', e.name); }
        }
        if (!stream) {
          stampDiv.textContent = 'Camera unavailable — check Safari Settings → SiteSnap → Camera';
          shutterBtn.style.display = 'none';
          return;
        }
        video.srcObject = stream;
        video.play().catch(() => {});
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        stampDiv.textContent = 'Camera requires HTTPS.';
        shutterBtn.style.display = 'none';
      } else {
        startStream();
      }

      // ── Capture ─────────────────────────────────────────────────────────
      shutterBtn.addEventListener('click', () => {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) {
          const prev = stampDiv.innerHTML;
          stampDiv.textContent = 'Camera starting — try again in a moment.';
          setTimeout(() => { stampDiv.innerHTML = prev; }, 2000);
          return;
        }
        clearInterval(stampInterval);
        const timeLine = getTimeLine();

        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        burnStamp(ctx, w, h, timeLine, locationLine);

        video.style.display    = 'none';
        canvas.style.display   = 'block';
        stampDiv.style.display = 'none';
        bottomBar.style.display = 'none';
        confirmRow.style.display = 'flex';

        canvas.toBlob(blob => { capturedBlob = blob; }, 'image/jpeg', 0.9);
      });

      retakeBtn.addEventListener('click', () => {
        capturedBlob = null;
        canvas.style.display   = 'none';
        video.style.display    = 'block';
        stampDiv.style.display = 'block';
        bottomBar.style.display = 'flex';
        confirmRow.style.display = 'none';
        stampInterval = setInterval(updateStamp, 1000);
        updateStamp();
      });

      useBtn.addEventListener('click', () => { if (capturedBlob) cleanup(capturedBlob); });
    });
  },
};

// Burned into the captured frame — top-right corner.
function burnStamp(ctx, w, h, timeLine, locationLine) {
  const lines = [timeLine, locationLine].filter(Boolean);
  const fontSize = Math.max(14, Math.round(h * 0.022));
  ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
  const lineH   = fontSize * 1.4;
  const padding = fontSize * 0.55;
  const maxW    = Math.max(...lines.map(l => ctx.measureText(l).width));
  const boxW    = maxW + padding * 2;
  const boxH    = lineH * lines.length + padding * 2;
  const bx      = w - boxW - 12;
  const by      = 12;  // top-right

  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, 5);
  else ctx.rect(bx, by, boxW, boxH);
  ctx.fill();

  ctx.fillStyle    = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, bx + padding, by + padding + i * lineH));
}

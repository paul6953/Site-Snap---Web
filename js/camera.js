// Full-screen camera. Returns Promise<Blob|null>.
// • Checks camera permission state before opening — if denied, shows Settings
//   instructions rather than a broken camera UI.
// • Torch/flash toggle button appears automatically if the device supports it.
// • Timestamp + reverse-geocoded address burned into top-right corner.

const Camera = {
  // Pre-warm camera permission in the background so subsequent opens
  // don't trigger a second permission dialog within the same session.
  async requestPermission() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach(t => t.stop());
    } catch (_) {}
  },

  async capture() {
    // Check permission state before building the UI.
    if (navigator.permissions) {
      try {
        const status = await navigator.permissions.query({ name: 'camera' });
        if (status.state === 'denied') {
          alert(
            'Camera access is blocked.\n\n' +
            'To fix this:\n' +
            'Settings → Privacy & Security → Camera → Safari → Allow\n\n' +
            'Or: Settings → Safari → Camera → Allow'
          );
          return null;
        }
      } catch (_) { /* permissions API not supported — proceed normally */ }
    }

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'camera-overlay';
      overlay.innerHTML = `
        <div class="camera-topbar">
          <button class="cam-btn camera-cancel">Cancel</button>
          <button class="cam-btn cam-flash" style="display:none" title="Flash">⚡</button>
        </div>
        <video class="camera-video" autoplay playsinline muted></video>
        <canvas class="camera-canvas" style="display:none"></canvas>
        <div class="camera-stamp-overlay"></div>
        <div class="camera-bottom">
          <button class="camera-shutter" aria-label="Take photo"></button>
        </div>
        <div class="camera-confirm-row" style="display:none">
          <button class="cam-btn camera-retake">Retake</button>
          <button class="cam-btn cam-use">Use Photo</button>
        </div>
      `;
      document.body.appendChild(overlay);

      const video       = overlay.querySelector('.camera-video');
      const canvas      = overlay.querySelector('.camera-canvas');
      const stampDiv    = overlay.querySelector('.camera-stamp-overlay');
      const cancelBtn   = overlay.querySelector('.camera-cancel');
      const flashBtn    = overlay.querySelector('.cam-flash');
      const shutterBtn  = overlay.querySelector('.camera-shutter');
      const retakeBtn   = overlay.querySelector('.camera-retake');
      const useBtn      = overlay.querySelector('.cam-use');
      const bottomBar   = overlay.querySelector('.camera-bottom');
      const confirmRow  = overlay.querySelector('.camera-confirm-row');

      let stream       = null;
      let videoTrack   = null;
      let torchOn      = false;
      let capturedBlob = null;
      let stampInterval = null;
      let locationLine  = '';

      // ── Reverse geocoding ───────────────────────────────────────────────
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async ({ coords: { latitude: lat, longitude: lng } }) => {
            try {
              const res  = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
                { headers: { 'Accept-Language': 'en' } }
              );
              const data = await res.json();
              const a    = data.address || {};
              const parts = [
                a.building || a.amenity || a.office || a.mall || '',
                a.house_number ? `${a.house_number} ${a.road || ''}`.trim() : (a.road || ''),
                a.suburb || a.neighbourhood || a.city_district || a.city || '',
              ].map(s => s.trim()).filter(Boolean);
              locationLine = parts.slice(0, 2).join(', ');
            } catch (_) {}
          },
          () => {},
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
        );
      }

      // ── Live stamp ──────────────────────────────────────────────────────
      function getTimestamp() {
        return new Date().toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
      }
      function updateStamp() {
        stampDiv.innerHTML = `<div>${getTimestamp()}</div>` +
          (locationLine ? `<div class="stamp-loc">${locationLine}</div>` : '');
      }
      stampInterval = setInterval(updateStamp, 1000);
      updateStamp();

      // ── Cleanup ─────────────────────────────────────────────────────────
      function cleanup(result) {
        clearInterval(stampInterval);
        if (stream) stream.getTracks().forEach(t => t.stop());
        overlay.remove();
        resolve(result);
      }
      cancelBtn.addEventListener('click', () => cleanup(null));

      // ── Start camera stream ─────────────────────────────────────────────
      async function startStream() {
        if (!navigator.mediaDevices?.getUserMedia) {
          stampDiv.innerHTML = '<div>Camera requires HTTPS. Open via the GitHub Pages link.</div>';
          shutterBtn.style.display = 'none';
          return;
        }
        const attempts = [
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
          { video: true, audio: false },
        ];
        for (const c of attempts) {
          try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
          catch (e) {
            if (e.name === 'NotAllowedError') {
              stampDiv.innerHTML =
                '<div>Camera blocked. Go to:</div>' +
                '<div>Settings → Privacy → Camera → Safari → Allow</div>';
              shutterBtn.style.display = 'none';
              return;
            }
          }
        }
        if (!stream) {
          stampDiv.innerHTML = '<div>Camera unavailable on this device.</div>';
          shutterBtn.style.display = 'none';
          return;
        }

        video.srcObject = stream;
        video.play().catch(() => {});
        videoTrack = stream.getVideoTracks()[0];

        // Show flash button if device torch is supported
        try {
          const caps = videoTrack.getCapabilities?.();
          if (caps?.torch) {
            flashBtn.style.display = 'block';
          }
        } catch (_) {}
      }
      startStream();

      // ── Torch toggle ────────────────────────────────────────────────────
      flashBtn.addEventListener('click', async () => {
        if (!videoTrack) return;
        torchOn = !torchOn;
        try {
          await videoTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
          flashBtn.textContent  = torchOn ? '🔆' : '⚡';
          flashBtn.classList.toggle('cam-flash--on', torchOn);
        } catch (_) { torchOn = false; }
      });

      // ── Capture ─────────────────────────────────────────────────────────
      shutterBtn.addEventListener('click', () => {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) {
          stampDiv.innerHTML = '<div>Camera still starting — try again in a moment.</div>';
          return;
        }
        clearInterval(stampInterval);
        const timeLine = getTimestamp();

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

      useBtn.addEventListener('click', async () => {
        if (!capturedBlob) return;
        // Offer native share sheet so user can "Save Image" to camera roll.
        // Web APIs have no direct camera-roll write permission — share sheet is the
        // closest a PWA can get on iOS/Android without a native wrapper.
        if (navigator.canShare) {
          try {
            const file = new File([capturedBlob], `SiteSnap_${Date.now()}.jpg`, { type: 'image/jpeg' });
            if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
          } catch (_) {} // dismissed or not supported — proceed anyway
        }
        cleanup(capturedBlob);
      });
    });
  },
};

function burnStamp(ctx, w, h, timeLine, locationLine) {
  const lines = [timeLine, locationLine].filter(Boolean);
  const size  = Math.max(14, Math.round(h * 0.022));
  ctx.font = `600 ${size}px -apple-system, sans-serif`;
  const lh = size * 1.4, pad = size * 0.55;
  const mw = Math.max(...lines.map(l => ctx.measureText(l).width));
  const bw = mw + pad * 2, bh = lh * lines.length + pad * 2;
  const bx = w - bw - 12, by = 12;

  ctx.fillStyle = 'rgba(0,0,0,.5)';
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 5); ctx.fill(); }
  else { ctx.fillRect(bx, by, bw, bh); }

  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad + i * lh));
}

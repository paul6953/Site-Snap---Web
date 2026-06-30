// Full-screen camera capture.
// Camera.capture({ lat, lng }) → Promise<Blob|null>
// GPS coordinates are displayed live in the viewfinder and burned into the
// captured frame along with the timestamp.
const Camera = {
  async capture({ lat, lng } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'camera-overlay';
      overlay.innerHTML = `
        <div class="camera-topbar">
          <button class="btn-icon camera-cancel" aria-label="Cancel">&#10005;</button>
          <div class="camera-gps-badge"></div>
        </div>
        <video class="camera-video" autoplay playsinline muted></video>
        <canvas class="camera-canvas" style="display:none"></canvas>
        <div class="camera-stamp-overlay"></div>
        <div class="camera-bottom">
          <button class="camera-shutter" aria-label="Take photo"></button>
        </div>
        <div class="camera-confirm-row" style="display:none">
          <button class="btn btn-secondary camera-retake">Retake</button>
          <button class="btn btn-primary camera-use">Use Photo</button>
        </div>
      `;
      document.body.appendChild(overlay);

      const video       = overlay.querySelector('.camera-video');
      const canvas      = overlay.querySelector('.camera-canvas');
      const stampDiv    = overlay.querySelector('.camera-stamp-overlay');
      const gpsBadge    = overlay.querySelector('.camera-gps-badge');
      const cancelBtn   = overlay.querySelector('.camera-cancel');
      const shutterBtn  = overlay.querySelector('.camera-shutter');
      const retakeBtn   = overlay.querySelector('.camera-retake');
      const useBtn      = overlay.querySelector('.camera-use');
      const bottomBar   = overlay.querySelector('.camera-bottom');
      const confirmRow  = overlay.querySelector('.camera-confirm-row');

      let stream = null;
      let capturedBlob = null;
      let stampInterval = null;

      if (lat != null && lng != null) {
        const latStr = Math.abs(lat).toFixed(5) + (lat >= 0 ? '° N' : '° S');
        const lngStr = Math.abs(lng).toFixed(5) + (lng >= 0 ? '° E' : '° W');
        gpsBadge.textContent = `${latStr}  ${lngStr}`;
      }

      function getStampText() {
        const time = new Date().toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        if (lat != null && lng != null) {
          const latStr = Math.abs(lat).toFixed(4) + (lat >= 0 ? '°N' : '°S');
          const lngStr = Math.abs(lng).toFixed(4) + (lng >= 0 ? '°E' : '°W');
          return `${time}\n${latStr}  ${lngStr}`;
        }
        return time;
      }

      function updateStampOverlay() {
        stampDiv.textContent = getStampText().replace('\n', '  ');
      }

      stampInterval = setInterval(updateStampOverlay, 1000);
      updateStampOverlay();

      function cleanup(result) {
        clearInterval(stampInterval);
        if (stream) stream.getTracks().forEach((t) => t.stop());
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
          catch (e) { console.warn('getUserMedia attempt failed:', e.name); }
        }
        if (!stream) {
          shutterBtn.textContent = 'Camera unavailable';
          shutterBtn.disabled = true;
          return;
        }
        video.srcObject = stream;
        video.play().catch((e) => console.error('video.play():', e));
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        shutterBtn.textContent = 'Camera requires HTTPS';
        shutterBtn.disabled = true;
      } else {
        startStream();
      }

      shutterBtn.addEventListener('click', () => {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) {
          shutterBtn.textContent = 'Starting…';
          setTimeout(() => { shutterBtn.textContent = ''; }, 1500);
          return;
        }

        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        burnStamp(ctx, w, h, getStampText());

        video.style.display = 'none';
        canvas.style.display = 'block';
        bottomBar.style.display = 'none';
        confirmRow.style.display = 'flex';
        stampDiv.style.display = 'none';
        clearInterval(stampInterval);

        canvas.toBlob((blob) => { capturedBlob = blob; }, 'image/jpeg', 0.88);
      });

      retakeBtn.addEventListener('click', () => {
        capturedBlob = null;
        canvas.style.display = 'none';
        video.style.display = 'block';
        bottomBar.style.display = 'flex';
        confirmRow.style.display = 'none';
        stampDiv.style.display = 'block';
        stampInterval = setInterval(updateStampOverlay, 1000);
        updateStampOverlay();
      });

      useBtn.addEventListener('click', () => {
        if (capturedBlob) cleanup(capturedBlob);
      });
    });
  },
};

function burnStamp(ctx, w, h, text) {
  const lines = text.split('\n');
  const fontSize = Math.max(16, Math.round(h * 0.028));
  ctx.font = `bold ${fontSize}px sans-serif`;
  const lineH = fontSize * 1.35;
  const padding = fontSize * 0.55;
  const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxH = lineH * lines.length + padding * 2;
  const boxW = maxW + padding * 2;

  // Bottom-right corner
  const bx = w - boxW - 12;
  const by = h - boxH - 12;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 6);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    ctx.fillText(line, bx + padding, by + padding + i * lineH);
  });
}

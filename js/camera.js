// Full-screen camera. Camera.capture() → Promise<Blob|null>
// Timestamp is burned into the bottom-right corner of every photo.
const Camera = {
  async capture() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'camera-overlay';
      overlay.innerHTML = `
        <div class="camera-topbar">
          <button class="btn-icon camera-cancel" aria-label="Cancel">&#10005;</button>
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
      const cancelBtn   = overlay.querySelector('.camera-cancel');
      const shutterBtn  = overlay.querySelector('.camera-shutter');
      const retakeBtn   = overlay.querySelector('.camera-retake');
      const useBtn      = overlay.querySelector('.camera-use');
      const bottomBar   = overlay.querySelector('.camera-bottom');
      const confirmRow  = overlay.querySelector('.camera-confirm-row');

      let stream = null;
      let capturedBlob = null;
      let stampInterval = null;

      function updateStamp() {
        stampDiv.textContent = new Date().toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
      }
      stampInterval = setInterval(updateStamp, 1000);
      updateStamp();

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
          stampDiv.textContent = 'Camera unavailable — check that this site has camera permission in Safari Settings.';
          shutterBtn.style.display = 'none';
          return;
        }
        video.srcObject = stream;
        video.play().catch((e) => console.error('video.play():', e));
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        stampDiv.textContent = 'Camera requires HTTPS. Open via the GitHub Pages URL, not a local file.';
        shutterBtn.style.display = 'none';
      } else {
        startStream();
      }

      shutterBtn.addEventListener('click', () => {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) {
          const prev = stampDiv.textContent;
          stampDiv.textContent = 'Camera still starting — try again in a moment.';
          setTimeout(() => { stampDiv.textContent = prev; }, 2000);
          return;
        }

        const timestamp = stampDiv.textContent;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        burnStamp(ctx, w, h, timestamp);

        video.style.display   = 'none';
        canvas.style.display  = 'block';
        stampDiv.style.display = 'none';
        bottomBar.style.display = 'none';
        confirmRow.style.display = 'flex';
        clearInterval(stampInterval);

        canvas.toBlob((blob) => { capturedBlob = blob; }, 'image/jpeg', 0.88);
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

      useBtn.addEventListener('click', () => {
        if (capturedBlob) cleanup(capturedBlob);
      });
    });
  },
};

function burnStamp(ctx, w, h, text) {
  const fontSize = Math.max(16, Math.round(h * 0.028));
  ctx.font = `bold ${fontSize}px sans-serif`;
  const padding = fontSize * 0.55;
  const textW   = ctx.measureText(text).width;
  const boxW    = textW + padding * 2;
  const boxH    = fontSize + padding * 2;
  const bx      = w - boxW - 12;
  const by      = h - boxH - 12;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 6);
  ctx.fill();

  ctx.fillStyle    = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.fillText(text, bx + padding, by + padding);
}

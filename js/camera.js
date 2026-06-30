// Full-screen camera capture with a burned-in timestamp, matching the
// "timestamp camera" concept. Returns a Promise<Blob|null> (null = cancelled).
const Camera = {
  async capture() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'camera-overlay';
      overlay.innerHTML = `
        <video class="camera-video" autoplay playsinline muted></video>
        <canvas class="camera-canvas" style="display:none"></canvas>
        <div class="camera-error" style="display:none"></div>
        <div class="camera-controls">
          <button class="btn btn-secondary camera-cancel">Cancel</button>
          <button class="camera-shutter" aria-label="Take photo"></button>
          <span class="camera-spacer"></span>
        </div>
        <div class="camera-confirm-controls" style="display:none">
          <button class="btn btn-secondary camera-retake">Retake</button>
          <button class="btn btn-primary camera-use">Use Photo</button>
        </div>
      `;
      document.body.appendChild(overlay);

      const video = overlay.querySelector('.camera-video');
      const canvas = overlay.querySelector('.camera-canvas');
      const errorBox = overlay.querySelector('.camera-error');
      const shutterBtn = overlay.querySelector('.camera-shutter');
      const cancelBtn = overlay.querySelector('.camera-cancel');
      const retakeBtn = overlay.querySelector('.camera-retake');
      const useBtn = overlay.querySelector('.camera-use');
      const liveControls = overlay.querySelector('.camera-controls');
      const confirmControls = overlay.querySelector('.camera-confirm-controls');

      let stream = null;
      let capturedBlob = null;

      // Disabled until the camera stream actually has frames, so a tap can't
      // capture a blank frame before the video is ready.
      shutterBtn.disabled = true;

      function cleanup(result) {
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
        overlay.remove();
        resolve(result);
      }

      cancelBtn.addEventListener('click', () => cleanup(null));

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        errorBox.style.display = 'block';
        errorBox.textContent = 'Camera requires HTTPS (or localhost). This page was not loaded over a secure connection.';
        shutterBtn.style.display = 'none';
      } else {
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
          .then((s) => {
            stream = s;
            video.srcObject = s;
            video.play().catch(() => {});
            video.addEventListener('loadedmetadata', () => { shutterBtn.disabled = false; }, { once: true });
          })
          .catch((err) => {
            errorBox.style.display = 'block';
            errorBox.textContent = 'Camera unavailable: ' + (err.message || err.name || 'permission denied');
            shutterBtn.style.display = 'none';
          });
      }

      shutterBtn.addEventListener('click', () => {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        stampTimestamp(ctx, w, h);

        canvas.style.display = 'block';
        video.style.display = 'none';
        liveControls.style.display = 'none';
        confirmControls.style.display = 'flex';

        canvas.toBlob((blob) => { capturedBlob = blob; }, 'image/jpeg', 0.85);
      });

      retakeBtn.addEventListener('click', () => {
        capturedBlob = null;
        canvas.style.display = 'none';
        video.style.display = 'block';
        liveControls.style.display = 'flex';
        confirmControls.style.display = 'none';
      });

      useBtn.addEventListener('click', () => {
        if (!capturedBlob) return;
        cleanup(capturedBlob);
      });
    });
  },
};

function stampTimestamp(ctx, w, h) {
  const text = new Date().toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const fontSize = Math.max(18, Math.round(h * 0.03));
  ctx.font = `bold ${fontSize}px sans-serif`;
  const padding = fontSize * 0.6;
  const textWidth = ctx.measureText(text).width;
  const barHeight = fontSize + padding * 2;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, h - barHeight, textWidth + padding * 2, barHeight);

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padding, h - barHeight / 2);
}

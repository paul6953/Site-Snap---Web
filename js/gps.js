// Singleton GPS watcher. Call GPS.start() when entering the floor plan screen
// and GPS.stop() when leaving. Keeps a single watchPosition active so battery
// is not wasted while browsing the home screen.
const GPS = (() => {
  let watchId = null;
  let current = null; // { lat, lng, accuracy, heading }
  const listeners = new Set();

  function broadcast(pos) {
    current = pos;
    listeners.forEach((fn) => fn(pos));
  }

  return {
    start() {
      if (watchId !== null || !navigator.geolocation) return;
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          broadcast({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading,
          });
        },
        (err) => console.warn('GPS error:', err.code, err.message),
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 }
      );
    },

    stop() {
      if (watchId === null) return;
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      current = null;
    },

    getPosition() {
      return current;
    },

    // Returns an unsubscribe function.
    onUpdate(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    isSupported() {
      return !!navigator.geolocation;
    },
  };
})();

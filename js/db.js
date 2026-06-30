// IndexedDB wrapper. All floor plan images, pins, and photos live only in this
// browser's local database — nothing is ever uploaded anywhere.
const DB_NAME = 'sitesnap';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('floorPlans')) {
        db.createObjectStore('floorPlans', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pins')) {
        const pins = db.createObjectStore('pins', { keyPath: 'id' });
        pins.createIndex('byFloorPlan', 'floorPlanId');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('byPin', 'pinId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode) {
  return openDb().then((db) => db.transaction(storeNames, mode));
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid() {
  return crypto.randomUUID();
}

const DB = {
  // --- Floor plans ---
  async addFloorPlan({ name, imageBlob }) {
    const record = { id: uid(), name, imageBlob, createdAt: Date.now() };
    const t = await tx('floorPlans', 'readwrite');
    await promisifyRequest(t.objectStore('floorPlans').add(record));
    return record;
  },

  async getFloorPlans() {
    const t = await tx('floorPlans', 'readonly');
    const all = await promisifyRequest(t.objectStore('floorPlans').getAll());
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },

  async getFloorPlan(id) {
    const t = await tx('floorPlans', 'readonly');
    return promisifyRequest(t.objectStore('floorPlans').get(id));
  },

  async updateFloorPlanCalibration(id, calibration) {
    const t = await tx('floorPlans', 'readwrite');
    const store = t.objectStore('floorPlans');
    const fp = await promisifyRequest(store.get(id));
    if (!fp) return;
    fp.calibration = calibration;
    await promisifyRequest(store.put(fp));
  },

  async deleteFloorPlan(id) {
    const pins = await DB.getPinsForFloorPlan(id);
    for (const pin of pins) {
      await DB.deletePin(pin.id);
    }
    const t = await tx('floorPlans', 'readwrite');
    await promisifyRequest(t.objectStore('floorPlans').delete(id));
  },

  // --- Pins ---
  async addPin({ floorPlanId, xNorm, yNorm, lat, lng, note }) {
    const record = { id: uid(), floorPlanId, xNorm, yNorm, lat: lat ?? null, lng: lng ?? null, note: note || null, createdAt: Date.now() };
    const t = await tx('pins', 'readwrite');
    await promisifyRequest(t.objectStore('pins').add(record));
    return record;
  },

  async getPinsForFloorPlan(floorPlanId) {
    const t = await tx('pins', 'readonly');
    const all = await promisifyRequest(t.objectStore('pins').index('byFloorPlan').getAll(floorPlanId));
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },

  async getPin(id) {
    const t = await tx('pins', 'readonly');
    return promisifyRequest(t.objectStore('pins').get(id));
  },

  async updatePinNote(id, note) {
    const t = await tx('pins', 'readwrite');
    const store = t.objectStore('pins');
    const pin = await promisifyRequest(store.get(id));
    if (!pin) return;
    pin.note = note || null;
    await promisifyRequest(store.put(pin));
  },

  async deletePin(id) {
    const photos = await DB.getPhotosForPin(id);
    const t = await tx(['pins', 'photos'], 'readwrite');
    const photoStore = t.objectStore('photos');
    for (const photo of photos) {
      photoStore.delete(photo.id);
    }
    await promisifyRequest(t.objectStore('pins').delete(id));
  },

  // --- Photos ---
  async addPhoto({ pinId, blob, note }) {
    const record = { id: uid(), pinId, blob, note: note || null, capturedAt: Date.now() };
    const t = await tx('photos', 'readwrite');
    await promisifyRequest(t.objectStore('photos').add(record));
    return record;
  },

  async getPhotosForPin(pinId) {
    const t = await tx('photos', 'readonly');
    const all = await promisifyRequest(t.objectStore('photos').index('byPin').getAll(pinId));
    return all.sort((a, b) => a.capturedAt - b.capturedAt);
  },

  async deletePhoto(id) {
    const t = await tx('photos', 'readwrite');
    await promisifyRequest(t.objectStore('photos').delete(id));
  },
};

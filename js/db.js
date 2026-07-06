// IndexedDB wrapper. All floor plan images, pins, and photos live only in this
// browser's local database — nothing is ever uploaded anywhere.
const DB_NAME = 'sitesnap';
const DB_VERSION = 2;

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
      if (!db.objectStoreNames.contains('manpowerDays')) {
        db.createObjectStore('manpowerDays', { keyPath: 'date' });
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
  async addFloorPlan({ name, imageBlob, pageWidthPt, pageHeightPt }) {
    const record = { id: uid(), name, imageBlob, pageWidthPt: pageWidthPt || null, pageHeightPt: pageHeightPt || null, createdAt: Date.now() };
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
  async addPin({ floorPlanId, xNorm, yNorm, lat, lng, name, color, note }) {
    const record = { id: uid(), floorPlanId, xNorm, yNorm, lat: lat ?? null, lng: lng ?? null, name: name || null, color: color || '#d62828', note: note || null, createdAt: Date.now() };
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

  async updatePin(id, fields) {
    const t = await tx('pins', 'readwrite');
    const store = t.objectStore('pins');
    const pin = await promisifyRequest(store.get(id));
    if (!pin) return;
    Object.assign(pin, fields);
    await promisifyRequest(store.put(pin));
  },

  async updatePhotoCaption(id, caption) {
    const t = await tx('photos', 'readwrite');
    const store = t.objectStore('photos');
    const photo = await promisifyRequest(store.get(id));
    if (!photo) return;
    photo.caption = caption || null;
    await promisifyRequest(store.put(photo));
  },

  async renameFloorPlan(id, name) {
    const t = await tx('floorPlans', 'readwrite');
    const store = t.objectStore('floorPlans');
    const fp = await promisifyRequest(store.get(id));
    if (!fp) return;
    fp.name = name;
    await promisifyRequest(store.put(fp));
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

  // --- Manpower ---
  async saveManpowerDay(date, entries) {
    const t = await tx('manpowerDays', 'readwrite');
    await promisifyRequest(t.objectStore('manpowerDays').put({ date, entries }));
  },

  async getManpowerDay(date) {
    const t = await tx('manpowerDays', 'readonly');
    return promisifyRequest(t.objectStore('manpowerDays').get(date));
  },

  async getAllManpowerDays() {
    const t = await tx('manpowerDays', 'readonly');
    const all = await promisifyRequest(t.objectStore('manpowerDays').getAll());
    return all.sort((a, b) => a.date.localeCompare(b.date));
  },

  // --- Photos ---
  async addPhoto({ pinId, blob, caption, note }) {
    const record = { id: uid(), pinId, blob, caption: caption || null, note: note || null, capturedAt: Date.now() };
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

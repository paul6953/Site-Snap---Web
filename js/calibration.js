// GPS → floor plan coordinate transform.
//
// Calibration anchors are two physical points where the user physically stood
// and tapped their location on the floor plan while GPS was active. Each anchor
// stores both floor-plan coordinates (xNorm 0-1, yNorm 0-1) and the GPS fix
// at that moment (lat, lng).
//
// The transform is a 2-point affine: scale + rotation, no shear. It handles
// any floor plan orientation relative to north automatically — the two anchor
// vectors define the full transform.

function gpsToFloorPlan(lat, lng, calibration, dims) {
  const { p1, p2 } = calibration;
  const x1 = p1.xNorm * dims.w;
  const y1 = p1.yNorm * dims.h;
  const x2 = p2.xNorm * dims.w;
  const y2 = p2.yNorm * dims.h;

  const avgLat = (p1.lat + p2.lat) / 2;
  const mPerDegLng = 111320 * Math.cos((avgLat * Math.PI) / 180);
  const mPerDegLat = 111320;

  // GPS A→B vector in metres, screen-Y convention (north = negative screen Y).
  const gX = (p2.lng - p1.lng) * mPerDegLng;
  const gY = -((p2.lat - p1.lat) * mPerDegLat);

  // Pixel A→B vector.
  const pX = x2 - x1;
  const pY = y2 - y1;

  // Complex-number division: (pX + i·pY) / (gX + i·gY) gives rotation+scale.
  const denom = gX * gX + gY * gY;
  if (denom === 0) return null;
  const tR = (pX * gX + pY * gY) / denom;
  const tI = (pY * gX - pX * gY) / denom;

  // Displacement of target point from anchor A (metres, screen-Y convention).
  const dX = (lng - p1.lng) * mPerDegLng;
  const dY = -((lat - p1.lat) * mPerDegLat);

  // Apply transform (complex multiplication).
  const pixX = x1 + dX * tR - dY * tI;
  const pixY = y1 + dX * tI + dY * tR;

  return {
    xNorm: pixX / dims.w,
    yNorm: pixY / dims.h,
  };
}

// Returns metres between two GPS points.
function gpsDistanceMetres(lat1, lng1, lat2, lng2) {
  const avgLat = (lat1 + lat2) / 2;
  const dx = (lng2 - lng1) * 111320 * Math.cos((avgLat * Math.PI) / 180);
  const dy = (lat2 - lat1) * 111320;
  return Math.hypot(dx, dy);
}

// Returns pixels-per-metre given the calibration (for sizing accuracy rings).
function pixelsPerMetre(calibration, dims) {
  const { p1, p2 } = calibration;
  const pixDist = Math.hypot(
    (p2.xNorm - p1.xNorm) * dims.w,
    (p2.yNorm - p1.yNorm) * dims.h
  );
  const mDist = gpsDistanceMetres(p1.lat, p1.lng, p2.lat, p2.lng);
  return mDist > 0 ? pixDist / mDist : 0;
}

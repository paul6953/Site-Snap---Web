// ─── Constants ────────────────────────────────────────────────────────────────
const MP_TRADES = [
  { id: 'ATWM',             name: 'ATWM',             noZone: true },
  { id: 'Darim',            name: 'Darim'                          },
  { id: 'MNTI Plumbing',    name: 'MNTI Plumbing'                  },
  { id: 'MNTI Hydronics',   name: 'MNTI Hydronics'                 },
  { id: 'MNTI Sheet Metal', name: 'MNTI Sheet Metal'               },
  { id: 'Piche',            name: 'Piche'                          },
  { id: 'Trident',          name: 'Trident'                        },
];
const MP_ZONES  = ['P1', '1', '2A', '2B', '3', '4', '5'];
const L2_ZONES  = ['1', '2A', '2B', '3', '4', '5'];
const MNTI_IDS  = ['MNTI Plumbing', 'MNTI Hydronics', 'MNTI Sheet Metal'];

const ZONE_COLORS = {
  'P1': '#007AFF', '1': '#34C759', '2A': '#FF9500',
  '2B': '#FF3B30', '3':  '#AF52DE', '4': '#5AC8FA', '5': '#FF6B35',
};

// ─── State ────────────────────────────────────────────────────────────────────
let mpDraft       = {};
let mpEditDate    = null;
let mpActiveTrade = null;
let mpActiveZone  = null;
let mpKeypadVal   = '';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined,
    { weekday: 'short', month: 'short', day: 'numeric' });
}

function getDraft(tid, zone) {
  if (zone === null) return mpDraft[tid] ?? 0;
  return (mpDraft[tid] ?? {})[zone] ?? 0;
}

function setDraft(tid, zone, val) {
  if (zone === null) { mpDraft[tid] = val; return; }
  if (typeof mpDraft[tid] !== 'object' || mpDraft[tid] === null) mpDraft[tid] = {};
  mpDraft[tid][zone] = val;
}

function tradeSum(tid, entries) {
  const e = entries?.[tid];
  if (!e) return 0;
  if (typeof e === 'number') return e;
  return Object.values(e).reduce((s, v) => s + (v || 0), 0);
}

function l2Sum(tid, entries) {
  return L2_ZONES.reduce((s, z) => s + ((entries?.[tid]?.[z]) || 0), 0);
}

function zoneAllTradesSum(zone, entries) {
  return MP_TRADES.filter(t => !t.noZone)
    .reduce((s, t) => s + ((entries?.[t.id]?.[zone]) || 0), 0);
}

// ─── Sub-screen navigation ────────────────────────────────────────────────────
function mpShow(id) {
  document.querySelectorAll('.mp-sub').forEach(el => { el.style.display = 'none'; });
  document.getElementById(id).style.display = 'flex';
}

// ─── Entry point (called from app.js) ────────────────────────────────────────
function openManpowerScreen() {
  document.getElementById('screen-home').style.display      = 'none';
  document.getElementById('screen-floorplan').style.display = 'none';
  document.getElementById('screen-manpower').style.display  = 'flex';
  mpOpenHome();
}

function closeManpowerScreen() {
  document.getElementById('screen-manpower').style.display = 'none';
  document.getElementById('screen-home').style.display     = 'flex';
}

// ─── Home sub-screen ─────────────────────────────────────────────────────────
async function mpOpenHome() {
  mpShow('mp-sub-home');
  const today = todayISO();
  document.getElementById('mp-date-label').textContent =
    new Date(today + 'T12:00:00').toLocaleDateString(undefined,
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const existing = await DB.getManpowerDay(today);
  document.getElementById('mp-home-status').textContent =
    existing ? 'Today\'s count is recorded. Tap to edit.' : 'Today\'s count has not been recorded.';
  document.getElementById('mp-start-btn').textContent =
    existing ? 'Edit Today\'s Count' : 'Record Today\'s Count';
}

document.getElementById('mp-back-home').addEventListener('click', closeManpowerScreen);

document.getElementById('mp-start-btn').addEventListener('click', async () => {
  const today = todayISO();
  mpEditDate = today;
  const existing = await DB.getManpowerDay(today);
  mpDraft = existing ? JSON.parse(JSON.stringify(existing.entries)) : {};
  mpShowTrades();
});

document.getElementById('mp-view-reports-btn').addEventListener('click', mpShowReports);

// ─── Trade list sub-screen ────────────────────────────────────────────────────
function mpShowTrades() {
  mpShow('mp-sub-trades');
  document.getElementById('mp-trades-subtitle').textContent = fmtDate(mpEditDate);
  renderTradeList();
}

function renderTradeList() {
  const list = document.getElementById('mp-trades-list');
  list.innerHTML = '';
  for (const trade of MP_TRADES) {
    const row = document.createElement('div');
    row.className = 'mp-list-row';
    const total = tradeSum(trade.id, mpDraft);
    row.innerHTML = `
      <span class="mp-row-label">${trade.name}</span>
      <span class="mp-row-value">${total > 0 ? total : '—'}</span>
      <span class="mp-row-arrow">›</span>`;
    row.addEventListener('click', () => {
      mpActiveTrade = trade;
      trade.noZone ? mpShowKeypad(null) : mpShowZones();
    });
    list.appendChild(row);
  }
}

document.getElementById('mp-trades-back').addEventListener('click', mpOpenHome);
document.getElementById('mp-save-btn').addEventListener('click', async () => {
  await DB.saveManpowerDay(mpEditDate, mpDraft);
  mpOpenHome();
});

// ─── Zone list sub-screen ─────────────────────────────────────────────────────
function mpShowZones() {
  mpShow('mp-sub-zones');
  document.getElementById('mp-zones-title').textContent = mpActiveTrade.name;
  renderZoneList();
}

function renderZoneList() {
  const list = document.getElementById('mp-zones-list');
  list.innerHTML = '';
  for (const zone of MP_ZONES) {
    const row = document.createElement('div');
    row.className = 'mp-list-row';
    const v = getDraft(mpActiveTrade.id, zone);
    row.innerHTML = `
      <span class="mp-zone-dot" style="background:${ZONE_COLORS[zone]}"></span>
      <span class="mp-row-label">${zone === 'P1' ? 'P1' : 'Zone ' + zone}</span>
      <span class="mp-row-value">${v > 0 ? v : '—'}</span>
      <span class="mp-row-arrow">›</span>`;
    row.addEventListener('click', () => { mpActiveZone = zone; mpShowKeypad(zone); });
    list.appendChild(row);
  }
}

document.getElementById('mp-zones-back').addEventListener('click', () => { mpActiveTrade = null; mpShowTrades(); });

// ─── Keypad sub-screen ────────────────────────────────────────────────────────
function mpShowKeypad(zone) {
  mpActiveZone = zone;
  const cur = getDraft(mpActiveTrade.id, zone);
  mpKeypadVal = cur > 0 ? String(cur) : '';
  const sub = zone !== null
    ? `${mpActiveTrade.name} — ${zone === 'P1' ? 'P1' : 'Zone ' + zone}`
    : mpActiveTrade.name;
  document.getElementById('mp-keypad-subtitle').textContent = sub;
  updateDisplay();
  mpShow('mp-sub-keypad');
}

function updateDisplay() {
  document.getElementById('mp-keypad-display').textContent = mpKeypadVal || '0';
}

document.getElementById('mp-keypad-back').addEventListener('click', () => {
  mpActiveTrade.noZone ? (mpActiveTrade = null, mpShowTrades()) : mpShowZones();
});

document.querySelectorAll('.mp-key').forEach(btn => {
  btn.addEventListener('click', () => {
    const k = btn.dataset.k;
    if (k === '⌫') {
      mpKeypadVal = mpKeypadVal.slice(0, -1);
    } else if (k === '✓') {
      setDraft(mpActiveTrade.id, mpActiveZone, parseInt(mpKeypadVal || '0', 10) || 0);
      if (mpActiveTrade.noZone) { mpActiveTrade = null; mpShowTrades(); }
      else { renderZoneList(); mpShowZones(); }
      return;
    } else {
      if (mpKeypadVal.length < 4) mpKeypadVal += k;
    }
    updateDisplay();
  });
});

// ─── Reports sub-screen ───────────────────────────────────────────────────────
async function mpShowReports() {
  mpShow('mp-sub-reports');
  const body = document.getElementById('mp-reports-body');
  body.innerHTML = '<p class="mp-placeholder">Loading…</p>';
  const allDays = await DB.getAllManpowerDays();
  body.innerHTML = '';
  if (!allDays.length) {
    body.innerHTML = '<p class="mp-placeholder">No data recorded yet.</p>';
    return;
  }
  renderAllCharts(body, allDays);
}

document.getElementById('mp-reports-back').addEventListener('click', mpOpenHome);

// ─── Chart rendering ─────────────────────────────────────────────────────────
function renderAllCharts(container, allDays) {
  const shortLabels = allDays.map(d => {
    const [, m, day] = d.date.split('-');
    return `${parseInt(m)}/${parseInt(day)}`;
  });

  const p1 = (tid) => allDays.map(d => d.entries?.[tid]?.P1 || 0);
  const l2 = (tid) => allDays.map(d => l2Sum(tid, d.entries));
  const zoneAll = (z) => allDays.map(d => zoneAllTradesSum(z, d.entries));
  const mntiP1  = () => allDays.map(d => MNTI_IDS.reduce((s,id) => s + (d.entries?.[id]?.P1 || 0), 0));
  const mntiL2  = () => allDays.map(d => MNTI_IDS.reduce((s,id) => s + l2Sum(id, d.entries), 0));

  // Section 1 — All zones overview
  section(container, 'Workers by Zone');
  chart(container, 'All Zones — Daily Total', shortLabels,
    MP_ZONES.map(z => ({ label: z === 'P1' ? 'P1' : 'Zone ' + z, color: ZONE_COLORS[z], data: zoneAll(z) })));

  // Section 2 — Per-trade P1 vs L2
  section(container, 'Workers by Trade');
  for (const t of MP_TRADES) {
    if (t.noZone) {
      chart(container, `${t.name} — Daily Count`, shortLabels,
        [{ label: t.name, color: '#007AFF', data: allDays.map(d => d.entries?.[t.id] || 0) }]);
    } else {
      chart(container, `${t.name} — P1 vs L2`, shortLabels, [
        { label: 'P1', color: '#007AFF', data: p1(t.id) },
        { label: 'L2', color: '#34C759', data: l2(t.id) },
      ]);
    }
  }

  // Section 3 — M&E Total
  section(container, 'M&E Total');
  chart(container, 'M&E & Trident Daily Count', shortLabels, [
    { label: 'MNTI P1',    color: '#007AFF', data: mntiP1()   },
    { label: 'MNTI L2',    color: '#34C759', data: mntiL2()   },
    { label: 'Trident P1', color: '#FF9500', data: p1('Trident') },
    { label: 'Trident L2', color: '#AF52DE', data: l2('Trident') },
  ]);
}

function section(container, title) {
  const h = document.createElement('p');
  h.className = 'mp-section-header';
  h.textContent = title;
  container.appendChild(h);
}

function chart(container, title, labels, datasets) {
  const card = document.createElement('div');
  card.className = 'mp-chart-card';

  const h = document.createElement('p');
  h.className = 'mp-chart-title';
  h.textContent = title;
  card.appendChild(h);

  const hasData = datasets.some(ds => ds.data.some(v => v > 0));
  if (!hasData) {
    const e = document.createElement('p');
    e.className = 'mp-placeholder';
    e.textContent = 'No data yet';
    card.appendChild(e);
    container.appendChild(card);
    return;
  }

  const canvas = document.createElement('canvas');
  card.appendChild(canvas);

  // Legend
  const leg = document.createElement('div');
  leg.className = 'mp-legend';
  datasets.forEach(ds => {
    const item = document.createElement('span');
    item.className = 'mp-legend-item';
    item.innerHTML = `<span class="mp-legend-dot" style="background:${ds.color}"></span>${ds.label}`;
    leg.appendChild(item);
  });
  card.appendChild(leg);
  container.appendChild(card);

  // Draw after layout is settled
  requestAnimationFrame(() => {
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.parentElement.clientWidth - 28; // card padding
    const H   = 180;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    drawLineChart(ctx, W, H, labels, datasets);
  });
}

function drawLineChart(ctx, W, H, labels, datasets) {
  const P = { t: 12, r: 12, b: 38, l: 38 };
  const cW = W - P.l - P.r;
  const cH = H - P.t - P.b;
  const n  = labels.length;

  const maxVal = Math.max(...datasets.flatMap(d => d.data), 1);

  ctx.clearRect(0, 0, W, H);

  // Grid + Y labels
  for (let i = 0; i <= 4; i++) {
    const y = P.t + cH - (i / 4) * cH;
    ctx.strokeStyle = '#e5e5ea'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(P.l, y); ctx.lineTo(P.l + cW, y); ctx.stroke();
    ctx.fillStyle = '#8e8e93'; ctx.font = '9px -apple-system,sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(maxVal * i / 4), P.l - 5, y);
  }

  // X labels (up to 8, evenly spaced)
  const xStep = Math.max(1, Math.ceil(n / 8));
  ctx.fillStyle = '#8e8e93'; ctx.font = '9px -apple-system,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = 0; i < n; i += xStep) {
    const x = P.l + (n < 2 ? cW / 2 : (i / (n - 1)) * cW);
    ctx.fillText(labels[i], x, H - P.b + 4);
  }
  if (n > 1 && (n - 1) % xStep !== 0) {
    ctx.fillText(labels[n - 1], P.l + cW, H - P.b + 4);
  }

  // X axis
  ctx.strokeStyle = '#c7c7cc'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(P.l, P.t + cH); ctx.lineTo(P.l + cW, P.t + cH); ctx.stroke();

  // Series
  for (const ds of datasets) {
    const pts = ds.data.map((v, i) => ({
      x: P.l + (n < 2 ? cW / 2 : (i / (n - 1)) * cW),
      y: P.t + cH - (v / maxVal) * cH,
    }));

    ctx.strokeStyle = ds.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();

    ctx.fillStyle = ds.color;
    for (const p of pts) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
}

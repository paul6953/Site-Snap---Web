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
let mpChartItems  = []; // { type:'section'|'chart', title, canvas? }

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
  document.getElementById('screen-landing').style.display   = 'none';
  document.getElementById('screen-home').style.display      = 'none';
  document.getElementById('screen-floorplan').style.display = 'none';
  document.getElementById('screen-manpower').style.display  = 'flex';
  mpEditDate = todayISO();
  mpOpenHome();
}

function closeManpowerScreen() {
  document.getElementById('screen-manpower').style.display  = 'none';
  document.getElementById('screen-landing').style.display   = 'flex';
}

// ─── Home sub-screen ─────────────────────────────────────────────────────────
async function mpOpenHome() {
  mpShow('mp-sub-home');
  if (!mpEditDate) mpEditDate = todayISO();

  const picker = document.getElementById('mp-date-picker');
  picker.value = mpEditDate;
  picker.max   = todayISO();

  const isToday  = mpEditDate === todayISO();
  document.getElementById('mp-date-label').textContent = fmtDate(mpEditDate);

  const existing = await DB.getManpowerDay(mpEditDate);
  document.getElementById('mp-home-status').textContent =
    existing ? 'Count recorded. Tap below to edit.' : 'No count recorded for this date.';
  document.getElementById('mp-start-btn').textContent =
    existing ? 'Edit Count' : (isToday ? 'Record Today\'s Count' : 'Record Count');
}

document.getElementById('mp-back-home').addEventListener('click', closeManpowerScreen);

document.getElementById('mp-date-picker').addEventListener('change', async (e) => {
  if (!e.target.value) return;
  mpEditDate = e.target.value;
  const isToday  = mpEditDate === todayISO();
  document.getElementById('mp-date-label').textContent = fmtDate(mpEditDate);
  const existing = await DB.getManpowerDay(mpEditDate);
  document.getElementById('mp-home-status').textContent =
    existing ? 'Count recorded. Tap below to edit.' : 'No count recorded for this date.';
  document.getElementById('mp-start-btn').textContent =
    existing ? 'Edit Count' : (isToday ? 'Record Today\'s Count' : 'Record Count');
});

document.getElementById('mp-start-btn').addEventListener('click', async () => {
  const existing = await DB.getManpowerDay(mpEditDate);
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

document.getElementById('mp-export-btn').addEventListener('click', () => {
  showActionSheet([
    { label: 'Export Charts (PDF)', action: exportChartsPDF },
    { label: 'Export Data (Excel)', action: async () => {
      const allDays = await DB.getAllManpowerDays();
      exportManpowerExcel(allDays);
    }},
  ]);
});

// ─── Excel export ─────────────────────────────────────────────────────────────
function exportManpowerExcel(allDays) {
  if (typeof XLSX === 'undefined') {
    alert('Excel library not loaded. Try refreshing the app.');
    return;
  }
  if (!allDays.length) {
    alert('No manpower data recorded yet.');
    return;
  }

  const wb = XLSX.utils.book_new();

  // --- Summary: one row per day, one column per trade ---
  const summaryHeader = ['Date', ...MP_TRADES.map(t => t.name), 'Grand Total'];
  const summaryRows   = [summaryHeader];
  for (const day of allDays) {
    const row = [day.date];
    let total = 0;
    for (const t of MP_TRADES) { const v = tradeSum(t.id, day.entries); row.push(v); total += v; }
    row.push(total);
    summaryRows.push(row);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary');

  // --- All Zones: total workers per zone per day ---
  const zoneHeader = ['Date', ...MP_ZONES.map(z => z === 'P1' ? 'P1' : 'Zone ' + z)];
  const zoneRows   = [zoneHeader];
  for (const day of allDays) {
    zoneRows.push([day.date, ...MP_ZONES.map(z => zoneAllTradesSum(z, day.entries))]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(zoneRows), 'All Zones');

  // --- Per-trade sheets ---
  for (const trade of MP_TRADES) {
    if (trade.noZone) {
      const rows = [['Date', trade.name]];
      for (const day of allDays) rows.push([day.date, day.entries?.[trade.id] || 0]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), trade.name.slice(0, 31));
    } else {
      const headers = ['Date', 'P1', ...L2_ZONES.map(z => 'Zone ' + z), 'P1 Total', 'L2 Total', 'Grand Total'];
      const rows = [headers];
      for (const day of allDays) {
        const p1v    = day.entries?.[trade.id]?.P1 || 0;
        const l2vals = L2_ZONES.map(z => day.entries?.[trade.id]?.[z] || 0);
        const l2tot  = l2vals.reduce((s, v) => s + v, 0);
        rows.push([day.date, p1v, ...l2vals, p1v, l2tot, p1v + l2tot]);
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), trade.name.slice(0, 31));
    }
  }

  // --- M&E Total ---
  const meRows = [['Date', 'MNTI P1', 'MNTI L2', 'Trident P1', 'Trident L2', 'M&E Total']];
  for (const day of allDays) {
    const mP1 = MNTI_IDS.reduce((s, id) => s + (day.entries?.[id]?.P1 || 0), 0);
    const mL2 = MNTI_IDS.reduce((s, id) => s + l2Sum(id, day.entries), 0);
    const tP1 = day.entries?.Trident?.P1 || 0;
    const tL2 = l2Sum('Trident', day.entries);
    meRows.push([day.date, mP1, mL2, tP1, tL2, mP1 + mL2 + tP1 + tL2]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meRows), 'M&E Total');

  XLSX.writeFile(wb, `Manpower_${todayISO()}.xlsx`);
}

// ─── Chart rendering ─────────────────────────────────────────────────────────
function renderAllCharts(container, allDays) {
  mpChartItems = [];
  const labels = allDays.map(d => {
    const [, m, day] = d.date.split('-');
    return `${parseInt(m)}/${parseInt(day)}`;
  });

  const p1       = (tid) => allDays.map(d => d.entries?.[tid]?.P1 || 0);
  const zd       = (tid, z) => allDays.map(d => d.entries?.[tid]?.[z] || 0);
  const l2t      = (tid) => allDays.map(d => l2Sum(tid, d.entries));
  const mntiZone = (z)  => allDays.map(d => MNTI_IDS.reduce((s, id) => s + (d.entries?.[id]?.[z] || 0), 0));
  const mntiP1   = ()   => allDays.map(d => MNTI_IDS.reduce((s, id) => s + (d.entries?.[id]?.P1 || 0), 0));

  // ─── Category 1: Workers by Trade — By Zone ──────────────────────────────
  section(container, 'Workers by Trade — By Zone');

  chart(container, 'ATWM — Daily Count', labels,
    [{ label: 'ATWM', color: '#007AFF', data: allDays.map(d => d.entries?.ATWM || 0) }]);

  for (const t of MP_TRADES.filter(t => !t.noZone)) {
    chart(container, `${t.name} — By Zone`, labels, [
      { label: 'P1', color: ZONE_COLORS['P1'], data: p1(t.id) },
      ...L2_ZONES.map(z => ({ label: 'Zone ' + z, color: ZONE_COLORS[z], data: zd(t.id, z) })),
    ]);
  }

  // ─── Category 2: Workers by Trade — Total (P1 vs L2) ─────────────────────
  section(container, 'Workers by Trade — Total');

  for (const t of MP_TRADES.filter(t => !t.noZone)) {
    chart(container, `${t.name} — P1 vs L2 Total`, labels, [
      { label: 'P1',       color: '#007AFF', data: p1(t.id)  },
      { label: 'L2 Total', color: '#34C759', data: l2t(t.id) },
    ]);
  }

  // ─── Category 3: M&E Totals ───────────────────────────────────────────────
  section(container, 'M&E Totals');

  chart(container, 'MNTI — P1 Daily Total', labels,
    [{ label: 'MNTI P1', color: '#007AFF', data: mntiP1() }]);

  chart(container, 'MNTI — L2 by Zone', labels,
    L2_ZONES.map(z => ({ label: 'Zone ' + z, color: ZONE_COLORS[z], data: mntiZone(z) })));

  chart(container, 'Trident — P1 Daily Count', labels,
    [{ label: 'Trident P1', color: '#FF9500', data: p1('Trident') }]);

  chart(container, 'Trident — L2 by Zone', labels,
    L2_ZONES.map(z => ({ label: 'Zone ' + z, color: ZONE_COLORS[z], data: zd('Trident', z) })));
}

function section(container, title) {
  const h = document.createElement('p');
  h.className = 'mp-section-header';
  h.textContent = title;
  container.appendChild(h);
  mpChartItems.push({ type: 'section', title });
}

function chart(container, title, labels, datasets) {
  const card = document.createElement('div');
  card.className = 'mp-chart-card';

  const h = document.createElement('p');
  h.className = 'mp-chart-title';
  h.textContent = title;
  card.appendChild(h);

  const hasData = datasets.some(ds => ds.data.some(v => v > 0));

  const canvas = document.createElement('canvas');

  if (!hasData) {
    const e = document.createElement('p');
    e.className = 'mp-placeholder';
    e.textContent = 'No data yet';
    card.appendChild(e);
    container.appendChild(card);
    mpChartItems.push({ type: 'chart', title, canvas: null });
    return;
  }

  card.appendChild(canvas);

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

  mpChartItems.push({ type: 'chart', title, canvas });

  requestAnimationFrame(() => {
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.parentElement.clientWidth - 28;
    const H   = 240;
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
  const P  = { t: 12, r: 12, b: 52, l: 38 };
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

  // X axis
  ctx.strokeStyle = '#c7c7cc'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(P.l, P.t + cH); ctx.lineTo(P.l + cW, P.t + cH); ctx.stroke();

  // X labels — all points, rotated -45°
  ctx.fillStyle = '#8e8e93'; ctx.font = '9px -apple-system,sans-serif';
  for (let i = 0; i < n; i++) {
    const x = P.l + (n < 2 ? cW / 2 : (i / (n - 1)) * cW);
    ctx.save();
    ctx.translate(x, H - P.b + 6);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(labels[i], 0, 0);
    ctx.restore();
  }

  // Series lines + dots
  for (const ds of datasets) {
    const pts = ds.data.map((v, i) => ({
      x: P.l + (n < 2 ? cW / 2 : (i / (n - 1)) * cW),
      y: P.t + cH - (v / maxVal) * cH,
    }));

    ctx.strokeStyle = ds.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();

    ctx.fillStyle = ds.color;
    for (const p of pts) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ─── PDF chart export ─────────────────────────────────────────────────────────
function exportChartsPDF() {
  if (!mpChartItems.length) {
    alert('Open Reports first to load the charts.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const PW = 612, PH = 792, M = 36;
  const doc = new jsPDF({ unit: 'pt', format: [PW, PH], orientation: 'portrait' });

  let y = M;

  // Cover title
  doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
  doc.text('Manpower Report', M, y + 4);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(142, 142, 147);
  doc.text(new Date().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' }), M, y + 20);
  y += 50;

  for (const item of mpChartItems) {
    if (item.type === 'section') {
      if (y + 80 > PH - M) { doc.addPage([PW, PH]); y = M; }
      else y += 10;
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(142, 142, 147);
      doc.text(item.title.toUpperCase(), M, y);
      doc.setDrawColor(229, 229, 234); doc.setLineWidth(0.5);
      doc.line(M, y + 5, PW - M, y + 5);
      y += 18;
    } else if (item.type === 'chart' && item.canvas && item.canvas.width) {
      const cv      = item.canvas;
      const logW    = parseFloat(cv.style.width)  || cv.width;
      const logH    = parseFloat(cv.style.height) || cv.height;
      const pdfImgW = PW - 2 * M;
      const pdfImgH = logH * (pdfImgW / logW);
      const blockH  = 16 + pdfImgH + 12;

      if (y + blockH > PH - M) { doc.addPage([PW, PH]); y = M; }

      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0, 0, 0);
      doc.text(item.title, M, y);
      y += 14;

      doc.addImage(cv.toDataURL('image/png'), 'PNG', M, y, pdfImgW, pdfImgH);
      y += pdfImgH + 12;
    }
  }

  doc.save(`Manpower_Charts_${todayISO()}.pdf`);
}

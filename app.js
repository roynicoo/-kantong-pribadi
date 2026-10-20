import { CATEGORIES, localDate, recap, validate, escapeHTML, toCSV, backup } from './core.js';
import { DemoStore, CloudStore } from './store.js';

/* ============================================================
   Kantong — pengendali antarmuka
   Data uang disimpan sebagai BigInt saat dihitung, dikirim sebagai
   bilangan bulat. Tidak ada angka floating point untuk nominal.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const PALETTE = ['#1c6b4b', '#b7893f', '#a8472c', '#2f6f8f', '#6b5b95', '#8a6d3b', '#4b7a5a'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const state = {
  mode: null,          // 'cloud' | 'demo'
  store: null,
  cfg: null,
  all: [],
  month: '',
  editing: null,
  loaded: false,
  busy: false,
  filters: { q: '', type: '', cat: '' },
};

/* ---------- utilitas tampilan ---------- */
const digits = (v) => String(v).replace(/[^\d]/g, '');
const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function rp(value) {
  let n = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value) || 0));
  const neg = n < 0n;
  if (neg) n = -n;
  return (neg ? '−' : '') + 'Rp ' + group(n.toString());
}
const rpShort = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' M' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' jt' : n >= 1e3 ? Math.round(n / 1e3) + ' rb' : String(n));

function monthLabel(m) {
  const [y, mm] = m.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(y, mm - 1, 1));
}
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

let noticeTimer = null;
function notify(text, isError = false) {
  const el = $('notice');
  el.textContent = text;
  el.hidden = false;
  el.classList.toggle('error', !!isError);
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 240);
  }, isError ? 5200 : 3200);
}

/* ---------- tema ---------- */
function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem('kantong.theme', name); } catch { /* penyimpanan diblokir */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', name === 'dark' ? '#0e1a17' : '#f7f2e7');
}
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('kantong.theme'); } catch { /* abaikan */ }
  const prefers = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(saved === 'dark' || saved === 'light' ? saved : prefers);
})();

/* ---------- kategori & isian ---------- */
function fillCategorySelect() {
  const sel = $('category');
  const type = document.querySelector('input[name="type"]:checked')?.value || 'expense';
  const keep = sel.value;
  sel.innerHTML = CATEGORIES[type].map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  if (CATEGORIES[type].includes(keep)) sel.value = keep;
}
function fillFilterCategories() {
  const all = [...new Set([...CATEGORIES.expense, ...CATEGORIES.income])].sort((a, b) => a.localeCompare(b, 'id'));
  $('fcat').innerHTML = '<option value="">Semua kategori</option>' + all.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
}

/* ---------- gerbang / konfigurasi ---------- */
function showGate(message, { login = false } = {}) {
  $('gate').hidden = false;
  $('workspace').hidden = true;
  $('logout').hidden = true;
  $('add-btn').hidden = true;
  $('login').hidden = !login;
  if (message) $('setup').textContent = message;
}
function setSync(text, cls) {
  const el = $('sync');
  el.textContent = text;
  el.className = 'sync' + (cls ? ' ' + cls : '');
}

function readConfig() {
  const c = window.KANTONG_CONFIG || {};
  const url = String(c.url || '').replace(/\/+$/, '');
  const key = String(c.anonKey || '');
  /* CloudStore membaca properti `anonKey`; simpan juga sebagai `key` untuk probe. */
  return url && key ? { url, anonKey: key, key } : null;
}

async function probeSchema(cfg) {
  const res = await fetch(`${cfg.url}/rest/v1/transactions?select=id&limit=0`, {
    headers: { apikey: cfg.key },
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) return 'ok';
  let body = null;
  try { body = await res.json(); } catch { /* bukan JSON */ }
  if (res.status === 404 || body?.code === 'PGRST205' || /Could not find the table/i.test(body?.message || '')) return 'missing';
  if (res.status === 401 || res.status === 403) return 'ok';   // anon ditolak = normal
  return 'error';
}

async function boot() {
  const cfg = readConfig();
  if (!cfg) {
    showGate('Cloud belum dikonfigurasi.', { login: false });
    return;
  }
  state.cfg = cfg;
  let status = 'error';
  try { status = await probeSchema(cfg); } catch { status = 'error'; }

  if (status === 'missing') {
    showGate('Database belum disiapkan. Jalankan supabase/schema.sql melalui SQL Editor pemilik proyek.', { login: false });
    return;
  }
  if (status === 'error') {
    showGate('Cloud tidak dapat diperiksa sekarang. Coba muat ulang, atau pakai demo lokal.', { login: false });
    return;
  }
  const store = new CloudStore(cfg);
  state.store = store;
  if (store.session?.access_token) {
    state.mode = 'cloud';
    try { await enterWorkspace(); } catch { showGate('Sesi berakhir. Silakan masuk kembali.', { login: true }); }
  } else {
    showGate(null, { login: true });
  }
}

/* ---------- masuk / keluar ---------- */
async function signIn(ev) {
  ev.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  const btn = ev.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Memeriksa…';
  try {
    state.store = new CloudStore(state.cfg);
    await state.store.signIn(email, password);
    state.mode = 'cloud';
    $('password').value = '';
    await enterWorkspace();
    notify('Selamat datang kembali.');
  } catch (err) {
    notify(err.message || 'Gagal masuk.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Masuk ke Kantong';
  }
}

async function signOut() {
  const s = state.store;
  try { if (state.mode === 'cloud' && s) await s.signOut(); } catch { /* sesi lokal tetap dibersihkan */ }
  state.all = []; state.loaded = false; state.editing = null; state.mode = null; state.store = null;
  closeSheet();
  resetForm();
  showGate('Silakan masuk kembali untuk melanjutkan.', { login: true });
  notify('Anda sudah keluar.');
}

/* ---------- ruang kerja ---------- */
async function enterWorkspace() {
  if (!state.store) state.store = new DemoStore();
  $('gate').hidden = true;
  $('workspace').hidden = false;
  $('logout').hidden = false;
  $('add-btn').hidden = false;
  $('identity').textContent = state.mode === 'cloud'
    ? (state.store.session?.user?.email || 'Masuk')
    : 'Demo lokal';
  if (!state.month) state.month = localDate().slice(0, 7);
  $('month').value = state.month;
  fillCategorySelect();
  fillFilterCategories();
  if (!$('date').value) $('date').value = localDate();
  setButtons(false);
  await load();
}

function setButtons(enabled) {
  const can = enabled && !state.busy;
  for (const id of ['save', 'print', 'csv', 'json', 'import']) {
    const el = $(id);
    if (el) el.disabled = !can;
  }
}

async function load() {
  setSync(state.mode === 'cloud' ? 'Cloud Supabase · memuat…' : 'Demo lokal · memuat…', 'warn');
  setButtons(false);
  try {
    const all = await state.store.all();
    state.all = Array.isArray(all) ? all : [];
    state.loaded = true;
    setSync(state.mode === 'cloud'
      ? `Cloud Supabase · dimuat ${state.all.length} transaksi`
      : 'Demo lokal · tidak tersinkron', state.mode === 'cloud' ? '' : 'demo');
    render();
    setButtons(true);
  } catch (err) {
    state.loaded = false;
    setSync('Data belum berhasil dimuat · laporan dan perubahan dinonaktifkan.', 'err');
    setButtons(false);
    $('rows').innerHTML = '';
    $('count').textContent = '0';
    $('empty').classList.add('show');
    notify(err.message || 'Gagal memuat data.', true);
  }
}

/* ---------- render ---------- */
function currentRecap() {
  try { return recap(state.all, state.month); }
  catch { return { rows: [], income: 0n, expense: 0n, balance: 0n, categories: {} }; }
}

function render() {
  const r = currentRecap();
  const prev = recapSafe(shiftMonth(state.month, -1));
  renderSummary(r, prev);
  renderChart();
  renderDonut(r);
  renderTop(r);
  renderTable(r);
  $('period-label').textContent = 'Periode ' + monthLabel(state.month);
}
function recapSafe(month) {
  try { return recap(state.all, month); }
  catch { return { rows: [], income: 0n, expense: 0n, balance: 0n, categories: {} }; }
}

function renderSummary(r, prev) {
  $('balance').textContent = rp(r.balance);
  $('income').textContent = rp(r.income);
  $('expense').textContent = rp(r.expense);

  const dEl = $('delta-out');
  const p = prev.expense;
  if (p > 0n) {
    const diff = Number(r.expense - p) / Number(p) * 100;
    const up = diff > 0;
    dEl.hidden = false;
    dEl.textContent = `${up ? '▲' : '▼'} ${Math.abs(diff).toFixed(diff % 1 === 0 ? 0 : 1)}% vs ${MONTH_SHORT[Number(shiftMonth(state.month, -1).split('-')[1]) - 1]}`;
  } else {
    dEl.hidden = true;
  }

  const daysInMonth = new Date(Number(state.month.slice(0, 4)), Number(state.month.slice(5, 7)), 0).getDate();
  const now = localDate();
  const elapsed = now.slice(0, 7) === state.month ? Math.max(1, Number(now.slice(8, 10))) : daysInMonth;
  $('daily-avg').textContent = r.expense > 0n ? rp(BigInt(Math.round(Number(r.expense) / elapsed))) : 'Rp 0';

  const nIn = r.rows.filter((t) => t.type === 'income').length;
  const nOut = r.rows.length - nIn;
  $('income-note').textContent = nIn ? `${nIn} pemasukan tercatat` : 'Belum ada pemasukan';
  $('expense-note').textContent = nOut ? `${nOut} pengeluaran tercatat` : 'Belum ada pengeluaran';
}

function renderChart() {
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(state.month, -i));
  const data = months.map((m) => {
    const r = recapSafe(m);
    return { m, income: Number(r.income), expense: Number(r.expense) };
  });
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const W = 520, H = 186, padL = 6, padB = 26, top = 8;
  const slot = (W - padL * 2) / data.length;
  const bw = Math.min(15, slot * 0.28);
  const gap = 5;
  const baseY = H - padB;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="presentation" aria-hidden="true">`;
  for (let i = 0; i <= 2; i++) {
    const y = top + ((baseY - top) / 2) * i;
    svg += `<line class="grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padL}" y2="${y.toFixed(1)}"/>`;
  }
  svg += `<text class="axis" x="${W - padL}" y="${top + 9}" text-anchor="end">${rpShort(max)}</text>`;
  data.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2;
    const hi = Math.max(2, (d.income / max) * (baseY - top));
    const ho = Math.max(2, (d.expense / max) * (baseY - top));
    const label = MONTH_SHORT[Number(d.m.split('-')[1]) - 1];
    svg += `<g><title>${label} ${d.m.slice(0, 4)} — masuk ${rp(d.income)}, keluar ${rp(d.expense)}</title>`;
    svg += `<rect class="bar-in" x="${(cx - bw - gap / 2).toFixed(1)}" y="${(baseY - hi).toFixed(1)}" width="${bw}" height="${hi.toFixed(1)}" rx="3"/>`;
    svg += `<rect class="bar-out" x="${(cx + gap / 2).toFixed(1)}" y="${(baseY - ho).toFixed(1)}" width="${bw}" height="${ho.toFixed(1)}" rx="3"/>`;
    svg += `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${label}</text></g>`;
  });
  svg += '</svg>';
  $('chart-bars').innerHTML = svg;
}

const C = 2 * Math.PI * 72;
function renderDonut(r) {
  const entries = Object.entries(r.categories).map(([k, v]) => [k, Number(v)]).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (!total) {
    $('categories').innerHTML = `<svg viewBox="0 0 200 200" role="presentation" aria-hidden="true"><circle cx="100" cy="100" r="72" fill="none" stroke="var(--line)" stroke-width="22"/><text x="100" y="96" text-anchor="middle" font-size="15" fill="var(--muted)">Belum ada</text><text x="100" y="116" text-anchor="middle" font-size="12" fill="var(--muted)">pengeluaran</text></svg>`;
    $('legend').innerHTML = '<li><span class="swatch" style="background:var(--line)"></span><span class="name">Belum ada pengeluaran</span><span class="val">—</span></li>';
    return;
  }
  let offset = 0;
  let svg = '<svg viewBox="0 0 200 200" role="presentation" aria-hidden="true"><g transform="rotate(-90 100 100)">';
  entries.forEach(([name, v], i) => {
    const len = (v / total) * C;
    const color = PALETTE[i % PALETTE.length];
    svg += `<circle class="arc" cx="100" cy="100" r="72" stroke="${color}" stroke-dasharray="${(Math.max(0, len - 1.5)).toFixed(2)} ${(C - len + 1.5).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${escapeHTML(name)} — ${rp(v)}</title></circle>`;
    offset += len;
  });
  svg += '</g></svg>';
  /* label tengah di luar grup yang diputar agar teks tetap tegak */
  svg += `<div class="donut-center"><b>${rpShort(total)}</b><span>total keluar</span></div>`;
  $('categories').innerHTML = `<div class="donut-stack">${svg}</div>`;
  $('legend').innerHTML = entries.map(([name, v], i) => `
    <li><span class="swatch" style="background:${PALETTE[i % PALETTE.length]}"></span>
    <span class="name">${escapeHTML(name)}</span>
    <span class="val">${Math.round((v / total) * 100)}% · ${rp(v)}</span></li>`).join('');
}

function renderTop(r) {
  const top = r.rows.filter((t) => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 3);
  $('top-list').innerHTML = top.length
    ? top.map((t, i) => `<li><span class="rank">${i + 1}</span><span class="who">${escapeHTML(t.category)}<small>${dayLabel(t.date)}${t.notes ? ' · ' + escapeHTML(t.notes) : ''}</small></span><span class="val">${rp(t.amount)}</span></li>`).join('')
    : '<li class="none">Belum ada pengeluaran pada periode ini.</li>';
}

function visibleRows(r) {
  const { q, type, cat } = state.filters;
  const needle = q.trim().toLowerCase();
  return r.rows.filter((t) => {
    if (type && t.type !== type) return false;
    if (cat && t.category !== cat) return false;
    if (needle) {
      const hay = `${t.notes || ''} ${t.category}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

function renderTable(r) {
  const rows = visibleRows(r);
  $('count').textContent = String(r.rows.length);
  $('filter-count').textContent = rows.length === r.rows.length
    ? (r.rows.length ? `${r.rows.length} transaksi` : '')
    : `${rows.length} dari ${r.rows.length}`;
  $('empty').classList.toggle('show', rows.length === 0);

  $('rows').innerHTML = rows.map((t) => {
    const income = t.type === 'income';
    const note = t.notes ? escapeHTML(t.notes) : '(tanpa catatan)';
    return `<tr>
      <td><span class="t-date">${dayLabel(t.date)}</span><span class="t-note${t.notes ? '' : ' muted'}">${note}</span></td>
      <td><span class="chip ${t.type}">${escapeHTML(t.category)}</span></td>
      <td class="number"><span class="amount ${t.type}">${income ? '+' : '−'}${rp(t.amount)}</span></td>
      <td class="actions"><div class="row-actions">
        <button class="icon-btn" type="button" data-edit="${escapeHTML(t.id)}" aria-label="Ubah transaksi" title="Ubah transaksi"><svg class="ic" aria-hidden="true"><use href="#ic-pencil"></use></svg></button>
        <button class="icon-btn" type="button" data-del="${escapeHTML(t.id)}" aria-label="Hapus transaksi" title="Hapus transaksi"><svg class="ic" aria-hidden="true"><use href="#ic-trash"></use></svg></button>
      </div></td>
    </tr>`;
  }).join('');
}

/* ---------- formulir ---------- */
function setFormMode(editing) {
  state.editing = editing;
  $('form-title').textContent = editing ? 'Ubah transaksi' : 'Catat transaksi';
  $('save').textContent = editing ? 'Simpan perubahan' : 'Simpan transaksi';
  $('cancel').hidden = !editing;
}

function resetForm() {
  setFormMode(null);
  $('amount').value = '';
  $('notes').value = '';
  $('date').value = localDate();
  document.querySelector('input[name="type"][value="expense"]').checked = true;
  fillCategorySelect();
  $('category').value = CATEGORIES.expense[0];
}

function startEdit(id) {
  const t = state.all.find((x) => x.id === id);
  if (!t) return;
  openSheet();
  document.querySelector(`input[name="type"][value="${t.type}"]`).checked = true;
  fillCategorySelect();
  $('amount').value = String(t.amount);
  $('date').value = t.date;
  $('category').value = t.category;
  $('notes').value = t.notes || '';
  setFormMode(id);
  $('entry-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('amount').focus({ preventScroll: true });
}

async function submitEntry(ev) {
  ev.preventDefault();
  if (state.busy) return;
  if (!state.loaded) { notify('Data belum berhasil dimuat · laporan dan perubahan dinonaktifkan.', true); return; }

  let payload;
  try {
    payload = validate({
      type: document.querySelector('input[name="type"]:checked')?.value,
      category: $('category').value,
      amount: digits($('amount').value),
      date: $('date').value,
      notes: $('notes').value,
    });
  } catch (err) {
    notify(err.message, true);
    $('amount').focus();
    return;
  }

  state.busy = true;
  setButtons(false);
  $('save').textContent = 'Menyimpan…';
  try {
    const saved = await state.store.save(payload, state.editing);
    if (state.editing) {
      const i = state.all.findIndex((x) => x.id === state.editing);
      if (i >= 0) state.all[i] = { ...state.all[i], ...saved };
    } else {
      state.all.push(saved);
    }
    resetForm();
    closeSheet();
    render();
    notify('Transaksi tersimpan.');
  } catch (err) {
    notify(err.message || 'Gagal menyimpan.', true);
    $('save').textContent = state.editing ? 'Simpan perubahan' : 'Simpan transaksi';
  } finally {
    state.busy = false;
    setButtons(true);
  }
}

async function deleteEntry(id) {
  if (!state.loaded || state.busy) return;
  if (!confirm('Hapus transaksi ini? Tindakan ini tidak bisa dibatalkan.')) return;
  state.busy = true;
  setButtons(false);
  try {
    await state.store.remove(id);
    state.all = state.all.filter((x) => x.id !== id);
    if (state.editing === id) resetForm();
    render();
    notify('Transaksi dihapus.');
  } catch (err) {
    notify(err.message || 'Gagal menghapus.', true);
  } finally {
    state.busy = false;
    setButtons(true);
  }
}

/* ---------- lembar bawah (ponsel) ---------- */
function openSheet() {
  $('entry-panel').classList.add('open');
  document.body.classList.add('sheet-open');
}
function closeSheet() {
  $('entry-panel').classList.remove('open');
  document.body.classList.remove('sheet-open');
}

/* ---------- ekspor / impor ---------- */
function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportCSV() {
  const r = currentRecap();
  if (!r.rows.length) { notify('Belum ada transaksi pada periode ini.', true); return; }
  download(`kantong-${state.month}.csv`, toCSV(r.rows), 'text/csv;charset=utf-8');
  notify('CSV periode ini diunduh.');
}
function exportJSON() {
  if (!state.all.length) { notify('Belum ada transaksi untuk dicadangkan.', true); return; }
  download(`kantong-backup-${localDate()}.json`, backup(state.all), 'application/json');
  notify('Backup seluruh bulan diunduh.');
}
function printReport() {
  if (!state.loaded) return;
  const r = currentRecap();
  if (!r.rows.length) notify('Belum ada transaksi pada periode ini.', true);
  $('period-label').textContent = 'Periode ' + monthLabel(state.month);
  window.print();
}

async function importBackup(file) {
  if (!file) return;
  if (!state.loaded) { notify('Data belum berhasil dimuat · laporan dan perubahan dinonaktifkan.', true); return; }
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    notify('File backup tidak bisa dibaca. Pastikan JSON dari Kantong.', true);
    return;
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.transactions) ? data.transactions : null;
  if (!list) { notify('Struktur backup tidak dikenali.', true); return; }

  const existing = new Set(state.all.map((t) => `${t.date}|${t.type}|${t.category}|${t.amount}|${t.notes || ''}`));
  let added = 0, skipped = 0, failed = 0;
  state.busy = true; setButtons(false);
  try {
    for (const raw of list) {
      let t;
      try { t = validate(raw); } catch { failed++; continue; }
      const sig = `${t.date}|${t.type}|${t.category}|${t.amount}|${t.notes}`;
      if (existing.has(sig)) { skipped++; continue; }
      try {
        const saved = await state.store.save(t, null);
        state.all.push(saved);
        existing.add(sig);
        added++;
      } catch { failed++; }
    }
    render();
    notify(`${added} transaksi dipulihkan${skipped ? `, ${skipped} duplikat dilewati` : ''}${failed ? `, ${failed} gagal` : ''}.`, added === 0);
  } finally {
    state.busy = false; setButtons(true);
  }
}

/* ---------- pemasangan peristiwa ---------- */
function wire() {
  $('theme').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  $('login').addEventListener('submit', signIn);
  $('logout').addEventListener('click', signOut);
  $('demo').addEventListener('click', async () => {
    state.mode = 'demo';
    state.store = new DemoStore();
    state.all = []; state.loaded = false; state.month = localDate().slice(0, 7);
    await enterWorkspace();
    notify('Mode demo: data hanya tersimpan di browser ini.');
  });

  $('entry').addEventListener('submit', submitEntry);
  $('cancel').addEventListener('click', () => { resetForm(); closeSheet(); notify('Perubahan dibatalkan.'); });
  $('amount').addEventListener('input', (e) => {
    e.target.value = digits(e.target.value);
  });

  document.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener('change', () => {
    fillCategorySelect();
    $('category').value = CATEGORIES[r.value][0];
  }));

  $('rows').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-edit],button[data-del]');
    if (!b) return;
    if (b.dataset.edit) startEdit(b.dataset.edit);
    else deleteEntry(b.dataset.del);
  });

  $('month').addEventListener('input', () => {
    if ($('month').value) { state.month = $('month').value; render(); }
  });
  $('prev-month').addEventListener('click', () => {
    state.month = shiftMonth(state.month, -1); $('month').value = state.month; render();
  });
  $('next-month').addEventListener('click', () => {
    state.month = shiftMonth(state.month, 1); $('month').value = state.month; render();
  });
  $('this-month').addEventListener('click', () => {
    state.month = localDate().slice(0, 7); $('month').value = state.month; render();
  });

  $('refresh').addEventListener('click', load);

  const onFilter = () => {
    state.filters.q = $('search').value;
    state.filters.type = $('ftype').value;
    state.filters.cat = $('fcat').value;
    renderTable(currentRecap());
  };
  $('search').addEventListener('input', onFilter);
  $('ftype').addEventListener('change', onFilter);
  $('fcat').addEventListener('change', onFilter);

  $('print').addEventListener('click', printReport);
  $('csv').addEventListener('click', exportCSV);
  $('json').addEventListener('click', exportJSON);
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    importBackup(f);
  });

  $('quick').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-q-type]');
    if (!b) return;
    openSheet();
    document.querySelector(`input[name="type"][value="${b.dataset.qType}"]`).checked = true;
    fillCategorySelect();
    $('category').value = b.dataset.qCat;
    $('amount').value = b.dataset.qAmount;
    $('notes').value = b.dataset.qNote || '';
    if (!$('date').value) $('date').value = localDate();
    $('amount').focus({ preventScroll: true });
  });

  $('add-btn').addEventListener('click', openSheet);
  $('sheet-close').addEventListener('click', () => { closeSheet(); });

  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('sheet-open')) return;
    if ($('entry-panel').contains(e.target) || $('add-btn').contains(e.target) || e.target.closest?.('#rows')) return;
    closeSheet();
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') {
      if (document.body.classList.contains('sheet-open')) closeSheet();
      else if (state.editing) { resetForm(); notify('Perubahan dibatalkan.'); }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/' && !$('workspace').hidden) { e.preventDefault(); $('search').focus(); }
    if (e.key.toLowerCase() === 'n' && !$('workspace').hidden) { e.preventDefault(); openSheet(); $('amount').focus(); }
  });
}

/* ---------- mulai ---------- */
wire();
resetForm();
boot();

import { CATEGORIES, localDate, recap, validate, escapeHTML, toCSV, backup, categoryName, budgetAmount, budgetRecap, dailyRecap, improvement, reportCSV } from './core.js';
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
  busy: false, loading:false,
  filters: { q: '', type: '', cat: '' },
  planning: {categories:[],budgets:[],scenarios:[]}, planningReady:false, view:'summary', scenarioOpen:false, draft:null, generation:0,
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
  sel.innerHTML = entryCategories(type).map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  if (entryCategories(type).includes(keep)) sel.value = keep;
}
function fillFilterCategories() {
  const all = [...new Set([...expenseNames(), ...CATEGORIES.income])].sort((a, b) => a.localeCompare(b, 'id'));
  $('fcat').innerHTML = '<option value="">Semua kategori</option>' + all.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
}

/* ---------- gerbang / konfigurasi ---------- */
function showGate(message, { login = false } = {}) {
  $('print-report').innerHTML='';
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
  if(state.busy||state.loading)return;
  const s = state.store;
  try { if (state.mode === 'cloud' && s) await s.signOut(); } catch { /* sesi lokal tetap dibersihkan */ }
  state.generation++;state.planning={categories:[],budgets:[],scenarios:[]};state.planningReady=false;state.draft=null;state.scenarioOpen=false;
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
  const can = enabled && !state.busy && !state.loading;
  for(const id of ['refresh','logout','month','prev-month','next-month','this-month','demo'])$(id).disabled=state.busy||state.loading;
  for(const el of $$('#budget-panel input,#budget-panel button'))el.disabled=!can||!state.planningReady;
  for(const id of ['improvement-alert','csv-budget','csv-scenario','json'])$(id).disabled=!can||!state.planningReady;
  $('csv-daily').disabled=!can;
  for (const id of ['save', 'print', 'csv', 'import']) {
    const el = $(id);
    if (el) el.disabled = !can;
  }
}

async function load() {
  if(state.busy||state.loading)return;state.loading=true;state.loaded=false;$('print-report').innerHTML='';
  setSync(state.mode === 'cloud' ? 'Cloud Supabase · memuat…' : 'Demo lokal · memuat…', 'warn');
  setButtons(false);
  try {
    const all = await state.store.all();
    state.all = Array.isArray(all) ? all : [];
    state.loaded = true;
    await loadPlanning();
    fillCategorySelect();fillFilterCategories();
    setSync(state.mode === 'cloud'
      ? `Cloud Supabase · dimuat ${state.all.length} transaksi`
      : 'Demo lokal · tidak tersinkron', state.mode === 'cloud' ? '' : 'demo');
    state.loading=false;render();
    setButtons(true);
  } catch (err) {
    state.loading=false;state.loaded = false;
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
  renderPlanning();
  renderPrint();
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
  $('daily-avg').textContent = r.expense > 0n ? rp(BigInt((r.expense+BigInt(Math.floor(elapsed/2)))/BigInt(elapsed))) : 'Rp 0';

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
    return { m, income: r.income, expense: r.expense };
  });
  const max = Math.max(1, ...data.flatMap((d) => [Number(d.income), Number(d.expense)]));
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
    const hi = Math.max(2, (Number(d.income) / max) * (baseY - top));
    const ho = Math.max(2, (Number(d.expense) / max) * (baseY - top));
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
  const entries = Object.entries(r.categories).sort((a,b)=>a[1]===b[1]?0:a[1]>b[1]?-1:1);
  const total = entries.reduce((a, [, v]) => a + v, 0n);
  if (!total) {
    $('categories').innerHTML = `<svg viewBox="0 0 200 200" role="presentation" aria-hidden="true"><circle cx="100" cy="100" r="72" fill="none" stroke="var(--line)" stroke-width="22"/><text x="100" y="96" text-anchor="middle" font-size="15" fill="var(--muted)">Belum ada</text><text x="100" y="116" text-anchor="middle" font-size="12" fill="var(--muted)">pengeluaran</text></svg>`;
    $('legend').innerHTML = '<li><span class="swatch" style="background:var(--line)"></span><span class="name">Belum ada pengeluaran</span><span class="val">—</span></li>';
    return;
  }
  let offset = 0;
  let svg = '<svg viewBox="0 0 200 200" role="presentation" aria-hidden="true"><g transform="rotate(-90 100 100)">';
  entries.forEach(([name, v], i) => {
    const len = (Number(v) / Number(total)) * C;
    const color = PALETTE[i % PALETTE.length];
    svg += `<circle class="arc" cx="100" cy="100" r="72" stroke="${color}" stroke-dasharray="${(Math.max(0, len - 1.5)).toFixed(2)} ${(C - len + 1.5).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${escapeHTML(name)} — ${rp(v)}</title></circle>`;
    offset += len;
  });
  svg += '</g></svg>';
  /* label tengah di luar grup yang diputar agar teks tetap tegak */
  svg += `<div class="donut-center"><b>${rpShort(Number(total))}</b><span>total keluar</span></div>`;
  $('categories').innerHTML = `<div class="donut-stack">${svg}</div>`;
  $('legend').innerHTML = entries.map(([name, v], i) => `
    <li><span class="swatch" style="background:${PALETTE[i % PALETTE.length]}"></span>
    <span class="name">${escapeHTML(name)}</span>
    <span class="val">${Math.round((Number(v) / Number(total)) * 100)}% · ${rp(v)}</span></li>`).join('');
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
  if(state.busy||state.loading||!state.loaded)return;
  const t = state.all.find((x) => x.id === id);
  if (!t) return;
  openSheet();setFormMode(id);
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
      amount: $('amount').value,
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
  if(!state.planningReady)return;
  download(`kantong-backup-${localDate()}.json`, backup(state.all,state.planning), 'application/json');
  notify('Backup seluruh bulan diunduh.');
}
function printReport() {
  if (!state.loaded) return;
  renderPrint();
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

  if(state.busy)return;
  const meta=data?.version===2?{categories:data.categories||[],budgets:data.budgets||[],scenarios:data.scenarios||[]}:{categories:[],budgets:[],scenarios:[]};
  if(!Object.values(meta).every(Array.isArray)){notify('Metadata backup tidak valid.',true);return;}
  if(Object.values(meta).some(a=>a.length)&&!state.planningReady){notify('Muat perencanaan / migrasi dahulu agar backup lengkap dapat dipulihkan.',true);return;}
  if(!confirm(`Pratinjau impor: ${list.length} transaksi, ${meta.categories.length} kategori, ${meta.budgets.length} anggaran, ${meta.scenarios.length} simulasi. Data duplikat dilewati (termasuk kunci kategori/bulan). Tidak ada penghapusan atau penimpaan. Lanjutkan?`))return;
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
    let metadataAdded=0,metadataSkipped=0;
    for(const [kind,items] of Object.entries(meta))for(const item of items){
      const duplicate=state.planning[kind].some(x=>kind==='categories'?x.name===item.name:kind==='budgets'?x.month===item.month&&x.category===item.category:x.month===item.month);
      if(duplicate){metadataSkipped++;continue;}
      try{if(kind==='categories'){if(typeof item.enabled!=='boolean')throw Error();await state.store.setCategory(item.name,item.enabled);}else if(kind==='budgets'){if(item.amount===null||item.amount===undefined)throw Error();await state.store.setBudget(item.month,item.category,item.amount);}else await state.store.setScenario(item.month,item.income,item.proposed);state.planning[kind].push(item);metadataAdded++;}catch{failed++;}
    }
    if(state.planningReady)await loadPlanning();fillCategorySelect();fillFilterCategories();render();
    notify(`${added} transaksi dipulihkan${skipped ? `, ${skipped} duplikat dilewati` : ''}${failed ? `, ${failed} gagal` : ''}; ${metadataAdded} metadata ditambah, ${metadataSkipped} metadata duplikat dilewati.`, failed > 0);
  } finally {
    state.busy = false; setButtons(true);
  }
}

/* ---------- pemasangan peristiwa ---------- */
function wire() {
  wirePlanning();
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
  // Do not turn -12, 1.5 or 1e3 into a different financial amount.


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
    if ($('month').value) { state.month = $('month').value; state.draft=null; render(); }
  });
  $('prev-month').addEventListener('click', () => {
    state.month = shiftMonth(state.month, -1); $('month').value = state.month; state.draft=null; render();
  });
  $('next-month').addEventListener('click', () => {
    state.month = shiftMonth(state.month, 1); $('month').value = state.month; state.draft=null; render();
  });
  $('this-month').addEventListener('click', () => {
    state.month = localDate().slice(0, 7); $('month').value = state.month; state.draft=null; render();
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

/* ---------- feuille de budget: shared cloud metadata, never a local fallback ---------- */
function expenseNames(){return [...new Set([...CATEGORIES.expense,...state.planning.categories.map(c=>c.name),...state.all.filter(t=>t.type==='expense').map(t=>t.category),...state.planning.budgets.map(b=>b.category)])];}
function entryCategories(type){if(type==='income')return CATEGORIES.income;if(state.mode==='cloud'&&!state.planningReady)return [...new Set(['Makan','Transportasi','Belanja','Tagihan','Kesehatan','Hiburan','Lainnya',...state.all.filter(t=>t.type==='expense').map(t=>t.category)])];const editing=state.all.find(t=>t.id===state.editing)?.category;return expenseNames().filter(n=>n===editing||state.planning.categories.find(c=>c.name===n)?.enabled!==false);}
function budgetRows(){return budgetRecap(state.all,state.month,state.planning.budgets,expenseNames());}
async function loadPlanning(){
 state.planningReady=false;state.planning={categories:[],budgets:[],scenarios:[]};
 try{const p=await state.store.planning();if(!p.categories.every(c=>typeof c.name==='string'&&typeof c.enabled==='boolean')||!p.budgets.every(b=>typeof b.month==='string'&&b.amount!==undefined)||!p.scenarios.every(s=>s.proposed&&typeof s.income==='string'))throw Error('Format tabel tidak cocok.');state.planning=p;state.planningReady=true;$('planning-notice').hidden=true;}
 catch(e){$('planning-notice').hidden=false;$('planning-notice').textContent='Perencanaan cloud belum tersedia. Jalankan hanya migration-v3.sql sekali (jangan ulang schema.sql), lalu Muat ulang. Transaksi lama tetap dapat dipakai. Jika sudah migrasi, periksa jaringan / izin. '+e.message;}
}
function setView(view){state.view=view;$$('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));$('workspace').dataset.view=view;$('budget-panel').hidden=view!=='budget';$('daily-panel').hidden=view!=='daily';}
function dailyHTML(d,cats=d.categories,print=false){const sum=day=>cats.reduce((s,c)=>s+day.categories[c],0n);return `<thead><tr><th>Tanggal</th>${cats.map(c=>`<th>${escapeHTML(c)}</th>`).join('')}<th>${print?'Subtotal kolom':'Total harian'}</th>${print?'<th>Total harian (semua)</th>':''}</tr></thead><tbody>${d.days.map(day=>`<tr><th>${day.date}</th>${cats.map(c=>`<td>${rp(day.categories[c])}</td>`).join('')}<td>${rp(sum(day))}</td>${print?`<td>${rp(day.total)}</td>`:''}</tr>`).join('')}</tbody><tfoot><tr><th>Total bulan</th>${cats.map(c=>`<td>${rp(d.totals[c])}</td>`).join('')}<td>${rp(cats.reduce((s,c)=>s+d.totals[c],0n))}</td>${print?`<td>${rp(d.total)}</td>`:''}</tr></tfoot>`;}
function renderPlanning(){
 const rows=budgetRows();$('budget-rows').innerHTML=rows.map(r=>`<tr><th>${escapeHTML(r.category)}${state.planning.categories.find(c=>c.name===r.category)?.enabled===false?' <small>(nonaktif)</small>':''}</th><td><input aria-label="Budget ${escapeHTML(r.category)}" data-budget="${escapeHTML(r.category)}" inputmode="numeric" type="text" placeholder="Belum dianggarkan" value="${r.budget??''}"></td><td>${rp(r.actual)}</td><td class="${r.gap!==null&&r.gap<0n?'negative':''}">${r.gap===null?'—':rp(r.gap)}</td><td><button type="button" class="ghost-btn" data-save-budget="${escapeHTML(r.category)}">Simpan</button></td></tr>`).join('');
 const set=rows.filter(r=>r.budget!==null);const b=set.reduce((s,r)=>s+r.budget,0n),a=set.reduce((s,r)=>s+r.actual,0n);$('budget-total').innerHTML=`<tr><th>Subtotal ${set.length} kategori beranggaran</th><td>${rp(b)}</td><td>${rp(a)}</td><td>${rp(b-a)}</td><td></td></tr><tr><th>Aktual semua kategori</th><td colspan="4">${rp(currentRecap().expense)} · kategori tanpa budget tidak dianggap target nol</td></tr>`;
 $('category-options').innerHTML=expenseNames().map(n=>`<div class="category-option"><label><input type="checkbox" data-category-enabled="${escapeHTML(n)}" ${state.planning.categories.find(c=>c.name===n)?.enabled===false?'':'checked'}>${escapeHTML(n)}</label><button class="ghost-btn" type="button" data-category-rename="${escapeHTML(n)}">Ganti nama</button></div>`).join('');
 $('improvement-warning').hidden=currentRecap().balance>=0n;
 $('improvement-alert').hidden=currentRecap().balance>=0n; $('improvement-alert').disabled=!state.planningReady||state.busy;
 $('improvement-start').textContent=state.planning.scenarios.some(s=>s.month===state.month)?'Buka improvement':'Buat improvement';
 $('daily-table').innerHTML=dailyHTML(dailyRecap(state.all,state.month,expenseNames()));
 if(state.scenarioOpen)renderScenario();else $('scenario-panel').hidden=true;
 setView(state.view);setButtons(state.loaded);
}
function renderScenario(){
 $('scenario-panel').hidden=false;
 if(!state.draft||state.draft.month!==state.month){const saved=state.planning.scenarios.find(s=>s.month===state.month);state.draft={month:state.month,income:saved?.income??currentRecap().income.toString(),proposed:{...(saved?.proposed||{})}};}
 const d=state.draft;const s=improvement(budgetRows(),d.income,d.proposed);$('scenario-income').value=d.income;
 $('scenario-rows').innerHTML=s.rows.map(r=>`<tr><th>${escapeHTML(r.category)}</th><td>${r.budget===null?'—':rp(r.budget)}</td><td>${rp(r.actual)}</td><td>${rp(r.baseline)} · ${r.source==='budget'?'budget':'aktual (tanpa budget)'}</td><td><input aria-label="Usulan ${escapeHTML(r.category)}" type="text" inputmode="numeric" data-proposal="${escapeHTML(r.category)}" value="${r.proposal}"></td><td data-reduction="${escapeHTML(r.category)}">${rp(r.reduction)}</td></tr>`).join('');
 for(const r of s.rows)d.proposed[r.category]=r.proposal.toString();updateScenarioTotals();
}
function updateScenarioTotals(){try{const s=improvement(budgetRows(),state.draft.income,state.draft.proposed);$('scenario-totals').textContent=`Asumsi masuk ${rp(s.income)} · Total baseline ${rp(s.baseline)} · Total usulan ${rp(s.total)} · Pengurangan rencana ${rp(s.reduction)} · Proyeksi sisa ${rp(s.remaining)}. Bukan tabungan aktual.`;s.rows.forEach(r=>{const el=$$('[data-reduction]').find(e=>e.dataset.reduction===r.category);if(el)el.textContent=rp(r.reduction);});$('scenario-state').textContent='Pratinjau simulasi; klik Simpan untuk sinkronisasi. Tidak diterapkan ke anggaran aktif.';}catch(e){$('scenario-totals').textContent=e.message;}}
async function planningAction(action,message){
 if(!state.loaded||!state.planningReady||state.busy)return;state.busy=true;setButtons(false);const store=state.store,gen=state.generation;
 try{await action(store);if(store!==state.store||gen!==state.generation)return;await loadPlanning();if(!state.planningReady)throw Error('Perubahan belum dapat dimuat ulang. Periksa sebelum mengulang.');fillCategorySelect();fillFilterCategories();render();notify(message);}
 catch(e){notify(e.message,true);}finally{state.busy=false;setButtons(state.loaded);}
}
function scenarioSaved(){const saved=state.planning.scenarios.find(s=>s.month===state.month);return saved?improvement(budgetRows(),saved.income,saved.proposed):null;}
function exportPlanning(kind){
 if(!state.loaded)return;let headers,rows;
 if(kind==='budget'){headers=['bulan','kategori','budget_idr_kosong_tanpa_target','actual_idr','gap_budget_minus_actual_idr'];rows=budgetRows().map(r=>[state.month,r.category,r.budget,r.actual,r.gap]);}
 if(kind==='daily'){const d=dailyRecap(state.all,state.month,expenseNames());headers=['tanggal',...d.categories,'total_pengeluaran_idr'];rows=d.days.map(r=>[r.date,...d.categories.map(c=>r.categories[c]),r.total]);rows.push(['TOTAL BULAN',...d.categories.map(c=>d.totals[c]),d.total]);}
 if(kind==='scenario'){const s=scenarioSaved();if(!s){notify('Belum ada simulasi tersimpan untuk bulan ini.',true);return;}headers=['bulan','cakupan','kategori','sumber_baseline','baseline_idr','actual_idr','usulan_idr','pengurangan_rencana_idr','asumsi_masuk_idr','total_usulan_idr','proyeksi_sisa_idr'];rows=s.rows.map(r=>[state.month,'simulasi bukan aktual',r.category,r.source,r.baseline,r.actual,r.proposal,r.reduction,s.income,s.total,s.remaining]);}
 download(`kantong-${kind}-${state.month}.csv`,reportCSV(headers,rows),'text/csv;charset=utf-8');
}
function plainTable(headers,rows,cls=''){return `<table class="${cls}"><thead><tr>${headers.map(h=>`<th>${escapeHTML(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${escapeHTML(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
function renderPrint(){
 if(!state.loaded){$('print-report').innerHTML='';return;}const r=currentRecap(),d=dailyRecap(state.all,state.month,expenseNames());
 let html=`<h1>Kantong · ${escapeHTML(monthLabel(state.month))}</h1><p>Periode ${state.month} · seluruh bulan, tanpa filter pencarian/jenis/kategori.</p><p>Aktual pemasukan ${rp(r.income)} · pengeluaran ${rp(r.expense)} · sisa ${rp(r.balance)} (arus kas, bukan saldo rekening / tabungan).</p><h2>Budget / Actual / Gap</h2>`;
 html+=state.planningReady?plainTable(['Kategori','Budget','Actual','Gap'],budgetRows().map(x=>[x.category,x.budget===null?'Belum dianggarkan':rp(x.budget),rp(x.actual),x.gap===null?'—':rp(x.gap)])):'<p>Perencanaan belum dimuat; budget/simulasi tidak tersedia. Ini bukan laporan perencanaan lengkap.</p>';
 html+='<h2>Rekap harian pengeluaran</h2><p>Kategori dibagi per kelompok kolom. Subtotal hanya kelompok ini; total bulanan seluruh kategori '+rp(d.total)+'.</p>';
 for(let i=0;i<d.categories.length;i+=5)html+='<table>'+dailyHTML(d,d.categories.slice(i,i+5),true)+'</table>';
 const s=state.planningReady?scenarioSaved():null;if(s){html+=`<h2>Simulasi improvement · terpisah, bukan aktual</h2><p>Asumsi masuk ${rp(s.income)} · baseline ${rp(s.baseline)} · usulan ${rp(s.total)} · pengurangan rencana ${rp(s.reduction)} · proyeksi sisa ${rp(s.remaining)}. Tidak mengubah transaksi atau anggaran aktif, termasuk bulan lampau.</p>`+plainTable(['Kategori','Sumber','Baseline','Aktual','Usulan','Pengurangan'],s.rows.map(x=>[x.category,x.source,rp(x.baseline),rp(x.actual),rp(x.proposal),rp(x.reduction)]));}
 html+='<h2>Seluruh transaksi periode ini</h2>'+plainTable(['Tanggal','Jenis','Kategori','Nominal','Catatan'],r.rows.map(t=>[t.date,t.type,t.category,rp(t.amount),t.notes||'—']),'print-transactions');$('print-report').innerHTML=html;
}
function wirePlanning(){
 $('improvement-alert').addEventListener('click',()=>{setView('budget');state.scenarioOpen=true;renderScenario();setButtons(state.loaded);});
 $$('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
 $('category-form').addEventListener('submit',e=>{e.preventDefault();const n=$('category-name').value;planningAction(s=>s.setCategory(n,true),'Kategori tersimpan.');});
 $('category-options').addEventListener('change',e=>{const n=e.target.dataset.categoryEnabled;if(n)planningAction(s=>s.setCategory(n,e.target.checked),'Kategori tersimpan.');});
 $('category-options').addEventListener('click',e=>{const n=e.target.dataset.categoryRename;if(!n)return;const raw=prompt('Nama baru (catatan dan anggaran lama tidak diganti; nama lama dinonaktifkan):',n);if(!raw||raw===n)return;let name;try{name=categoryName(raw);}catch(err){notify(err.message,true);return;}planningAction(async s=>{await s.setCategory(name,true);await s.setCategory(n,false);},'Kategori tersimpan.');});
 $('budget-rows').addEventListener('click',e=>{const n=e.target.dataset.saveBudget;if(!n)return;const input=$$('[data-budget]').find(i=>i.dataset.budget===n),month=state.month;planningAction(s=>s.setBudget(month,n,input.value),'Anggaran tersimpan.');});
 $('improvement-start').addEventListener('click',()=>{state.scenarioOpen=true;renderScenario();setButtons(state.loaded);});
 $('scenario-income').addEventListener('input',e=>{state.draft.income=e.target.value;updateScenarioTotals();});
 $('scenario-rows').addEventListener('input',e=>{if(!e.target.dataset.proposal)return;state.draft.proposed[e.target.dataset.proposal]=e.target.value;updateScenarioTotals();});
 $('scenario-save').addEventListener('click',()=>{const d=state.draft;planningAction(s=>s.setScenario(d.month,d.income,d.proposed),'Simulasi tersimpan. Anggaran aktif dan transaksi tidak berubah.');});
 for(const kind of ['budget','daily','scenario'])$('csv-'+kind).addEventListener('click',()=>exportPlanning(kind));
 window.addEventListener('beforeprint',renderPrint);
}

/* ---------- mulai ---------- */
wire();
resetForm();
boot();

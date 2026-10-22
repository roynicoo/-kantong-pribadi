import { CATEGORIES, localDate, recap, validate, escapeHTML, toCSV, backup, categoryName, budgetAmount, budgetRecap, dailyRecap, improvement, reportCSV,
  autoPost, validateEntryDate, runningBalance, monthFlow, balanceByMonth, onboardingMode, normalizeSettings, parseBackup, mergeSettings,
  openingAmount, validateSchedule, scheduleStatusText, validateMonthString,
  validateUsername, usernameFromEmail, greetingText, avatarInitials, validateAvatarPhoto, avatarDataError, AVATAR_COLORS, THEMES, PATTERNS,
  validateAccount, validateTransfer, validateHolding, valuationPlan, accountBalance, assetTotals, allocationByType, investmentProfit,
  valueHistory, defaultAccountId, latestValuation, ACCOUNT_TYPES, ACCOUNT_COLORS, HOLDING_KINDS } from './core.js';
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
  /* v4 */
  settings: null, schedules: [], postings: [], v4Ready: false, v4Dismissed: false,
  onboardingOpen: false, onboardingStep: 1, pendingOpening: null, editingSchedule: null,
  bannerDismissed: false, postErrors: [],
  accounts: [], transfers: [], holdings: [], valuations: [], activityRows: [],
  accountEditing: null, transferEditing: null, activeAccount: null, holdingDraft: [], onbAccounts: [],
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
  state.settings=null;state.schedules=[];state.postings=[];state.v4Ready=false;state.pendingOpening=null;state.editingSchedule=null;state.postErrors=[];
  closeOnboarding();$('onboarding-banner').hidden=true;
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
  $('date').max = localDate();
  fillScheduleCategories();
  setButtons(false);
  await load();
}

function setButtons(enabled) {
  const can = enabled && !state.busy && !state.loading;
  for(const id of ['refresh','logout','month','prev-month','next-month','this-month','demo'])$(id).disabled=state.busy||state.loading;
  for(const el of $$('#budget-panel input,#budget-panel button'))el.disabled=!can||!state.planningReady;
  for(const id of ['improvement-alert','csv-budget','csv-scenario','json'])$(id).disabled=!can||!state.planningReady;
  $('csv-daily').disabled=!can;
  for (const el of $$('#recurring-panel input,#recurring-panel button,#accounts-panel input,#accounts-panel button')) el.disabled = !can || !state.v4Ready;
  for (const el of $$('#onboarding button,#onboarding input,#onboarding select')) el.disabled = state.busy;
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
    await loadPlanning();
    await loadV4();
    if (state.v4Ready) await runAutoPost();
    state.loaded = true;
    fillCategorySelect();fillFilterCategories();
    setSync(state.mode === 'cloud'
      ? `Cloud Supabase · dimuat ${state.all.length} transaksi`
      : 'Demo lokal · tidak tersinkron', state.mode === 'cloud' ? '' : 'demo');
    state.loading=false;render();
    setButtons(true);
    maybeOpenOnboarding();
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
  renderSaldo();
  renderAssetDashboard();
  renderAccounts();
  renderSchedules();
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
  const postedIds = new Set(state.postings.map((p) => p.transaction_id).filter(Boolean));
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
      <td><span class="chip ${t.type}">${escapeHTML(t.category)}</span>${postedIds.has(t.id) ? '<span class="chip auto" title="Dibuat otomatis dari jadwal pemasukan rutin">otomatis</span>' : ''}</td>
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
  $('date').max = localDate();
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
  if (state.v4Ready && t.account_id) { fillAccountOptions(); $('account').value = t.account_id; }
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
      account_id: state.v4Ready ? ($('account').value || null) : null,
    });
    validateEntryDate(payload.date, localDate());
  } catch (err) {
    notify(err.message, true);
    if (/Tanggal/.test(err.message)) $('date').focus();
    else $('amount').focus();
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
    try { if (payload.account_id) localStorage.setItem('kantong.lastAccount', payload.account_id); } catch { /* diblokir */ }
    resetForm();
    closeSheet();
    const savedMonth = String(saved.date).slice(0, 7);
    const jumped = savedMonth !== state.month;
    if (jumped) { state.month = savedMonth; $('month').value = savedMonth; state.draft = null; }
    render();
    notify(jumped ? `Transaksi tersimpan · tampilan pindah ke ${monthLabel(savedMonth)}.` : 'Transaksi tersimpan.');
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
  const posted = state.postings.find((p) => p.transaction_id === id);
  const question = posted
    ? 'Hapus pemasukan otomatis ini? Bulan tersebut tidak akan dicatat ulang otomatis (bisa ditambahkan manual bila perlu).'
    : 'Hapus transaksi ini? Tindakan ini tidak bisa dibatalkan.';
  if (!confirm(question)) return;
  state.busy = true;
  setButtons(false);
  try {
    /* Tandai lebih dulu agar pengulangan otomatis tidak membuat baris ini lagi. */
    if (posted) await state.store.dismissPosting(posted.schedule_id, posted.month);
    await state.store.remove(id);
    state.all = state.all.filter((x) => x.id !== id);
    if (posted) state.postings = await state.store.postings();
    if (state.editing === id) resetForm();
    render();
    notify(posted ? 'Transaksi dihapus. Bulan ini tidak akan dicatat ulang otomatis.' : 'Transaksi dihapus.');
  } catch (err) {
    if (posted) { try { await state.store.restorePosting(posted.schedule_id, posted.month, id); state.postings = await state.store.postings(); } catch { /* tampilkan galat asli */ } }
    render();
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
  let extras = null;
  if (state.v4Ready) {
    extras = {
      settings: state.settings,
      schedules: state.schedules.map(({ id, name, amount, day, start_month, end_month, resume_month, active, category, notes }) => ({ id, name, amount, day, start_month, end_month, resume_month, active, category, notes })),
      postings: state.postings.map(({ schedule_id, month, status, transaction_id, amount }) => ({ schedule_id, month, status, transaction_id, amount })),
      accounts: state.accounts.map(({ id, name, type, opening_balance, color, note, current_value, is_archived }) => ({ id, name, type, opening_balance, color, note, current_value, is_archived })),
      transfers: state.transfers.map(({ id, from_account, to_account, amount, date, note }) => ({ id, from_account, to_account, amount, date, note })),
      holdings: state.holdings.map(({ id, account_id, asset_name, kind, quantity, avg_buy_price, current_price }) => ({ id, account_id, asset_name, kind, quantity, avg_buy_price, current_price })),
      valuations: state.valuations.map(({ id, account_id, date, value, note }) => ({ id, account_id, date, value, note })),
    };
  }
  download(`kantong-backup-${localDate()}.json`, backup(state.all,state.planning,extras), 'application/json');
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
  try { data = JSON.parse(await file.text()); }
  catch { notify('File backup tidak bisa dibaca. Pastikan JSON dari Kantong.', true); return; }
  let parsed;
  try { parsed = parseBackup(data); }
  catch (e) { notify(e.message, true); return; }
  if (state.busy) return;
  const meta = { categories: parsed.categories, budgets: parsed.budgets, scenarios: parsed.scenarios };
  if (!Object.values(meta).every(Array.isArray)) { notify('Metadata backup tidak valid.', true); return; }
  if (Object.values(meta).some((a) => a.length) && !state.planningReady) { notify('Muat perencanaan / migrasi dahulu agar backup lengkap dapat dipulihkan.', true); return; }
  const hasV4 = !!(parsed.accounts.length || parsed.holdings.length || parsed.valuations.length || parsed.transfers.length || parsed.schedules.length || parsed.settings);
  if (hasV4 && !state.v4Ready) { notify('Backup memuat akun/jadwal/pengaturan, tetapi migration-v4.sql belum berjalan. Jalankan migrasi dahulu atau pulihkan hanya transaksi.', true); return; }
  if (!confirm(`Pratinjau impor: ${parsed.transactions.length} transaksi, ${meta.categories.length} kategori, ${meta.budgets.length} anggaran, ${meta.scenarios.length} simulasi, ${parsed.schedules.length} jadwal rutin, ${parsed.accounts.length} akun, ${parsed.holdings.length} aset, ${parsed.transfers.length} pindah dana. Duplikat dilewati; tidak ada penghapusan atau penimpaan. Transaksi lama tanpa akun masuk ke akun kas default. Lanjutkan?`)) return;
  const existing = new Set(state.all.map((t) => `${t.date}|${t.type}|${t.category}|${t.amount}|${t.notes || ''}`));
  let added = 0, skipped = 0, failed = 0;
  state.busy = true; setButtons(false);
  try {
    for (const raw of parsed.transactions) {
      let t;
      try { t = validate(raw); } catch { failed++; continue; }
      const sig = `${t.date}|${t.type}|${t.category}|${t.amount}|${t.notes}`;
      if (existing.has(sig)) { skipped++; continue; }
      try { const saved = await state.store.save(t, null); state.all.push(saved); existing.add(sig); added++; }
      catch { failed++; }
    }
    let metadataAdded = 0, metadataSkipped = 0;
    for (const [kind, items] of Object.entries(meta)) for (const item of items) {
      const duplicate = state.planning[kind].some((x) => kind === 'categories' ? x.name === item.name : kind === 'budgets' ? x.month === item.month && x.category === item.category : x.month === item.month);
      if (duplicate) { metadataSkipped++; continue; }
      try {
        if (kind === 'categories') { if (typeof item.enabled !== 'boolean') throw Error(); await state.store.setCategory(item.name, item.enabled); }
        else if (kind === 'budgets') { if (item.amount === null || item.amount === undefined) throw Error(); await state.store.setBudget(item.month, item.category, item.amount); }
        else await state.store.setScenario(item.month, item.income, item.proposed);
        state.planning[kind].push(item); metadataAdded++;
      } catch { failed++; }
    }
    const accountMap = new Map();
    let accountsAdded = 0, accountsSkipped = 0;
    for (const item of parsed.accounts) {
      let clean;
      try { clean = validateAccount(item); } catch { failed++; continue; }
      const dup = state.accounts.find((a) => a.name === clean.name && a.type === clean.type);
      if (dup) { accountsSkipped++; accountMap.set(item.id, dup.id); continue; }
      try { const created = await state.store.saveAccount(clean, null); accountMap.set(item.id, created.id); state.accounts.push(created); accountsAdded++; }
      catch { failed++; }
    }
    let transfersAdded = 0, transfersSkipped = 0;
    for (const item of parsed.transfers) {
      const from = accountMap.get(item.from_account) || item.from_account;
      const to = accountMap.get(item.to_account) || item.to_account;
      if (!state.accounts.some((a) => a.id === from) || !state.accounts.some((a) => a.id === to)) { transfersSkipped++; continue; }
      let clean;
      try { clean = validateTransfer({ ...item, from_account: from, to_account: to }); } catch { failed++; continue; }
      if (state.transfers.some((t) => t.from_account === from && t.to_account === to && t.amount === clean.amount && t.date === clean.date && (t.note || '') === clean.note)) { transfersSkipped++; continue; }
      try { await state.store.saveTransfer(clean, null); transfersAdded++; } catch { failed++; }
    }
    let holdingsAdded = 0, holdingsSkipped = 0;
    for (const item of parsed.holdings) {
      const accId = accountMap.get(item.account_id) || item.account_id;
      if (!state.accounts.some((a) => a.id === accId)) { holdingsSkipped++; continue; }
      let clean;
      try { clean = validateHolding({ ...item, account_id: accId }); } catch { failed++; continue; }
      if (state.holdings.some((h) => h.account_id === accId && h.asset_name === clean.asset_name && String(h.quantity) === clean.quantity && String(h.current_price) === clean.current_price)) { holdingsSkipped++; continue; }
      try { await state.store.saveHolding(clean, null); holdingsAdded++; } catch { failed++; }
    }
    let valuationsAdded = 0, valuationsSkipped = 0;
    for (const item of parsed.valuations) {
      const accId = accountMap.get(item.account_id) || item.account_id;
      if (!state.accounts.some((a) => a.id === accId)) { valuationsSkipped++; continue; }
      if (state.valuations.some((v) => v.account_id === accId && v.date === item.date && Number(v.value) === Number(item.value))) { valuationsSkipped++; continue; }
      try { await state.store.saveValuation(accId, String(item.value), item.note || '', item.date); valuationsAdded++; } catch { failed++; }
    }
    let settingsNote = '';
    if (parsed.settings && state.v4Ready) {
      const merged = mergeSettings(state.settings, parsed.settings);
      if (merged.changed) {
        try { state.settings = await state.store.saveSettings(merged.settings); applyLook(state.settings.theme, state.settings.pattern); renderProfileChrome(); settingsNote = ', pengaturan profil/saldo awal dipulihkan'; }
        catch { failed++; }
      } else settingsNote = ', pengaturan akun tidak ditimpa';
    }
    if (state.planningReady) await loadPlanning();
    if (state.v4Ready) { await refreshAssets(); await runAutoPost(); }
    fillCategorySelect(); fillFilterCategories(); render();
    notify(`${added} transaksi dipulihkan${skipped ? `, ${skipped} duplikat dilewati` : ''}${failed ? `, ${failed} gagal` : ''}; ${metadataAdded} metadata ditambah, ${metadataSkipped} duplikat; ${accountsAdded} akun, ${holdingsAdded} aset, ${transfersAdded} pindah dana, ${valuationsAdded} catatan nilai ditambah${settingsNote}.`, failed > 0);
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
      if (!$('profile').hidden) { closeProfile(); return; }
      if (state.onboardingOpen) { laterOnboarding(); return; }
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
function setView(view){state.view=view;$$('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));$('workspace').dataset.view=view;$('budget-panel').hidden=view!=='budget';$('daily-panel').hidden=view!=='daily';$('recurring-panel').hidden=view!=='recurring';$('accounts-panel').hidden=view!=='accounts';}
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
 const activeAcc=state.accounts.filter(a=>!a.is_archived);
 if(state.v4Ready&&activeAcc.length){
  const totals=assetTotals(state.accounts,assetData());
  html+=`<h2>Akun & Aset</h2><p>Saldo menurut catatan: uang siap pakai ${rp(totals.ready)} · total aset ${rp(totals.total)} · investasi ${rp(totals.investment)}. Nilai investasi DIISI MANUAL, bukan harga pasar real-time.</p>`;
  html+=plainTable(['Akun','Jenis','Saldo','Catatan'],activeAcc.map(a=>{
   const prof=a.type==='investment'?investmentProfit(a,assetData()):null;
   return [a.name,ACCOUNT_TYPES.find(t=>t.id===a.type)?.label||a.type,rp(accountBalance(a,assetData())),prof?`biaya ${rp(prof.cost)} · P/L ${rp(prof.profit)}${prof.pct===null?'':` (${prof.pct>=0?'+':''}${prof.pct.toFixed(1)}%)`} · nilai manual`:(a.note||'—')];
  }));
 }else{
  const opening=BigInt(state.settings?.opening_balance??0);const run=runningBalance(state.all,opening.toString());
  html+=`<h2>Saldo berjalan</h2><p>Saldo awal ${rp(run.opening)} · seluruh pemasukan ${rp(run.income)} · seluruh pengeluaran ${rp(run.expense)} · saldo saat ini ${rp(run.balance)}. Kas menurut catatan, bukan saldo rekening bank.</p>`;
 }
 html+=`<h2>Pemasukan rutin</h2>`;
 html+=state.schedules.length?plainTable(['Jadwal','Nominal','Tanggal','Mulai','Status'],state.schedules.map(s=>[s.name,rp(s.amount),`tgl ${s.day}`,s.start_month,scheduleStatusText(s)])):'<p>Belum ada jadwal pemasukan rutin.</p>';
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


/* ============================================================
   Kantong v4 — pemuatan v4, pemasukan rutin, onboarding, profil
   ============================================================ */

/* ---------- tampilan: tema aksen & latar halus ---------- */
function applyLook(theme, pattern) {
  const t = THEMES.some((x) => x.id === theme) ? theme : 'krem';
  const p = PATTERNS.some((x) => x.id === pattern) ? pattern : 'none';
  document.documentElement.dataset.accent = t;
  document.documentElement.dataset.pattern = p;
  try { localStorage.setItem('kantong.look', JSON.stringify({ theme: t, pattern: p })); } catch { /* penyimpanan diblokir */ }
}
(function initLook() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem('kantong.look') || 'null'); } catch { cached = null; }
  applyLook(cached?.theme || 'krem', cached?.pattern || 'none');
})();

function displayName() {
  if (state.settings?.display_name) return state.settings.display_name;
  if (state.mode === 'cloud') return usernameFromEmail(state.store?.session?.user?.email || '');
  return '';
}
function paintAvatar(el, name, settings = state.settings) {
  if (!el) return;
  if (settings?.avatar_kind === 'photo' && settings.avatar_data) {
    el.style.backgroundImage = `url("${settings.avatar_data}")`;
    el.style.backgroundColor = 'transparent';
    el.textContent = '';
    el.dataset.kind = 'photo';
  } else {
    el.style.backgroundImage = 'none';
    el.style.backgroundColor = settings?.avatar_color || AVATAR_COLORS[0];
    el.textContent = avatarInitials(name);
    el.dataset.kind = 'initial';
  }
}
function renderProfileChrome() {
  const name = displayName();
  const label = name || 'Pengguna';
  const line = greetingText(label, new Date().getHours());
  $('greeting').textContent = line;
  $('dash-greeting').textContent = line;
  $('identity').textContent = state.mode === 'cloud' ? (state.store?.session?.user?.email || 'Masuk') : 'Demo lokal';
  $('identity').title = state.mode === 'cloud' ? (state.store?.session?.user?.email || '') : 'Data demo hanya di browser ini';
  paintAvatar($('avatar'), label);
  $('profile-title').textContent = `Hi, ${label}`;
}

/* ---------- tabel v4: pengaturan, jadwal, penanda ---------- */
function normalizeScheduleRow(raw) {
  try { return { ...validateSchedule(raw), id: raw.id, created_at: raw.created_at || null }; } catch { return null; }
}
function fillScheduleCategories() {
  const opts = CATEGORIES.income.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  $('sched-category').innerHTML = opts;
  $('onb-category').innerHTML = opts;
}
async function loadV4() {
  state.v4Ready = false;
  state.settings = normalizeSettings(null);
  state.schedules = [];
  state.postings = [];
  try {
    const [settings, schedules, postings, accounts, transfers, holdings, valuations, activity] = await Promise.all([
      state.store.settings(), state.store.schedules(), state.store.postings(),
      state.store.accounts(), state.store.transfers(), state.store.holdings(), state.store.valuations(), state.store.activity(),
    ]);
    if (![schedules, postings, accounts, transfers, holdings, valuations, activity].every(Array.isArray)) throw Error('Format tabel v4 tidak cocok.');
    state.settings = normalizeSettings(settings);
    state.schedules = schedules.map(normalizeScheduleRow).filter(Boolean);
    state.postings = postings.filter((p) => p && p.schedule_id && p.month);
    state.accounts = accounts.filter((a) => a && a.id);
    state.transfers = transfers.filter((t) => t && t.id);
    state.holdings = holdings.filter((h) => h && h.id);
    state.valuations = valuations.filter((v) => v && v.id);
    state.activityRows = activity;
    state.v4Ready = true;
    applyLook(state.settings.theme, state.settings.pattern);
    if (!state.v4Dismissed) $('v4-notice').hidden = true;
  } catch (e) {
    if (!state.v4Dismissed) {
      $('v4-notice').hidden = false;
      $('v4-notice-text').textContent = 'Pemasukan rutin, saldo awal, dan profil belum tersedia. Jalankan hanya migration-v4.sql SEKALI (jangan ulangi schema.sql), lalu Muat ulang. Transaksi, anggaran, rekap, dan ekspor tetap dapat dipakai. Jika sudah migrasi, periksa jaringan / izin. ' + (e?.message || '');
    }
    applyLook('krem', 'none');
  }
  renderProfileChrome();
}
function showAutoPostNotice(errors) {
  const el = $('autopost-notice');
  el.hidden = false;
  el.textContent = `Pemasukan rutin otomatis gagal dicatat (${errors.length}): ${errors[0].message} Saldo tidak diubah dan tidak ada angka yang dibuat-buat. Periksa koneksi lalu Muat ulang; percobaan ulang aman dan tidak menggandakan baris.`;
}
async function runAutoPost() {
  state.postErrors = [];
  try {
    const res = await autoPost(state.store, { schedules: state.schedules, postings: state.postings, today: localDate() });
    if (res.created.length) {
      for (const row of res.created) if (row.transaction) state.all.push(row.transaction);
      state.postings = await state.store.postings();
    }
    if (res.errors.length) { state.postErrors = res.errors; showAutoPostNotice(res.errors); }
    else $('autopost-notice').hidden = true;
  } catch (e) {
    state.postErrors = [{ message: e?.message || 'Galat tidak diketahui.' }];
    showAutoPostNotice(state.postErrors);
  }
}

/* ---------- saldo berjalan ---------- */
function renderSaldo() {
  const active = state.accounts.filter((a) => !a.is_archived);
  const usingAccounts = state.v4Ready && active.length > 0;
  const liquidOpening = active.filter((a) => a.type !== 'investment').reduce((sum, a) => sum + BigInt(a.opening_balance || 0), 0n);
  const opening = usingAccounts ? liquidOpening : BigInt(state.settings?.opening_balance ?? 0);
  const run = runningBalance(state.all, opening.toString());
  const totals = usingAccounts ? assetTotals(state.accounts, assetData()) : null;
  $('saldo').textContent = totals ? rp(totals.ready) : rp(run.balance);
  $('saldo-foot').textContent = !state.v4Ready
    ? 'Saldo awal belum dapat dimuat (migrasi v4 belum berjalan), jadi perhitungan memakai Rp 0. Transaksi lain tetap aman.'
    : usingAccounts
      ? `Uang siap pakai dari ${active.filter((a) => a.type !== 'investment').length} akun · total aset ${rp(totals.total)} · investasi ${rp(totals.investment)} (nilai manual)`
      : `Saldo awal ${rp(run.opening)} · seluruh pemasukan ${rp(run.income)} · seluruh pengeluaran ${rp(run.expense)}`;
  let months = [];
  try { months = balanceByMonth(state.all, opening.toString()); } catch { months = []; }
  const map = new Map(months.map((m) => [m.month, m]));
  if (!map.has(state.month)) { try { map.set(state.month, monthFlow(state.all, state.month, opening.toString())); } catch { /* bulan tidak valid */ } }
  const list = [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  $('saldo-months').innerHTML = list.length
    ? list.map((m) => `<tr${m.month === state.month ? ' class="current"' : ''}><th scope="row">${escapeHTML(monthLabel(m.month))}</th><td class="number">${rp(m.inflow)}</td><td class="number">${rp(m.outflow)}</td><td class="number">${rp(m.ending)}</td></tr>`).join('')
    : '<tr><td colspan="4">Belum ada catatan.</td></tr>';
}
function assetData() {
  return { accounts: state.accounts, transactions: state.all, transfers: state.transfers, holdings: state.holdings, valuations: state.valuations };
}

/* ---------- pemasukan rutin: daftar & formulir ---------- */
function renderSchedules() {
  if (!state.v4Ready) {
    $('schedule-rows').innerHTML = '<tr><td colspan="5">Pemasukan rutin belum tersedia. Jalankan migration-v4.sql sekali lalu Muat ulang.</td></tr>';
  } else if (!state.schedules.length) {
    $('schedule-rows').innerHTML = '<tr><td colspan="5">Belum ada jadwal. Tambahkan gaji atau pemasukan tetap agar tercatat otomatis.</td></tr>';
  } else {
    $('schedule-rows').innerHTML = state.schedules.map((s) => {
      const posted = state.postings.filter((p) => p.schedule_id === s.id).sort((a, b) => a.month.localeCompare(b.month));
      const last = posted.at(-1);
      const status = scheduleStatusText(s);
      return `<tr>
        <td class="sched-main"><b>${escapeHTML(s.name)}</b><small>${escapeHTML(status)}</small></td>
        <td>${rp(s.amount)}</td>
        <td>Mulai ${escapeHTML(monthLabel(s.start_month))}${s.end_month ? ` · berhenti ${escapeHTML(monthLabel(s.end_month))}` : ''}</td>
        <td class="sched-state">${s.active ? 'Aktif' : 'Dijeda'}${last ? ` · terakhir ${escapeHTML(monthLabel(last.month))}${last.status === 'dismissed' ? ' (dihapus manual)' : ''}` : ' · belum ada pencatatan'}</td>
        <td><div class="sched-actions">
          <button type="button" class="ghost-btn" data-sched-edit="${escapeHTML(s.id)}" aria-label="Ubah jadwal ${escapeHTML(s.name)}">Ubah</button>
          <button type="button" class="ghost-btn" data-sched-toggle="${escapeHTML(s.id)}" aria-label="${s.active ? 'Jeda' : 'Aktifkan'} jadwal ${escapeHTML(s.name)}">${s.active ? 'Jeda' : 'Aktifkan'}</button>
          <button type="button" class="ghost-btn" data-sched-del="${escapeHTML(s.id)}" aria-label="Hapus jadwal ${escapeHTML(s.name)}">Hapus</button>
        </div></td></tr>`;
    }).join('');
  }
  $('opening-balance').value = state.v4Ready ? String(state.settings.opening_balance) : '';
  $('opening-date').textContent = !state.v4Ready
    ? 'Belum tersedia sebelum migrasi v4 dijalankan.'
    : state.settings.opening_balance_date
      ? `Saldo awal disimpan ${dayLabel(state.settings.opening_balance_date)}.`
      : 'Saldo awal belum diatur; dihitung Rp 0.';
  $('recurring-notice').textContent = !state.v4Ready
    ? ''
    : state.schedules.length
      ? `${state.schedules.filter((s) => s.active).length} jadwal aktif · ${state.postings.filter((p) => p.status === 'posted').length} bulan sudah dicatat otomatis.`
      : 'Belum ada jadwal aktif.';
}
function openScheduleForm(id) {
  if (!state.v4Ready) return;
  state.editingSchedule = id || null;
  const s = id ? state.schedules.find((x) => x.id === id) : null;
  $('schedule-form-title').textContent = s ? 'Ubah jadwal' : 'Tambah jadwal';
  $('sched-name').value = s?.name || '';
  $('sched-amount').value = s ? String(s.amount) : '';
  $('sched-day').value = s ? String(s.day) : '25';
  $('sched-start').value = s?.start_month || localDate().slice(0, 7);
  $('sched-end').value = s?.end_month || '';
  $('sched-category').value = s?.category || 'Gaji';
  $('sched-active').checked = s ? s.active : true;
  $('sched-notes').value = s?.notes || '';
  $('schedule-form').hidden = false;
  $('sched-name').focus({ preventScroll: true });
}
async function saveScheduleForm(ev) {
  ev.preventDefault();
  if (state.busy || !state.v4Ready) return;
  let payload;
  try {
    payload = validateSchedule({
      name: $('sched-name').value,
      amount: $('sched-amount').value,
      day: $('sched-day').value,
      start_month: $('sched-start').value,
      end_month: $('sched-end').value,
      category: $('sched-category').value,
      active: $('sched-active').checked,
      notes: $('sched-notes').value,
    });
  } catch (e) { notify(e.message, true); return; }
  const editing = state.editingSchedule;
  state.busy = true; setButtons(false);
  try {
    await state.store.saveSchedule(payload, editing);
    state.schedules = (await state.store.schedules()).map(normalizeScheduleRow).filter(Boolean);
    state.editingSchedule = null;
    $('schedule-form').hidden = true;
    await runAutoPost();
    render();
    notify(editing ? 'Jadwal diperbarui. Pencatatan bulan berikutnya mengikuti jadwal baru; baris lama tidak diubah.' : 'Jadwal pemasukan tersimpan. Bulan yang tanggalnya sudah lewat langsung dicatat sekali.');
  } catch (e) {
    notify(e.message || 'Gagal menyimpan jadwal.', true);
  } finally { state.busy = false; setButtons(state.loaded); }
}
async function toggleSchedule(id) {
  if (state.busy) return;
  const s = state.schedules.find((x) => x.id === id);
  if (!s) return;
  state.busy = true; setButtons(false);
  try {
    await state.store.setScheduleActive(id, !s.active, localDate().slice(0, 7));
    state.schedules = (await state.store.schedules()).map(normalizeScheduleRow).filter(Boolean);
    await runAutoPost();
    render();
    notify(s.active
      ? 'Jadwal dijeda. Kantong tidak mencatat bulan berikutnya sampai diaktifkan lagi.'
      : 'Jadwal aktif kembali. Bulan saat dijeda tidak dicatat mundur.');
  } catch (e) { notify(e.message || 'Gagal mengubah status jadwal.', true); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function deleteSchedule(id) {
  if (state.busy) return;
  const s = state.schedules.find((x) => x.id === id);
  if (!s) return;
  if (!confirm(`Hapus jadwal “${s.name}”? Transaksi yang sudah tercatat tetap ada dan tidak ikut terhapus.`)) return;
  state.busy = true; setButtons(false);
  try {
    await state.store.deleteSchedule(id);
    state.schedules = (await state.store.schedules()).map(normalizeScheduleRow).filter(Boolean);
    state.postings = await state.store.postings();
    if (state.editingSchedule === id) { state.editingSchedule = null; $('schedule-form').hidden = true; }
    render();
    notify('Jadwal dihapus. Transaksi lama tidak berubah.');
  } catch (e) { notify(e.message || 'Gagal menghapus jadwal.', true); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function saveOpening(ev) {
  ev.preventDefault();
  if (state.busy || !state.v4Ready) return;
  let n;
  try { n = openingAmount($('opening-balance').value); } catch (e) { notify(e.message, true); return; }
  state.busy = true; setButtons(false);
  try {
    state.settings = await state.store.saveSettings({ opening_balance: n, opening_balance_date: state.settings.opening_balance_date || localDate() });
    render();
    notify('Saldo awal tersimpan. “Saldo saat ini” dihitung ulang.');
  } catch (e) { notify(e.message || 'Gagal menyimpan saldo awal.', true); }
  finally { state.busy = false; setButtons(state.loaded); }
}

/* ---------- onboarding ---------- */
function maybeOpenOnboarding() {
  if (!state.v4Ready || !state.loaded) { $('onboarding-banner').hidden = true; return; }
  const mode = onboardingMode(state.settings);
  $('onboarding-banner').hidden = !(mode === 'banner' && !state.bannerDismissed);
  if (mode === 'wizard' && $('profile').hidden) openOnboarding();
}
function openOnboarding() {
  if (!state.v4Ready || state.onboardingOpen) return;
  state.onboardingOpen = true;
  state.pendingOpening = null;
  $('onboarding').hidden = false;
  document.body.classList.add('modal-open');
  state.onbAccounts = [{ name: 'BCA', type: 'bank', opening_balance: '' }];
  renderOnbAccounts();
  $('onb-name').value = '';
  $('onb-amount').value = '';
  $('onb-day').value = '25';
  $('onb-sched-start').value = localDate().slice(0, 7);
  $('onb-category').value = 'Gaji';
  showOnbStep(1);
}
function renderOnbAccounts() {
  $('onb-account-list').innerHTML = state.onbAccounts.map((a, i) => `
    <div class="onb-account-row">
      <div class="onb-acc-name"><label for="onb-acc-name-${i}">Nama akun</label><input id="onb-acc-name-${i}" maxlength="40" value="${escapeHTML(a.name || '')}" data-onb-field="name" data-onb-index="${i}" autocomplete="off"></div>
      <div><label for="onb-acc-type-${i}">Jenis</label><select id="onb-acc-type-${i}" data-onb-field="type" data-onb-index="${i}">${ACCOUNT_TYPES.map((t) => `<option value="${t.id}"${a.type === t.id ? ' selected' : ''}>${t.label}</option>`).join('')}</select></div>
      <div><label for="onb-acc-open-${i}">Saldo (Rp)</label><input id="onb-acc-open-${i}" inputmode="numeric" pattern="[0-9]*" value="${escapeHTML(String(a.opening_balance ?? ''))}" data-onb-field="opening_balance" data-onb-index="${i}"></div>
      <button type="button" class="icon-btn" data-onb-remove="${i}" aria-label="Hapus baris akun ${i + 1}"><svg class="ic" aria-hidden="true"><use href="#ic-close"></use></svg></button>
    </div>`).join('');
}
function closeOnboarding() {
  state.onboardingOpen = false;
  $('onboarding').hidden = true;
  if ($('profile').hidden) document.body.classList.remove('modal-open');
}
function showOnbStep(step) {
  state.onboardingStep = step;
  for (const el of $$('#onboarding .onb-step')) el.hidden = Number(el.dataset.step) !== step;
  $('onboarding-step-label').textContent = `Langkah ${step} dari 4`;
  const titles = { 1: 'Mau mulai kelola uang?', 2: 'Uangmu sekarang di mana?', 3: 'Pemasukan rutin', 4: 'Siap mulai' };
  $('onboarding-title').textContent = titles[step] || titles[1];
  $('onboarding-lede').textContent = step === 4
    ? 'Periksa ringkasan singkat ini, lalu mulai mencatat.'
    : step === 1
      ? 'Tiga langkah singkat: saldo awal, pemasukan rutin, lalu mulai mencatat. Semua bisa diubah nanti.'
      : step === 2
        ? 'Buat akun pertama dan isi saldonya hari ini. Boleh lebih dari satu; ini hanya catatan Anda.'
        : 'Opsional. Bisa ditambah kapan saja dari tab Rutin.';
  if (step === 4) renderOnbSummary();
  const focus = { 1: 'onb-start', 2: 'onb-acc-name-0', 3: 'onb-name', 4: 'onb-finish' }[step];
  setTimeout(() => { const el = $(focus); if (el) el.focus({ preventScroll: true }); }, 30);
}
function renderOnbSummary() {
  const accounts = state.accounts.filter((a) => !a.is_archived);
  const rows = [
    [`Hi, ${displayName() || 'Pengguna'}`, 'Nama & tema bisa diubah di Profil'],
    ['Akun', accounts.length ? accounts.map((a) => `${a.name} (${rp(accountBalance(a, assetData()))})`).join(' · ') : 'Belum ada akun — bisa ditambah nanti'],
    ['Pemasukan rutin', state.schedules.length ? state.schedules.map((s) => scheduleStatusText(s)).join(' · ') : 'Belum ada — bisa ditambah nanti'],
  ];
  $('onb-summary').innerHTML = rows.map(([k, v]) => `<li><b>${escapeHTML(k)}</b><span>${escapeHTML(v)}</span></li>`).join('');
}
async function onbAccountsNext(ev) {
  ev.preventDefault();
  if (state.busy) return;
  const rows = state.onbAccounts.filter((a) => String(a.name || '').trim() || String(a.opening_balance || '').trim());
  let plan;
  try {
    plan = rows.map((a) => validateAccount({ name: a.name, type: a.type, opening_balance: a.opening_balance, color: ACCOUNT_COLORS[state.onbAccounts.indexOf(a) % ACCOUNT_COLORS.length] }));
  } catch (e) { notify(e.message, true); return; }
  if (!plan.length) { showOnbStep(3); return; }
  state.busy = true; setButtons(false);
  let added = 0;
  try {
    for (const item of plan) { await state.store.saveAccount(item, null); added++; }
    state.accounts = (await state.store.accounts()).filter((a) => a && a.id);
    state.activityRows = await state.store.activity();
    fillAccountOptions();
    showOnbStep(3);
  } catch (e) {
    notify(`${added} akun tersimpan, sisanya gagal: ${e.message || 'galat'}. Periksa tab Akun sebelum mengulang.`, true);
    try { state.accounts = (await state.store.accounts()).filter((a) => a && a.id); fillAccountOptions(); } catch { /* tetap tampilkan galat asli */ }
  } finally { state.busy = false; setButtons(state.loaded); }
}
async function onbScheduleSave(ev) {
  ev.preventDefault();
  if (state.busy) return;
  let payload;
  try {
    payload = validateSchedule({
      name: $('onb-name').value,
      amount: $('onb-amount').value,
      day: $('onb-day').value,
      start_month: $('onb-sched-start').value,
      category: $('onb-category').value,
    });
  } catch (e) { notify(e.message, true); return; }
  state.busy = true; setButtons(false);
  try {
    await state.store.saveSchedule(payload, null);
    state.schedules = (await state.store.schedules()).map(normalizeScheduleRow).filter(Boolean);
    showOnbStep(4);
  } catch (e) { notify(e.message || 'Gagal menyimpan jadwal.', true); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function laterOnboarding() {
  if (state.busy) return;
  state.busy = true; setButtons(false);
  try {
    state.settings = await state.store.saveSettings({ onboarding_skipped: true });
  } catch (e) {
    notify('Pilihan “Nanti” belum tersimpan: ' + (e.message || '') + ' Anda tetap bisa memakai aplikasi.', true);
  } finally { state.busy = false; setButtons(state.loaded); }
  closeOnboarding();
  maybeOpenOnboarding();
  notify('Panduan bisa dilanjutkan kapan saja dari pengingat atau menu Profil.');
}
async function finishOnboarding() {
  if (state.busy) return;
  state.busy = true; setButtons(false);
  try {
    state.settings = await state.store.saveSettings({
      onboarding_completed: true, onboarding_skipped: false,
    });
    if (state.schedules.length) await runAutoPost();
    closeOnboarding();
    $('onboarding-banner').hidden = true;
    state.bannerDismissed = false;
    applyLook(state.settings.theme, state.settings.pattern);
    render(); renderProfileChrome();
    notify('Panduan selesai. Selamat mencatat.');
  } catch (e) {
    notify('Panduan belum tersimpan: ' + (e.message || '') + ' Coba lagi; data tidak diubah.', true);
  } finally { state.busy = false; setButtons(state.loaded); }
}

/* ---------- profil ---------- */
function profileStatus(message, error = false) {
  const el = $('profile-status');
  el.textContent = message;
  el.classList.toggle('error', !!error);
}
function renderProfileForm() {
  const d = state.profileDraft;
  const name = d.display_name?.trim() ? d.display_name.trim() : (displayName() || 'Pengguna');
  $('profile-name').value = d.display_name || '';
  $('profile-title').textContent = `Hi, ${name}`;
  $('profile-name-preview').textContent = name;
  $('profile-email').textContent = state.mode === 'cloud'
    ? (state.store?.session?.user?.email || 'Masuk dengan email')
    : 'Demo lokal — profil tersimpan hanya di browser ini.';
  paintAvatar($('profile-avatar'), name, d);
  $('avatar-remove').hidden = d.avatar_kind !== 'photo';
  $('avatar-colors').innerHTML = AVATAR_COLORS.map((c) => `<button type="button" class="avatar-choice" data-avatar-color="${c}" aria-label="Warna avatar ${c}" aria-pressed="${d.avatar_color === c}" style="background:${c}"></button>`).join('');
  $('theme-swatches').innerHTML = THEMES.map((t) => `<button type="button" class="choice" data-accent="${t.id}" aria-pressed="${d.theme === t.id}"><span class="dot-accent" style="background:${t.color}"></span>${t.label}</button>`).join('');
  $('pattern-swatches').innerHTML = PATTERNS.map((p) => `<button type="button" class="choice" data-pattern-choice="${p.id}" aria-pressed="${d.pattern === p.id}"><span class="pat pat-${p.id}"></span>${p.label}</button>`).join('');
}
function openProfile() {
  if (!state.loaded) return;
  state.profileDraft = {
    display_name: state.settings?.display_name || (state.mode === 'cloud' ? usernameFromEmail(state.store?.session?.user?.email || '') : ''),
    avatar_color: state.settings?.avatar_color || AVATAR_COLORS[0],
    avatar_kind: state.settings?.avatar_kind || 'initial',
    avatar_data: state.settings?.avatar_data || null,
    theme: state.settings?.theme || 'krem',
    pattern: state.settings?.pattern || 'none',
  };
  renderProfileForm();
  applyLook(state.profileDraft.theme, state.profileDraft.pattern);
  profileStatus('');
  $('profile').hidden = false;
  document.body.classList.add('modal-open');
  $('profile-name').focus({ preventScroll: true });
}
function closeProfile() {
  $('profile').hidden = true;
  if (state.settings) applyLook(state.settings.theme, state.settings.pattern);
  if ($('onboarding').hidden) document.body.classList.remove('modal-open');
}
async function saveProfile(ev) {
  ev.preventDefault();
  if (state.busy) return;
  let name;
  try { name = validateUsername($('profile-name').value); }
  catch (e) { profileStatus(e.message, true); $('profile-name').focus(); return; }
  if (!state.v4Ready) { profileStatus('Profil butuh migration-v4.sql dijalankan sekali. Nama belum disimpan.', true); return; }
  const d = state.profileDraft;
  state.busy = true; setButtons(false);
  try {
    state.settings = await state.store.saveSettings({
      display_name: name, avatar_color: d.avatar_color, avatar_kind: d.avatar_kind,
      avatar_data: d.avatar_kind === 'photo' ? d.avatar_data : null, theme: d.theme, pattern: d.pattern,
    });
    applyLook(state.settings.theme, state.settings.pattern);
    renderProfileChrome();
    render();
    closeProfile();
    notify('Profil tersimpan di akun. Perangkat lain akan melihat nama dan tema yang sama setelah Muat ulang.');
  } catch (e) {
    profileStatus(e.message || 'Gagal menyimpan profil.', true);
  } finally { state.busy = false; setButtons(state.loaded); }
}
async function compressAvatar(file) {
  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
    el.onerror = () => { URL.revokeObjectURL(url); reject(Error('Foto tidak bisa dibaca oleh browser ini.')); };
    el.src = url;
  });
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
  const scale = Math.max(size / img.width, size / img.height);
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  let quality = 0.82;
  let out = canvas.toDataURL('image/jpeg', quality);
  while (out.length > 140000 && quality > 0.4) { quality -= 0.12; out = canvas.toDataURL('image/jpeg', quality); }
  return out;
}
async function handleAvatarFile(file) {
  if (!file) return;
  try {
    validateAvatarPhoto({ type: file.type, size: file.size });
    const data = await compressAvatar(file);
    avatarDataError(data);
    state.profileDraft = { ...state.profileDraft, avatar_kind: 'photo', avatar_data: data };
    renderProfileForm();
    profileStatus(`Foto siap disimpan (${Math.round((data.length * 3 / 4) / 1024)} KB, 256×256).`);
  } catch (e) {
    profileStatus(e.message || 'Foto gagal diproses; tidak ada yang disimpan.', true);
  }
}
async function resetLook() {
  state.profileDraft = { ...state.profileDraft, theme: 'krem', pattern: 'none' };
  renderProfileForm();
  applyLook('krem', 'none');
  if (!state.v4Ready) { profileStatus('Tampilan diatur ulang untuk perangkat ini. Migrasi v4 belum berjalan sehingga tidak tersimpan di akun.', true); return; }
  try {
    state.settings = await state.store.saveSettings({ theme: 'krem', pattern: 'none' });
    profileStatus('Tampilan diatur ulang ke bawaan dan tersimpan.');
  } catch (e) { profileStatus('Tampilan diatur ulang di layar, tetapi belum tersimpan: ' + (e.message || ''), true); }
}

/* ---------- peristiwa v4 ---------- */
function wireV4() {
  $('onb-start').addEventListener('click', () => showOnbStep(2));
  $('onb-later').addEventListener('click', laterOnboarding);
  $('onb-accounts-form').addEventListener('submit', onbAccountsNext);
  $('onb-accounts-skip').addEventListener('click', () => showOnbStep(3));
  $('onb-add-account').addEventListener('click', () => { const n = state.onbAccounts.length; state.onbAccounts.push({ name: n === 1 ? 'Tunai' : `Akun ${n + 1}`, type: n === 1 ? 'cash' : 'bank', opening_balance: '' }); renderOnbAccounts(); });
  $('onb-account-list').addEventListener('input', (e) => { const el = e.target.closest('[data-onb-field]'); if (!el) return; state.onbAccounts[Number(el.dataset.onbIndex)][el.dataset.onbField] = el.value; });
  $('onb-account-list').addEventListener('change', (e) => { const el = e.target.closest('[data-onb-field]'); if (!el) return; state.onbAccounts[Number(el.dataset.onbIndex)][el.dataset.onbField] = el.value; });
  $('onb-account-list').addEventListener('click', (e) => { const b = e.target.closest('[data-onb-remove]'); if (!b) return; if (state.onbAccounts.length === 1) { state.onbAccounts[0] = { name: '', type: 'bank', opening_balance: '' }; } else state.onbAccounts.splice(Number(b.dataset.onbRemove), 1); renderOnbAccounts(); });
  $('onb-schedule-form').addEventListener('submit', onbScheduleSave);
  $('onb-schedule-skip').addEventListener('click', () => showOnbStep(4));
  $('onb-finish').addEventListener('click', finishOnboarding);
  $('onb-banner-open').addEventListener('click', () => { state.bannerDismissed = false; $('onboarding-banner').hidden = true; openOnboarding(); });
  $('onb-banner-close').addEventListener('click', () => { state.bannerDismissed = true; $('onboarding-banner').hidden = true; });
  $('v4-notice-close').addEventListener('click', () => { state.v4Dismissed = true; $('v4-notice').hidden = true; });

  $('profile-btn').addEventListener('click', openProfile);
  $('profile-close').addEventListener('click', closeProfile);
  $('profile-name').addEventListener('input', (e) => { if (state.profileDraft) state.profileDraft.display_name = e.target.value; });
  $('profile-form').addEventListener('submit', saveProfile);
  $('avatar-colors').addEventListener('click', (e) => {
    const c = e.target.closest('[data-avatar-color]')?.dataset.avatarColor;
    if (!c) return;
    state.profileDraft = { ...state.profileDraft, avatar_color: c, avatar_kind: 'initial', avatar_data: null };
    renderProfileForm();
  });
  $('theme-swatches').addEventListener('click', (e) => {
    const t = e.target.closest('[data-accent]')?.dataset.accent;
    if (!t) return;
    state.profileDraft = { ...state.profileDraft, theme: t };
    renderProfileForm(); applyLook(t, state.profileDraft.pattern);
    profileStatus('Pratinjau tema. Klik “Simpan profil” agar tersimpan di akun.');
  });
  $('pattern-swatches').addEventListener('click', (e) => {
    const p = e.target.closest('[data-pattern-choice]')?.dataset.patternChoice;
    if (!p) return;
    state.profileDraft = { ...state.profileDraft, pattern: p };
    renderProfileForm(); applyLook(state.profileDraft.theme, p);
    profileStatus('Pratinjau latar. Klik “Simpan profil” agar tersimpan di akun.');
  });
  $('avatar-upload').addEventListener('click', () => $('avatar-file').click());
  $('avatar-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    handleAvatarFile(f);
  });
  $('avatar-remove').addEventListener('click', () => {
    state.profileDraft = { ...state.profileDraft, avatar_kind: 'initial', avatar_data: null };
    renderProfileForm(); profileStatus('Foto dihapus dari pratinjau. Simpan profil untuk menerapkan.');
  });
  $('profile-reset').addEventListener('click', resetLook);

  $('schedule-new').addEventListener('click', () => openScheduleForm(null));
  $('schedule-form').addEventListener('submit', saveScheduleForm);
  $('sched-cancel').addEventListener('click', () => { state.editingSchedule = null; $('schedule-form').hidden = true; });
  $('schedule-rows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sched-edit],[data-sched-toggle],[data-sched-del]');
    if (!b) return;
    if (b.dataset.schedEdit) openScheduleForm(b.dataset.schedEdit);
    else if (b.dataset.schedToggle) toggleSchedule(b.dataset.schedToggle);
    else deleteSchedule(b.dataset.schedDel);
  });
  $('opening-form').addEventListener('submit', saveOpening);
  $('rerun-onboarding').addEventListener('click', openOnboarding);

  $('quick-date').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quickdate]');
    if (!b) return;
    const d = new Date();
    d.setDate(d.getDate() - Number(b.dataset.quickdate));
    $('date').value = localDate(d);
    $('date').max = localDate();
    $('date').focus();
  });
}


/* ============================================================
   Kantong v4 — Akun & Aset: tampilan, formulir, pemeliharaan
   ============================================================ */
function accName(id) { return state.accounts.find((a) => a.id === id)?.name || 'Akun dihapus'; }
function fillAccountOptions() {
  const active = state.accounts.filter((a) => !a.is_archived);
  const usable = active.filter((a) => a.type !== 'investment');
  const sel = $('account');
  const keep = sel.value;
  sel.innerHTML = usable.map((a) => `<option value="${escapeHTML(a.id)}">${escapeHTML(a.name)}</option>`).join('');
  let last = null;
  try { last = localStorage.getItem('kantong.lastAccount'); } catch { last = null; }
  const pick = usable.find((a) => a.id === keep)?.id || usable.find((a) => a.id === last)?.id || defaultAccountId(usable);
  if (pick) sel.value = pick;
  $('account-field').hidden = !state.v4Ready || !usable.length;
  const opts = active.map((a) => `<option value="${escapeHTML(a.id)}">${escapeHTML(a.name)}</option>`).join('');
  for (const id of ['tr-from', 'tr-to']) {
    const el = $(id);
    const prev = el.value;
    el.innerHTML = opts;
    el.value = active.some((a) => a.id === prev) ? prev : (active[0]?.id || '');
  }
  if ($('tr-to').value === $('tr-from').value && active[1]) $('tr-to').value = active[1].id;
}
function renderAssetDashboard() {
  const active = state.accounts.filter((a) => !a.is_archived);
  const card = $('aset-card');
  if (!active.length) { card.hidden = true; return; }
  card.hidden = false;
  const totals = assetTotals(state.accounts, assetData());
  $('aset-ready').textContent = rp(totals.ready);
  $('aset-total').textContent = rp(totals.total);
  const alloc = allocationByType(state.accounts, assetData());
  const total = alloc.reduce((s, x) => s + x.value, 0n);
  const C = 2 * Math.PI * 54;
  let offset = 0;
  if (!total) $('aset-donut').innerHTML = '<p class="empty-note">Belum ada nilai aset.</p>';
  else {
    let svg = '<svg viewBox="0 0 140 140" role="presentation" aria-hidden="true"><g transform="rotate(-90 70 70)">';
    alloc.forEach((x, i) => {
      const len = (Number(x.value) / Number(total)) * C;
      svg += `<circle cx="70" cy="70" r="54" fill="none" stroke="${ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]}" stroke-width="18" stroke-dasharray="${Math.max(0, len - 1.5).toFixed(2)} ${(C - len + 1.5).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${escapeHTML(x.label)} — ${rp(x.value)}</title></circle>`;
      offset += len;
    });
    svg += `</g><text x="70" y="66" text-anchor="middle" font-size="9" fill="var(--muted)">TOTAL</text><text x="70" y="82" text-anchor="middle" font-size="12" font-family="Georgia,serif" fill="var(--ink)">${escapeHTML(rpShort(Number(total)))}</text></svg>`;
    $('aset-donut').innerHTML = svg + `<ul class="mini-legend">${alloc.map((x, i) => `<li><span class="swatch" style="background:${ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]}"></span>${escapeHTML(x.label)}<b>${escapeHTML(rpShort(Number(x.value)))}</b></li>`).join('')}</ul>`;
  }
  const investIds = new Set(state.accounts.filter((a) => a.type === 'investment' && !a.is_archived).map((a) => a.id));
  const byDate = new Map();
  for (const v of state.valuations) if (investIds.has(v.account_id)) byDate.set(v.date, (byDate.get(v.date) || 0n) + BigInt(v.value));
  const points = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));
  $('aset-history').innerHTML = points.length >= 2 ? lineChart(points, 'Riwayat nilai investasi') : '<p class="empty-note">Perbarui nilai investasi minimal dua kali untuk melihat riwayat.</p>';
}
function lineChart(points, label = '') {
  const W = 320, H = 96, pad = 12;
  const values = points.map((p) => Number(p.value));
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = points.map((p, i) => {
    const x = pad + ((W - pad * 2) * i) / Math.max(1, points.length - 1);
    const y = H - pad - ((Number(p.value) - min) / span) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${pad},${H - pad} ${pts.join(' ')} ${W - pad},${H - pad}`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHTML(label)}"><polygon class="area" points="${area}"/><polyline class="line" points="${pts.join(' ')}"/><text class="axis" x="${pad}" y="${H - 2}">${escapeHTML(points[0].date)}</text><text class="axis" x="${W - pad}" y="${H - 2}" text-anchor="end">${escapeHTML(points.at(-1).date)}</text></svg>`;
}
function renderAccounts() {
  const totals = assetTotals(state.accounts, assetData());
  const active = state.accounts.filter((a) => !a.is_archived);
  $('asset-totals').innerHTML = `<div><span>Uang siap pakai</span><b>${rp(totals.ready)}</b></div><div><span>Total aset</span><b>${rp(totals.total)}</b></div><div><span>Investasi (manual)</span><b>${rp(totals.investment)}</b></div>`;
  $('account-cards').innerHTML = state.accounts.length ? state.accounts.map((a) => {
    const bal = accountBalance(a, assetData());
    const prof = a.type === 'investment' ? investmentProfit(a, assetData()) : null;
    return `<article class="account-card${a.is_archived ? ' archived' : ''}">
      <header><span class="acc-dot" style="background:${a.color}"></span><h3>${escapeHTML(a.name)}</h3><span class="badge">${escapeHTML(ACCOUNT_TYPES.find((t) => t.id === a.type)?.label || a.type)}</span></header>
      <p class="acc-balance">${rp(bal)}</p>
      ${prof ? `<p class="acc-note">Biaya ${rp(prof.cost)} · P/L ${rp(prof.profit)}${prof.pct === null ? '' : ` (${prof.pct >= 0 ? '+' : ''}${prof.pct.toFixed(1)}%)`} · nilai manual</p>` : ''}
      ${a.note ? `<p class="acc-note">${escapeHTML(a.note)}</p>` : ''}
      ${a.is_archived ? '<p class="acc-note">Diarsipkan — disembunyikan dari pilihan, riwayat tetap ada.</p>' : ''}
      <div class="acc-actions">
        <button type="button" class="ghost-btn" data-acc-edit="${escapeHTML(a.id)}">Ubah</button>
        ${a.type === 'investment' ? `<button type="button" class="ghost-btn" data-acc-detail="${escapeHTML(a.id)}">Rincian aset</button>` : ''}
        <button type="button" class="ghost-btn" data-acc-archive="${escapeHTML(a.id)}">${a.is_archived ? 'Aktifkan' : 'Arsipkan'}</button>
      </div></article>`;
  }).join('') : '<p class="hint">Belum ada akun. Tambahkan BCA, Tunai, atau akun investasi pertama.</p>';
  $('transfer-rows').innerHTML = state.transfers.length ? state.transfers.slice(0, 20).map((t) => `<tr><td>${escapeHTML(accName(t.from_account))} → ${escapeHTML(accName(t.to_account))}${t.note ? `<small>${escapeHTML(t.note)}</small>` : ''}</td><td>${rp(t.amount)}</td><td>${dayLabel(t.date)}</td><td><div class="row-actions"><button class="icon-btn" type="button" data-tr-edit="${escapeHTML(t.id)}" aria-label="Ubah pindah dana"><svg class="ic" aria-hidden="true"><use href="#ic-pencil"></use></svg></button><button class="icon-btn" type="button" data-tr-del="${escapeHTML(t.id)}" aria-label="Hapus pindah dana"><svg class="ic" aria-hidden="true"><use href="#ic-trash"></use></svg></button></div></td></tr>`).join('') : '<tr><td colspan="4">Belum ada pindah dana.</td></tr>';
  $('activity-rows').innerHTML = state.activityRows.length ? state.activityRows.slice(0, 50).map((a) => `<li><span><span class="act-kind">${escapeHTML(a.action)}</span> ${escapeHTML(a.entity)} · ${escapeHTML(a.summary)}</span><time datetime="${escapeHTML(a.created_at || '')}">${a.created_at ? new Date(a.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</time></li>`).join('') : '<li>Belum ada perubahan tercatat.</li>';
  renderBulkRows();
  if (state.activeAccount) renderInvestment();
}
function renderBulkRows() {
  const invs = state.accounts.filter((a) => a.type === 'investment' && !a.is_archived);
  $('bulk-rows').innerHTML = invs.length ? invs.map((a) => {
    const cur = accountBalance(a, assetData());
    return `<tr data-bulk-row="${escapeHTML(a.id)}"><th>${escapeHTML(a.name)}</th><td>${rp(cur)}</td><td><input class="holding-input" inputmode="numeric" data-bulk-input="${escapeHTML(a.id)}" placeholder="${cur}"></td><td><input class="holding-input" maxlength="200" data-bulk-note="${escapeHTML(a.id)}" placeholder="opsional"></td><td data-bulk-state="${escapeHTML(a.id)}">—</td></tr>`;
  }).join('') : '<tr><td colspan="5">Belum ada akun investasi. Tambahkan akun bertipe Investasi.</td></tr>';
}
function openAccountForm(id) {
  if (!state.v4Ready) return;
  state.accountEditing = id || null;
  const a = id ? state.accounts.find((x) => x.id === id) : null;
  $('account-form-title').textContent = a ? 'Ubah akun' : 'Tambah akun';
  $('acc-name').value = a?.name || '';
  $('acc-type').innerHTML = ACCOUNT_TYPES.map((t) => `<option value="${t.id}"${a?.type === t.id ? ' selected' : ''}>${t.label}</option>`).join('');
  $('acc-type').value = a?.type || 'bank';
  $('acc-opening').value = a ? String(a.opening_balance) : '';
  $('acc-color').innerHTML = ACCOUNT_COLORS.map((c) => `<option value="${c}"${(a?.color || ACCOUNT_COLORS[0]) === c ? ' selected' : ''}>${c}</option>`).join('');
  $('acc-current').value = a?.current_value !== null && a?.current_value !== undefined ? String(a.current_value) : '';
  $('acc-note').value = a?.note || '';
  $('acc-warning').hidden = !a;
  $('account-form').hidden = false;
  $('acc-name').focus({ preventScroll: true });
}
async function saveAccountForm(ev) {
  ev.preventDefault();
  if (state.busy) return;
  let clean;
  try {
    clean = validateAccount({ name: $('acc-name').value, type: $('acc-type').value, opening_balance: $('acc-opening').value, color: $('acc-color').value, note: $('acc-note').value, current_value: $('acc-current').value === '' ? null : $('acc-current').value, is_archived: state.accounts.find((a) => a.id === state.accountEditing)?.is_archived || false });
  } catch (e) { notify(e.message, true); return; }
  const prev = state.accountEditing ? state.accounts.find((a) => a.id === state.accountEditing) : null;
  if (prev && prev.opening_balance !== clean.opening_balance && !confirm('Saldo awal akun ini berubah. Saldo akun akan dihitung ulang dari saldo awal baru; riwayat transaksi tidak diubah. Lanjutkan?')) return;
  state.busy = true; setButtons(false);
  try {
    await state.store.saveAccount(clean, state.accountEditing);
    state.accountEditing = null;
    $('account-form').hidden = true;
    await refreshAssets();
    notify(prev ? 'Akun diperbarui. Saldo dihitung ulang dari data saat ini.' : 'Akun ditambahkan.');
  } catch (e) { notify(e.message || 'Gagal menyimpan akun.', true); await refreshAssets(); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function archiveAccountPrompt(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  const next = !a.is_archived;
  if (next && !confirm(`Arsipkan “${a.name}”? Akun disembunyikan dari pilihan transaksi, tetapi riwayat dan saldonya tetap tersimpan.`)) return;
  state.busy = true; setButtons(false);
  try { await state.store.archiveAccount(id, next); await refreshAssets(); notify(next ? 'Akun diarsipkan. Riwayat tetap aman.' : 'Akun diaktifkan kembali.'); }
  catch (e) { notify(e.message || 'Gagal mengubah arsip akun.', true); await refreshAssets(); }
  finally { state.busy = false; setButtons(state.loaded); }
}
function openTransferForm(id) {
  if (!state.v4Ready) return;
  const active = state.accounts.filter((a) => !a.is_archived);
  if (active.length < 2) { notify('Butuh minimal dua akun untuk pindah dana.', true); return; }
  state.transferEditing = id || null;
  const t = id ? state.transfers.find((x) => x.id === id) : null;
  fillAccountOptions();
  $('transfer-form-title').textContent = t ? 'Ubah pindah dana' : 'Pindah dana';
  if (t) { $('tr-from').value = t.from_account; $('tr-to').value = t.to_account; }
  $('tr-amount').value = t ? String(t.amount) : '';
  $('tr-date').value = t?.date || localDate();
  $('tr-date').max = localDate();
  $('tr-note').value = t?.note || '';
  $('transfer-form').hidden = false;
  $('tr-amount').focus({ preventScroll: true });
}
async function saveTransferForm(ev) {
  ev.preventDefault();
  if (state.busy) return;
  let clean;
  try { clean = validateTransfer({ from_account: $('tr-from').value, to_account: $('tr-to').value, amount: $('tr-amount').value, date: $('tr-date').value, note: $('tr-note').value }); }
  catch (e) { notify(e.message, true); return; }
  state.busy = true; setButtons(false);
  try {
    await state.store.saveTransfer(clean, state.transferEditing);
    state.transferEditing = null;
    $('transfer-form').hidden = true;
    await refreshAssets();
    notify('Pindah dana tersimpan. Bukan pemasukan/pengeluaran; anggaran tidak berubah.');
  } catch (e) { notify(e.message || 'Gagal menyimpan pindah dana.', true); await refreshAssets(); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function deleteTransferPrompt(id) {
  if (state.busy) return;
  if (!confirm('Hapus pindah dana ini? Saldo kedua akun dihitung ulang. Transaksi lain tidak berubah.')) return;
  state.busy = true; setButtons(false);
  try { await state.store.deleteTransfer(id); await refreshAssets(); notify('Pindah dana dihapus; saldo dihitung ulang.'); }
  catch (e) { notify(e.message || 'Gagal menghapus pindah dana.', true); await refreshAssets(); }
  finally { state.busy = false; setButtons(state.loaded); }
}
function openInvestment(id) {
  state.activeAccount = id;
  state.holdingDraft = state.holdings.filter((h) => h.account_id === id).map((h) => ({ ...h, dirty: false }));
  $('investment-detail').hidden = false;
  renderInvestment();
  $('investment-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function renderInvestment() {
  const a = state.accounts.find((x) => x.id === state.activeAccount);
  if (!a) { $('investment-detail').hidden = true; state.activeAccount = null; return; }
  $('investment-detail').hidden = false;
  const prof = investmentProfit(a, assetData());
  const last = latestValuation(state.valuations, a.id);
  $('inv-title').textContent = `${a.name} · investasi`;
  $('inv-meta').textContent = `Nilai ${rp(prof.value)} · biaya ${rp(prof.cost)} · laba/rugi belum terealisasi ${rp(prof.profit)}${prof.pct === null ? '' : ` (${prof.pct >= 0 ? '+' : ''}${prof.pct.toFixed(1)}%)`} · nilai manual, bukan harga pasar. Nilai diperbarui ${last ? dayLabel(last.date) : 'belum pernah'}.`;
  $('inv-value').value = a.current_value !== null && a.current_value !== undefined ? String(a.current_value) : '';
  $('holding-rows').innerHTML = state.holdingDraft.length ? state.holdingDraft.map((h, i) => {
    let value = '';
    try { if (h.quantity !== '' && h.current_price !== '') value = rp(holdingValueSafe(h)); } catch { value = '—'; }
    let pl = '';
    try { if (h.quantity !== '' && h.current_price !== '' && h.avg_buy_price !== '') { const p = holdingValueSafe(h) - BigInt(Math.round(Number(h.quantity) * Number(h.avg_buy_price))); pl = `${p >= 0n ? '+' : ''}${rp(p)}`; } } catch { pl = '—'; }
    return `<tr class="${h.dirty ? 'dirty-row' : ''}" data-h-row="${i}">
      <td><input class="holding-input" maxlength="60" value="${escapeHTML(h.asset_name)}" data-h-field="asset_name" data-h-index="${i}" aria-label="Nama aset"></td>
      <td><select class="holding-input" data-h-field="kind" data-h-index="${i}" aria-label="Jenis aset">${HOLDING_KINDS.map((k) => `<option value="${k.id}"${h.kind === k.id ? ' selected' : ''}>${k.label}</option>`).join('')}</select></td>
      <td><input class="holding-input" inputmode="decimal" value="${escapeHTML(String(h.quantity))}" data-h-field="quantity" data-h-index="${i}" aria-label="Jumlah"></td>
      <td><input class="holding-input" inputmode="decimal" value="${escapeHTML(String(h.avg_buy_price))}" data-h-field="avg_buy_price" data-h-index="${i}" aria-label="Harga beli rata-rata"></td>
      <td><input class="holding-input" inputmode="decimal" value="${escapeHTML(String(h.current_price))}" data-h-field="current_price" data-h-index="${i}" aria-label="Harga kini manual"></td>
      <td data-h-value="${i}">${value}<br><small>${pl}</small></td>
      <td><button type="button" class="icon-btn" data-h-del="${escapeHTML(h.id || '')}" data-h-index="${i}" aria-label="Hapus aset"><svg class="ic" aria-hidden="true"><use href="#ic-trash"></use></svg></button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7">Belum ada rincian aset. Tambah aset atau isi nilai kini manual.</td></tr>';
  $('holding-dirty').hidden = !state.holdingDraft.some((h) => h.dirty);
  const hist = valueHistory(state.valuations, a.id);
  $('valuation-rows').innerHTML = hist.length ? hist.slice().reverse().map((v, idx, arr) => {
    const prev = arr[idx + 1];
    const delta = prev ? v.value - prev.value : null;
    const row = state.valuations.find((x) => x.account_id === a.id && x.date === v.date && BigInt(x.value) === v.value);
    return `<tr><td>${dayLabel(v.date)}</td><td>${rp(v.value)}</td><td class="${delta !== null && delta < 0n ? 'negative' : ''}">${delta === null ? '—' : `${delta >= 0n ? '+' : ''}${rp(delta)}`}</td><td>${escapeHTML(v.note || '—')}</td><td>${row ? `<button type="button" class="ghost-btn" data-val-del="${escapeHTML(row.id)}">Hapus</button>` : ''}</td></tr>`;
  }).join('') : '<tr><td colspan="5">Belum ada riwayat nilai.</td></tr>';
  $('inv-chart').innerHTML = hist.length >= 2 ? lineChart(hist, 'Riwayat nilai investasi') : '<p class="empty-note">Riwayat grafik muncul setelah ada dua pembaruan nilai.</p>';
}
function holdingValueSafe(h) {
  const v = Number(h.quantity) * Number(h.current_price);
  if (!Number.isFinite(v) || v < 0 || v > 9e15) throw Error('di luar batas');
  return BigInt(Math.round(v));
}
async function saveHoldings() {
  if (state.busy) return;
  const dirty = state.holdingDraft.filter((h) => h.dirty);
  const rows = dirty.filter((h) => String(h.asset_name || '').trim() || String(h.quantity || '').trim() || String(h.current_price || '').trim());
  if (!rows.length) { notify('Tidak ada perubahan aset untuk disimpan.', true); return; }
  let plan;
  try { plan = rows.map((h) => validateHolding({ ...h, account_id: state.activeAccount })); }
  catch (e) { notify(e.message, true); return; }
  state.busy = true; setButtons(false);
  try {
    for (let i = 0; i < plan.length; i++) await state.store.saveHolding(plan[i], rows[i].id || null);
    await refreshAssets();
    openInvestment(state.activeAccount);
    notify(`${plan.length} baris aset tersimpan. Nilai investasi dihitung ulang.`);
  } catch (e) { notify(e.message || 'Gagal menyimpan aset.', true); await refreshAssets(); openInvestment(state.activeAccount); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function deleteHoldingPrompt(id, index) {
  if (state.busy) return;
  const row = state.holdingDraft[index];
  if (!id) { state.holdingDraft.splice(index, 1); renderInvestment(); return; }
  if (!confirm(`Hapus aset “${row?.asset_name || ''}”? Nilai investasi dihitung ulang; riwayat nilai tetap ada.`)) return;
  state.busy = true; setButtons(false);
  try { await state.store.deleteHolding(id); await refreshAssets(); openInvestment(state.activeAccount); notify('Aset dihapus; nilai investasi dihitung ulang.'); }
  catch (e) { notify(e.message || 'Gagal menghapus aset.', true); await refreshAssets(); openInvestment(state.activeAccount); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function saveInvestmentValue() {
  if (state.busy) return;
  const id = state.activeAccount;
  let value;
  try { value = openingAmount($('inv-value').value); }
  catch { notify('Nilai kini harus rupiah bulat nonnegatif.', true); return; }
  state.busy = true; setButtons(false);
  try {
    await state.store.saveValuation(id, value, $('inv-note').value);
    await refreshAssets(); openInvestment(id); $('inv-note').value = '';
    notify('Nilai investasi tersimpan sebagai riwayat baru. Nilai lama tidak ditimpa.');
  } catch (e) { notify(e.message || 'Gagal menyimpan nilai investasi.', true); await refreshAssets(); openInvestment(id); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function deleteValuationPrompt(id) {
  if (state.busy) return;
  if (!confirm('Hapus satu catatan riwayat nilai ini? Nilai kini akun dihitung ulang dari catatan terbaru yang tersisa.')) return;
  state.busy = true; setButtons(false);
  try { await state.store.deleteValuation(id); await refreshAssets(); openInvestment(state.activeAccount); notify('Catatan nilai dihapus; nilai kini dihitung ulang.'); }
  catch (e) { notify(e.message || 'Gagal menghapus catatan nilai.', true); await refreshAssets(); openInvestment(state.activeAccount); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function saveBulkValues() {
  if (state.busy) return;
  const rows = [];
  for (const a of state.accounts.filter((x) => x.type === 'investment' && !x.is_archived)) {
    const input = $(`[data-bulk-input="${a.id}"]`) || $$('[data-bulk-input]').find((el) => el.dataset.bulkInput === a.id);
    if (!input || input.value.trim() === '') continue;
    const noteEl = $$('[data-bulk-note]').find((el) => el.dataset.bulkNote === a.id);
    rows.push({ account_id: a.id, value: input.value.trim(), note: noteEl?.value || '' });
  }
  if (!rows.length) { $('bulk-status').textContent = 'Tidak ada nilai baru untuk disimpan.'; return; }
  let plan;
  try { plan = valuationPlan(rows); } catch (e) { $('bulk-status').textContent = e.message; $('bulk-status').classList.add('error'); return; }
  state.busy = true; setButtons(false);
  try {
    const res = await state.store.saveValuations(plan);
    if (res.errors?.length) {
      $('bulk-status').textContent = `Gagal ${res.errors.length}: ${res.errors[0].message} Nilai yang tampil dimuat ulang dari data tersimpan.`;
      $('bulk-status').classList.add('error');
      notify('Sebagian nilai gagal disimpan. Angka dimuat ulang dari data sebenarnya.', true);
    } else {
      $('bulk-status').classList.remove('error');
      $('bulk-status').textContent = `${res.saved.length} nilai akun tersimpan.`;
      notify(`${res.saved.length} nilai investasi tersimpan (manual).`);
    }
    await refreshAssets();
  } catch (e) {
    $('bulk-status').textContent = (e.message || 'Gagal menyimpan nilai.') + ' Angka dimuat ulang dari data tersimpan.';
    $('bulk-status').classList.add('error');
    notify(e.message || 'Gagal menyimpan nilai.', true);
    await refreshAssets();
  } finally { state.busy = false; setButtons(state.loaded); }
}
async function refreshAssets() {
  const [accounts, transfers, holdings, valuations, activity] = await Promise.all([
    state.store.accounts(), state.store.transfers(), state.store.holdings(), state.store.valuations(), state.store.activity(),
  ]);
  state.accounts = accounts.filter((a) => a && a.id);
  state.transfers = transfers.filter((t) => t && t.id);
  state.holdings = holdings.filter((h) => h && h.id);
  state.valuations = valuations.filter((v) => v && v.id);
  state.activityRows = activity;
  if (state.activeAccount && !state.accounts.some((a) => a.id === state.activeAccount)) state.activeAccount = null;
  fillAccountOptions();
  render();
}
function exportAssetsCSV(kind) {
  if (!state.loaded) return;
  let headers, rows;
  if (kind === 'accounts') {
    headers = ['nama', 'jenis', 'saldo_awal_idr', 'saldo_saat_ini_idr', 'nilai_manual_idr', 'diarsipkan', 'catatan'];
    rows = state.accounts.map((a) => [a.name, a.type, a.opening_balance, accountBalance(a, assetData()), a.current_value, a.is_archived ? 'ya' : 'tidak', a.note || '']);
  } else if (kind === 'holdings') {
    headers = ['akun', 'nama_aset', 'jenis', 'jumlah', 'harga_beli_rata_rata_manual', 'harga_kini_manual', 'nilai_idr', 'harga_manual_bukan_feed'];
    rows = state.holdings.map((h) => [accName(h.account_id), h.asset_name, h.kind, h.quantity, h.avg_buy_price, h.current_price, holdingValueSafe(h), 'ya']);
  } else {
    headers = ['tanggal', 'dari_akun', 'ke_akun', 'nominal_idr', 'catatan'];
    rows = state.transfers.map((t) => [t.date, accName(t.from_account), accName(t.to_account), t.amount, t.note || '']);
  }
  download(`kantong-${kind}-${localDate()}.csv`, reportCSV(headers, rows), 'text/csv;charset=utf-8');
  notify('CSV diunduh.');
}
function wireAssets() {
  $('account-new').addEventListener('click', () => openAccountForm(null));
  $('account-form').addEventListener('submit', saveAccountForm);
  $('acc-cancel').addEventListener('click', () => { state.accountEditing = null; $('account-form').hidden = true; });
  $('account-cards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-acc-edit],[data-acc-archive],[data-acc-detail]');
    if (!b) return;
    if (b.dataset.accEdit) openAccountForm(b.dataset.accEdit);
    else if (b.dataset.accArchive) archiveAccountPrompt(b.dataset.accArchive);
    else openInvestment(b.dataset.accDetail);
  });
  $('transfer-new').addEventListener('click', () => openTransferForm(null));
  $('open-transfer').addEventListener('click', () => { closeSheet(); setView('accounts'); openTransferForm(null); });
  $('transfer-form').addEventListener('submit', saveTransferForm);
  $('tr-cancel').addEventListener('click', () => { state.transferEditing = null; $('transfer-form').hidden = true; });
  $('transfer-rows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tr-edit],[data-tr-del]');
    if (!b) return;
    if (b.dataset.trEdit) openTransferForm(b.dataset.trEdit);
    else deleteTransferPrompt(b.dataset.trDel);
  });
  $('holding-new').addEventListener('click', () => { state.holdingDraft.push({ account_id: state.activeAccount, asset_name: '', kind: 'saham', quantity: '', avg_buy_price: '', current_price: '', dirty: true }); renderInvestment(); });
  $('holding-rows').addEventListener('input', (e) => {
    const el = e.target.closest('[data-h-field]'); if (!el) return;
    const row = state.holdingDraft[Number(el.dataset.hIndex)]; if (!row) return;
    row[el.dataset.hField] = el.value; row.dirty = true;
    $('holding-dirty').hidden = false;
    const tr = el.closest('tr'); if (tr) tr.classList.add('dirty-row');
  });
  $('holding-rows').addEventListener('change', (e) => {
    const el = e.target.closest('[data-h-field]'); if (!el) return;
    const row = state.holdingDraft[Number(el.dataset.hIndex)]; if (!row) return;
    row[el.dataset.hField] = el.value; row.dirty = true; $('holding-dirty').hidden = false;
  });
  $('holding-rows').addEventListener('click', (e) => { const b = e.target.closest('[data-h-del]'); if (b) deleteHoldingPrompt(b.dataset.hDel, Number(b.dataset.hIndex)); });
  $('holding-save-all').addEventListener('click', saveHoldings);
  $('inv-close').addEventListener('click', () => { state.activeAccount = null; $('investment-detail').hidden = true; });
  $('inv-value-save').addEventListener('click', saveInvestmentValue);
  $('valuation-rows').addEventListener('click', (e) => { const b = e.target.closest('[data-val-del]'); if (b) deleteValuationPrompt(b.dataset.valDel); });
  $('bulk-open').addEventListener('click', () => { $('bulk-values').hidden = false; renderBulkRows(); $('bulk-values').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  $('bulk-close').addEventListener('click', () => { $('bulk-values').hidden = true; });
  $('bulk-save').addEventListener('click', saveBulkValues);
  $('bulk-rows').addEventListener('input', (e) => {
    const el = e.target.closest('[data-bulk-input]'); if (!el) return;
    const account = state.accounts.find((a) => a.id === el.dataset.bulkInput);
    const cur = account ? accountBalance(account, assetData()) : 0n;
    const stateEl = $$('[data-bulk-state]').find((x) => x.dataset.bulkState === el.dataset.bulkInput);
    if (stateEl) stateEl.textContent = el.value.trim() === '' ? '—' : (BigInt(el.value.trim()) === cur ? 'sama' : 'berubah');
  });
  $('aset-open').addEventListener('click', () => setView('accounts'));
  $('csv-accounts').addEventListener('click', () => exportAssetsCSV('accounts'));
  $('csv-holdings').addEventListener('click', () => exportAssetsCSV('holdings'));
  $('csv-transfers').addEventListener('click', () => exportAssetsCSV('transfers'));
}

/* ---------- mulai ---------- */
wire();
wireV4();
wireAssets();
resetForm();
boot();

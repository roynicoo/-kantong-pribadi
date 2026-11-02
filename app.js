import { CATEGORIES, localDate, recap, validate, escapeHTML, toCSV, backup, categoryName, budgetAmount, budgetRecap, dailyRecap, improvement, reportCSV,
  autoPost, validateEntryDate, runningBalance, monthFlow, balanceByMonth, onboardingMode, normalizeSettings, parseBackup, mergeSettings,
  openingAmount, validateSchedule, scheduleStatusText, validateMonthString,
  validateUsername, usernameFromEmail, greetingText, avatarInitials, validateAvatarPhoto, avatarDataError, AVATAR_COLORS, THEMES, PATTERNS,
  validateAccount, validateTransfer, validateHolding, valuationPlan, accountBalance, assetTotals, allocationByType, investmentProfit,
  valueHistory, defaultAccountId, latestValuation, ACCOUNT_TYPES, ACCOUNT_COLORS, HOLDING_KINDS,
  normalizeWaPhone, waPhonePretty, waLinkStatusText, waCodeExpiryText, tgLinkStatusText } from './core.js';
import {
  passwordStrength, signupErrors, signupOutcome, parseAuthHash, resendCountdown, signupNoticeText,
  CATEGORY_ICONS, CATEGORY_COLORS, CATEGORY_FALLBACK, SEED_CATEGORY_META, DEFAULT_SEED_CATEGORIES,
  sortCategories, findCategory, categoryMeta, categoryCreateError, categoryRenameError, categoryDeleteBlock, moveCategory,
  recapDayGroups, budgetRowsWithMeta, unbudgetedCategories, wibTime,
  TAXONOMY, TAXONOMY_ROWS, TX_KINDS, PAYMENT_METHODS, NEED_WANT, taxonomyNames, taxonomyGroups,
  taxonOf, kindOfCategory, groupOfCategory, groupMeta, dashboardMetrics, goalProgress, goalsOverview,
  validateGoal, GOAL_TEMPLATES, budgetGroupRows, SAVINGS_GROUP, OBLIGATION_GROUP,
  formatRupiahInput, rupiahDigits, countDigitsBefore, caretForDigits,
} from './core.js';
import { DemoStore, CloudStore } from './store.js';

/* ============================================================
   Kantong — pengendali antarmuka
   Data uang disimpan sebagai BigInt saat dihitung, dikirim sebagai
   bilangan bulat. Tidak ada angka floating point untuk nominal.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const PALETTE = ['#1c6b4b', '#b7893f', '#a8472c', '#2f6f8f', '#6b5b95', '#8a6d3b', '#4b7a5a'];
/* Seeded category and account names are stored in Indonesian because the database
   constraint (transactions.category_matches_type) and the seeded rows keep those
   literal values. Only what the user sees is translated here, and only for the
   built-in names; anything the user typed is shown exactly as typed. */
const DISPLAY_LABEL = {
  Makan: 'Food', Transport: 'Transport', Transportasi: 'Transportation', Laundry: 'Laundry',
  Kosan: 'Rent', Listrik: 'Electricity', Internet: 'Internet', Rokok: 'Cigarettes',
  Belanja: 'Shopping', Tagihan: 'Bills', Kesehatan: 'Health', Hiburan: 'Entertainment',
  Lainnya: 'Other', ETC: 'Misc', Andreas: 'Andreas', Ortu: 'Parents', UKT: 'Tuition',
  Gaji: 'Salary', Usaha: 'Business', Hadiah: 'Gift', Tunai: 'Cash',
};
const L = (name) => DISPLAY_LABEL[String(name ?? '')] ?? name;
const LH = (name) => escapeHTML(L(name));
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  planning: {categories:[],budgets:[],scenarios:[]}, planningReady:false, view:'dashboard', scenarioOpen:false, draft:null, generation:0,
  /* v4 */
  settings: null, schedules: [], postings: [], v4Ready: false, v4Dismissed: false,
  onboardingOpen: false, onboardingStep: 1, pendingOpening: null, editingSchedule: null,
  bannerDismissed: false, postErrors: [],
  accounts: [], transfers: [], holdings: [], valuations: [], activityRows: [],
  accountEditing: null, transferEditing: null, activeAccount: null, holdingDraft: [], onbAccounts: [],
  waLink: null, waCode: null, waLoading: false,
  tgLink: null, tgCode: null, tgLoading: false,
  /* v5 */
  authSettings: null, authScreen: null, signupBusy: false, resetBusy: false, pendingEmail: '',
  recovery: false, seedState: { seeded: false, supported: false }, seedBusy: false,
  catEditing: null, catIcon: CATEGORY_ICONS[0], catColor: CATEGORY_COLORS[0],
  /* v7 */
  goals: [], goalsReady: false, goalEditing: null, goalBusy: false,
  goalIcon: '🎯', goalColor: '#1c6b4b', reportTab: 'daily', taxonomyState: { seeded: false, supported: true },
  budgetDirty: new Map(), txExpanded: false,
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
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(y, mm - 1, 1));
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

/* ---------- kategori & isian (v7 definitions live near the budget block) ---------- */

/* ---------- gerbang / konfigurasi ---------- */
function showGate(message, { login = false } = {}) {
  $('print-report').innerHTML='';
  $('gate').hidden = false;
  $('workspace').hidden = true;
  $('logout').hidden = true;
  $('add-btn').hidden = true;
  $('profile-btn').hidden = true;   /* sapaan profil tidak relevan di layar masuk */
  authScreen(login ? 'login' : null);
  if (message) $('setup').textContent = message;
  else if (login) $('setup').textContent = 'Sign in with your account, or create a new one from the Sign up tab.';
  else $('setup').textContent = 'Checking configuration…';
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
    showGate('Cloud is not configured.', { login: false });
    return;
  }
  state.cfg = cfg;

  /* Tautan pemulihan Supabase: #access_token=…&type=recovery (implicit) */
  const recovery = parseAuthHash(location.hash);
  if (recovery?.type && recovery.session) {
    const store = new CloudStore(cfg);
    try { store.acceptRecoverySession(recovery.session); } catch { /* ditangani di bawah */ }
    try { await store.loadUser(); }
    catch { showGate('The recovery link is no longer valid. Request a new one via “Forgot password?”.', { login: true }); return; }
    state.store = store;
    state.mode = 'cloud';
    state.recovery = recovery.type === 'recovery';
    $('gate').hidden = false; $('workspace').hidden = true; $('logout').hidden = true; $('add-btn').hidden = true;
    history.replaceState(null, '', location.pathname + location.search);
    if (state.recovery) {
      $('setup').textContent = 'Set a new password for your account.';
      authScreen('reset');
      return;
    }
  }
  if (recovery?.error) { showGate(recovery.error, { login: true }); return; }

  /* Tautan PKCE: ?code=… */
  const code = new URLSearchParams(location.search).get('code');
  if (code) {
    try {
      const store = new CloudStore(cfg);
      const { status, payload } = await store.authRequest('/auth/v1/token?grant_type=pkce', { method: 'POST', body: JSON.stringify({ auth_code: code }) });
      if (status < 400 && payload?.access_token) {
        store.remember(payload);
        try { await store.loadUser(); } catch { showGate('The recovery link is no longer valid. Request a new one via “Forgot password?”.', { login: true }); return; }
        state.store = store; state.mode = 'cloud'; state.recovery = true;
        $('gate').hidden = false; $('workspace').hidden = true; $('logout').hidden = true; $('add-btn').hidden = true;
        history.replaceState(null, '', location.pathname);
        $('setup').textContent = 'Set a new password for your account.';
        authScreen('reset');
        return;
      }
      showGate('The recovery link is no longer valid. Request a new one via “Forgot password?”.', { login: true });
      return;
    } catch { /* lanjut ke alur biasa */ }
  }

  let status = 'error';
  try { status = await probeSchema(cfg); } catch { status = 'error'; }

  if (status === 'missing') {
    showGate('The database is not set up. Run supabase/schema.sql from the project owner\'s SQL Editor.', { login: false });
    return;
  }
  if (status === 'error') {
    showGate('The cloud cannot be checked right now. Try reloading, or use the local demo.', { login: false });
    return;
  }
  const store = new CloudStore(cfg);
  state.store = store;
  if (store.session?.access_token) {
    state.mode = 'cloud';
    try { await enterWorkspace(); } catch { showGate('Session ended. Please sign in again.', { login: true }); }
  } else {
    state.authSettings = await probeAuthSettings(cfg);
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
    notify('Welcome back.');
  } catch (err) {
    const raw = String(err?.message || '');
    const msg = /invalid login credentials|invalid_grant/i.test(raw)
      ? 'Email or password does not match. Check again, or use “Forgot password?”.'
      : /email not confirmed/i.test(raw)
        ? 'Email not verified yet. Open the verification link in your inbox, then sign in.'
        : raw || 'Sign-in failed.';
    loginError(msg);
    notify(msg, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in to Kantong';
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
  showGate('Please sign in again to continue.', { login: true });
  notify('You are signed out.');
}

/* ---------- ruang kerja ---------- */
async function enterWorkspace() {
  if (!state.store) state.store = new DemoStore();
  $('gate').hidden = true;
  $('workspace').hidden = false;
  $('logout').hidden = false;
  $('add-btn').hidden = false;
  $('profile-btn').hidden = false;
  $('identity').textContent = state.mode === 'cloud'
    ? (state.store.session?.user?.email || 'Sign in')
    : 'Local demo';
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
  if($('csv-goals'))$('csv-goals').disabled=!can;
  for(const id of ['goal-new','goal-save'])if($(id))$(id).disabled=!can||!state.goalsReady;
  for (const el of $$('#recurring-panel input,#recurring-panel button,#accounts-panel input,#accounts-panel button')) el.disabled = !can || !state.v4Ready;
  /* Hanya tombol yang dimatikan saat menyimpan. Menonaktifkan isian membuat
     ketikan pengguna bisa mendarat di kolom lain (fokus berpindah). */
  for (const el of $$('#onboarding button')) el.disabled = state.busy;
  for (const id of ['save', 'print', 'csv', 'import']) {
    const el = $(id);
    if (el) el.disabled = !can;
  }
  paintBudgetDirty();
  refreshMoneyValidity();
}

async function load() {
  if(state.busy||state.loading)return;state.loading=true;state.loaded=false;$('print-report').innerHTML='';
  setSync(state.mode === 'cloud' ? 'Supabase cloud · loading…' : 'Local demo · loading…', 'warn');
  setButtons(false);
  try {
    const all = await state.store.all();
    state.all = Array.isArray(all) ? all : [];
    await loadPlanning();
    await loadV4();
    await loadV7();
    if (state.v4Ready) await runAutoPost();
    state.loaded = true;
    fillCategorySelect();fillFilterCategories();
    setSync(state.mode === 'cloud'
      ? `Supabase cloud · loaded ${state.all.length} transactions`
      : 'Local demo · not synced', state.mode === 'cloud' ? '' : 'demo');
    state.loading=false;render();
    setButtons(true);
    maybeOpenOnboarding();
  } catch (err) {
    state.loading=false;state.loaded = false;
    setSync('Data did not load · reports and changes are disabled.', 'err');
    setButtons(false);
    $('rows').innerHTML = '';
    $('count').textContent = '0';
    $('empty').classList.add('show');
    notify(err.message || 'Could not load data.', true);
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
  renderTop(r);
  renderTable(r);
  renderPlanning();
  renderRecap();
  renderGoals();
  renderPrint();
  paintMoneyInputs();
  $('period-label').textContent = 'Period ' + monthLabel(state.month);
}
function recapSafe(month) {
  try { return recap(state.all, month); }
  catch { return { rows: [], income: 0n, expense: 0n, balance: 0n, categories: {} }; }
}

function renderSummary(r, prev) {
  const m = dashboardData();
  $('income').textContent = rp(m.income);
  $('expense').textContent = rp(m.expense);
  $('m-savings').textContent = rp(m.savings);
  $('balance').textContent = rp(m.remaining);
  $('m-rate').textContent = m.savingRate === null ? '—' : `${m.savingRate.toFixed(1)}%`;

  const dEl = $('delta-out');
  if (m.deltaPct === null) {
    dEl.hidden = true;
  } else {
    const up = m.deltaPct > 0;
    dEl.hidden = false;
    dEl.textContent = `${up ? '▲' : '▼'} ${Math.abs(m.deltaPct).toFixed(Math.abs(m.deltaPct) % 1 === 0 ? 0 : 1)}% expense vs ${MONTH_SHORT[Number(shiftMonth(state.month, -1).split('-')[1]) - 1]}`;
    dEl.className = 'delta ' + (up ? 'up' : 'down');
  }

  $('daily-avg').textContent = m.expense > 0n ? rp(m.avgDaily) : 'Rp 0';

  const nIn = r.rows.filter((t) => t.type === 'income').length;
  const nOut = r.rows.filter((t) => t.type === 'expense').length;
  const nSave = r.rows.filter((t) => t.type === 'savings').length;
  const nOwe = r.rows.filter((t) => t.type === 'obligation').length;
  $('income-note').textContent = nIn ? `${nIn} income entries` : 'No income yet';
  $('expense-note').textContent = nOut ? `${nOut} expense entries` : 'No expenses yet';
  $('m-savings-note').textContent = nSave ? `${nSave} savings entries` : m.obligation > 0n ? `Obligations ${rp(m.obligation)}` : 'Nothing set aside yet';
  $('m-rate-note').textContent = m.savingRate === null ? 'Needs income to compute' : `Obligations ${rp(m.obligation)}`;

  renderInsights(m);
  renderGroupDonut(m);
  renderGoalMini(m);
}

function dashboardData() {
  return dashboardMetrics({
    all: state.all, month: state.month,
    budgets: state.planning.budgets, categories: state.planning.categories,
    goals: state.goals, today: localDate(),
  });
}

/* Expenses by GROUP on the dashboard, not by individual subcategory. */
function renderGroupDonut(m) {
  const entries = m.expenseByGroup;
  const total = m.expense;
  if (!total || !entries.length) {
    $('categories').innerHTML = `<svg viewBox="0 0 200 200" role="presentation" aria-hidden="true"><circle cx="100" cy="100" r="72" fill="none" stroke="var(--line)" stroke-width="22"/><text x="100" y="96" text-anchor="middle" font-size="15" fill="var(--muted)">No</text><text x="100" y="116" text-anchor="middle" font-size="12" fill="var(--muted)">expenses</text></svg>`;
    $('legend').innerHTML = '<li><span class="swatch" style="background:var(--line)"></span><span class="name">No expenses yet</span><span class="val">—</span></li>';
    return;
  }
  let offset = 0;
  let svg = '<svg viewBox="0 0 200 200" role="presentation" aria-hidden="true"><g transform="rotate(-90 100 100)">';
  entries.forEach((e) => {
    const len = (Number(e.total) / Number(total)) * C;
    svg += `<circle class="arc" cx="100" cy="100" r="72" stroke="${e.color}" stroke-dasharray="${(Math.max(0, len - 1.5)).toFixed(2)} ${(C - len + 1.5).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${escapeHTML(e.group)} — ${rp(e.total)}</title></circle>`;
    offset += len;
  });
  svg += '</g></svg>';
  svg += `<div class="donut-center"><b>${rpShort(Number(total))}</b><span>total out</span></div>`;
  $('categories').innerHTML = `<div class="donut-stack">${svg}</div>`;
  $('legend').innerHTML = entries.map((e) => `
  <li><span class="swatch" style="background:${e.color}"></span>
  <span class="name">${escapeHTML(e.group)}</span>
  <span class="val">${e.share.toFixed(e.share % 1 === 0 ? 0 : 1)}% · ${rp(e.total)}</span></li>`).join('');
}

function renderInsights(m) {
  const rows = [];
  if (m.topGroup) rows.push(['Top spending group', `${m.topGroup.group} · ${m.topGroup.share.toFixed(0)}% · ${rp(m.topGroup.total)}`]);
  if (m.biggestExpense) rows.push(['Biggest single expense', `${LH(m.biggestExpense.category)} · ${rp(m.biggestExpense.amount)} · ${dayLabel(m.biggestExpense.date)}`]);
  rows.push(['Average daily spend', `${rp(m.avgDaily)} · ${m.elapsedDays} day${m.elapsedDays === 1 ? '' : 's'}`]);
  rows.push(['Vs last month', m.deltaPct === null ? 'No expense last month to compare' : `${m.deltaPct > 0 ? '+' : ''}${m.deltaPct.toFixed(1)}% (${rp(m.prevExpense)} → ${rp(m.expense)})`]);
  rows.push(['Income kept as savings', m.savingRate === null ? '—' : `${m.savingRate.toFixed(1)}%`]);
  if (m.obligation > 0n) rows.push(['Obligations this month', rp(m.obligation)]);
  $('insight-list').innerHTML = rows.map(([k, v]) => `<li><span class="insight-k">${escapeHTML(k)}</span><span class="insight-v">${v}</span></li>`).join('');

  const budgeted = m.budgetByGroup;
  $('group-budget-list').innerHTML = budgeted.length
    ? `<table class="group-budget-table"><thead><tr><th>Group budget</th><th class="number">Budget</th><th class="number">Actual</th><th class="number">Gap</th></tr></thead><tbody>${budgeted.map((g) => {
      const pct = g.budget > 0n ? Math.min(100, Number((g.actual * 100n) / g.budget)) : 0;
      return `<tr><th><span class="swatch" style="background:${groupMeta(g.group).color}"></span> ${escapeHTML(g.group)}<span class="bar"><i style="width:${pct}%"></i></span></th><td class="number">${rp(g.budget)}</td><td class="number">${rp(g.actual)}</td><td class="number ${g.gap < 0n ? 'negative' : ''}">${rp(g.gap)}</td></tr>`;
    }).join('')}</tbody></table>`
    : '<p class="note">No group budget yet this month. Set budgets per category or per group in the Budget menu.</p>';
}

function renderGoalMini(m) {
  const goals = m.goals.rows.slice(0, 3);
  $('dash-goal-list').innerHTML = goals.length
    ? goals.map((g) => `<li><span class="goal-dot" style="background:${g.goal.color}">${escapeHTML(g.goal.icon)}</span><span class="goal-name">${escapeHTML(g.goal.name)}<small>${rp(g.saved)} of ${rp(g.target)}</small><span class="bar"><i style="width:${g.cappedPct}%"></i></span></span><span class="goal-pct">${g.pct.toFixed(0)}%</span></li>`).join('')
      + (m.goals.count > 3 ? `<li class="goal-more">+${m.goals.count - 3} more goals</li>` : '')
    : '<li class="none">No savings goal yet. Open Savings Goals to start one.</li>';
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
    svg += `<g><title>${label} ${d.m.slice(0, 4)} — in ${rp(d.income)}, out ${rp(d.expense)}</title>`;
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
    $('categories').innerHTML = `<svg viewBox="0 0 200 200" role="presentation" aria-hidden="true"><circle cx="100" cy="100" r="72" fill="none" stroke="var(--line)" stroke-width="22"/><text x="100" y="96" text-anchor="middle" font-size="15" fill="var(--muted)">No</text><text x="100" y="116" text-anchor="middle" font-size="12" fill="var(--muted)">expenses</text></svg>`;
    $('legend').innerHTML = '<li><span class="swatch" style="background:var(--line)"></span><span class="name">No expenses yet</span><span class="val">—</span></li>';
    return;
  }
  let offset = 0;
  let svg = '<svg viewBox="0 0 200 200" role="presentation" aria-hidden="true"><g transform="rotate(-90 100 100)">';
  entries.forEach(([name, v], i) => {
    const len = (Number(v) / Number(total)) * C;
    const color = PALETTE[i % PALETTE.length];
    svg += `<circle class="arc" cx="100" cy="100" r="72" stroke="${color}" stroke-dasharray="${(Math.max(0, len - 1.5)).toFixed(2)} ${(C - len + 1.5).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${LH(name)} — ${rp(v)}</title></circle>`;
    offset += len;
  });
  svg += '</g></svg>';
  /* label tengah di luar grup yang diputar agar teks tetap tegak */
  svg += `<div class="donut-center"><b>${rpShort(Number(total))}</b><span>total out</span></div>`;
  $('categories').innerHTML = `<div class="donut-stack">${svg}</div>`;
  $('legend').innerHTML = entries.map(([name, v], i) => `
  <li><span class="swatch" style="background:${PALETTE[i % PALETTE.length]}"></span>
  <span class="name">${LH(name)}</span>
  <span class="val">${Math.round((Number(v) / Number(total)) * 100)}% · ${rp(v)}</span></li>`).join('');
}

function renderTop(r) {
  const top = r.rows.filter((t) => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 3);
  $('top-list').innerHTML = top.length
    ? top.map((t, i) => `<li><span class="rank">${i + 1}</span><span class="who">${LH(t.category)}<small>${dayLabel(t.date)}${t.notes ? ' · ' + escapeHTML(t.notes) : ''}</small></span><span class="val">${rp(t.amount)}</span></li>`).join('')
    : '<li class="none">No expenses in this period.</li>';
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
  const LIMIT = 7;
  const shown = state.txExpanded ? rows : rows.slice(0, LIMIT);
  const postedIds = new Set(state.postings.map((p) => p.transaction_id).filter(Boolean));
  $('count').textContent = String(r.rows.length);
  $('filter-count').textContent = rows.length === r.rows.length
    ? (r.rows.length ? `${r.rows.length} transactions` : '')
    : `${rows.length} from ${r.rows.length}`;
  $('empty').classList.toggle('show', rows.length === 0);
  const more = $('tx-more');
  if (more) {
    more.hidden = rows.length <= LIMIT;
    more.textContent = state.txExpanded ? 'Show less' : `View all ${rows.length} transactions`;
    more.setAttribute('aria-expanded', String(state.txExpanded));
  }

  $('rows').innerHTML = shown.map((t) => {
    const income = t.type === 'income';
    const sign = income ? '+' : t.type === 'savings' ? '→' : '−';
    const note = t.notes ? escapeHTML(t.notes) : '(no note)';
    const extra = [t.payment_method, t.need_want].filter(Boolean).join(' · ');
    const stamp = t.updated_at || t.created_at;
    const time = stamp ? wibTime(stamp) : '';
    const timeTag = time
      ? `<span class="t-time">· ${time}</span>`
      : '<span class="t-time" title="No record time stored — this row was saved before v7">· —</span>';
    return `<tr>
  <td><span class="t-date">${dayLabel(t.date)} ${timeTag}</span><span class="t-note${t.notes ? '' : ' muted'}">${note}</span>${extra ? `<span class="t-meta">${escapeHTML(extra)}</span>` : ''}</td>
  <td><span class="chip ${t.type}">${LH(t.category)}</span>${postedIds.has(t.id) ? '<span class="chip auto" title="Created automatically from a recurring income schedule">auto</span>' : ''}</td>
  <td class="number"><span class="amount ${t.type}">${sign}${rp(t.amount)}</span></td>
  <td class="actions"><div class="row-actions">
  <button class="icon-btn" type="button" data-edit="${escapeHTML(t.id)}" aria-label="Edit transaction" title="Edit transaction"><svg class="ic" aria-hidden="true"><use href="#ic-pencil"></use></svg></button>
  <button class="icon-btn" type="button" data-del="${escapeHTML(t.id)}" aria-label="Delete transaction" title="Delete transaction"><svg class="ic" aria-hidden="true"><use href="#ic-trash"></use></svg></button>
  </div></td>
  </tr>`;
  }).join('');
}

/* ---------- formulir ---------- */
function setFormMode(editing) {
  state.editing = editing;
  $('form-title').textContent = editing ? 'Edit transaction' : 'Record a transaction';
  $('save').textContent = editing ? 'Save changes' : 'Save transaction';
  $('cancel').hidden = !editing;
}

function resetForm() {
  setFormMode(null);
  $('amount').value = '';
  $('notes').value = '';
  $('date').value = localDate();
  $('date').max = localDate();
  document.querySelector('input[name="type"][value="expense"]').checked = true;
  fillPaymentSelects();
  $('payment').value = '';
  $('needwant').value = '';
  fillCategorySelect();
  $('category').value = entryCategories('expense')[0] || '';
  fillGoalOptions();
  $('entry-goal').value = '';
  toggleGoalField();
}

function fillPaymentSelects() {
  if (!$('payment').options.length) {
    $('payment').innerHTML = '<option value="">Not recorded</option>' + PAYMENT_METHODS.map((m) => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join('');
  }
  if (!$('needwant').options.length) {
    $('needwant').innerHTML = '<option value="">Not recorded</option><option value="need">Need</option><option value="want">Want</option>';
  }
}

function startEdit(id) {
  if(state.busy||state.loading||!state.loaded)return;
  const t = state.all.find((x) => x.id === id);
  if (!t) return;
  openSheet();setFormMode(id);
  document.querySelector(`input[name="type"][value="${t.type}"]`).checked = true;
  fillCategorySelect();
  $('amount').value = formatRupiahInput(String(t.amount));
  $('date').value = t.date;
  $('category').value = t.category;
  $('notes').value = t.notes || '';
  fillPaymentSelects();
  $('payment').value = t.payment_method || '';
  $('needwant').value = t.need_want || '';
  fillGoalOptions();
  $('entry-goal').value = t.goal_id || '';
  toggleGoalField();
  if (state.v4Ready && t.account_id) { fillAccountOptions(); $('account').value = t.account_id; }
  setFormMode(id);
  $('entry-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('amount').focus({ preventScroll: true });
}

async function submitEntry(ev) {
  ev.preventDefault();
  if (state.busy) return;
  if (!state.loaded) { notify('Data did not load · reports and changes are disabled.', true); return; }

  let payload;
  try {
    payload = validate({
      type: document.querySelector('input[name="type"]:checked')?.value,
      category: $('category').value,
      amount: rupiahDigits($('amount').value),
      date: $('date').value,
      notes: $('notes').value,
      account_id: state.v4Ready ? ($('account').value || null) : null,
      payment_method: $('payment')?.value || null,
      need_want: $('needwant')?.value || null,
      goal_id: document.querySelector('input[name="type"]:checked')?.value === 'savings' ? ($('entry-goal')?.value || null) : null,
    });
    validateEntryDate(payload.date, localDate());
  } catch (err) {
    notify(err.message, true);
    if (/date/i.test(err.message)) $('date').focus();
    else $('amount').focus();
    return;
  }

  state.busy = true;
  setButtons(false);
  $('save').textContent = 'Saving…';
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
    notify(jumped ? `Transaction saved · jumping to ${monthLabel(savedMonth)}.` : 'Transaction saved.');
  } catch (err) {
    notify(err.message || 'Could not save.', true);
    $('save').textContent = state.editing ? 'Save changes' : 'Save transaction';
  } finally {
    state.busy = false;
    setButtons(true);
  }
}

async function deleteEntry(id) {
  if (!state.loaded || state.busy) return;
  const posted = state.postings.find((p) => p.transaction_id === id);
  const question = posted
    ? 'Delete this automatic income? That month will not be recorded again automatically (you can add it by hand).'
    : 'Delete this transaction? This cannot be undone.';
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
    notify(posted ? 'Transaction deleted. This month will not be re-posted automatically.' : 'Transaction deleted.');
  } catch (err) {
    if (posted) { try { await state.store.restorePosting(posted.schedule_id, posted.month, id); state.postings = await state.store.postings(); } catch { /* tampilkan galat asli */ } }
    render();
    notify(err.message || 'Could not delete.', true);
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

const wibStamp = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const w = new Date(d.getTime() + 7 * 3600 * 1000);
  return w.toISOString().slice(0, 16).replace('T', ' ');
};

function exportCSV() {
  const r = currentRecap();
  if (!r.rows.length) { notify('No transactions in this period.', true); return; }
  const header = ['date', 'type', 'category', 'amount_idr', 'note', 'recorded_at_wib', 'edited_at_wib'];
  const rows = r.rows.map((t) => [
    t.date, t.type, t.category, String(t.amount), t.notes || '',
    wibStamp(t.created_at), wibStamp(t.updated_at),
  ]);
  download(`kantong-${state.month}.csv`, reportCSV(header, rows), 'text/csv;charset=utf-8');
  notify('This period\'s CSV downloaded.');
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
      goals: state.goals.map(({ id, name, target_amount, saved_amount, deadline, account_id, category, color, icon, archived_at }) => ({ id, name, target_amount, saved_amount, deadline, account_id, category, color, icon, archived_at })),
    };
  }
  download(`kantong-backup-${localDate()}.json`, backup(state.all,state.planning,extras), 'application/json');
  notify('Full backup downloaded.');
}
function printReport() {
  if (!state.loaded) return;
  renderPrint();
  $('period-label').textContent = 'Period ' + monthLabel(state.month);
  window.print();
}

async function importBackup(file) {
  if (!file) return;
  if (!state.loaded) { notify('Data did not load · reports and changes are disabled.', true); return; }
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { notify('The backup file could not be read. Make sure it is Kantong JSON.', true); return; }
  let parsed;
  try { parsed = parseBackup(data); }
  catch (e) { notify(e.message, true); return; }
  if (state.busy) return;
  const meta = { categories: parsed.categories, budgets: parsed.budgets, scenarios: parsed.scenarios };
  if (!Object.values(meta).every(Array.isArray)) { notify('Invalid backup metadata.', true); return; }
  if (Object.values(meta).some((a) => a.length) && !state.planningReady) { notify('Load planning (or migrate) first so the full backup can be restored.', true); return; }
  const hasV4 = !!(parsed.accounts.length || parsed.holdings.length || parsed.valuations.length || parsed.transfers.length || parsed.schedules.length || parsed.settings);
  if (hasV4 && !state.v4Ready) { notify('The backup contains accounts/schedules/settings, but migration-v4.sql has not run. Run the migration first, or restore transactions only.', true); return; }
  if (!confirm(`Import preview: ${parsed.transactions.length} transactions, ${meta.categories.length} categories, ${meta.budgets.length} budgets, ${meta.scenarios.length} simulations, ${parsed.schedules.length} recurring schedules, ${parsed.accounts.length} accounts, ${parsed.holdings.length} assets, ${parsed.transfers.length} transfers. Duplicates are skipped; nothing is deleted or overwritten. Older transactions without an account go to the default cash account. Continue?`)) return;
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
    let goalsAdded = 0, goalsSkipped = 0;
    if (state.goalsReady) {
      for (const item of parsed.goals) {
        if (!item || !item.name) { goalsSkipped++; continue; }
        if (state.goals.some((g) => String(g.name).toLowerCase() === String(item.name).toLowerCase())) { goalsSkipped++; continue; }
        try {
          await state.store.saveGoal({ ...item, account_id: null }, null);
          goalsAdded++;
        } catch { failed++; }
      }
      if (goalsAdded) state.goals = await state.store.goals();
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
        try { state.settings = await state.store.saveSettings(merged.settings); applyLook(state.settings.theme, state.settings.pattern); renderProfileChrome(); settingsNote = ', profile and opening-balance settings restored'; }
        catch { failed++; }
      } else settingsNote = ', account settings were not overwritten';
    }
    if (state.planningReady) await loadPlanning();
    if (state.v4Ready) { await refreshAssets(); await runAutoPost(); }
    fillCategorySelect(); fillFilterCategories(); render();
    notify(`${added} transactions restored${skipped ? `, ${skipped} duplikat dilewati` : ''}${failed ? `, ${failed} failed` : ''}; ${metadataAdded} metadata ditambah, ${metadataSkipped} duplikat; ${accountsAdded} accounts, ${holdingsAdded} aset, ${transfersAdded} pindah dana, ${valuationsAdded} value notes added${settingsNote}.`, failed > 0);
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
    notify('Demo mode: data is stored only in this browser.');
  });

  $('entry').addEventListener('submit', submitEntry);
  $('cancel').addEventListener('click', () => { resetForm(); closeSheet(); notify('Change discarded.'); });

  $('rows').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-edit],button[data-del]');
    if (!b) return;
    if (b.dataset.edit) startEdit(b.dataset.edit);
    else deleteEntry(b.dataset.del);
  });

  $('month').addEventListener('input', () => {
    if ($('month').value) { state.month = $('month').value; state.draft=null; state.budgetDirty.clear(); render(); }
  });
  $('prev-month').addEventListener('click', () => {
    state.month = shiftMonth(state.month, -1); $('month').value = state.month; state.draft=null; state.budgetDirty.clear(); render();
  });
  $('next-month').addEventListener('click', () => {
    state.month = shiftMonth(state.month, 1); $('month').value = state.month; state.draft=null; state.budgetDirty.clear(); render();
  });
  $('this-month').addEventListener('click', () => {
    state.month = localDate().slice(0, 7); $('month').value = state.month; state.draft=null; state.budgetDirty.clear(); render();
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
      else if (state.editing) { resetForm(); notify('Change discarded.'); }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/' && !$('workspace').hidden) { e.preventDefault(); $('search').focus(); }
    if (e.key.toLowerCase() === 'n' && !$('workspace').hidden) { e.preventDefault(); openSheet(); $('amount').focus(); }
  });
}

/* ---------- feuille de budget: shared cloud metadata, never a local fallback ---------- */
function expenseNames(){
 const rows=state.planning.categories.filter(c=>(c.kind||'expense')==='expense');
 const list=[...rows.map(c=>c.name),...state.all.filter(t=>t.type==='expense').map(t=>t.category),...state.planning.budgets.filter(b=>(b.scope||'category')==='category').map(b=>b.category)];
 if(!list.length)return taxonomyNames('expense');
 return [...new Set(list)];
}
function entryCategories(type){
 if(type==='income'){
  const rows=state.planning.categories.filter(c=>c.kind==='income'&&!c.archived_at).map(c=>c.name);
  return [...new Set([...TAXONOMY.income,...CATEGORIES.income,...rows,...state.all.filter(t=>t.type==='income').map(t=>t.category)])];
 }
 const rows=state.planning.categories.filter(c=>(c.kind||'expense')===type);
 const hidden=new Set(rows.filter(r=>r.archived_at||r.enabled===false).map(r=>r.name));
 const editing=state.all.find(t=>t.id===state.editing)?.category;
 const hist=state.all.filter(t=>t.type===type).map(t=>t.category);
 let base=[...rows.filter(r=>!hidden.has(r.name)).map(r=>r.name),...hist.filter(n=>!hidden.has(n)||n===editing)];
 if(type==='savings')base.push(...state.goals.filter(g=>!g.archived_at&&g.category).map(g=>g.category));
 if(!base.length)base=[...taxonomyNames(type)];
 const list=[...new Set(base.filter(Boolean))];
 return list.some(n=>n===editing)?list:[...new Set([...list,...(editing?[editing]:[])])];
}
function categoryGroupOf(name,type){
 const row=findCategory(state.planning.categories,name);
 return taxonOf(name)?.group_name||row?.group_name||(type==='income'?'Income':type==='savings'?SAVINGS_GROUP:type==='obligation'?OBLIGATION_GROUP:'Other');
}
function budgetRows(){return budgetRecap(state.all,state.month,state.planning.budgets.filter(b=>(b.scope||'category')==='category'),expenseNames());}
function categoryCatalog(){
 const explicit=sortCategories(state.planning.categories.filter(c=>(c.kind||'expense')==='expense'));
 const names=[...explicit.map(r=>r.name),...expenseNames().filter(n=>!findCategory(explicit,n))];
 return names.map(n=>{
  const row=findCategory(state.planning.categories,n);
  const seed=SEED_CATEGORY_META[n]||{};
  return {name:n, enabled:row?row.enabled!==false:true, icon:row?.icon||seed.icon||'', color:row?.color||seed.color||'', sort_order:row?.sort_order??null, archived_at:row?.archived_at||null, is_default:row?.is_default===true, group_name:row?.group_name||taxonOf(n)?.group_name||'Other'};
 });
}
function fillCategorySelect(){
 const sel=$('category');
 if(!sel)return;
 const type=document.querySelector('input[name="type"]:checked')?.value||'expense';
 const keep=sel.value;
 const names=entryCategories(type);
 const order=[...taxonomyGroups(),'Other'];
 const buckets=new Map();
 for(const n of names){const g=categoryGroupOf(n,type);if(!buckets.has(g))buckets.set(g,[]);buckets.get(g).push(n);}
 const groups=[...buckets.keys()].sort((a,b)=>{const ia=order.indexOf(a),ib=order.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b,'en');});
 const opts=groups.map(g=>`<optgroup label="${escapeHTML(g)}">${buckets.get(g).map(n=>`<option value="${escapeHTML(n)}">${LH(n)}</option>`).join('')}</optgroup>`).join('');
 sel.innerHTML=opts||'<option value="">—</option>';
 if(names.includes(keep))sel.value=keep;
 toggleGoalField();
}
function toggleGoalField(){
 const type=document.querySelector('input[name="type"]:checked')?.value;
 const on=type==='savings';
 const field=$('goal-field');
 if(field)field.hidden=!on;
 if(on)fillGoalOptions();
}
function fillGoalOptions(){
 const sel=$('entry-goal');
 if(!sel)return;
 const keep=sel.value;
 sel.innerHTML='<option value="">No goal</option>'+state.goals.filter(g=>!g.archived_at).map(g=>`<option value="${escapeHTML(g.id)}">${escapeHTML(g.name)}</option>`).join('');
 if([...sel.options].some(o=>o.value===keep))sel.value=keep;
}
function fillFilterCategories() {
 const all=[...new Set([...expenseNames(),...CATEGORIES.income,...TAXONOMY.income,...state.all.map(t=>t.category)])].sort((a,b)=>a.localeCompare(b,'en'));
 $('fcat').innerHTML='<option value="">All categories</option>'+all.map(c=>`<option value="${escapeHTML(c)}">${LH(c)}</option>`).join('');
}
async function loadPlanning(){
 state.planningReady=false;state.planning={categories:[],budgets:[],scenarios:[]};
 try{const p=await state.store.planning();if(!p.categories.every(c=>typeof c.name==='string'&&typeof c.enabled==='boolean')||!p.budgets.every(b=>typeof b.month==='string'&&b.amount!==undefined)||!p.scenarios.every(s=>s.proposed&&typeof s.income==='string'))throw Error('Unexpected table format.');state.planning=p;state.planningReady=true;$('planning-notice').hidden=true;}
 catch(e){$('planning-notice').hidden=false;$('planning-notice').textContent='Cloud planning is not available yet. Run only migration-v3.sql once (never schema.sql again), then Reload. Older transactions keep working. If you already migrated, check network and permissions. '+e.message;}
}
/* Di 390px tab bisa tergulir keluar layar; geser tab aktif ke tengah tanpa
   menggeser halaman. Dipakai saat berganti tab dan saat ukuran layar berubah. */
function centerActiveTab(){
 const bar=document.querySelector('.view-tabs');
 const active=bar?.querySelector('[aria-pressed="true"]');
 if(!bar||!active)return;
 bar.scrollTo({left:Math.max(0,active.offsetLeft-(bar.clientWidth-active.offsetWidth)/2),behavior:'smooth'});
}
window.addEventListener('resize',()=>{ centerActiveTab(); });
function setView(view){
 state.view=view;
 $$('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
 centerActiveTab();const w=$('workspace');if(w)w.dataset.view=view;
 const show=(id,on)=>{const el=$(id);if(el)el.hidden=!on;};
 show('dash-panel',view==='dashboard');
 show('tx-panel',view==='transactions');
 show('budget-panel',view==='budget');
 show('savings-panel',view==='savings');
 show('reports-panel',view==='reports');
 /* Reports hosts the three detailed ledgers as sub-views, so the app keeps
    exactly five main menus without losing daily recap, recurring or accounts. */
 const sub=view==='reports'?state.reportTab:null;
 show('daily-panel',sub==='daily');
 show('recurring-panel',sub==='recurring');
 show('accounts-panel',sub==='accounts');
 $$('#report-subnav [data-report]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.report===state.reportTab)));
}
function dailyHTML(d,cats=d.categories,print=false){const sum=day=>cats.reduce((s,c)=>s+day.categories[c],0n);return `<thead><tr><th>Date</th>${cats.map(c=>`<th>${escapeHTML(c)}</th>`).join('')}<th>${print?'Column subtotal':'Daily total'}</th>${print?'<th>Daily total (all)</th>':''}</tr></thead><tbody>${d.days.map(day=>`<tr><th>${day.date}</th>${cats.map(c=>`<td>${rp(day.categories[c])}</td>`).join('')}<td>${rp(sum(day))}</td>${print?`<td>${rp(day.total)}</td>`:''}</tr>`).join('')}</tbody><tfoot><tr><th>Month total</th>${cats.map(c=>`<td>${rp(d.totals[c])}</td>`).join('')}<td>${rp(cats.reduce((s,c)=>s+d.totals[c],0n))}</td>${print?`<td>${rp(d.total)}</td>`:''}</tr></tfoot>`;}
function renderPlanning(){
 const rows=budgetRowsWithMeta(state.all,state.month,state.planning.budgets,categoryCatalog());$('budget-rows').innerHTML=rows.map(r=>`<tr><th><span class="recap-icon" aria-hidden="true">${escapeHTML(r.icon)}</span> ${LH(r.category)}${r.archived?' <small>(archived)</small>':(findCategory(state.planning.categories,r.category)?.enabled===false?' <small>(inactive)</small>':'')}</th><td><input aria-label="Budget ${LH(r.category)}" data-budget="${escapeHTML(r.category)}" data-budget-scope="category" data-money inputmode="numeric" type="text" placeholder="Not budgeted" value="${r.budget===null?'':formatRupiahInput(String(r.budget))}"></td><td>${rp(r.actual)}</td><td class="${r.gap!==null&&r.gap<0n?'negative':''}">${r.gap===null?'—':rp(r.gap)}</td></tr>`).join('');
 const set=rows.filter(r=>r.budget!==null);const b=set.reduce((s,r)=>s+r.budget,0n),a=set.reduce((s,r)=>s+r.actual,0n);$('budget-total').innerHTML=`<tr><th>Subtotal ${set.length} budgeted categories</th><td>${rp(b)}</td><td>${rp(a)}</td><td>${rp(b-a)}</td><td></td></tr><tr><th>Actual, all categories</th><td colspan="4">${rp(currentRecap().expense)} · categories without a budget are not treated as a zero target</td></tr>`;
 renderCategories();
 renderGroupBudgets();
 $('improvement-warning').hidden=currentRecap().balance>=0n;
 $('improvement-alert').hidden=currentRecap().balance>=0n; $('improvement-alert').disabled=!state.planningReady||state.busy;
 $('improvement-start').textContent=state.planning.scenarios.some(s=>s.month===state.month)?'Open improvement':'Start an improvement';
 $('daily-table').innerHTML=dailyHTML(dailyRecap(state.all,state.month,expenseNames()));
 if(state.scenarioOpen)renderScenario();else $('scenario-panel').hidden=true;
 setView(state.view);setButtons(state.loaded);paintBudgetDirty();
}
function renderScenario(){
 $('scenario-panel').hidden=false;
 if(!state.draft||state.draft.month!==state.month){const saved=state.planning.scenarios.find(s=>s.month===state.month);state.draft={month:state.month,income:saved?.income??currentRecap().income.toString(),proposed:{...(saved?.proposed||{})}};}
 const d=state.draft;const s=improvement(budgetRows(),d.income,d.proposed);$('scenario-income').value=formatRupiahInput(d.income);
 $('scenario-rows').innerHTML=s.rows.map(r=>`<tr><th>${LH(r.category)}</th><td>${r.budget===null?'—':rp(r.budget)}</td><td>${rp(r.actual)}</td><td>${rp(r.baseline)} · ${r.source==='budget'?'budget':'actual (no budget)'}</td><td><input aria-label="Proposed ${LH(r.category)}" type="text" inputmode="numeric" data-money data-proposal="${escapeHTML(r.category)}" value="${formatRupiahInput(String(r.proposal))}"></td><td data-reduction="${escapeHTML(r.category)}">${rp(r.reduction)}</td></tr>`).join('');
 for(const r of s.rows)d.proposed[r.category]=r.proposal.toString();updateScenarioTotals();
}
function updateScenarioTotals(){try{const s=improvement(budgetRows(),state.draft.income,state.draft.proposed);$('scenario-totals').textContent=`Assumed income ${rp(s.income)} · Total baseline ${rp(s.baseline)} · Total proposed ${rp(s.total)} · Planned reduction ${rp(s.reduction)} · Projected remainder ${rp(s.remaining)}. Not actual savings.`;s.rows.forEach(r=>{const el=$$('[data-reduction]').find(e=>e.dataset.reduction===r.category);if(el)el.textContent=rp(r.reduction);});$('scenario-state').textContent='Simulation preview; tap Save to sync. Not applied to the active budget.';}catch(e){$('scenario-totals').textContent=e.message;}}
async function planningAction(action,message){
 if(!state.loaded||!state.planningReady||state.busy)return;state.busy=true;setButtons(false);const store=state.store,gen=state.generation;
 try{await action(store);if(store!==state.store||gen!==state.generation)return;await loadPlanning();if(!state.planningReady)throw Error('The change could not be reloaded. Check before retrying.');fillCategorySelect();fillFilterCategories();render();notify(message);}
 catch(e){notify(e.message,true);}finally{state.busy=false;setButtons(state.loaded);}
}
function scenarioSaved(){const saved=state.planning.scenarios.find(s=>s.month===state.month);return saved?improvement(budgetRows(),saved.income,saved.proposed):null;}
function exportPlanning(kind){
 if(!state.loaded)return;let headers,rows;
 if(kind==='budget'){headers=['month','category','icon','color','budget_idr_blank_no_target','actual_idr','gap_budget_minus_actual_idr','scope'];rows=budgetRowsWithMeta(state.all,state.month,state.planning.budgets,categoryCatalog()).map(r=>[state.month,r.category,r.icon,r.color,r.budget,r.actual,r.gap,'category']);rows.push(...budgetGroupRows(state.all,state.month,state.planning.budgets).filter(g=>g.budget!==null).map(g=>[state.month,g.group,groupMeta(g.group).icon,groupMeta(g.group).color,g.budget,g.actual,g.gap,'group']));}
 if(kind==='daily'){const d=dailyRecap(state.all,state.month,expenseNames());headers=['date',...d.categories,'total_expense_idr'];rows=d.days.map(r=>[r.date,...d.categories.map(c=>r.categories[c]),r.total]);rows.push(['MONTH TOTAL',...d.categories.map(c=>d.totals[c]),d.total]);}
 if(kind==='scenario'){const s=scenarioSaved();if(!s){notify('No saved simulation for this month yet.',true);return;}headers=['month','scope','category','baseline_source','baseline_idr','actual_idr','proposed_idr','planned_reduction_idr','assumed_income_idr','total_proposed_idr','projected_remainder_idr'];rows=s.rows.map(r=>[state.month,'simulation, not actual',r.category,r.source,r.baseline,r.actual,r.proposal,r.reduction,s.income,s.total,s.remaining]);}
 download(`kantong-${kind}-${state.month}.csv`,reportCSV(headers,rows),'text/csv;charset=utf-8');
}
function plainTable(headers,rows,cls=''){return `<table class="${cls}"><thead><tr>${headers.map(h=>`<th>${escapeHTML(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${escapeHTML(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
function renderPrint(){
 if(!state.loaded){$('print-report').innerHTML='';return;}const r=currentRecap(),d=dailyRecap(state.all,state.month,expenseNames());
 let html=`<h1>Kantong · ${escapeHTML(monthLabel(state.month))}</h1><p>Period ${state.month} · the whole month, ignoring search/type/category filters.</p><p>Actual income ${rp(r.income)} · expenses ${rp(r.expense)} · savings ${rp(r.savings)} · obligations ${rp(r.obligation)} · remaining ${rp(r.net)} (cash flow, not a bank balance).</p><h2>Budget / Actual / Gap</h2>`;
 const activeAcc=state.accounts.filter(a=>!a.is_archived);
 if(state.v4Ready&&activeAcc.length){
  const totals=assetTotals(state.accounts,assetData());
  html+=`<h2>Accounts & Assets</h2><p>Balance per your records: spendable money ${rp(totals.ready)} · total assets ${rp(totals.total)} · investments ${rp(totals.investment)}. Investment values are ENTERED MANUALLY, not real-time market prices.</p>`;
  html+=plainTable(['Accounts','Type','Balance','Note'],activeAcc.map(a=>{
   const prof=a.type==='investment'?investmentProfit(a,assetData()):null;
   return [a.name,ACCOUNT_TYPES.find(t=>t.id===a.type)?.label||a.type,rp(accountBalance(a,assetData())),prof?`cost ${rp(prof.cost)} · P/L ${rp(prof.profit)}${prof.pct===null?'':` (${prof.pct>=0?'+':''}${prof.pct.toFixed(1)}%)`} · manual value`:(a.note||'—')];
  }));
 }else{
  const opening=BigInt(state.settings?.opening_balance??0);const run=runningBalance(state.all,opening.toString());
  html+=`<h2>Running balance</h2><p>Opening balance ${rp(run.opening)} · all income ${rp(run.income)} · all expenses ${rp(run.expense)} · current balance ${rp(run.balance)}. Cash per your records, not a bank balance.</p>`;
 }
 html+=`<h2>Recurring income</h2>`;
 html+=state.schedules.length?plainTable(['Schedule','Amount','Date','Start','Status'],state.schedules.map(s=>[s.name,rp(s.amount),`day ${s.day}`,s.start_month,scheduleStatusText(s)])):'<p>No recurring income schedule yet.</p>';
 html+=state.planningReady?plainTable(['Category','Budget','Actual','Gap'],budgetRows().map(x=>[L(x.category),x.budget===null?'Not budgeted':rp(x.budget),rp(x.actual),x.gap===null?'—':rp(x.gap)])):'<p>Planning is not loaded; budget and simulation are unavailable. This is not a complete planning report.</p>';
 html+='<h2>Group budgets</h2>'+plainTable(['Group','Budget','Actual','Gap'],budgetGroupRows(state.all,state.month,state.planning.budgets).map(g=>[g.group,g.budget===null?'Not budgeted':rp(g.budget),rp(g.actual),g.gap===null?'—':rp(g.gap)]));
 html+='<h2>Savings goals</h2>'+ (state.goals.length ? plainTable(['Goal','Target','Saved','Progress','Deadline','Status'],goalsOverview(state.goals,state.all).rows.map(g=>[g.goal.name,rp(g.target),rp(g.saved),`${g.pct.toFixed(0)}%`,g.goal.deadline||'—',g.done?'Reached':'In progress'])) : '<p>No savings goal yet.</p>');
 const days=recapDayGroups(state.all,state.month,expenseNames(),categoryCatalog());
 html+='<h2>Daily expense recap</h2><p>Income '+rp(days.totals.income)+' · expenses '+rp(days.totals.expense)+' · net '+rp(days.totals.balance)+'. One block per date; blocks are not split across pages so card borders do not repeat.</p>';
 html+=printRecapHTML(days);
 const s=state.planningReady?scenarioSaved():null;if(s){html+=`<h2>Improvement simulation · separate, not actual</h2><p>Assumed income ${rp(s.income)} · baseline ${rp(s.baseline)} · proposed ${rp(s.total)} · planned reduction ${rp(s.reduction)} · projected remainder ${rp(s.remaining)}. Does not change transactions or the active budget, including past months.</p>`+plainTable(['Category','Source','Baseline','Actual','Proposed','Reduction'],s.rows.map(x=>[L(x.category),x.source,rp(x.baseline),rp(x.actual),rp(x.proposal),rp(x.reduction)]));}
 html+='<h2>All transactions in this period</h2>'+plainTable(['Date','Time (WIB)','Type','Category','Amount','Payment','Need/Want','Note'],r.rows.map(t=>[t.date,(t.updated_at||t.created_at)?wibTime(t.updated_at||t.created_at):'—',t.type,L(t.category),rp(t.amount),t.payment_method||'—',t.need_want||'—',t.notes||'—']),'print-transactions');$('print-report').innerHTML=html;
}
function wirePlanning(){
 $('improvement-alert').addEventListener('click',()=>{setView('budget');state.scenarioOpen=true;renderScenario();setButtons(state.loaded);});
 $$('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
 /* Kelola kategori v5 ditangani wireV5() — kategori kini punya ikon, warna, urutan, arsip. */

 $('improvement-start').addEventListener('click',()=>{state.scenarioOpen=true;renderScenario();setButtons(state.loaded);});
 $('scenario-income').addEventListener('input',e=>{state.draft.income=rupiahDigits(e.target.value);updateScenarioTotals();});
 $('scenario-rows').addEventListener('input',e=>{if(!e.target.dataset.proposal)return;state.draft.proposed[e.target.dataset.proposal]=rupiahDigits(e.target.value);updateScenarioTotals();});
 $('scenario-save').addEventListener('click',()=>{const d=state.draft;planningAction(s=>s.setScenario(d.month,d.income,d.proposed),'Simulation saved. The active budget and transactions are unchanged.');});
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
  const label = name || 'User';
  const line = greetingText(label, new Date().getHours());
  $('greeting').textContent = line;
  $('dash-greeting').textContent = line;
  $('identity').textContent = state.mode === 'cloud' ? (state.store?.session?.user?.email || 'Sign in') : 'Local demo';
  $('identity').title = state.mode === 'cloud' ? (state.store?.session?.user?.email || '') : 'Demo data lives only in this browser';
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
    if (![schedules, postings, accounts, transfers, holdings, valuations, activity].every(Array.isArray)) throw Error('Unexpected v4 table format.');
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
      $('v4-notice-text').textContent = 'Recurring income, the opening balance, and the profile are not available yet. Run only migration-v4.sql ONCE (do not re-run schema.sql), then Reload. Transactions, budgets, recap, and exports keep working. If you already migrated, check network and permissions. ' + (e?.message || '');
    }
    applyLook('krem', 'none');
  }
  renderProfileChrome();
}
function showAutoPostNotice(errors) {
  const el = $('autopost-notice');
  el.hidden = false;
  el.textContent = `Automatic recurring income could not be posted (${errors.length}): ${errors[0].message} Balances are unchanged and no numbers were invented. Check your connection then Reload; retrying is safe and will not duplicate rows.`;
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
    state.postErrors = [{ message: e?.message || 'Unknown error.' }];
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
    ? 'The opening balance could not be loaded (migration v4 has not run), so the calculation uses Rp 0. Other transactions are safe.'
    : usingAccounts
      ? `Spendable money from ${active.filter((a) => a.type !== 'investment').length} accounts · total assets ${rp(totals.total)} · investasi ${rp(totals.investment)} (nilai manual)`
      : `Opening balance ${rp(run.opening)} · all income ${rp(run.income)} · spending, savings and obligations ${rp(run.expense)}`;
  let months = [];
  try { months = balanceByMonth(state.all, opening.toString()); } catch { months = []; }
  const map = new Map(months.map((m) => [m.month, m]));
  if (!map.has(state.month)) { try { map.set(state.month, monthFlow(state.all, state.month, opening.toString())); } catch { /* bulan tidak valid */ } }
  const list = [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  $('saldo-months').innerHTML = list.length
    ? list.map((m) => `<tr${m.month === state.month ? ' class="current"' : ''}><th scope="row">${escapeHTML(monthLabel(m.month))}</th><td class="number">${rp(m.inflow)}</td><td class="number">${rp(m.outflow)}</td><td class="number">${rp(m.ending)}</td></tr>`).join('')
    : '<tr><td colspan="4">No entries yet.</td></tr>';
}
function assetData() {
  return { accounts: state.accounts, transactions: state.all, transfers: state.transfers, holdings: state.holdings, valuations: state.valuations };
}

/* ---------- pemasukan rutin: daftar & formulir ---------- */
function renderSchedules() {
  if (!state.v4Ready) {
    $('schedule-rows').innerHTML = '<tr><td colspan="5">Recurring income is not available yet. Run migration-v4.sql once, then Reload.</td></tr>';
  } else if (!state.schedules.length) {
    $('schedule-rows').innerHTML = '<tr><td colspan="5">No schedules yet. Add a salary or fixed income so it is recorded automatically.</td></tr>';
  } else {
    $('schedule-rows').innerHTML = state.schedules.map((s) => {
      const posted = state.postings.filter((p) => p.schedule_id === s.id).sort((a, b) => a.month.localeCompare(b.month));
      const last = posted.at(-1);
      const status = scheduleStatusText(s);
      return `<tr>
  <td class="sched-main"><b>${escapeHTML(s.name)}</b><small>${escapeHTML(status)}</small></td>
  <td>${rp(s.amount)}</td>
  <td>Start ${escapeHTML(monthLabel(s.start_month))}${s.end_month ? ` · berhenti ${escapeHTML(monthLabel(s.end_month))}` : ''}</td>
  <td class="sched-state">${s.active ? 'Active' : 'Dijeda'}${last ? ` · terakhir ${escapeHTML(monthLabel(last.month))}${last.status === 'dismissed' ? ' (deleted manually)' : ''}` : ' · nothing posted yet'}</td>
  <td><div class="sched-actions">
  <button type="button" class="ghost-btn" data-sched-edit="${escapeHTML(s.id)}" aria-label="Edit schedule ${escapeHTML(s.name)}">Edit</button>
  <button type="button" class="ghost-btn" data-sched-toggle="${escapeHTML(s.id)}" aria-label="${s.active ? 'Pause' : 'Resume'} jadwal ${escapeHTML(s.name)}">${s.active ? 'Pause' : 'Resume'}</button>
  <button type="button" class="ghost-btn" data-sched-del="${escapeHTML(s.id)}" aria-label="Delete schedule ${escapeHTML(s.name)}">Delete</button>
  </div></td></tr>`;
    }).join('');
  }
  $('opening-balance').value = state.v4Ready ? String(state.settings.opening_balance) : '';
  $('opening-date').textContent = !state.v4Ready
    ? 'Not available until migration v4 runs.'
    : state.settings.opening_balance_date
      ? `Opening balance saved ${dayLabel(state.settings.opening_balance_date)}.`
      : 'No opening balance set; counting Rp 0.';
  $('recurring-notice').textContent = !state.v4Ready
    ? ''
    : state.schedules.length
      ? `${state.schedules.filter((s) => s.active).length} jadwal aktif · ${state.postings.filter((p) => p.status === 'posted').length} months were posted automatically.`
      : 'No active schedule.';
}
function openScheduleForm(id) {
  if (!state.v4Ready) return;
  state.editingSchedule = id || null;
  const s = id ? state.schedules.find((x) => x.id === id) : null;
  $('schedule-form-title').textContent = s ? 'Edit schedule' : 'Add schedule';
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
    notify(editing ? 'Schedule updated. Future postings follow the new schedule; existing rows are unchanged.' : 'Recurring income saved. Months whose date already passed are posted once right away.');
  } catch (e) {
    notify(e.message || 'Could not save the schedule.', true);
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
      ? 'Schedule paused. Kantong will not post the next month until you reactivate it.'
      : 'Schedule active again. The paused month is not back-filled.');
  } catch (e) { notify(e.message || 'Could not change the schedule status.', true); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function deleteSchedule(id) {
  if (state.busy) return;
  const s = state.schedules.find((x) => x.id === id);
  if (!s) return;
  if (!confirm(`Delete schedule “${s.name}”? Transactions already recorded stay and are not deleted.`)) return;
  state.busy = true; setButtons(false);
  try {
    await state.store.deleteSchedule(id);
    state.schedules = (await state.store.schedules()).map(normalizeScheduleRow).filter(Boolean);
    state.postings = await state.store.postings();
    if (state.editingSchedule === id) { state.editingSchedule = null; $('schedule-form').hidden = true; }
    render();
    notify('Schedule deleted. Existing transactions are unchanged.');
  } catch (e) { notify(e.message || 'Could not delete the schedule.', true); }
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
    notify('Opening balance saved. “Current balance” was recalculated.');
  } catch (e) { notify(e.message || 'Could not save the opening balance.', true); }
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
  /* Tawaran bawaan selalu tampil di panduan: penanamannya idempoten, jadi
     pengguna yang sudah pernah menanam tidak akan mendapat baris ganda. */
  $('onb-seed-row').hidden = false;
  $('onb-seed').checked = true;
  $('onb-seed-note').textContent = 'You can rename, archive, or delete them later in the Budget tab. Existing categories are not overwritten.';
  ensureSeedState().then((st) => {
    if (!st.supported) {
      $('onb-seed-row').hidden = true;
      $('onb-seed').checked = false;
      $('onb-seed-note').textContent = 'Default categories could not be set up automatically in this account. You can still add categories from the Budget tab.';
    } else if (st.seeded) {
      $('onb-seed-note').textContent = 'Default categories were already set up. Ticking this will not duplicate anything.';
    }
  });
  showOnbStep(1);
}
function renderOnbAccounts() {
  $('onb-account-list').innerHTML = state.onbAccounts.map((a, i) => `
  <div class="onb-account-row">
  <div class="onb-acc-name"><label for="onb-acc-name-${i}">Account name</label><input id="onb-acc-name-${i}" maxlength="40" value="${escapeHTML(a.name || '')}" data-onb-field="name" data-onb-index="${i}" autocomplete="off"></div>
  <div><label for="onb-acc-type-${i}">Type</label><select id="onb-acc-type-${i}" data-onb-field="type" data-onb-index="${i}">${ACCOUNT_TYPES.map((t) => `<option value="${t.id}"${a.type === t.id ? ' selected' : ''}>${t.label}</option>`).join('')}</select></div>
  <div><label for="onb-acc-open-${i}">Balance (Rp)</label><input id="onb-acc-open-${i}" inputmode="numeric" pattern="[0-9]*" value="${escapeHTML(String(a.opening_balance ?? ''))}" data-onb-field="opening_balance" data-onb-index="${i}"></div>
  <button type="button" class="icon-btn" data-onb-remove="${i}" aria-label="Remove account row ${i + 1}"><svg class="ic" aria-hidden="true"><use href="#ic-close"></use></svg></button>
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
  $('onboarding-step-label').textContent = `Step ${step} of 4`;
  const titles = { 1: 'Want to start tracking money?', 2: 'Where is your money right now?', 3: 'Recurring income', 4: 'Ready to start' };
  $('onboarding-title').textContent = titles[step] || titles[1];
  $('onboarding-lede').textContent = step === 4
    ? 'Check this quick summary, then start recording.'
    : step === 1
      ? 'Three short steps: opening balance, recurring income, then start recording. Everything can be changed later.'
      : step === 2
        ? 'Create your first account and enter its balance today. More than one is fine; this is your own record.'
        : 'Optional. You can add it any time from the Recurring tab.';
  if (step === 4) renderOnbSummary();
  const focus = { 1: 'onb-start', 2: 'onb-acc-name-0', 3: 'onb-name', 4: 'onb-finish' }[step];
  /* Jangan rebut fokus kalau pengguna sudah mulai mengetik: memindahkan fokus
     di tengah pengisian membuat teks mendarat di kolom yang salah. */
  setTimeout(() => {
    const el = $(focus);
    if (!el) return;
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) return;
    el.focus({ preventScroll: true });
  }, 0);
}
function renderOnbSummary() {
  const accounts = state.accounts.filter((a) => !a.is_archived);
  const rows = [
    [`Hi, ${displayName() || 'User'}`, 'Name and theme can be changed in Profile'],
    ['Accounts', accounts.length ? accounts.map((a) => `${a.name} (${rp(accountBalance(a, assetData()))})`).join(' · ') : 'No account yet — you can add one later'],
    ['Recurring income', state.schedules.length ? state.schedules.map((s) => scheduleStatusText(s)).join(' · ') : 'Nothing yet — you can add one later'],
  ];
  $('onb-summary').innerHTML = rows.map(([k, v]) => `<li><b>${escapeHTML(k)}</b><span>${escapeHTML(v)}</span></li>`).join('');
}
/* Klik pengguna tidak boleh hilang hanya karena penyimpanan sebelumnya belum
   selesai; tunggu sebentar, bukan membuang submit. */
async function waitIdle(limit = 3000) {
  const started = Date.now();
  while (state.busy && Date.now() - started < limit) await new Promise((r) => setTimeout(r, 50));
}
async function onbAccountsNext(ev) {
  ev.preventDefault();
  await waitIdle();
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
    for (const item of plan) {
      /* Akun bawaan (Tunai) yang sudah ditanam saat langkah 1 diperbarui, bukan digandakan. */
      const twin = state.accounts.find((a) => !a.is_archived && String(a.name || '').trim().toLowerCase() === item.name.trim().toLowerCase());
      if (twin) await state.store.saveAccount({ ...twin, type: item.type, opening_balance: item.opening_balance, color: twin.color || item.color }, twin.id);
      else await state.store.saveAccount(item, null);
      added++;
    }
    state.accounts = (await state.store.accounts()).filter((a) => a && a.id);
    state.activityRows = await state.store.activity();
    fillAccountOptions();
    showOnbStep(3);
  } catch (e) {
    notify(`${added} accounts saved, the rest failed: ${e.message || 'galat'}. Check the Accounts tab before retrying.`, true);
    try { state.accounts = (await state.store.accounts()).filter((a) => a && a.id); fillAccountOptions(); } catch { /* tetap tampilkan galat asli */ }
  } finally { state.busy = false; setButtons(state.loaded); }
}
async function onbScheduleSave(ev) {
  ev.preventDefault();
  await waitIdle();
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
  } catch (e) { notify(e.message || 'Could not save the schedule.', true); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function laterOnboarding() {
  if (state.busy) return;
  state.busy = true; setButtons(false);
  try {
    state.settings = await state.store.saveSettings({ onboarding_skipped: true });
  } catch (e) {
    notify('The “Later” choice was not saved: ' + (e.message || '') + ' You can still use the app.', true);
  } finally { state.busy = false; setButtons(state.loaded); }
  closeOnboarding();
  maybeOpenOnboarding();
  notify('You can resume the guide any time from the reminder or the Profile menu.');
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
    notify('Guide complete. Happy recording.');
  } catch (e) {
    notify('The guide was not saved: ' + (e.message || '') + ' Try again; no data was changed.', true);
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
  const name = d.display_name?.trim() ? d.display_name.trim() : (displayName() || 'User');
  $('profile-name').value = d.display_name || '';
  $('profile-title').textContent = `Hi, ${name}`;
  $('profile-name-preview').textContent = name;
  $('profile-email').textContent = state.mode === 'cloud'
    ? (state.store?.session?.user?.email || 'Sign in with email')
    : 'Local demo — the profile lives only in this browser.';
  paintAvatar($('profile-avatar'), name, d);
  $('avatar-remove').hidden = d.avatar_kind !== 'photo';
  $('avatar-colors').innerHTML = AVATAR_COLORS.map((c) => `<button type="button" class="avatar-choice" data-avatar-color="${c}" aria-label="Avatar color ${c}" aria-pressed="${d.avatar_color === c}" style="background:${c}"></button>`).join('');
  $('theme-swatches').innerHTML = THEMES.map((t) => `<button type="button" class="choice" data-accent="${t.id}" aria-pressed="${d.theme === t.id}"><span class="dot-accent" style="background:${t.color}"></span>${t.label}</button>`).join('');
  $('pattern-swatches').innerHTML = PATTERNS.map((p) => `<button type="button" class="choice" data-pattern-choice="${p.id}" aria-pressed="${d.pattern === p.id}"><span class="pat pat-${p.id}"></span>${p.label}</button>`).join('');
  renderWaSection();
  renderTgSection();
}

/* ---------- WhatsApp: tautan nomor ---------- */
function waStatus(message, error = false) {
  const el = $('wa-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', !!error);
}
function renderWaSection() {
  if (!$('wa-link-state')) return;
  const cloud = state.mode === 'cloud';
  const link = state.waLink;
  const verified = !!(link && link.verified_at);
  $('wa-link-state').textContent = !cloud
    ? 'Demo mode: WhatsApp linking is only available for online accounts.'
    : state.waLoading
      ? 'Memeriksa status nomor…'
      : waLinkStatusText(link);
  const input = $('wa-phone');
  input.disabled = !cloud || state.busy;
  if (document.activeElement !== input) input.value = link && link.phone_e164 ? waPhonePretty(link.phone_e164) : '';
  $('wa-connect').disabled = !cloud || state.busy;
  $('wa-connect').textContent = link ? 'Ganti nomor' : 'Connect';
  $('wa-unlink').hidden = !(cloud && link);
  $('wa-unlink').disabled = state.busy;
  const showCode = cloud && !!(state.waCode && state.waCode.code);
  $('wa-code-box').hidden = !showCode;
  if (showCode) {
    $('wa-code').textContent = state.waCode.code;
    $('wa-code-expiry').textContent = waCodeExpiryText(state.waCode.expires_at);
  }
}
async function connectWa() {
  if (state.mode !== 'cloud') { waStatus('Connecting a number is only available for online accounts.', true); return; }
  if (!state.v4Ready) { waStatus('This feature needs kantong-wa-migration.sql to run once.', true); return; }
  if (state.busy) return;
  let phone;
  try { phone = normalizeWaPhone($('wa-phone').value); }
  catch (e) { waStatus(e.message, true); $('wa-phone').focus(); return; }
  state.busy = true; setButtons(false); renderWaSection();
  try {
    const result = await state.store.requestWaCode(phone);
    state.waCode = result;
    state.waLink = { user_id: state.store.session?.user?.id || null, phone_e164: result.phone_e164, verified_at: null, expires_at: result.expires_at, last_seen_at: null };
    renderWaSection();
    waStatus(`Code created. Send the message VERIFY ${result.code} from WhatsApp ${waPhonePretty(result.phone_e164)} to the bot.`);
  } catch (e) {
    waStatus(e.message || 'Could not create a verification code.', true);
  } finally {
    state.busy = false; setButtons(state.loaded); renderWaSection();
  }
}
async function unlinkWa() {
  if (state.mode !== 'cloud' || state.busy) return;
  const number = state.waLink && state.waLink.phone_e164 ? waPhonePretty(state.waLink.phone_e164) : 'this account';
  if (!globalThis.confirm(`Disconnect number ${number}? Notes from that number stop reaching this account.`)) return;
  state.busy = true; setButtons(false); renderWaSection();
  try {
    await state.store.unlinkWa();
    state.waLink = null;
    state.waCode = null;
    waStatus('Number disconnected. Notes from it no longer reach this account.');
  } catch (e) {
    waStatus(e.message || 'Could not disconnect the number.', true);
  } finally {
    state.busy = false; setButtons(state.loaded); renderWaSection();
  }
}
async function copyWaCode() {
  const code = state.waCode && state.waCode.code;
  if (!code) return;
  const text = `VERIFY ${code}`;
  try {
    await navigator.clipboard.writeText(text);
    waStatus('Code copied. Paste it into WhatsApp and send it to the bot.');
  } catch {
    waStatus(`Copy manually: ${text}`);
  }
}

/* ---------- Telegram: tautan chat ----------
   Tidak ada nomor: chat baru dikenal setelah kode dikirim ke bot.
   Bagian ini berdiri sendiri, tidak bergantung pada tautan WhatsApp. */
function tgStatus(message, error = false) {
  const el = $('tg-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', !!error);
}
function renderTgSection() {
  if (!$('tg-link-state')) return;
  const cloud = state.mode === 'cloud';
  const link = state.tgLink;
  const verified = !!(link && link.verified_at);
  $('tg-link-state').textContent = !cloud
    ? 'Demo mode: Telegram linking is only available for online accounts.'
    : state.tgLoading
      ? 'Memeriksa status Telegram…'
      : tgLinkStatusText(link);
  $('tg-connect').disabled = !cloud || state.busy;
  $('tg-connect').textContent = verified ? 'Reconnect' : 'Connect Telegram';
  $('tg-unlink').hidden = !(cloud && link);
  $('tg-unlink').disabled = state.busy;
  $('tg-check').hidden = !(cloud && !verified);
  $('tg-check').disabled = state.busy || state.tgLoading;
  const showCode = cloud && !!(state.tgCode && state.tgCode.code);
  $('tg-code-box').hidden = !showCode;
  if (showCode) {
    $('tg-code').textContent = state.tgCode.code;
    $('tg-code-expiry').textContent = waCodeExpiryText(state.tgCode.expires_at);
  }
}
async function connectTg() {
  if (state.mode !== 'cloud') { tgStatus('Connecting Telegram is only available for online accounts.', true); return; }
  if (!state.v4Ready) { tgStatus('This feature needs kantong-tg-migration.sql to run once.', true); return; }
  if (state.busy) return;
  state.busy = true; setButtons(false); renderTgSection();
  try {
    const result = await state.store.requestTgCode();
    state.tgCode = result;
    state.tgLink = state.tgLink || { user_id: state.store.session?.user?.id || null, chat_id: null, verified_at: null };
    renderTgSection();
    tgStatus(`Code created. Open the Kantong Telegram bot, then send: verify ${result.code}`);
  } catch (e) {
    tgStatus(e.message || 'Could not create a verification code.', true);
  } finally {
    state.busy = false; setButtons(state.loaded); renderTgSection();
  }
}
async function checkTg() {
  if (state.mode !== 'cloud' || state.busy) return;
  state.tgLoading = true; renderTgSection();
  try {
    state.tgLink = await state.store.tgLink();
    renderTgSection();
    tgStatus(state.tgLink && state.tgLink.verified_at
      ? 'Telegram chat connected. Try sending: makan 1900'
      : 'Not connected. Send the verification code from Telegram to the bot, then check again.');
  } catch (e) {
    tgStatus(e.message || 'Could not read the Telegram status.', true);
  } finally {
    state.tgLoading = false; renderTgSection();
  }
}
async function unlinkTg() {
  if (state.mode !== 'cloud' || state.busy) return;
  if (!globalThis.confirm('Disconnect this Telegram chat? Notes from it stop reaching this account.')) return;
  state.busy = true; setButtons(false); renderTgSection();
  try {
    await state.store.unlinkTg();
    state.tgLink = null;
    state.tgCode = null;
    tgStatus('Telegram chat disconnected. Notes from it no longer reach this account.');
  } catch (e) {
    tgStatus(e.message || 'Could not disconnect the Telegram chat.', true);
  } finally {
    state.busy = false; setButtons(state.loaded); renderTgSection();
  }
}
async function copyTgCode() {
  const code = state.tgCode && state.tgCode.code;
  if (!code) return;
  const text = `verify ${code}`;
  try {
    await navigator.clipboard.writeText(text);
    tgStatus('Code copied. Paste it into the Telegram bot chat and send it.');
  } catch {
    tgStatus(`Copy manually: ${text}`);
  }
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
  state.waLink = null;
  state.waCode = null;
  state.waLoading = state.mode === 'cloud' && state.v4Ready;
  state.tgLink = null;
  state.tgCode = null;
  state.tgLoading = state.mode === 'cloud' && state.v4Ready;
  renderProfileForm();
  applyLook(state.profileDraft.theme, state.profileDraft.pattern);
  profileStatus('');
  if (state.mode === 'cloud' && state.v4Ready) {
    state.waLoading = true;
    state.store.waLink()
      .then((link) => { state.waLink = link; })
      .catch(() => { state.waLink = null; })
      .finally(() => { state.waLoading = false; renderWaSection(); });
    state.tgLoading = true;
    state.store.tgLink()
      .then((link) => { state.tgLink = link; })
      .catch(() => { state.tgLink = null; })
      .finally(() => { state.tgLoading = false; renderTgSection(); });
  }
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
  if (!state.v4Ready) { profileStatus('Profile needs migration-v4.sql to run once. The name was not saved.', true); return; }
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
    notify('Profile saved to your account. Other devices see the same name and theme after Reload.');
  } catch (e) {
    profileStatus(e.message || 'Could not save the profile.', true);
  } finally { state.busy = false; setButtons(state.loaded); }
}
async function compressAvatar(file) {
  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
    el.onerror = () => { URL.revokeObjectURL(url); reject(Error('This browser cannot read the photo.')); };
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
    profileStatus(`Photo ready to save (${Math.round((data.length * 3 / 4) / 1024)} KB, 256×256).`);
  } catch (e) {
    profileStatus(e.message || 'Photo processing failed; nothing was saved.', true);
  }
}
async function resetLook() {
  state.profileDraft = { ...state.profileDraft, theme: 'krem', pattern: 'none' };
  renderProfileForm();
  applyLook('krem', 'none');
  if (!state.v4Ready) { profileStatus('Appearance reset for this device. Migration v4 has not run, so it was not saved to your account.', true); return; }
  try {
    state.settings = await state.store.saveSettings({ theme: 'krem', pattern: 'none' });
    profileStatus('Appearance reset to defaults and saved.');
  } catch (e) { profileStatus('Appearance reset on screen but not saved: ' + (e.message || ''), true); }
}

/* ---------- peristiwa v4 ---------- */
function wireV4() {
  $('onb-start').addEventListener('click', async () => {
    const offer = $('onb-seed-row');
    if (offer && !offer.hidden && $('onb-seed')?.checked && !state.seedBusy) {
      await runSeedDefaults();
      showOnbStep(2);
      return;
    }
    showOnbStep(2);
  });
  $('onb-later').addEventListener('click', laterOnboarding);
  $('onb-accounts-form').addEventListener('submit', onbAccountsNext);
  $('onb-accounts-skip').addEventListener('click', () => showOnbStep(3));
  $('onb-add-account').addEventListener('click', () => { const n = state.onbAccounts.length; state.onbAccounts.push({ name: n === 1 ? 'Tunai' : `Account ${n + 1}`, type: n === 1 ? 'cash' : 'bank', opening_balance: '' }); renderOnbAccounts(); });
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
  $('wa-connect').addEventListener('click', connectWa);
  $('wa-unlink').addEventListener('click', unlinkWa);
  $('wa-code-copy').addEventListener('click', copyWaCode);
  $('wa-phone').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); connectWa(); } });
  $('tg-connect').addEventListener('click', connectTg);
  $('tg-check').addEventListener('click', checkTg);
  $('tg-unlink').addEventListener('click', unlinkTg);
  $('tg-code-copy').addEventListener('click', copyTgCode);
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
    profileStatus('Theme preview. Tap “Save profile” to store it in your account.');
  });
  $('pattern-swatches').addEventListener('click', (e) => {
    const p = e.target.closest('[data-pattern-choice]')?.dataset.patternChoice;
    if (!p) return;
    state.profileDraft = { ...state.profileDraft, pattern: p };
    renderProfileForm(); applyLook(state.profileDraft.theme, p);
    profileStatus('Background preview. Tap “Save profile” to store it in your account.');
  });
  $('avatar-upload').addEventListener('click', () => $('avatar-file').click());
  $('avatar-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    handleAvatarFile(f);
  });
  $('avatar-remove').addEventListener('click', () => {
    state.profileDraft = { ...state.profileDraft, avatar_kind: 'initial', avatar_data: null };
    renderProfileForm(); profileStatus('Photo removed from the preview. Save the profile to apply it.');
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
function accName(id) { return state.accounts.find((a) => a.id === id)?.name || 'Account deleted'; }
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
  if (!total) $('aset-donut').innerHTML = '<p class="empty-note">No asset value yet.</p>';
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
  $('aset-history').innerHTML = points.length >= 2 ? lineChart(points, 'Investment value history') : '<p class="empty-note">Update the investment value at least twice to see the history.</p>';
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
  $('asset-totals').innerHTML = `<div><span>Spendable money</span><b>${rp(totals.ready)}</b></div><div><span>Total assets</span><b>${rp(totals.total)}</b></div><div><span>Investasi (manual)</span><b>${rp(totals.investment)}</b></div>`;
  $('account-cards').innerHTML = state.accounts.length ? state.accounts.map((a) => {
    const bal = accountBalance(a, assetData());
    const prof = a.type === 'investment' ? investmentProfit(a, assetData()) : null;
    return `<article class="account-card${a.is_archived ? ' archived' : ''}">
  <header><span class="acc-dot" style="background:${a.color}"></span><h3>${LH(a.name)}</h3><span class="badge">${escapeHTML(ACCOUNT_TYPES.find((t) => t.id === a.type)?.label || a.type)}</span></header>
  <p class="acc-balance">${rp(bal)}</p>
  ${prof ? `<p class="acc-note">Biaya ${rp(prof.cost)} · P/L ${rp(prof.profit)}${prof.pct === null ? '' : ` (${prof.pct >= 0 ? '+' : ''}${prof.pct.toFixed(1)}%)`} · nilai manual</p>` : ''}
  ${a.note ? `<p class="acc-note">${escapeHTML(a.note)}</p>` : ''}
  ${a.is_archived ? '<p class="acc-note">Archived — hidden from pickers, history kept.</p>' : ''}
  <div class="acc-actions">
  <button type="button" class="ghost-btn" data-acc-edit="${escapeHTML(a.id)}">Edit</button>
        
  ${a.type === 'investment' ? `<button type="button" class="ghost-btn" data-acc-detail="${escapeHTML(a.id)}">Asset details</button>` : ''}
  <button type="button" class="ghost-btn" data-acc-archive="${escapeHTML(a.id)}">${a.is_archived ? 'Reactivate' : 'Archive'}</button>
  </div></article>`;
  }).join('') : '<p class="note">No accounts yet. Add BCA, Cash, or your first investment account.</p>';
  $('transfer-rows').innerHTML = state.transfers.length ? state.transfers.slice(0, 20).map((t) => `<tr><td>${escapeHTML(accName(t.from_account))} → ${escapeHTML(accName(t.to_account))}${t.note ? `<small>${escapeHTML(t.note)}</small>` : ''}</td><td>${rp(t.amount)}</td><td>${dayLabel(t.date)}</td><td><div class="row-actions"><button class="icon-btn" type="button" data-tr-edit="${escapeHTML(t.id)}" aria-label="Edit transfer"><svg class="ic" aria-hidden="true"><use href="#ic-pencil"></use></svg></button><button class="icon-btn" type="button" data-tr-del="${escapeHTML(t.id)}" aria-label="Delete transfer"><svg class="ic" aria-hidden="true"><use href="#ic-trash"></use></svg></button></div></td></tr>`).join('') : '<tr><td colspan="4">No transfers yet.</td></tr>';
  $('activity-rows').innerHTML = state.activityRows.length ? state.activityRows.slice(0, 50).map((a) => `<li><span><span class="act-kind">${escapeHTML(a.action)}</span> ${escapeHTML(a.entity)} · ${escapeHTML(a.summary)}</span><time datetime="${escapeHTML(a.created_at || '')}">${a.created_at ? new Date(a.created_at).toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</time></li>`).join('') : '<li>No changes recorded yet.</li>';
  renderBulkRows();
  if (state.activeAccount) renderInvestment();
}
function renderBulkRows() {
  const invs = state.accounts.filter((a) => a.type === 'investment' && !a.is_archived);
  $('bulk-rows').innerHTML = invs.length ? invs.map((a) => {
    const cur = accountBalance(a, assetData());
    return `<tr data-bulk-row="${escapeHTML(a.id)}"><th>${LH(a.name)}</th><td>${rp(cur)}</td><td><input class="holding-input" data-money inputmode="numeric" data-bulk-input="${escapeHTML(a.id)}" placeholder="${cur}"></td><td><input class="holding-input" maxlength="200" data-bulk-note="${escapeHTML(a.id)}" placeholder="optional"></td><td data-bulk-state="${escapeHTML(a.id)}">—</td></tr>`;
  }).join('') : '<tr><td colspan="5">No investment accounts yet. Add an account of type Investment.</td></tr>';
}
function openAccountForm(id) {
  if (!state.v4Ready) return;
  state.accountEditing = id || null;
  const a = id ? state.accounts.find((x) => x.id === id) : null;
  $('account-form-title').textContent = a ? 'Edit account' : 'Add account';
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
  if (prev && prev.opening_balance !== clean.opening_balance && !confirm('This account\'s opening balance changed. The account balance will be recalculated from the new opening balance; transaction history is untouched. Continue?')) return;
  state.busy = true; setButtons(false);
  try {
    await state.store.saveAccount(clean, state.accountEditing);
    state.accountEditing = null;
    $('account-form').hidden = true;
    await refreshAssets();
    notify(prev ? 'Account updated. Balance recalculated from current data.' : 'Account added.');
  } catch (e) { notify(e.message || 'Could not save the account.', true); await refreshAssets(); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function archiveAccountPrompt(id) {
  const a = state.accounts.find((x) => x.id === id);
  if (!a) return;
  const next = !a.is_archived;
  if (next && !confirm(`Archive “${a.name}”? The account is hidden from transaction pickers, but its history and balance are kept.`)) return;
  state.busy = true; setButtons(false);
  try { await state.store.archiveAccount(id, next); await refreshAssets(); notify(next ? 'Account archived. History stays safe.' : 'Account reactivated.'); }
  catch (e) { notify(e.message || 'Could not change the account archive state.', true); await refreshAssets(); }
  finally { state.busy = false; setButtons(state.loaded); }
}
function openTransferForm(id) {
  if (!state.v4Ready) return;
  const active = state.accounts.filter((a) => !a.is_archived);
  if (active.length < 2) { notify('Transfers need at least two accounts.', true); return; }
  state.transferEditing = id || null;
  const t = id ? state.transfers.find((x) => x.id === id) : null;
  fillAccountOptions();
  $('transfer-form-title').textContent = t ? 'Edit transfer' : 'Transfer';
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
    notify('Transfer saved. Not income or expense; budgets unchanged.');
  } catch (e) { notify(e.message || 'Could not save the transfer.', true); await refreshAssets(); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function deleteTransferPrompt(id) {
  if (state.busy) return;
  if (!confirm('Delete this transfer? Both account balances are recalculated. Other transactions are unchanged.')) return;
  state.busy = true; setButtons(false);
  try { await state.store.deleteTransfer(id); await refreshAssets(); notify('Transfer deleted; balances recalculated.'); }
  catch (e) { notify(e.message || 'Could not delete the transfer.', true); await refreshAssets(); }
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
  $('inv-meta').textContent = `Value ${rp(prof.value)} · biaya ${rp(prof.cost)} · unrealized P/L ${rp(prof.profit)}${prof.pct === null ? '' : ` (${prof.pct >= 0 ? '+' : ''}${prof.pct.toFixed(1)}%)`} · manual value, not a market price. Value updated ${last ? dayLabel(last.date) : 'never yet'}.`;
  $('inv-value').value = a.current_value !== null && a.current_value !== undefined ? String(a.current_value) : '';
  $('holding-rows').innerHTML = state.holdingDraft.length ? state.holdingDraft.map((h, i) => {
    let value = '';
    try { if (h.quantity !== '' && h.current_price !== '') value = rp(holdingValueSafe(h)); } catch { value = '—'; }
    let pl = '';
    try { if (h.quantity !== '' && h.current_price !== '' && h.avg_buy_price !== '') { const p = holdingValueSafe(h) - BigInt(Math.round(Number(h.quantity) * Number(h.avg_buy_price))); pl = `${p >= 0n ? '+' : ''}${rp(p)}`; } } catch { pl = '—'; }
    return `<tr class="${h.dirty ? 'dirty-row' : ''}" data-h-row="${i}">
  <td><input class="holding-input" maxlength="60" value="${escapeHTML(h.asset_name)}" data-h-field="asset_name" data-h-index="${i}" aria-label="Asset name"></td>
  <td><select class="holding-input" data-h-field="kind" data-h-index="${i}" aria-label="Type aset">${HOLDING_KINDS.map((k) => `<option value="${k.id}"${h.kind === k.id ? ' selected' : ''}>${k.label}</option>`).join('')}</select></td>
  <td><input class="holding-input" inputmode="decimal" value="${escapeHTML(String(h.quantity))}" data-h-field="quantity" data-h-index="${i}" aria-label="Quantity"></td>
  <td><input class="holding-input" data-money inputmode="decimal" value="${formatRupiahInput(String(h.avg_buy_price))}" data-h-field="avg_buy_price" data-h-index="${i}" aria-label="Average buy price"></td>
  <td><input class="holding-input" data-money inputmode="decimal" value="${formatRupiahInput(String(h.current_price))}" data-h-field="current_price" data-h-index="${i}" aria-label="Current price (manual)"></td>
  <td data-h-value="${i}">${value}<br><small>${pl}</small></td>
  <td><button type="button" class="icon-btn" data-h-del="${escapeHTML(h.id || '')}" data-h-index="${i}" aria-label="Remove asset"><svg class="ic" aria-hidden="true"><use href="#ic-trash"></use></svg></button></td>
  </tr>`;
  }).join('') : '<tr><td colspan="7">No asset details yet. Add an asset or enter the current value manually.</td></tr>';
  $('holding-dirty').hidden = !state.holdingDraft.some((h) => h.dirty);
  const hist = valueHistory(state.valuations, a.id);
  $('valuation-rows').innerHTML = hist.length ? hist.slice().reverse().map((v, idx, arr) => {
    const prev = arr[idx + 1];
    const delta = prev ? v.value - prev.value : null;
    const row = state.valuations.find((x) => x.account_id === a.id && x.date === v.date && BigInt(x.value) === v.value);
    return `<tr><td>${dayLabel(v.date)}</td><td>${rp(v.value)}</td><td class="${delta !== null && delta < 0n ? 'negative' : ''}">${delta === null ? '—' : `${delta >= 0n ? '+' : ''}${rp(delta)}`}</td><td>${escapeHTML(v.note || '—')}</td><td>${row ? `<button type="button" class="ghost-btn" data-val-del="${escapeHTML(row.id)}">Delete</button>
  ` : ''}</td></tr>`;
  }).join('') : '<tr><td colspan="5">No value history yet.</td></tr>';
  $('inv-chart').innerHTML = hist.length >= 2 ? lineChart(hist, 'Investment value history') : '<p class="empty-note">The chart appears after two value updates.</p>';
}
function holdingValueSafe(h) {
  const v = Number(h.quantity) * Number(h.current_price);
  if (!Number.isFinite(v) || v < 0 || v > 9e15) throw Error('out of range');
  return BigInt(Math.round(v));
}
async function saveHoldings() {
  if (state.busy) return;
  const dirty = state.holdingDraft.filter((h) => h.dirty);
  const rows = dirty.filter((h) => String(h.asset_name || '').trim() || String(h.quantity || '').trim() || String(h.current_price || '').trim());
  if (!rows.length) { notify('No asset changes to save.', true); return; }
  let plan;
  try { plan = rows.map((h) => validateHolding({ ...h, account_id: state.activeAccount })); }
  catch (e) { notify(e.message, true); return; }
  state.busy = true; setButtons(false);
  try {
    for (let i = 0; i < plan.length; i++) await state.store.saveHolding(plan[i], rows[i].id || null);
    await refreshAssets();
    openInvestment(state.activeAccount);
    notify(`${plan.length} asset rows saved. Investment value recalculated.`);
  } catch (e) { notify(e.message || 'Could not save the asset.', true); await refreshAssets(); openInvestment(state.activeAccount); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function deleteHoldingPrompt(id, index) {
  if (state.busy) return;
  const row = state.holdingDraft[index];
  if (!id) { state.holdingDraft.splice(index, 1); renderInvestment(); return; }
  if (!confirm(`Remove asset “${row?.asset_name || ''}”? Investment value is recalculated; value history stays.`)) return;
  state.busy = true; setButtons(false);
  try { await state.store.deleteHolding(id); await refreshAssets(); openInvestment(state.activeAccount); notify('Asset deleted; investment value recalculated.'); }
  catch (e) { notify(e.message || 'Could not remove the asset.', true); await refreshAssets(); openInvestment(state.activeAccount); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function saveInvestmentValue() {
  if (state.busy) return;
  const id = state.activeAccount;
  let value;
  try { value = openingAmount($('inv-value').value); }
  catch { notify('The current value must be whole, non-negative rupiah.', true); return; }
  state.busy = true; setButtons(false);
  try {
    await state.store.saveValuation(id, value, $('inv-note').value);
    await refreshAssets(); openInvestment(id); $('inv-note').value = '';
    notify('Investment value saved as a new history entry. The old value is not overwritten.');
  } catch (e) { notify(e.message || 'Could not save the investment value.', true); await refreshAssets(); openInvestment(id); }
  finally { state.busy = false; setButtons(state.loaded); }
}
async function deleteValuationPrompt(id) {
  if (state.busy) return;
  if (!confirm('Delete this history entry? The current value is recalculated from the newest remaining entry.')) return;
  state.busy = true; setButtons(false);
  try { await state.store.deleteValuation(id); await refreshAssets(); openInvestment(state.activeAccount); notify('Value note deleted; current value recalculated.'); }
  catch (e) { notify(e.message || 'Could not delete the value note.', true); await refreshAssets(); openInvestment(state.activeAccount); }
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
  if (!rows.length) { $('bulk-status').textContent = 'No new values to save.'; return; }
  let plan;
  try { plan = valuationPlan(rows); } catch (e) { $('bulk-status').textContent = e.message; $('bulk-status').classList.add('error'); return; }
  state.busy = true; setButtons(false);
  try {
    const res = await state.store.saveValuations(plan);
    if (res.errors?.length) {
      $('bulk-status').textContent = `Could not ${res.errors.length}: ${res.errors[0].message} The displayed values were reloaded from stored data.`;
      $('bulk-status').classList.add('error');
      notify('Some values could not be saved. Numbers were reloaded from the real data.', true);
    } else {
      $('bulk-status').classList.remove('error');
      $('bulk-status').textContent = `${res.saved.length} account values saved.`;
      notify(`${res.saved.length} investment values saved (manual).`);
    }
    await refreshAssets();
  } catch (e) {
    $('bulk-status').textContent = (e.message || 'Could not save the value.') + ' Numbers reloaded from stored data.';
    $('bulk-status').classList.add('error');
    notify(e.message || 'Could not save the value.', true);
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
    headers = ['name', 'type', 'opening_balance_idr', 'current_balance_idr', 'manual_value_idr', 'archived', 'note'];
    rows = state.accounts.map((a) => [a.name, a.type, a.opening_balance, accountBalance(a, assetData()), a.current_value, a.is_archived ? 'yes' : 'no', a.note || '']);
  } else if (kind === 'holdings') {
    headers = ['account', 'asset_name', 'type', 'quantity', 'avg_buy_price_manual', 'current_price_manual', 'value_idr', 'manual_price_not_feed'];
    rows = state.holdings.map((h) => [accName(h.account_id), h.asset_name, h.kind, h.quantity, h.avg_buy_price, h.current_price, holdingValueSafe(h), 'yes']);
  } else {
    headers = ['date', 'from_account', 'to_account', 'amount_idr', 'note'];
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
  $('open-transfer').addEventListener('click', () => { closeSheet(); state.reportTab='accounts'; setView('reports'); openTransferForm(null); });
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
    if (stateEl) stateEl.textContent = el.value.trim() === '' ? '—' : (BigInt(el.value.trim()) === cur ? 'same' : 'changed');
  });
  $('aset-open').addEventListener('click', () => { state.reportTab='accounts'; setView('reports'); });
  $('csv-accounts').addEventListener('click', () => exportAssetsCSV('accounts'));
  $('csv-holdings').addEventListener('click', () => exportAssetsCSV('holdings'));
  $('csv-transfers').addEventListener('click', () => exportAssetsCSV('transfers'));
}


/* ============================================================
   Kantong v5 — pendaftaran mandiri, rekap harian kartu,
   kelola kategori dari tab Anggaran.
   ============================================================ */

const AUTH_FORMS = { login: 'login', signup: 'signup', forgot: 'forgot', reset: 'reset-form' };
const inviteRequired = () => {
  const c = window.KANTONG_CONFIG || {};
  return c.requireInvite === true || c.inviteRequired === true;
};

function authScreen(name) {
  state.authScreen = name;
  for (const [key, id] of Object.entries(AUTH_FORMS)) {
    const el = $(id);
    if (el) el.hidden = key !== name;
  }
  const tabLogin = $('tab-login'), tabSignup = $('tab-signup');
  if (tabLogin && tabSignup) {
    const bare = name === 'reset';
    tabLogin.hidden = bare;
    tabSignup.hidden = bare;
    tabLogin.setAttribute('aria-selected', String(name === 'login' || name === 'forgot'));
    tabSignup.setAttribute('aria-selected', String(name === 'signup'));
  }
  if (name === 'signup') { renderInviteField(); renderSignupDisabled(); }
  if (name !== 'signup') { const st = $('signup-status'); if (st) st.hidden = true; }
  if (name === 'reset') { const st = $('reset-status'); if (st) st.hidden = true; }
}

function renderInviteField() {
  const on = inviteRequired();
  const label = $('su-invite-field'), input = $('su-invite');
  if (label) label.hidden = !on;
  if (input) { input.hidden = !on; if (!on) input.value = ''; }
}

function renderSignupDisabled() {
  const el = $('signup-disabled');
  if (!el) return;
  const disabled = state.authSettings?.disableSignup === true;
  const text = signupNoticeText(disabled);
  el.hidden = !text;
  el.textContent = text;
  const btn = $('su-submit');
  if (btn) btn.disabled = disabled || state.signupBusy;
}

function loginError(message) {
  const el = $('login-error');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}
function fieldError(id, message) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}
function signupStatus(message, isError = false) {
  const el = $('signup-status');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
  el.classList.toggle('error', !!isError);
}
const emailProblem = (value) => signupErrors({ email: value, password: '12345678', username: 'aa' }).email || '';

async function probeAuthSettings(cfg) {
  try {
    const res = await fetch(`${cfg.url}/auth/v1/settings`, { headers: { apikey: cfg.anonKey }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const body = await res.json();
    return { disableSignup: body?.disable_signup === true };
  } catch { return null; }
}
const appRedirectUrl = () => location.origin + location.pathname;

/* ---------- kata sandi: lihat/sembunyikan + kekuatan ---------- */
function wirePasswordToggle(inputId, buttonId, strengthId) {
  const input = $(inputId), button = $(buttonId), meter = $(strengthId);
  if (!input || !button || !meter) return;
  button.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  const paint = () => {
    if (!input.value) {
      meter.dataset.strength = '0';
      meter.textContent = `Minimal ${8} characters, mix letters and numbers.`;
      return;
    }
    const s = passwordStrength(input.value);
    meter.dataset.strength = String(s.score >= 4 ? 3 : s.score >= 2 ? 2 : 1);
    meter.textContent = `${s.label} · ${s.hint}`;
  };
  input.addEventListener('input', paint);
  paint();
}

/* ---------- kirim ulang verifikasi: cooldown 60 dtk ---------- */
let resendTimer = null;
let resendUntil = 0;
function paintResend() {
  const btn = $('resend-confirm');
  if (!btn) return;
  const left = Math.max(0, Math.ceil((resendUntil - Date.now()) / 1000));
  btn.disabled = left > 0 || state.signupBusy;
  btn.textContent = resendCountdown(left);
  const note = $('resend-note');
  if (note) note.textContent = left > 0
    ? 'Check your inbox and spam folder. The free Supabase email quota is hourly.'
    : 'No email yet? Resend it now.';
  if (left <= 0) { clearInterval(resendTimer); resendTimer = null; }
}
function startResendCooldown(seconds) {
  resendUntil = Date.now() + Math.max(0, Number(seconds) || 0) * 1000;
  clearInterval(resendTimer);
  resendTimer = null;
  paintResend();
  if (seconds > 0) resendTimer = setInterval(paintResend, 1000);
}
async function resendConfirmation() {
  const email = (state.pendingEmail || $('su-email').value || '').trim();
  if (!email) { signupStatus('Enter your email first so the link can be resent.', true); return; }
  try {
    if (!state.store) state.store = new CloudStore(state.cfg);
    await state.store.resendConfirmation(email, appRedirectUrl());
    signupStatus('Verification email resent. Check your inbox and spam folder.');
    startResendCooldown(60);
  } catch (e) {
    signupStatus(e.message, true);
    startResendCooldown(60);
  }
}

/* ---------- daftar ---------- */
async function submitSignup(ev) {
  ev.preventDefault();
  if (state.signupBusy) return;
  for (const id of ['err-su-email', 'err-su-password', 'err-su-username', 'err-su-invite']) fieldError(id, '');
  signupStatus('');
  const email = $('su-email').value.trim();
  const username = $('su-username').value.trim();
  const password = $('su-password').value;
  const errors = signupErrors({ email, username, password, inviteCode: $('su-invite').value }, { inviteRequired: inviteRequired() });
  if (Object.keys(errors).length) {
    if (errors.email) fieldError('err-su-email', errors.email);
    if (errors.username) fieldError('err-su-username', errors.username);
    if (errors.password) fieldError('err-su-password', errors.password);
    if (errors.invite) fieldError('err-su-invite', errors.invite);
    signupStatus('Check the highlighted fields. Nothing has been sent yet.', true);
    const first = !$('err-su-email').hidden ? $('su-email') : !$('err-su-username').hidden ? $('su-username') : !$('err-su-password').hidden ? $('su-password') : $('su-invite');
    first.focus({ preventScroll: true });
    return;
  }
  state.signupBusy = true;
  const btn = $('su-submit');
  btn.disabled = true;
  btn.textContent = 'Mendaftarkan…';
  try {
    state.store = new CloudStore(state.cfg);
    const outcome = await state.store.signUp({ email, password, username, redirectTo: appRedirectUrl() });
    state.pendingEmail = email;
    if (outcome.kind === 'session') {
      state.mode = 'cloud';
      $('su-password').value = '';
      signupStatus(outcome.message);
      await enterWorkspace();
      notify('Account created. The setup guide is open.');
    } else if (outcome.kind === 'verify') {
      $('signup-verify').hidden = false;
      signupStatus(outcome.message);
      startResendCooldown(0);
      $('resend-confirm').focus({ preventScroll: true });
    } else {
      $('signup-verify').hidden = true;
      signupStatus(outcome.message, true);
    }
  } catch (e) {
    signupStatus(e.message, true);
    if (e.kind === 'disabled') {
      state.authSettings = { ...(state.authSettings || {}), disableSignup: true };
      renderSignupDisabled();
    }
  } finally {
    state.signupBusy = false;
    btn.textContent = 'Create account';
    btn.disabled = state.authSettings?.disableSignup === true;
    paintResend();
  }
}

/* ---------- lupa password & kata sandi baru ---------- */
async function submitForgot(ev) {
  ev.preventDefault();
  const email = $('fp-email').value.trim();
  const problem = emailProblem(email);
  fieldError('forgot-error', problem);
  const status = $('forgot-status');
  status.hidden = true;
  if (problem) { $('fp-email').focus({ preventScroll: true }); return; }
  const btn = $('forgot-submit');
  btn.disabled = true;
  btn.textContent = 'Mengirim…';
  try {
    state.store = new CloudStore(state.cfg);
    await state.store.requestPasswordReset(email, appRedirectUrl());
    status.hidden = false;
    status.classList.remove('error');
    status.textContent = 'If that email is registered, a reset link has been sent. Open the link on this device, then set a new password.';
  } catch (e) {
    status.hidden = false;
    status.classList.add('error');
    status.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send reset link';
  }
}
async function submitReset(ev) {
  ev.preventDefault();
  if (state.resetBusy) return;
  const password = $('rp-password').value;
  const problem = signupErrors({ email: 'ok@ok.id', password, username: 'aa' }).password || '';
  fieldError('reset-error', problem);
  if (problem) { $('rp-password').focus({ preventScroll: true }); return; }
  state.resetBusy = true;
  const btn = $('reset-submit');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const status = $('reset-status');
  try {
    await state.store.setNewPassword(password);
    $('rp-password').value = '';
    status.hidden = false;
    status.classList.remove('error');
    status.textContent = 'New password saved.';
    state.recovery = false;
    await enterWorkspace();
    notify('New password saved.');
  } catch (e) {
    status.hidden = false;
    status.classList.add('error');
    status.textContent = e.message;
  } finally {
    state.resetBusy = false;
    btn.disabled = false;
    btn.textContent = 'Save new password';
  }
}

/* ---------- bawaan: 11 kategori + akun Tunai ---------- */
async function ensureSeedState() {
  if (state.seedState?.supported) return state.seedState;
  try { state.seedState = await state.store.seedState(); }
  catch { state.seedState = { seeded: false, supported: false }; }
  return state.seedState;
}
async function runSeedDefaults() {
  if (state.seedBusy || !state.store) return { categories: 0, account: false };
  state.seedBusy = true;
  setButtons(false);
  try {
    let res;
    try { res = await state.store.seedTaxonomy(); }
    catch { res = await state.store.seedDefaults(); }
    state.seedState = { ...(await state.store.seedState()), seeded: true };
    state.taxonomyState = await state.store.taxonomySeeded().catch(() => ({ seeded: false, supported: false }));
    if ($('tax-seed')) $('tax-seed').hidden = true;
    await loadPlanning();
    state.accounts = (await state.store.accounts()).filter((a) => a && a.id);
    if (state.accounts.length) state.onbAccounts = [{ name: state.accounts[0].name, type: state.accounts[0].type, opening_balance: '' }];
    fillAccountOptions();
    fillCategorySelect();
    fillFilterCategories();
    renderOnbAccounts();
    render();
    $('onb-seed-note').textContent = res.categories || res.account
      ? `Siap: ${res.categories} new categories${res.account ? ' + a Cash account' : ''}. You can change them any time in the Budget tab.`
      : 'Default categories were already there. Nothing was duplicated.';
    notify(res.categories || res.account ? 'Default categories and account are ready.' : 'Default categories already exist; nothing was duplicated.');
    return res;
  } catch (e) {
    notify('Default categories could not be set up: ' + (e.message || 'galat'), true);
    return { categories: 0, account: false };
  } finally {
    state.seedBusy = false;
    setButtons(state.loaded);
  }
}

/* ---------- rekap harian: kartu per tanggal ---------- */
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dateTitle(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}
function recapData() {
  return recapDayGroups(state.all, state.month, expenseNames(), categoryCatalog());
}
function recapGroupId(date, category) {
  return `recap-${date}-${String(category).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`;
}
function recapEntryHTML(entry) {
  const note = String(entry.notes || '').trim();
  const noteEl = note
    ? `<button type="button" class="recap-entry-note" data-recap-note aria-expanded="false" title="${escapeHTML(note)}">${escapeHTML(note)}</button>`
    : '<span class="recap-entry-note empty">No note</span>';
  return `<li class="recap-entry"><span class="recap-time">${escapeHTML(entry.time || '—')}</span>${noteEl}<span class="recap-amt">${rp(entry.amount)}</span></li>`;
}
function recapDayHTML(day) {
  const groups = day.groups.map((g) => {
    const id = recapGroupId(day.date, g.category);
    const open = g.entries.length === 1;
    return `<li class="recap-group">
  <button type="button" class="recap-group-row" data-recap-group="${escapeHTML(day.date)}|${escapeHTML(g.category)}" aria-expanded="${open}" aria-controls="${id}">
  <span class="recap-icon" aria-hidden="true">${escapeHTML(g.icon)}</span>
  <span class="recap-cat" title="${LH(g.category)}">${LH(g.category)}</span>
  <span class="recap-count">${g.entries.length} entri</span>
  <span class="recap-amt">${rp(g.total)}</span>
  </button>
  <ul class="recap-entries" id="${id}"${open ? '' : ' hidden'}>${g.entries.map(recapEntryHTML).join('')}</ul>
  </li>`;
  }).join('');
  return `<article class="recap-day" id="recap-${day.date}" data-date="${day.date}">
  <header class="recap-day-head">
  <div class="recap-day-date"><b>${WEEKDAY[day.weekday]}</b><span>${dateTitle(day.date)}</span></div>
  <div class="recap-day-total"><span class="amount expense">${rp(day.total)}</span><small>${day.count} notes</small></div>
  </header>
  ${day.income > 0n ? `<span class="recap-day-in">+ ${rp(day.income)} income</span>` : ''}
  <ul class="recap-groups">${groups}</ul>
  </article>`;
}
function renderRecap() {
  if (!$('recap-days')) return;
  let data;
  try { data = recapData(); } catch { return; }
  $('recap-month').textContent = monthLabel(state.month);
  $('recap-totals').innerHTML = `
    
  <div class="recap-sum in"><b>Income</b><span>
${rp(data.totals.income)}</span></div>
  <div class="recap-sum out"><b>Expenses</b><span>
${rp(data.totals.expense)}</span></div>
  <div class="recap-sum"><b>Net</b><span class="${data.totals.balance < 0n ? 'negative' : ''}">${rp(data.totals.balance)}</span></div>`;
  $('recap-days').innerHTML = data.days.map(recapDayHTML).join('');
  const empty = $('recap-empty');
  empty.hidden = data.days.length > 0;
  empty.classList.toggle('show', data.days.length === 0);
  $('recap-sticky').innerHTML = `<span>${data.days.length} days recorded · ${escapeHTML(monthLabel(state.month))}</span><span><b>${rp(data.totals.expense)}</b> expenses</span>`;
}
function printRecapHTML(data) {
  if (!data.days.length) return '<p>No expense entries this month.</p>';
  return data.days.map((day) => `<table class="print-recap-day">
  <caption>${WEEKDAY[day.weekday]}, ${dateTitle(day.date)} — total ${rp(day.total)}</caption>
  <thead><tr><th>Category</th><th>Time · note</th><th class="amount">Amount</th></tr></thead>
  <tbody>
${day.groups.map((g) => g.entries.map((e, i) => `<tr>${i === 0 ? `<th scope="row" rowspan="${g.entries.length}">${LH(g.category)}</th>` : ''}<td>${escapeHTML(e.time || '—')} · ${escapeHTML(String(e.notes || '').trim() || 'no note')}</td><td class="amount">${rp(e.amount)}</td></tr>`).join('')).join('')}</tbody>
  <tfoot><tr><th colspan="2">Day total</th><td class="amount">
${rp(day.total)}</td></tr></tfoot>
  </table>`).join('');
}
function jumpToDay(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const iso = localDate(d);
  const month = iso.slice(0, 7);
  if (month !== state.month) {
    state.month = month;
    $('month').value = month;
    state.draft = null;
    render();
  }
  state.reportTab='daily'; setView('reports');
  const card = $(`recap-${iso}`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1400);
  } else {
    notify(`No entries on ${dateTitle(iso)}.`, false);
  }
}

/* ---------- kategori: daftar, formulir, urutan, arsip, hapus ---------- */
function renderCategories() {
  if (!$('cat-list')) return;
  const catalog = categoryCatalog();
  const stored = new Set(state.planning.categories.map((r) => String(r.name).trim().toLowerCase()));
  const active = catalog.filter((r) => !r.archived_at);
  $('cat-list').innerHTML = catalog.length ? catalog.map((r) => {
    const order = active.findIndex((a) => a.name === r.name);
    const isStored = stored.has(r.name.trim().toLowerCase());
    const icon = r.icon || CATEGORY_FALLBACK.icon;
    const color = r.color || CATEGORY_FALLBACK.color;
    const stateText = r.archived_at ? 'Archived · history kept' : !isStored ? 'Built-in · unchanged' : r.is_default ? 'Active · built-in category' : 'Active';
    return `<li class="cat-row ${r.archived_at ? 'is-archived' : ''}" data-cat-row="${escapeHTML(r.name)}">
  <span class="cat-swatch" style="background:${escapeHTML(color)}1f;border-color:${escapeHTML(color)}" aria-hidden="true">${escapeHTML(icon)}</span>
  <span class="cat-name"><b>${escapeHTML(r.name)}</b><small>${escapeHTML(r.kind || 'expense')}${r.group_name ? ` · ${escapeHTML(r.group_name)}` : ''} · ${stateText}${order > 0 ? ` · order ${order + 1}` : ''}</small></span>
  <span class="cat-actions">
  <button type="button" data-cat-up="${escapeHTML(r.name)}" aria-label="Move up ${escapeHTML(r.name)}" ${r.archived_at || order <= 0 ? 'disabled' : ''}>↑</button>
  <button type="button" data-cat-down="${escapeHTML(r.name)}" aria-label="Move down ${escapeHTML(r.name)}" ${r.archived_at || order < 0 || order >= active.length - 1 ? 'disabled' : ''}>↓</button>
  <button type="button" data-cat-edit="${escapeHTML(r.name)}" aria-label="Edit ${escapeHTML(r.name)}">Edit</button>
  <button type="button" data-cat-archive="${escapeHTML(r.name)}" aria-label="${r.archived_at ? 'Reactivate' : 'Archive'} ${escapeHTML(r.name)}">${r.archived_at ? 'Reactivate' : 'Archive'}</button>
  <button type="button" class="danger" data-cat-del="${escapeHTML(r.name)}" aria-label="Delete ${escapeHTML(r.name)}" title="${isStored ? 'Delete only if never used' : 'Built-in category: archive it if unused'}" ${isStored ? '' : 'disabled'}>Delete</button>
  </span>
  </li>
`;
  }).join('') : '<li class="cat-row"><span class="cat-name"><b>No expense categories yet.</b><small>Add your first category with the button above.</small></span></li>';

  const un = unbudgetedCategories(catalog, state.planning.budgets, state.month, state.all);
  $('cat-unbudgeted').hidden = !state.planningReady || !un.length;
  $('cat-unbudgeted-list').innerHTML = un.map((c) => `<li class="cat-unbudgeted-row">
  <span class="cat-swatch" style="background:${escapeHTML(c.color)}1f;border-color:${escapeHTML(c.color)}" aria-hidden="true">${escapeHTML(c.icon)}</span>
  <span class="cat-name"><b>${escapeHTML(c.name)}</b><small>Not budgeted · actual ${rp(c.actual)}</small></span>
  <span class="recap-amt">—</span>
  <button type="button" class="ghost-btn" data-cat-budget="${escapeHTML(c.name)}">Create budget</button>
  </li>
`).join('');
}
function renderCatPickers() {
  $('cat-icon-list').innerHTML = CATEGORY_ICONS.map((i) => `<button type="button" data-cat-icon="${escapeHTML(i)}" aria-pressed="${i === state.catIcon}" aria-label="Icon ${escapeHTML(i)}">${escapeHTML(i)}</button>`).join('');
  $('cat-color-list').innerHTML = CATEGORY_COLORS.map((c) => `<button type="button" data-cat-color="${c}" aria-pressed="${c === state.catColor}" aria-label="Color ${c}" style="color:${c}"></button>`).join('');
}
function openCategoryForm(name) {
  const row = name ? findCategory(state.planning.categories, name) : null;
  state.catEditing = row ? row.name : null;
  state.catIcon = row?.icon || CATEGORY_ICONS[0];
  state.catColor = row?.color || CATEGORY_COLORS[0];
  $('cat-form-title').textContent = row ? `Edit “${row.name}”` : 'New category';
  $('cat-name').value = row ? row.name : '';
  if ($('cat-kind')) { $('cat-kind').value = row?.kind || 'expense'; $('cat-kind').disabled = !!row; }
  fieldError('cat-error', '');
  $('cat-form').hidden = false;
  renderCatPickers();
  $('cat-name').focus({ preventScroll: true });
  $('cat-form').scrollIntoView({ block: 'nearest' });
}
async function refreshCategories(store) {
  /* Ganti nama kategori ikut menulis ulang transaksi, jadi muat ulang keduanya. */
  state.all = await store.all();
  await loadPlanning();
  if (!state.planningReady) throw Error('The change could not be reloaded. Check before retrying.');
  fillCategorySelect();
  fillFilterCategories();
  render();
}
async function saveCategoryForm(ev) {
  ev.preventDefault();
  if (state.busy || !state.planningReady) return;
  const rawName = $('cat-name').value;
  const editing = state.catEditing;
  const problem = editing
    ? categoryRenameError(editing, rawName, state.planning.categories)
    : categoryCreateError(rawName, state.planning.categories);
  if (problem) { fieldError('cat-error', problem); return; }
  fieldError('cat-error', '');
  state.busy = true;
  setButtons(false);
  const store = state.store, gen = state.generation;
  try {
    if (editing) {
      const current = findCategory(state.planning.categories, editing)
        || { name: editing, enabled: true, icon: '', color: '', sort_order: null, archived_at: null, is_default: false };
      const next = String(rawName).trim();
      if (next !== current.name) {
        await store.renameCategory(current.name, next);
        /* Baris baru sudah membawa rantai nama lama; jangan menimpanya. */
        const renamed = findCategory(await store.categories(), next) || { ...current, name: next };
        await store.saveCategory({ ...renamed, icon: state.catIcon, color: state.catColor });
      } else {
        await store.saveCategory({ ...current, name: next, icon: state.catIcon, color: state.catColor });
      }
      notify(next === current.name ? 'Category updated.' : 'Category renamed. Transactions and budgets follow the new name.');
    } else {
      const base = state.planning.categories.reduce((m, c) => Math.max(m, Number.isInteger(c.sort_order) ? c.sort_order : -1), -1) + 1;
      const kind = $('cat-kind')?.value || 'expense';
      const group = taxonOf(String(rawName).trim())?.group_name || (kind === 'income' ? 'Income' : kind === 'savings' ? 'Savings & Investment' : kind === 'obligation' ? 'Financial Obligations' : 'Other');
      await store.saveCategory({ name: rawName, kind, group_name: group, icon: state.catIcon, color: state.catColor, enabled: true, sort_order: base });
      notify('Category added.');
    }
    if (store !== state.store || gen !== state.generation) return;
    state.catEditing = null;
    $('cat-form').hidden = true;
    $('cat-status').textContent = '';
    await refreshCategories(store);
  } catch (e) {
    fieldError('cat-error', e.message);
    notify(e.message, true);
  } finally {
    state.busy = false;
    setButtons(state.loaded);
  }
}
/* Kategori bawaan (mis. Makan) belum tentu punya baris sendiri. Saat pertama
   kali diubah/diarsipkan/diurutkan, barisnya dibuat dulu agar perubahan punya
   tempat menyimpan ikon, warna, dan urutan. */
async function ensureCategoryRow(store, name) {
  const existing = findCategory(state.planning.categories, name);
  if (existing) return existing;
  const seed = SEED_CATEGORY_META[name] || {};
  const base = state.planning.categories.reduce((m, c) => Math.max(m, Number.isInteger(c.sort_order) ? c.sort_order : -1), -1) + 1;
  return store.saveCategory({
    name,
    enabled: true,
    icon: seed.icon || CATEGORY_ICONS[0],
    color: seed.color || CATEGORY_COLORS[0],
    sort_order: base,
    is_default: DEFAULT_SEED_CATEGORIES.includes(name),
  });
}
async function runCatAction(action, message) {
  if (state.busy) return;
  state.busy = true;
  setButtons(false);
  const store = state.store, gen = state.generation;
  $('cat-status').textContent = '';
  try {
    await action(store);
    if (store !== state.store || gen !== state.generation) return;
    await refreshCategories(store);
    notify(message);
  } catch (e) {
    $('cat-status').textContent = e.message;
    notify(e.message, true);
  } finally {
    state.busy = false;
    setButtons(state.loaded);
  }
}
async function deleteCategoryPrompt(name) {
  const row = findCategory(state.planning.categories, name);
  if (!row || state.busy) return;
  state.busy = true;
  setButtons(false);
  let usage;
  try { usage = await state.store.categoryUsage(row.name); }
  catch (e) { notify(e.message, true); state.busy = false; setButtons(state.loaded); return; }
  state.busy = false;
  setButtons(state.loaded);
  const block = categoryDeleteBlock(usage);
  if (block) {
    $('cat-status').textContent = block;
    notify(block, true);
    return;
  }
  if (!confirm(`Delete category “${row.name}”? This category has never been used by a transaction or a budget.`)) return;
  await runCatAction((store) => store.deleteCategory(row.name), `Category “${row.name}” deleted.`);
}
async function toggleArchiveCategory(name) {
  const row = findCategory(state.planning.categories, name) || categoryCatalog().find((r) => r.name === name);
  if (!row) return;
  const archived = !row.archived_at;
  await runCatAction(async (store) => {
    const target = findCategory(state.planning.categories, name) || await ensureCategoryRow(store, name);
    await store.archiveCategory(target.name, archived);
  }, archived ? `Category “${row.name}” archived. History stays intact.` : `Category “${row.name}” is active again.`);
}
async function moveCategoryRow(name, delta) {
  const pairs = moveCategory(categoryCatalog(), name, delta);
  if (!pairs.length) return;
  await runCatAction(async (store) => {
    for (const pair of pairs) {
      const row = findCategory(state.planning.categories, pair.name) || await ensureCategoryRow(store, pair.name);
      await store.saveCategory({ ...row, sort_order: pair.sort_order });
    }
  }, 'Category order saved.');
}
function focusBudgetFor(name) {
  setView('budget');
  const input = $$('[data-budget]').find((el) => el.dataset.budget === name);
  if (!input) { notify('Budget row not found. Reload and try again.', true); return; }
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  input.focus({ preventScroll: true });
  input.select?.();
  $('cat-status').textContent = `Enter a budget amount for “${name}” then tap Save.`;
  notify(`Enter a budget amount for ${name}, then tap Save.`);
}

/* ---------- pemasangan v5 ---------- */
function wireV5() {
  $('tab-login').addEventListener('click', () => authScreen('login'));
  $('tab-signup').addEventListener('click', () => authScreen('signup'));
  $('signup-to-login').addEventListener('click', () => authScreen('login'));
  $('signup').addEventListener('submit', submitSignup);
  $('resend-confirm').addEventListener('click', resendConfirmation);
  $('forgot-open').addEventListener('click', () => { authScreen('forgot'); $('fp-email').value = $('email').value.trim(); $('fp-email').focus({ preventScroll: true }); });
  $('forgot-back').addEventListener('click', () => authScreen('login'));
  $('forgot').addEventListener('submit', submitForgot);
  $('reset-form').addEventListener('submit', submitReset);
  wirePasswordToggle('su-password', 'su-toggle', 'su-strength');
  wirePasswordToggle('rp-password', 'rp-toggle', 'rp-strength');

  $('recap-prev').addEventListener('click', () => { state.month = shiftMonth(state.month, -1); $('month').value = state.month; state.draft = null; render(); });
  $('recap-next').addEventListener('click', () => { state.month = shiftMonth(state.month, 1); $('month').value = state.month; state.draft = null; render(); });
  $('recap-today').addEventListener('click', () => jumpToDay(0));
  $('recap-yesterday').addEventListener('click', () => jumpToDay(1));
  $('recap-days').addEventListener('click', (e) => {
    const note = e.target.closest('[data-recap-note]');
    if (note) {
      note.setAttribute('aria-expanded', String(note.getAttribute('aria-expanded') !== 'true'));
      return;
    }
    const row = e.target.closest('[data-recap-group]');
    if (!row) return;
    const [date, category] = row.dataset.recapGroup.split('|');
    const list = $(recapGroupId(date, category));
    if (!list) return;
    const open = row.getAttribute('aria-expanded') === 'true';
    row.setAttribute('aria-expanded', String(!open));
    list.hidden = open;
  });

  $('cat-new').addEventListener('click', () => openCategoryForm(null));
  $('cat-cancel').addEventListener('click', () => { state.catEditing = null; $('cat-form').hidden = true; fieldError('cat-error', ''); });
  $('cat-form').addEventListener('submit', saveCategoryForm);
  $('cat-icon-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat-icon]');
    if (!b) return;
    state.catIcon = b.dataset.catIcon;
    renderCatPickers();
  });
  $('cat-color-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat-color]');
    if (!b) return;
    state.catColor = b.dataset.catColor;
    renderCatPickers();
  });
  $('cat-list').addEventListener('click', (e) => {
    const up = e.target.closest('[data-cat-up]');
    if (up) return void moveCategoryRow(up.dataset.catUp, -1);
    const down = e.target.closest('[data-cat-down]');
    if (down) return void moveCategoryRow(down.dataset.catDown, 1);
    const edit = e.target.closest('[data-cat-edit]');
    if (edit) return void openCategoryForm(edit.dataset.catEdit);
    const arch = e.target.closest('[data-cat-archive]');
    if (arch) return void toggleArchiveCategory(arch.dataset.catArchive);
    const del = e.target.closest('[data-cat-del]');
    if (del) return void deleteCategoryPrompt(del.dataset.catDel);
  });
  $('cat-unbudgeted-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat-budget]');
    if (b) focusBudgetFor(b.dataset.catBudget);
  });
}

/* ---------- mulai ---------- */
wire();
wireV4();
wireAssets();
wireV5();
wireV7();
resetForm();
boot();

/* ============================================================
   Info tooltips (.hint)
   A small ⓘ that opens its explanation on tap/click, never on hover.
   Keyboard: Tab to the button, Enter/Space toggles, Escape closes.
   Tap outside closes too. The panel is re-parented to <body> and positioned
   with fixed coordinates clamped to the visual viewport, so it can never
   overflow a 390px-wide phone and it is not trapped by a transformed or
   backdrop-filtered ancestor.
   ============================================================ */
function hintPanels() { return $$('.hint-panel'); }

function closeHint(panel, { restoreFocus = false } = {}) {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  const btn = document.querySelector('.hint-btn[aria-controls="' + panel.id + '"]');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  if (panel.__home && panel.__home.isConnected) panel.__home.appendChild(panel);
  panel.style.left = '';
  panel.style.top = '';
  if (restoreFocus && btn) btn.focus();
}

function closeAllHints(except) {
  hintPanels().forEach((p) => { if (p !== except) closeHint(p); });
}

function placeHint(btn, panel) {
  const r = btn.getBoundingClientRect();
  const vv = window.visualViewport;
  const viewW = vv ? vv.width : window.innerWidth;
  const viewH = vv ? vv.height : window.innerHeight;
  const offTop = vv ? vv.offsetTop : 0;
  const offLeft = vv ? vv.offsetLeft : 0;
  const gap = 8;
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  let left = r.left + r.width / 2 - pw / 2 - offLeft;
  left = Math.max(gap, Math.min(left, viewW - pw - gap));
  let top = r.bottom - offTop + gap;
  let above = false;
  if (top + ph > viewH - gap) { top = r.top - offTop - ph - gap; above = true; }   /* flip above */
  top = Math.max(offTop + gap, Math.min(top, offTop + viewH - ph - gap));
  panel.dataset.side = above ? 'above' : 'below';
  panel.style.setProperty('--arrow-x', Math.round(r.left + r.width / 2 - left - offLeft) + 'px');
  panel.style.left = Math.round(left + offLeft) + 'px';
  panel.style.top = Math.round(top + offTop) + 'px';
}

function openHint(btn) {
  const panel = document.getElementById(btn.getAttribute('aria-controls'));
  if (!panel) return;
  closeAllHints(panel);
  if (panel.parentElement !== document.body) {
    panel.__home = panel.parentElement;
    document.body.appendChild(panel);
  }
  panel.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  placeHint(btn, panel);
}

function toggleHint(btn) {
  const panel = document.getElementById(btn.getAttribute('aria-controls'));
  if (!panel) return;
  if (!panel.hidden) closeHint(panel);
  else openHint(btn);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('.hint-btn');
  if (btn) {
    e.preventDefault();
    toggleHint(btn);
    return;
  }
  if (!e.target.closest || !e.target.closest('.hint-panel')) closeAllHints();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = hintPanels().find((p) => !p.hidden);
  if (!open) return;
  /* capture phase: Escape closes the tooltip first, not the dialog behind it */
  e.preventDefault();
  e.stopPropagation();
  closeHint(open, { restoreFocus: true });
}, true);

const repositionHints = () => {
  hintPanels().forEach((p) => {
    if (p.hidden) return;
    const btn = document.querySelector('.hint-btn[aria-controls="' + p.id + '"]');
    if (btn) placeHint(btn, p);
  });
};
window.addEventListener('resize', repositionHints);
window.addEventListener('scroll', repositionHints, { passive: true });
window.visualViewport?.addEventListener('resize', repositionHints);
window.visualViewport?.addEventListener('scroll', repositionHints);

/* iOS keyboard: track the real visible height so the bottom sheet and the
   modals stay usable while the keyboard is open (falls back to 100dvh). */
function syncViewportHeight() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  const root = document.documentElement;
  root.style.setProperty('--app-vh', Math.round(h) + 'px');
  /* how much the on-screen keyboard covers at the bottom of the layout viewport */
  const inset = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  root.style.setProperty('--kb-inset', inset + 'px');
}
syncViewportHeight();
window.addEventListener('resize', syncViewportHeight);
window.visualViewport?.addEventListener('resize', syncViewportHeight);
window.addEventListener('orientationchange', syncViewportHeight);

/* ============================================================
   Kantong v7 — savings goals, group budgets, report sub-views.

   Everything here is additive: the v3–v6 paths keep working, and a
   failed v7 load (migration not run) only disables the savings screen.
   ============================================================ */

async function loadV7() {
  state.goals = [];
  state.goalsReady = false;
  try {
    state.goals = await state.store.goals();
    state.goalsReady = true;
  } catch {
    state.goalsReady = false;
    state.goals = [];
  }
  try {
    state.taxonomyState = await state.store.taxonomySeeded();
  } catch {
    state.taxonomyState = { seeded: false, supported: false };
  }
  if ($('tax-seed')) $('tax-seed').hidden = !state.taxonomyState.supported || !!state.taxonomyState.seeded;
  fillGoalOptions();
}

async function runTaxonomySeed() {
  if (state.seedBusy || !state.store) return { categories: 0, account: false };
  state.seedBusy = true;
  setButtons(false);
  try {
    const res = await state.store.seedTaxonomy();
    state.taxonomyState = await state.store.taxonomySeeded();
    await loadPlanning();
    state.accounts = (await state.store.accounts()).filter((a) => a && a.id);
    fillAccountOptions();
    fillCategorySelect();
    fillFilterCategories();
    if ($('tax-seed')) $('tax-seed').hidden = true;
    render();
    $('cat-status').textContent = res.skipped
      ? 'The category set was already added once. Nothing was re-created.'
      : `Added ${res.categories} categories${res.account ? ' and a Cash account' : ''}. Rename, archive or delete any of them.`;
    notify(res.skipped ? 'Category set already present; nothing duplicated.' : 'Category set added.');
    return res;
  } catch (e) {
    notify(e.message || 'The category set could not be added.', true);
    return { categories: 0, account: false };
  } finally {
    state.seedBusy = false;
    setButtons(state.loaded);
  }
}

/* ---------- savings goals ---------- */
function goalById(id) { return state.goals.find((g) => g.id === id) || null; }
function goalDateLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

function goalCardHTML(p) {
  const g = p.goal;
  const due = p.daysLeft === null ? 'No target date'
    : p.daysLeft < 0 ? `Target date passed (${goalDateLabel(g.deadline)})`
      : `${p.daysLeft} days left · ${goalDateLabel(g.deadline)}`;
  return `<article class="goal-card${p.done ? ' is-done' : ''}" data-goal-card="${escapeHTML(g.id)}">
  <div class="goal-card-head">
  <span class="goal-dot" style="background:${escapeHTML(g.color)}" aria-hidden="true">${escapeHTML(g.icon || '🎯')}</span>
  <div class="goal-title"><h3>${escapeHTML(g.name)}</h3><p class="note">${escapeHTML(due)}</p></div>
  <span class="goal-pct">${p.pct.toFixed(0)}%</span>
  </div>
  <p class="goal-fig"><b>${rp(p.saved)}</b> <span>of ${rp(p.target)}</span></p>
  <div class="progress" role="img" aria-label="${escapeHTML(g.name)} ${p.pct.toFixed(0)} percent"><i style="width:${p.cappedPct}%"></i></div>
  <p class="goal-meta">${p.done ? 'Goal reached.' : `${rp(p.remaining)} to go`} · ${p.contributions} contribution${p.contributions === 1 ? '' : 's'}${p.manual > 0n ? ` · started with ${rp(p.manual)}` : ''}</p>
  <form class="goal-contribute" data-goal-contribute="${escapeHTML(g.id)}">
  <input data-goal-amount data-money inputmode="numeric" pattern="[0-9]*" placeholder="Add amount" aria-label="Contribution to ${escapeHTML(g.name)}">
  <button class="ghost-btn" type="submit">Add money</button>
  </form>
  <div class="goal-actions">
  <button type="button" class="ghost-btn" data-goal-edit="${escapeHTML(g.id)}">Edit</button>
  <button type="button" class="ghost-btn" data-goal-archive="${escapeHTML(g.id)}">Archive</button>
  <button type="button" class="ghost-btn danger" data-goal-del="${escapeHTML(g.id)}">Delete</button>
  </div>
  </article>`;
}

function renderGoals() {
  const cards = $('goal-cards');
  if (!cards) return;
  const ov = goalsOverview(state.goals, state.all, localDate());
  $('goal-summary').innerHTML = ov.count
    ? `<div class="goal-total"><p class="eyebrow">Across ${ov.count} active goal${ov.count === 1 ? '' : 's'}</p>
  <p class="figure small">${rp(ov.saved)} <small>of ${rp(ov.target)}</small></p>
  <div class="progress"><i style="width:${ov.target > 0n ? Math.min(100, Number((ov.saved * 100n) / ov.target)) : 0}%"></i></div>
  <p class="note">${ov.done} reached · ${ov.count - ov.done} in progress</p></div>`
    : '';
  cards.innerHTML = ov.rows.map(goalCardHTML).join('');
  $('goal-empty').hidden = false;
  $('goal-empty').classList.toggle('show', ov.rows.length === 0 && state.goalsReady);
  $('goal-template-list').innerHTML = GOAL_TEMPLATES.map((t) => `<button type="button" class="template-chip" data-goal-template="${escapeHTML(t.name)}">${escapeHTML(t.icon)} ${escapeHTML(t.name)}</button>`).join('');
  const archived = state.goals.filter((g) => g.archived_at);
  $('goal-archived-wrap').hidden = !archived.length;
  $('goal-archived').innerHTML = archived.map((g) => `<li class="cat-row"><span class="cat-name"><b>${escapeHTML(g.name)}</b><small>Archived · ${rp(g.target_amount)} target</small></span><span class="cat-actions"><button type="button" data-goal-restore="${escapeHTML(g.id)}">Restore</button></span></li>`).join('');
  fillGoalOptions();
  if (!state.goalsReady) $('goal-status').textContent = 'Savings goals need migration v7. Run supabase/migration-v7.sql once, then Reload.';
}

function openGoalForm(id, template = null) {
  if (!state.goalsReady) { notify('Savings goals need the v7 migration first.', true); return; }
  const row = id ? goalById(id) : null;
  state.goalEditing = row ? row.id : null;
  state.goalIcon = row?.icon || template?.icon || '🎯';
  state.goalColor = row?.color || '#1c6b4b';
  $('goal-form-title').textContent = row ? `Edit “${row.name}”` : 'New savings goal';
  $('goal-name').value = row?.name || template?.name || '';
  $('goal-target').value = row ? formatRupiahInput(String(row.target_amount)) : formatRupiahInput(template?.target_amount || '');
  $('goal-saved').value = row && row.saved_amount ? formatRupiahInput(String(row.saved_amount)) : '';
  $('goal-deadline').value = row?.deadline || '';
  fillGoalAccountOptions();
  $('goal-account').value = row?.account_id || '';
  $('goal-error').hidden = true;
  $('goal-form').hidden = false;
  renderGoalPickers();
  $('goal-name').focus({ preventScroll: true });
  $('goal-form').scrollIntoView({ block: 'nearest' });
}

function fillGoalAccountOptions() {
  const sel = $('goal-account');
  if (!sel) return;
  const rows = state.v4Ready ? state.accounts.filter((a) => !a.is_archived) : [];
  sel.innerHTML = '<option value="">No account</option>' + rows.map((a) => `<option value="${escapeHTML(a.id)}">${escapeHTML(a.name)}</option>`).join('');
}

function renderGoalPickers() {
  $('goal-icon-list').innerHTML = CATEGORY_ICONS.map((i) => `<button type="button" data-goal-icon="${escapeHTML(i)}" aria-pressed="${i === state.goalIcon}" aria-label="Icon ${escapeHTML(i)}">${escapeHTML(i)}</button>`).join('');
  $('goal-color-list').innerHTML = CATEGORY_COLORS.map((c) => `<button type="button" data-goal-color="${c}" aria-pressed="${c === state.goalColor}" aria-label="Color ${c}" style="color:${c}"></button>`).join('');
}

function closeGoalForm() {
  state.goalEditing = null;
  $('goal-form').hidden = true;
  $('goal-error').hidden = true;
}

async function submitGoal(ev) {
  ev.preventDefault();
  if (state.busy || !state.goalsReady) return;
  let clean;
  try {
    clean = validateGoal({
      name: $('goal-name').value,
      target_amount: $('goal-target').value,
      saved_amount: $('goal-saved').value,
      deadline: $('goal-deadline').value || null,
      account_id: $('goal-account').value || null,
      color: state.goalColor,
      icon: state.goalIcon,
    });
  } catch (e) {
    $('goal-error').hidden = false;
    $('goal-error').textContent = e.message;
    return;
  }
  state.busy = true;
  setButtons(false);
  const store = state.store, gen = state.generation;
  try {
    const saved = await store.saveGoal(clean, state.goalEditing);
    if (store !== state.store || gen !== state.generation) return;
    state.goals = await store.goals();
    closeGoalForm();
    render();
    notify(state.goalEditing ? 'Savings goal updated.' : 'Savings goal created. Add money any time.');
  } catch (e) {
    $('goal-error').hidden = false;
    $('goal-error').textContent = e.message;
    notify(e.message, true);
  } finally {
    state.busy = false;
    setButtons(state.loaded);
  }
}

async function contributeGoal(id, rawAmount) {
  const goal = goalById(id);
  if (!goal || state.busy) return;
  const amount = String(rawAmount || '').replace(/[^\d]/g, '');
  if (!amount) { notify('Enter the amount you want to set aside.', true); return; }
  let payload;
  try {
    payload = validate({
      type: 'savings',
      category: goal.category || goal.name,
      amount,
      date: localDate(),
      notes: `Savings · ${goal.name}`,
      account_id: goal.account_id || null,
      payment_method: goal.account_id ? 'Transfer' : null,
      need_want: null,
      goal_id: goal.id,
    });
  } catch (e) { notify(e.message, true); return; }
  state.busy = true;
  setButtons(false);
  const store = state.store, gen = state.generation;
  try {
    const saved = await store.save(payload, null);
    if (store !== state.store || gen !== state.generation) return;
    state.all.push(saved);
    render();
    notify(`Saved ${rp(payload.amount)} towards ${goal.name}.`);
  } catch (e) {
    notify(e.message || 'The contribution could not be saved.', true);
  } finally {
    state.busy = false;
    setButtons(state.loaded);
  }
}

async function archiveGoalFlow(id, archived) {
  if (state.busy) return;
  state.busy = true;
  setButtons(false);
  try {
    await state.store.archiveGoal(id, archived);
    state.goals = await state.store.goals();
    render();
    notify(archived ? 'Goal archived. History stays in place.' : 'Goal restored.');
  } catch (e) { notify(e.message, true); }
  finally { state.busy = false; setButtons(state.loaded); }
}

async function deleteGoalFlow(id) {
  const goal = goalById(id);
  if (!goal || state.busy) return;
  if (!confirm(`Delete the savings goal “${goal.name}”? Savings entries stay in the ledger.`)) return;
  state.busy = true;
  setButtons(false);
  try {
    await state.store.deleteGoal(id);
    state.goals = await state.store.goals();
    render();
    notify('Savings goal deleted.');
  } catch (e) { notify(e.message, true); }
  finally { state.busy = false; setButtons(state.loaded); }
}

/* ---------- group budgets ---------- */
function renderGroupBudgets() {
  const body = $('group-budget-rows');
  if (!body) return;
  const direct = (group) => state.planning.budgets.find((b) => b.month === state.month && (b.scope || 'category') === 'group' && b.category === group);
  const summed = (group) => state.planning.budgets.filter((b) => b.month === state.month && (b.scope || 'category') === 'category' && taxonOf(b.category)?.group_name === group).reduce((s, b) => s + BigInt(b.amount), 0n);
  const rows = budgetGroupRows(state.all, state.month, state.planning.budgets).filter((r) => TAXONOMY.expenseGroups.some((g) => g.name === r.group));
  body.innerHTML = rows.map((r) => {
    const d = direct(r.group);
    const sum = summed(r.group);
    return `<tr><th><span class="swatch" style="background:${groupMeta(r.group).color}"></span> ${escapeHTML(r.group)}</th>
  <td><input aria-label="Group budget ${escapeHTML(r.group)}" data-group-budget="${escapeHTML(r.group)}" data-budget-scope="group" data-money inputmode="numeric" type="text" placeholder="${sum > 0n ? `Sum ${rp(sum)}` : 'Not budgeted'}" value="${d ? formatRupiahInput(String(d.amount)) : ''}"></td>
  <td>${rp(r.actual)}</td><td class="${r.gap !== null && r.gap < 0n ? 'negative' : ''}">${r.gap === null ? '—' : rp(r.gap)}</td></tr>`;
  }).join('');
}

/* ---------- one save action for the whole budget table ---------- */
const budgetKey = (scope, name) => `${scope}|${name}`;

function budgetStoredValue(scope, name) {
  const row = state.planning.budgets.find((b) => b.month === state.month && (b.scope || 'category') === scope && b.category === name);
  return row ? String(row.amount) : '';
}

function markBudgetDirty(el) {
  const scope = el.dataset.budgetScope === 'group' ? 'group' : 'category';
  const name = el.dataset.budget || el.dataset.groupBudget;
  if (!name) return;
  const value = rupiahDigits(el.value);
  const stored = budgetStoredValue(scope, name);
  const key = budgetKey(scope, name);
  let same = false;
  if (value === '' && stored === '') same = true;
  else if (/^\d+$/.test(value) && /^\d+$/.test(stored) && value !== '' && stored !== '') same = BigInt(value) === BigInt(stored);
  if (same) state.budgetDirty.delete(key);
  else state.budgetDirty.set(key, value);
  paintBudgetDirty();
}

function paintBudgetDirty() {
  const n = state.budgetDirty.size;
  const save = $('budget-save'), discard = $('budget-discard'), note = $('budget-dirty');
  if (!save) return;
  const blocked = state.busy || state.loading || !state.planningReady;
  save.disabled = blocked || n === 0;
  discard.disabled = blocked || n === 0;
  save.textContent = n ? `Save ${n} change${n === 1 ? '' : 's'}` : 'Save changes';
  if (!blocked) note.textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}. Nothing is written until you save.` : 'No unsaved changes.';
}

function restoreDirtyInputs() {
  for (const [key, value] of state.budgetDirty) {
    const [scope, name] = key.split('|');
    const el = scope === 'group'
      ? $$('[data-group-budget]').find((i) => i.dataset.groupBudget === name)
      : $$('[data-budget]').find((i) => i.dataset.budget === name);
    if (el) el.value = value === '' ? '' : formatRupiahInput(value);
  }
}

async function saveBudgetChanges() {
  if (!state.budgetDirty.size || state.busy || !state.planningReady) return;
  const entries = [...state.budgetDirty.entries()].map(([key, value]) => {
    const [scope, category] = key.split('|');
    return { scope, category, amount: value };
  });
  state.busy = true;
  setButtons(false);
  $('budget-save').textContent = 'Saving…';
  const store = state.store, gen = state.generation;
  try {
    const res = await store.saveBudgetBatch(state.month, entries);
    if (store !== state.store || gen !== state.generation) return;
    for (const row of res.saved) state.budgetDirty.delete(budgetKey(row.scope, row.category));
    await loadPlanning();
    render();
    if (res.failed.length) {
      restoreDirtyInputs();
      $('budget-dirty').textContent = `Saved ${res.saved.length}, ${res.failed.length} failed: ${res.failed.map((f) => f.category).join(', ')}. Those rows are still unsaved.`;
      notify(`Budget partly saved: ${res.failed.length} row(s) failed.`, true);
    } else {
      notify(`Budget saved · ${res.saved.length} change${res.saved.length === 1 ? '' : 's'}.`);
      $('budget-dirty').textContent = `Saved ${res.saved.length} change${res.saved.length === 1 ? '' : 's'}.`;
      setTimeout(() => { if (!state.budgetDirty.size && $('budget-dirty')) $('budget-dirty').textContent = 'No unsaved changes.'; }, 4000);
    }
  } catch (e) {
    notify(e.message || 'The budget could not be saved.', true);
  } finally {
    state.busy = false;
    setButtons(state.loaded);
    paintBudgetDirty();
  }
}

function discardBudgetChanges() {
  if (!state.budgetDirty.size) return;
  state.budgetDirty.clear();
  render();
  notify('Budget changes discarded.');
}


function exportGoalsCSV() {
  if (!state.loaded) return;
  const header = ['goal', 'category', 'target_idr', 'saved_idr', 'progress_percent', 'remaining_idr', 'deadline', 'status'];
  const rows = goalsOverview(state.goals, state.all, localDate()).rows.map((r) => [
    r.goal.name, r.goal.category || '', r.target.toString(), r.saved.toString(),
    r.pct.toFixed(1), r.remaining.toString(), r.goal.deadline || '', r.done ? 'reached' : 'in progress',
  ]);
  download(`kantong-goals-${localDate()}.csv`, reportCSV(header, rows), 'text/csv;charset=utf-8');
  notify('Savings goals CSV downloaded.');
}

/* ---------- reusable money field: Rp prefix, live range helper, validity ---------- */
const MONEY_MAX = 9007199254740991;
const MONEY_BOUNDS = {
  amount: { min: 1, max: MONEY_MAX },
  'opening-balance': { min: 0, max: MONEY_MAX },
  'sched-amount': { min: 1, max: MONEY_MAX },
  'acc-opening': { min: 0, max: MONEY_MAX },
  'acc-current': { min: 0, max: MONEY_MAX },
  'tr-amount': { min: 1, max: MONEY_MAX },
  'inv-value': { min: 0, max: MONEY_MAX },
  'scenario-income': { min: 0, max: MONEY_MAX },
  'onb-amount': { min: 0, max: MONEY_MAX },
  'goal-target': { min: 1, max: MONEY_MAX },
  'goal-saved': { min: 0, max: MONEY_MAX },
};
const moneyRp = (n) => `Rp${formatRupiahInput(String(n))}`;

function moneyBounds(input) {
  const key = input.id || (input.dataset.budget ? `budget:${input.dataset.budget}` : '') || (input.dataset.groupBudget ? `group:${input.dataset.groupBudget}` : '');
  const base = MONEY_BOUNDS[key] || { min: 0, max: MONEY_MAX };
  const min = input.dataset.moneyMin !== undefined ? Number(input.dataset.moneyMin) : base.min;
  const max = input.dataset.moneyMax !== undefined ? Number(input.dataset.moneyMax) : base.max;
  return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : MONEY_MAX };
}

function moneyFieldMissing(input) {
  return !!input.required && String(input.value ?? '').trim() === '';
}

function moneyFieldError(input) {
  const raw = String(input.value ?? '');
  if (raw.trim() === '') return '';
  const digits = rupiahDigits(raw);
  if (!/^\d+$/.test(digits)) return 'Digits only — no comma, no decimal.';
  let value;
  try { value = BigInt(digits); } catch { return 'Digits only — no comma, no decimal.'; }
  const { min, max } = moneyBounds(input);
  if (value < BigInt(min)) return `Minimum ${moneyRp(min)}.`;
  if (value > BigInt(max)) return `Maximum ${moneyRp(max)}.`;
  return '';
}

function enhanceMoneyField(input) {
  if (!input || input.closest('.money-input')) return;
  const bounds = moneyBounds(input);
  const wrap = document.createElement('div');
  wrap.className = 'money-input';
  const prefix = document.createElement('span');
  prefix.className = 'money-prefix';
  prefix.setAttribute('aria-hidden', 'true');
  prefix.textContent = 'Rp';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(prefix);
  wrap.appendChild(input);
  const field = document.createElement('div');
  field.className = 'money-field';
  wrap.parentNode.insertBefore(field, wrap);
  field.appendChild(wrap);
  const help = document.createElement('p');
  help.className = 'money-help';
  help.id = `${input.id || input.dataset.budget || input.dataset.groupBudget || 'money'}-range`.replace(/[^A-Za-z0-9_-]/g, '-');
  help.dataset.base = `Amount allowed: ${moneyRp(bounds.min)} – ${moneyRp(bounds.max)}`;
  help.textContent = help.dataset.base;
  field.appendChild(help);
  input.setAttribute('aria-describedby', help.id);
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('pattern', '[0-9]*');
  input.setAttribute('autocomplete', 'off');
  /* The displayed value contains thousand dots, so native pattern validation
     would block submit. The app validates the digits itself. */
  const form = input.closest('form');
  if (form && !form.hasAttribute('novalidate')) form.setAttribute('novalidate', '');
}

function enhanceMoneyFields() {
  $$('[data-money]').forEach(enhanceMoneyField);
}

function applyMoneyFormat(el) {
  if (!el || !el.dataset || el.dataset.money === undefined) return;
  const raw = String(el.value ?? '');
  const caret = typeof el.selectionStart === 'number' ? el.selectionStart : raw.length;
  const digitsBefore = countDigitsBefore(raw, caret);
  const next = formatRupiahInput(raw);
  if (next === raw) return;
  el.value = next;
  try {
    const pos = caretForDigits(next, digitsBefore);
    el.setSelectionRange(pos, pos);
  } catch { /* input type without selection support */ }
}

function refreshMoneyValidity() {
  $$('[data-money]').forEach((input) => {
    const field = input.closest('.money-field');
    if (!field) return;
    const err = moneyFieldError(input);
    const missing = moneyFieldMissing(input);
    field.classList.toggle('is-invalid', !!err);
    const help = field.querySelector('.money-help');
    const text = err || help?.dataset.base || '';
    if (help && help.textContent !== text) help.textContent = text;
    const form = input.closest('form');
    if (form) {
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = !!err || missing || state.busy || state.loading || !state.loaded;
    }
  });
  if ($('budget-save')) {
    const bad = $$('#budget-rows [data-money], #group-budget-rows [data-money]').some((i) => moneyFieldError(i));
    if (bad) $('budget-save').disabled = true;
  }
}

function paintMoneyInputs() {
  enhanceMoneyFields();
  $$('[data-money]').forEach((el) => { if (el.value) el.value = formatRupiahInput(el.value); });
  refreshMoneyValidity();
}

/* ---------- wiring ---------- */
function wireV7() {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('report-subnav', 'click', (e) => {
    const b = e.target.closest('[data-report]');
    if (!b) return;
    state.reportTab = b.dataset.report;
    setView('reports');
  });
  on('dash-goal-open', 'click', () => setView('savings'));
  on('tx-more', 'click', () => { state.txExpanded = !state.txExpanded; renderTable(currentRecap()); });
  on('goal-new', 'click', () => openGoalForm(null));
  on('goal-cancel', 'click', closeGoalForm);
  on('goal-form', 'submit', submitGoal);
  on('goal-icon-list', 'click', (e) => {
    const b = e.target.closest('[data-goal-icon]');
    if (!b) return;
    state.goalIcon = b.dataset.goalIcon;
    renderGoalPickers();
  });
  on('goal-color-list', 'click', (e) => {
    const b = e.target.closest('[data-goal-color]');
    if (!b) return;
    state.goalColor = b.dataset.goalColor;
    renderGoalPickers();
  });
  on('goal-template-list', 'click', (e) => {
    const b = e.target.closest('[data-goal-template]');
    if (!b) return;
    const t = GOAL_TEMPLATES.find((x) => x.name === b.dataset.goalTemplate);
    if (state.goals.some((g) => g.name.toLowerCase() === String(t.name).toLowerCase() && !g.archived_at)) {
      notify(`“${t.name}” already exists. Edit it instead of creating a duplicate.`, true);
      return;
    }
    openGoalForm(null, t);
  });
  on('goal-cards', 'click', (e) => {
    const edit = e.target.closest('[data-goal-edit]');
    if (edit) return void openGoalForm(edit.dataset.goalEdit);
    const arch = e.target.closest('[data-goal-archive]');
    if (arch) return void archiveGoalFlow(arch.dataset.goalArchive, true);
    const del = e.target.closest('[data-goal-del]');
    if (del) return void deleteGoalFlow(del.dataset.goalDel);
  });
  on('goal-cards', 'submit', (e) => {
    const form = e.target.closest('[data-goal-contribute]');
    if (!form) return;
    e.preventDefault();
    void contributeGoal(form.dataset.goalContribute, form.querySelector('[data-goal-amount]').value);
  });
  on('goal-archived', 'click', (e) => {
    const b = e.target.closest('[data-goal-restore]');
    if (b) void archiveGoalFlow(b.dataset.goalRestore, false);
  });
  on('tax-seed', 'click', () => void runTaxonomySeed());
  on('csv-goals', 'click', exportGoalsCSV);
  /* One delegated listener covers every present and future money field. */
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el && el.matches && el.matches('[data-money]')) {
      enhanceMoneyField(el);
      applyMoneyFormat(el);
      refreshMoneyValidity();
    }
  });
  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (el && el.matches && el.matches('[data-money]')) paintMoneyInputs();
  }, true);
  const markBudget = (e) => {
    const el = e.target;
    if (el && el.matches && el.matches('[data-budget],[data-group-budget]')) markBudgetDirty(el);
  };
  on('budget-rows', 'input', markBudget);
  on('group-budget-rows', 'input', markBudget);
  on('budget-save', 'click', () => void saveBudgetChanges());
  on('budget-discard', 'click', discardBudgetChanges);
  /* type switch: refresh categories and show the goal picker only for savings */
  $$('input[name="type"]').forEach((r) => r.addEventListener('change', () => {
    fillCategorySelect();
    const v = r.value;
    const names = entryCategories(v);
    $('category').value = names[0] || '';
    toggleGoalField();
  }));
}

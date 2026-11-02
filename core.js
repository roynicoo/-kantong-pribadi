export const CATEGORIES={income:['Gaji','Usaha','Hadiah','Lainnya'],expense:['Makan','Laundry','Kosan','Transport','Listrik','Internet','Rokok','Andreas','Ortu','UKT','ETC','Transportasi','Belanja','Tagihan','Kesehatan','Hiburan','Lainnya']};
/* v7 kinds. `income` and `expense` keep their v3 meaning; the two new kinds are
   money that leaves the spending budget but is not an expense: money you keep
   (savings/investments) and money you owe (obligations). */
export const TX_KINDS = ['income', 'expense', 'savings', 'obligation'];
export const PAYMENT_METHODS = ['Cash', 'Debit', 'Credit', 'QRIS', 'E-Wallet', 'Transfer'];
export const NEED_WANT = ['need', 'want'];
export function categoryName(raw){const name=String(raw??'').trim();if(!/^[A-Za-z0-9][A-Za-z0-9 ._&()/-]{0,49}$/.test(name)||['Gaji','Usaha','Hadiah'].includes(name))throw Error('Expense category: 1–50 letters/numbers, spaces or . _ & ( ) / - — not an income category.');return name;}
export function localDate(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function monthBounds(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Invalid month');const [y,m]=month.split('-').map(Number);return [`${month}-01`,`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-01`];}
export function recap(all,month){const [start,end]=monthBounds(month);const rows=sortTransactions(all.filter(t=>t.date>=start&&t.date<end));let income=0n,expense=0n,savings=0n,obligation=0n;const categories=Object.create(null),savingsCategories=Object.create(null);for(const t of rows){const n=BigInt(t.amount);if(t.type==='income')income+=n;else if(t.type==='savings'){savings+=n;savingsCategories[t.category]=(savingsCategories[t.category]||0n)+n;}else if(t.type==='obligation')obligation+=n;else{expense+=n;categories[t.category]=(categories[t.category]||0n)+n;}}return {rows,income,expense,savings,obligation,balance:income-expense,net:income-expense-savings-obligation,categories,savingsCategories};}
export function validate(t){
 const type=String(t.type??'');
 if(!TX_KINDS.includes(type))throw Error('Invalid type or category.');
 if(type==='income'){if(!CATEGORIES.income.includes(t.category))throw Error('Invalid type or category.');}
 else{categoryName(t.category);if(t.category!==String(t.category).trim())throw Error('Invalid category.');}
 const raw=String(t.amount);const amount=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(amount)||amount<=0)throw Error('The amount must be positive whole rupiah, at most 9,007,199,254,740,991.');
 const date=String(t.date);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'0001-01-01'||date>'9999-12-31'||Number.isNaN(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Invalid date.');
 const notes=String(t.notes||'').trim();if(notes.length>500)throw Error('A note can be at most 500 characters.');
 const account_id=t.account_id===null||t.account_id===undefined||t.account_id===''?null:String(t.account_id);
 /* v7 optional fields. Empty means "not recorded", never a guessed default. */
 const pm=t.payment_method===null||t.payment_method===undefined||t.payment_method===''?null:String(t.payment_method);
 if(pm!==null&&!PAYMENT_METHODS.includes(pm))throw Error('Pick a payment method from the list.');
 const nw=t.need_want===null||t.need_want===undefined||t.need_want===''?null:String(t.need_want);
 if(nw!==null&&!NEED_WANT.includes(nw))throw Error('Pick need or want.');
 const goal_id=t.goal_id===null||t.goal_id===undefined||t.goal_id===''?null:String(t.goal_id);
 return {type,category:t.category,amount,date,notes,account_id,payment_method:pm,need_want:nw,goal_id};
}
export function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
/* One explicit ordering for every ledger view and both stores:
   newest transaction date first, then the most recently created/edited row,
   then id so the order is stable. Never rely on insertion order. */
export function transactionStamp(t) {
  const raw = t?.updated_at || t?.created_at || '';
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}
export function sortTransactions(rows = []) {
  return [...rows].sort((a, b) => {
    const byDate = String(b?.date ?? '').localeCompare(String(a?.date ?? ''));
    if (byDate) return byDate;
    const byStamp = transactionStamp(b) - transactionStamp(a);
    if (byStamp) return byStamp;
    return String(b?.id ?? '').localeCompare(String(a?.id ?? ''));
  });
}
export function toCSV(rows){const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFFdate,type,category,amount_idr,note\r\n'+rows.map(t=>[t.date,t.type,t.category,t.amount,t.notes].map(cell).join(',')).join('\r\n');}
export function reportCSV(headers,rows){const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFF'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n');}
export function backup(rows,planning,extras){const version=planning?(extras?(Array.isArray(extras.accounts)?4:3):2):1;return JSON.stringify({app:'Kantong',version,exportedAt:new Date().toISOString(),transactions:rows,...(planning||{}),...(extras||{})},(_,v)=>typeof v==='bigint'?v.toString():v,2);}
// Empty budget means no target; zero is an intentional target.
export function budgetAmount(raw){if(raw===''||raw===null||raw===undefined)return null;const s=rupiahDigits(raw);const n=Number(s);if(!/^\d+$/.test(s)||!Number.isSafeInteger(n)||n<0)throw Error('The budget must be whole, non-negative rupiah within the safe range.');return n;}
export function budgetRecap(all,month,budgets=[],names=[]){const r=recap(all,month);const selected=budgets.filter(b=>b.month===month&&(b.scope||'category')!=='group');return [...new Set([...names,...Object.keys(r.categories),...selected.map(b=>b.category)])].map(category=>{const b=selected.find(x=>x.category===category);const budget=b?BigInt(b.amount):null;const actual=r.categories[category]||0n;return {category,budget,actual,gap:budget===null?null:budget-actual};});}
export function dailyRecap(all,month,names=[]){
 const r=recap(all,month), categories=[...new Set([...names,...Object.keys(r.categories)])];
 const [y,m]=month.split('-').map(Number);const count=new Date(Date.UTC(y===0?2000:y,m,0)).getUTCDate();
 const days=Array.from({length:count},(_,i)=>({date:`${month}-${String(i+1).padStart(2,'0')}`,categories:Object.fromEntries(categories.map(c=>[c,0n])),total:0n}));
 for(const t of r.rows){if(t.type!=='expense')continue;const d=days[Number(t.date.slice(8))-1];d.categories[t.category]+=BigInt(t.amount);d.total+=BigInt(t.amount);}
 return {categories,days,totals:Object.fromEntries(categories.map(c=>[c,r.categories[c]||0n])),total:r.expense};
}
export const needsImprovement=(all,month)=>recap(all,month).balance<0n;
export function improvement(rows,income,proposed={}){
 const raw=String(income);if(!/^\d+$/.test(raw))throw Error('Assumed income must be whole, non-negative rupiah.');
 const result=rows.map(r=>{const baseline=r.budget??r.actual;const value=Object.hasOwn(proposed,r.category)?budgetAmount(proposed[r.category]):baseline;if(value===null)throw Error('Fill in every proposal; use 0 where needed.');const proposal=BigInt(value);return {...r,baseline,source:r.budget===null?'actual':'budget',proposal,reduction:baseline-proposal};});
 const total=result.reduce((s,r)=>s+r.proposal,0n),baseline=result.reduce((s,r)=>s+r.baseline,0n);return {rows:result,income:BigInt(raw),total,baseline,reduction:baseline-total,remaining:BigInt(raw)-total};
}
export const idr=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);

/* ---------- money input formatting (display only) ----------
   Typing 30000 shows 30.000 immediately. The dot is a thousand separator,
   never a decimal point: values are still whole rupiah integers. */
export const RUPIAH_GROUPED = /^\d{1,3}(\.\d{3})+$/;
export function formatRupiahInput(raw) {
  const digits = String(raw ?? '').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
export function rupiahDigits(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s;
  if (RUPIAH_GROUPED.test(s)) return s.replace(/\./g, '');
  return s; /* leave malformed input for the validator to reject */
}
export function countDigitsBefore(value, caret) {
  const s = String(value ?? '');
  const upto = Number.isFinite(caret) ? Math.max(0, Math.min(caret, s.length)) : s.length;
  return s.slice(0, upto).replace(/[^\d]/g, '').length;
}
export function caretForDigits(formatted, digitCount) {
  const s = String(formatted ?? '');
  if (!digitCount || digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (/\d/.test(s[i])) { seen += 1; if (seen === digitCount) return i + 1; }
  }
  return s.length;
}

/* ============================================================
   Kantong v4 — jadwal pemasukan rutin, saldo berjalan, onboarding.
   Semua fungsi di bawah ini murni: tidak membaca jam, jaringan, atau
   penyimpanan kecuali nilai yang diberikan sebagai argumen.
   ============================================================ */

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_MS = 86400000;

export function validateMonthString(raw, label = 'Month') {
  const m = String(raw ?? '');
  if (!MONTH_RE.test(m) || m < '0001-01') throw Error(`${label} is invalid.`);
  return m;
}
export function monthIndex(month) {
  const m = validateMonthString(month);
  const [y, mo] = m.split('-').map(Number);
  return y * 12 + (mo - 1);
}
export function monthFromIndex(index) {
  const i = Math.trunc(index);
  const y = Math.floor(i / 12), mo = i - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}`;
}
export function daysInMonth(month) {
  const [y, m] = validateMonthString(month).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/* Tanggal 31 pada bulan 30/28/29 hari memakai hari terakhir bulan itu. */
export function scheduleDueDate(month, day) {
  const m = validateMonthString(month);
  const d = Math.trunc(Number(day));
  if (!Number.isInteger(d) || d < 1 || d > 31) throw Error('The due day must be 1–31.');
  return `${m}-${String(Math.min(d, daysInMonth(m))).padStart(2, '0')}`;
}
export function openingAmount(raw) {
  if (raw === '' || raw === null || raw === undefined) return 0;
  const s = rupiahDigits(raw);
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < 0) throw Error('The opening balance must be whole, non-negative rupiah (0 is fine).');
  return n;
}
export function validateEntryDate(date, today) {
  const d = String(date ?? '');
  const t = String(today ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < '0001-01-01' || d > '9999-12-31' || Number.isNaN(Date.parse(d + 'T12:00:00Z')) || new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) !== d) throw Error('Invalid date.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw Error('Invalid today date.');
  if (d > t) throw Error(`Date ${d} has not happened yet (today is ${t}). Pick today or an earlier date.`);
  return d;
}
export function validateSchedule(raw) {
  const src = raw || {};
  const name = String(src.name ?? '').trim();
  if (!name || name.length > 50 || /[<>\u0000-\u001f]/.test(name)) throw Error('Recurring income name: 1–50 characters, without < > or control characters.');
  const amountRaw = String(src.amount ?? '');
  const amount = Number(amountRaw);
  if (!/^\d+$/.test(amountRaw) || !Number.isSafeInteger(amount) || amount <= 0) throw Error('The recurring income amount must be positive whole rupiah, at most 9,007,199,254,740,991.');
  const dayRaw = String(src.day ?? '');
  const day = Number(dayRaw);
  if (!/^\d{1,2}$/.test(dayRaw) || !Number.isInteger(day) || day < 1 || day > 31) throw Error('The due day must be 1–31.');
  const startMonth = validateMonthString(src.start_month, 'Start month');
  let endMonth = src.end_month === null || src.end_month === undefined || src.end_month === '' ? null : validateMonthString(src.end_month, 'End month');
  if (endMonth && endMonth < startMonth) throw Error('The end month cannot be before the start month.');
  let resumeMonth = src.resume_month === null || src.resume_month === undefined || src.resume_month === '' ? null : validateMonthString(src.resume_month, 'Month reactivated');
  if (resumeMonth && resumeMonth < startMonth) resumeMonth = null;
  const category = String(src.category ?? 'Gaji');
  if (!CATEGORIES.income.includes(category)) throw Error('Invalid recurring income category.');
  const notes = String(src.notes ?? '').trim();
  if (notes.length > 500) throw Error('A note can be at most 500 characters.');
  return { name, amount, day, start_month: startMonth, end_month: endMonth, active: src.active !== false, category, notes, resume_month: resumeMonth };
}
/* Bulan yang tanggal jatuhnya sudah lewat (atau hari ini), sejak awal jadwal. */
export function scheduleDueMonths(schedule, today) {
  const s = validateSchedule(schedule);
  const t = validateEntryDate(today, today);
  const todayMonth = t.slice(0, 7);
  const from = s.resume_month && s.resume_month > s.start_month ? s.resume_month : s.start_month;
  if (from > todayMonth) return [];
  const out = [];
  for (let i = monthIndex(from), end = monthIndex(todayMonth); i <= end; i++) {
    const month = monthFromIndex(i);
    if (s.end_month && month > s.end_month) break;
    if (scheduleDueDate(month, s.day) > t) continue;
    out.push(month);
  }
  return out;
}
export function scheduleStatusText(schedule, today = localDate()) {
  const s = validateSchedule(schedule);
  if (s.end_month && String(today).slice(0, 7) > s.end_month) return `${s.name} · finished · schedule ended ${s.end_month}`;
  if (!s.active) return `${s.name} · paused · automatic on day ${s.day}`;
  return `${s.name} · automatic on day ${s.day}`;
}
export const postingKey = (scheduleId, month) => `${scheduleId}|${month}`;
/* Rencana pencatatan: idempoten karena setiap (jadwal, bulan) hanya muncul sekali. */
export function planPostings({ schedules = [], postings = [], today = localDate() } = {}) {
  const done = new Set();
  for (const p of postings) if (p && p.schedule_id && p.month) done.add(postingKey(p.schedule_id, p.month));
  const plan = [];
  for (const raw of schedules) {
    if (!raw || raw.active === false) continue;
    let s;
    try { s = validateSchedule(raw); } catch { continue; }
    if (!raw.id) continue;
    for (const month of scheduleDueMonths(s, today)) {
      const key = postingKey(raw.id, month);
      if (done.has(key)) continue;
      done.add(key);
      plan.push({ schedule_id: raw.id, name: s.name, month, date: scheduleDueDate(month, s.day), amount: s.amount, category: s.category, notes: `Otomatis · ${s.name}`, key });
    }
  }
  return plan.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'id'));
}
/* Orkestrasi tipis di atas penyimpanan; klaim unik mencegah duplikat dua perangkat. */
export async function autoPost(store, { schedules = [], postings = [], today = localDate() } = {}) {
  const plan = planPostings({ schedules, postings, today });
  const created = [], errors = [];
  for (const item of plan) {
    let claim;
    try { claim = await store.claimPosting(item); }
    catch (e) { errors.push({ ...item, message: e?.message || 'Could not lock automatic posting.' }); continue; }
    if (!claim || claim.claimed !== true) continue;
    let tx;
    try { tx = await store.save({ type: 'income', category: item.category, amount: String(item.amount), date: item.date, notes: item.notes }, null); }
    catch (e) {
      try { await store.releasePosting(item.schedule_id, item.month); } catch { /* biarkan klaim agar tidak dobel; pengguna melihat galat */ }
      errors.push({ ...item, message: e?.message || 'Could not save the automatic income.' });
      continue;
    }
    try { await store.linkPosting(item.schedule_id, item.month, tx.id); }
    catch (e) { errors.push({ ...item, message: `Income ${item.month} recorded but linking failed: ${e?.message || ''}` }); continue; }
    created.push({ ...item, transaction: tx });
  }
  return { created, errors, plan };
}
export function runningBalance(all, opening = 0) {
  const start = BigInt(openingAmount(opening));
  let income = 0n, expense = 0n;
  for (const t of all || []) {
    const n = BigInt(t.amount);
    if (t.type === 'income') income += n; else expense += n;
  }
  return { opening: start, income, expense, balance: start + income - expense };
}
export function monthFlow(all, month, opening = 0) {
  const m = validateMonthString(month);
  const start = BigInt(openingAmount(opening));
  const [nextY, nextM] = (() => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? [y + 1, 1] : [y, mo + 1]; })();
  const next = `${String(nextY).padStart(4, '0')}-${String(nextM).padStart(2, '0')}`;
  /* Cash leaves the wallet for expenses, obligations and money set aside in a
     savings entry. Only income adds to it, so the monthly ending matches the
     current balance and the dashboard remainder. */
  let carried = start;
  for (const t of all || []) if (String(t.date).slice(0, 7) < m) carried += (t.type === 'income' ? BigInt(t.amount) : -BigInt(t.amount));
  const r = recap(all, m);
  const outflow = r.expense + r.savings + r.obligation;
  return { month: m, inflow: r.income, outflow, ending: carried + r.income - outflow };
}
export function balanceByMonth(all, opening = 0) {
  const months = [...new Set((all || []).map((t) => String(t.date).slice(0, 7)).filter((m) => MONTH_RE.test(m)))].sort();
  return months.map((month) => monthFlow(all, month, opening));
}
export function onboardingMode(settings) {
  const s = settings || {};
  if (s.onboarding_completed) return 'none';
  if (s.onboarding_skipped) return 'banner';
  return 'wizard';
}
export function normalizeSettings(row) {
  const src = row || {};
  let displayName = null;
  try { displayName = validateUsername(src.display_name); } catch { displayName = null; }
  let avatarData = null;
  if (src.avatar_kind === 'photo' && typeof src.avatar_data === 'string') {
    try { avatarDataError(src.avatar_data); avatarData = src.avatar_data; } catch { avatarData = null; }
  }
  return {
    onboarding_completed: src.onboarding_completed === true,
    onboarding_skipped: src.onboarding_skipped === true,
    opening_balance: openingAmount(src.opening_balance),
    opening_balance_date: src.opening_balance_date ? String(src.opening_balance_date).slice(0, 10) : null,
    display_name: displayName,
    avatar_color: AVATAR_COLORS.includes(src.avatar_color) ? src.avatar_color : AVATAR_COLORS[0],
    avatar_kind: avatarData ? 'photo' : 'initial',
    avatar_data: avatarData,
    theme: normalizeTheme(src.theme),
    pattern: normalizePattern(src.pattern),
  };
}
export function mergeSettings(current, incoming) {
  const now = normalizeSettings(current);
  if (now.onboarding_completed) return { settings: now, changed: false };
  return { settings: { ...normalizeSettings(incoming), onboarding_skipped: false }, changed: true };
}
export function parseBackup(data) {
  if (Array.isArray(data)) return { version: 1, transactions: data, categories: [], budgets: [], scenarios: [], schedules: [], postings: [], settings: null, accounts: [], transfers: [], holdings: [], valuations: [] };
  if (!data || typeof data !== 'object' || !Array.isArray(data.transactions)) throw Error('Unrecognized backup structure.');
  const arr = (k) => (Array.isArray(data[k]) ? data[k] : []);
  const version = Number.isInteger(data.version) ? data.version : 1;
  return {
    version,
    transactions: data.transactions,
    categories: arr('categories'),
    budgets: arr('budgets'),
    scenarios: arr('scenarios'),
    schedules: version >= 3 ? arr('schedules') : [],
    postings: version >= 3 ? arr('postings') : [],
    settings: version >= 3 && data.settings && typeof data.settings === 'object' ? data.settings : null,
    accounts: version >= 4 ? arr('accounts') : [],
    transfers: version >= 4 ? arr('transfers') : [],
    holdings: version >= 4 ? arr('holdings') : [],
    valuations: version >= 4 ? arr('valuations') : [],
    /* v7 goals ride along in any version; old files simply have none. */
    goals: arr('goals'),
  };
}

/* ---------- v4 profil: nama pengguna, avatar lokal, tema tampilan ---------- */
export const USERNAME_RE = /^[A-Za-z0-9 ._-]{2,24}$/;
export const AVATAR_COLORS = ['#0f4c44', '#1d4e79', '#7a3b2e', '#4b3a70', '#3f6b2f'];
export const AVATAR_LIMIT_BYTES = 100 * 1024;
export const AVATAR_LIMIT_CHARS = 140000;
export const THEMES = [
  { id: 'krem', label: 'Green cream', color: '#0f4c44', dark: '#8fd8c4' },
  { id: 'biru', label: 'Calm blue', color: '#1d4e79', dark: '#8fc4ec' },
  { id: 'ungu', label: 'Soft purple', color: '#4b3a70', dark: '#c3b2e8' },
  { id: 'senja', label: 'Earthy dusk', color: '#8a3b2a', dark: '#eda88f' },
];
export const PATTERNS = [
  { id: 'none', label: 'Plain' },
  { id: 'titik', label: 'Fine dots' },
  { id: 'garis', label: 'Diagonal lines' },
  { id: 'kisi', label: 'Grid' },
];
export function validateUsername(raw) {
  const name = String(raw ?? '').trim();
  if (!USERNAME_RE.test(name)) throw Error('Display name: 2–24 characters — letters, numbers, spaces, dots, underscores, or hyphens.');
  return name;
}
export function usernameFromEmail(email) {
  const local = String(email ?? '').split('@')[0] || '';
  const cleaned = local.replace(/[^A-Za-z0-9 ._-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  return cleaned.length >= 2 ? cleaned : 'User';
}
/* ---------- WhatsApp: nomor & status tautan ---------- */
export const WA_PHONE_RE = /^628[0-9]{8,11}$/;
/* 08xx / +62xx / 62xx / spasi / tanda hubung -> 628xxxxxxxxx */
export function normalizeWaPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) throw Error('A WhatsApp number is required.');
  let n = digits;
  if (n.startsWith('0')) n = `62${n.slice(1)}`;
  else if (n.startsWith('8')) n = `62${n}`;
  else if (n.startsWith('620')) n = `62${n.slice(3)}`;
  if (!WA_PHONE_RE.test(n)) throw Error('Invalid Indonesian WhatsApp number. Example: 081233434573.');
  return n;
}
export function waPhonePretty(phone) {
  const s = String(phone ?? '');
  if (!WA_PHONE_RE.test(s)) return s;
  return `0${s.slice(2)}`;
}
const WA_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function waStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${WA_MONTHS[d.getMonth()]} ${d.getFullYear()} ${hh}:${mm}`;
}
export function waLinkStatusText(link, now = new Date()) {
  if (!link) return 'Not connected. Notes from WhatsApp do not reach this account yet.';
  if (!link.verified_at) {
    return link.phone_e164
      ? `Waiting for verification for ${waPhonePretty(link.phone_e164)}.`
      : 'Waiting for verification.';
  }
  const seen = link.last_seen_at ? new Date(link.last_seen_at) : null;
  if (!seen || Number.isNaN(seen.getTime())) return `Connected · ${waPhonePretty(link.phone_e164)} · never used yet.`;
  const minutes = Math.floor(Math.max(0, now.getTime() - seen.getTime()) / 60000);
  if (minutes < 1) return `Connected · ${waPhonePretty(link.phone_e164)} · last used just now.`;
  if (minutes < 60) return `Connected · ${waPhonePretty(link.phone_e164)} · last used ${minutes} minutes ago.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Connected · ${waPhonePretty(link.phone_e164)} · last used ${hours} hours ago.`;
  return `Connected · ${waPhonePretty(link.phone_e164)} · last used ${waStamp(link.last_seen_at)}.`;
}
export function waCodeExpiryText(expiresAt, now = new Date()) {
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return '';
  const left = Math.ceil((end.getTime() - now.getTime()) / 60000);
  if (left <= 0) return 'The code expired. Tap Connect again for a new code.';
  return `Code valid for ${left} more minutes.`;
}
/* ---------- Telegram: status tautan chat ---------- */
/* Chat Telegram tidak punya nomor, jadi tidak ada normalisasi nomor di sini.
   Tautan dibuat dengan kode 6 digit yang dikirim ke bot dari aplikasi Telegram. */
export function tgLinkStatusText(link, now = new Date()) {
  if (!link) return 'Not connected. Notes from Telegram do not reach this account yet.';
  if (!link.verified_at) return 'Waiting for verification. Send the code from Telegram to the bot.';
  const seen = link.last_seen_at ? new Date(link.last_seen_at) : null;
  if (!seen || Number.isNaN(seen.getTime())) return 'Connected · Telegram chat · never used yet.';
  const minutes = Math.floor(Math.max(0, now.getTime() - seen.getTime()) / 60000);
  if (minutes < 1) return 'Connected · Telegram chat · last used just now.';
  if (minutes < 60) return `Connected · Telegram chat · last used ${minutes} minutes ago.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Connected · Telegram chat · last used ${hours} hours ago.`;
  return `Connected · Telegram chat · last used ${waStamp(link.last_seen_at)}.`;
}
export function greetingText(name, hour = new Date().getHours()) {
  const h = Number(hour);
  const period = h >= 4 && h < 11 ? 'Good morning' : h >= 11 && h < 15 ? 'Good afternoon' : h >= 15 && h < 19 ? 'Good evening' : 'Good night';
  let safe = String(name ?? '').trim().slice(0, 24);
  if (safe.length < 2) safe = 'User';
  return `${period} · Hi, ${safe}`;
}
export function avatarInitials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((p) => p[0]).join('');
  return (initials || '?').toUpperCase().slice(0, 2);
}
/* Batas input sebelum kompresi; bukan bukti bahwa file aman diproses. */
export function validateAvatarPhoto({ type, size } = {}) {
  if (!/^image\/(jpeg|webp)$/.test(String(type || ''))) throw Error('The photo must be JPEG or WebP. Other formats are rejected.');
  const n = Number(size);
  if (!Number.isSafeInteger(n) || n <= 0) throw Error('Invalid file size.');
  if (n > 8 * 1024 * 1024) throw Error('Foto asli maksimal 8 MB.');
  return true;
}
/* Data URL disimpan sebagai teks pribadi di baris pengaturan; batas 100 KB biner. */
export function avatarDataError(dataUrl) {
  const s = String(dataUrl ?? '');
  if (!/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) throw Error('Invalid photo data.');
  const bytes = Math.floor((s.length - s.indexOf(',') - 1) * 3 / 4);
  if (bytes > AVATAR_LIMIT_BYTES || s.length > AVATAR_LIMIT_CHARS) throw Error('The photo is still over 100 KB after compression. Pick another one.');
  return false;
}
export const normalizeTheme = (v) => (THEMES.some((t) => t.id === v) ? v : 'krem');
export const normalizePattern = (v) => (PATTERNS.some((p) => p.id === v) ? v : 'none');

/* ============================================================
   Kantong v4 — Akun & Aset: dompet, transfer, investasi manual.
   Tidak ada umpan harga pasar; semua nilai investasi diisi pengguna.
   ============================================================ */
export const ACCOUNT_TYPES = [
  { id: 'cash', label: 'Cash' },
  { id: 'bank', label: 'Bank' },
  { id: 'ewallet', label: 'E-wallet' },
  { id: 'investment', label: 'Investment' },
  { id: 'other', label: 'Other' },
];
export const LIQUID_TYPES = ['cash', 'bank', 'ewallet'];
export const ACCOUNT_COLORS = ['#0f4c44', '#1d4e79', '#7a3b2e', '#4b3a70', '#3f6b2f', '#8a6d3b'];
export const HOLDING_KINDS = [
  { id: 'saham', label: 'Stock' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'reksadana', label: 'Mutual fund' },
  { id: 'emas', label: 'Gold' },
  { id: 'lainnya', label: 'Other' },
];

const accountName = (raw) => {
  const name = String(raw ?? '').trim();
  if (!name || name.length > 40 || /[<>\u0000-\u001f]/.test(name)) throw Error('Account name: 1–40 characters, without < > or control characters.');
  return name;
};
const money = (raw, label, { allowZero = true } = {}) => {
  const s = rupiahDigits(raw ?? '');
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < 0 || (!allowZero && n === 0)) throw Error(`${label} must be whole, non-negative rupiah.`);
  return n;
};
const decimal = (raw, label, places) => {
  const s = String(raw ?? '').trim();
  const re = new RegExp(`^\\d{1,15}(\\.\\d{1,${places}})?$`);
  if (!re.test(s)) throw Error(`${label} is invalid (at most ${places} decimals, no minus sign).`);
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw Error(`${label} is invalid.`);
  return s.replace(/\.?0+$/, '') === s ? s : s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};
export function validateAccount(raw) {
  const src = raw || {};
  const type = String(src.type ?? '');
  if (!ACCOUNT_TYPES.some((t) => t.id === type)) throw Error('Invalid account type.');
  const color = String(src.color ?? ACCOUNT_COLORS[0]);
  if (!ACCOUNT_COLORS.includes(color)) throw Error('Invalid account color.');
  const note = String(src.note ?? '').trim();
  if (note.length > 200) throw Error('An account note can be at most 200 characters.');
  const currentValue = src.current_value === null || src.current_value === undefined || src.current_value === '' ? null : money(src.current_value, 'Account current value');
  return { name: accountName(src.name), type, opening_balance: money(src.opening_balance === '' || src.opening_balance === undefined || src.opening_balance === null ? 0 : src.opening_balance, 'Account opening balance'), color, note, current_value: currentValue, is_archived: src.is_archived === true };
}
export function validateTransfer(raw) {
  const src = raw || {};
  const from = String(src.from_account ?? '').trim();
  const to = String(src.to_account ?? '').trim();
  if (!from || !to) throw Error('Pick a source and a destination account.');
  if (from === to) throw Error('The source and destination accounts must differ.');
  const amount = money(src.amount, 'Transfer amount', { allowZero: false });
  const date = validateEntryDate(src.date, src.date);
  const note = String(src.note ?? '').trim();
  if (note.length > 200) throw Error('A transfer note can be at most 200 characters.');
  return { from_account: from, to_account: to, amount, date, note };
}
export function validateHolding(raw) {
  const src = raw || {};
  const accountId = String(src.account_id ?? '').trim();
  if (!accountId) throw Error('An investment account is required.');
  const kind = String(src.kind ?? '');
  if (!HOLDING_KINDS.some((k) => k.id === kind)) throw Error('Invalid asset type.');
  const assetName = String(src.asset_name ?? '').trim();
  if (!assetName || assetName.length > 60 || /[<>\u0000-\u001f]/.test(assetName)) throw Error('Asset name: 1–60 characters, without < > or control characters.');
  return {
    account_id: accountId, asset_name: assetName, kind,
    quantity: decimal(src.quantity, 'Amount', 8),
    avg_buy_price: decimal(src.avg_buy_price, 'Average buy price', 4),
    current_price: decimal(src.current_price, 'Harga kini', 4),
  };
}
export const holdingValue = (h) => {
  const v = Number(h.quantity) * Number(h.current_price);
  if (!Number.isFinite(v) || v < 0 || v > 9e15) throw Error('The asset value is out of the safe range.');
  return BigInt(Math.round(v));
};
export const holdingCost = (h) => {
  const v = Number(h.quantity) * Number(h.avg_buy_price);
  if (!Number.isFinite(v) || v < 0 || v > 9e15) throw Error('The asset cost is out of the safe range.');
  return BigInt(Math.round(v));
};
export function defaultAccountId(accounts = []) {
  const active = accounts.filter((a) => !a.is_archived);
  const pick = active.find((a) => a.type === 'cash') || active.find((a) => LIQUID_TYPES.includes(a.type)) || active[0];
  return pick?.id || null;
}
export function latestValuation(valuations = [], accountId) {
  const rows = valuations.filter((v) => v.account_id === accountId).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const last = rows.at(-1);
  return last ? { date: last.date, value: BigInt(last.value), note: last.note || '' } : null;
}
export function accountBalance(account, data = {}) {
  const accounts = data.accounts || [account];
  const transfers = data.transfers || [];
  const transactions = data.transactions || [];
  const fallbackId = data.defaultAccountId ?? defaultAccountId(accounts);
  if (account.type === 'investment') {
    const mine = (data.holdings || []).filter((h) => h.account_id === account.id);
    if (mine.length) return mine.reduce((s, h) => s + holdingValue(h), 0n);
    const snap = latestValuation(data.valuations || [], account.id);
    if (account.current_value !== null && account.current_value !== undefined) return BigInt(account.current_value);
    if (snap) return snap.value;
    return BigInt(account.opening_balance || 0);
  }
  let bal = BigInt(account.opening_balance || 0);
  for (const t of transactions) {
    const owner = t.account_id || fallbackId;
    if (owner !== account.id) continue;
    bal += t.type === 'income' ? BigInt(t.amount) : -BigInt(t.amount);
  }
  for (const tr of transfers) {
    if (tr.from_account === account.id) bal -= BigInt(tr.amount);
    if (tr.to_account === account.id) bal += BigInt(tr.amount);
  }
  return bal;
}
export function investmentCost(account, data = {}) {
  const mine = (data.holdings || []).filter((h) => h.account_id === account.id);
  if (mine.length) return mine.reduce((s, h) => s + holdingCost(h), 0n);
  let cost = BigInt(account.opening_balance || 0);
  for (const tr of data.transfers || []) {
    if (tr.to_account === account.id) cost += BigInt(tr.amount);
    if (tr.from_account === account.id) cost -= BigInt(tr.amount);
  }
  return cost;
}
export function investmentProfit(account, data = {}) {
  const value = accountBalance(account, data);
  const cost = investmentCost(account, data);
  const profit = value - cost;
  const pct = cost > 0n ? (Number(profit) / Number(cost)) * 100 : null;
  return { value, cost, profit, pct };
}
export function assetTotals(accounts = [], data = {}) {
  const active = accounts.filter((a) => !a.is_archived);
  let total = 0n, ready = 0n, investment = 0n;
  const byType = {};
  for (const a of active) {
    const bal = accountBalance(a, { ...data, accounts });
    total += bal;
    byType[a.type] = (byType[a.type] || 0n) + bal;
    if (a.type === 'investment') investment += bal;
    else if (LIQUID_TYPES.includes(a.type)) ready += bal;
  }
  return { total, ready, investment, byType };
}
export function allocationByType(accounts = [], data = {}) {
  const totals = assetTotals(accounts, data);
  return ACCOUNT_TYPES.filter((t) => totals.byType[t.id] !== undefined)
    .map((t) => ({ type: t.id, label: t.label, value: totals.byType[t.id] }))
    .filter((x) => x.value !== 0n)
    .sort((a, b) => (a.value === b.value ? 0 : a.value > b.value ? -1 : 1));
}
export function valueHistory(valuations = [], accountId) {
  return valuations.filter((v) => v.account_id === accountId)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((v) => ({ date: String(v.date), value: BigInt(v.value), note: v.note || '' }));
}
/* Nilai kini yang diisi pengguna, bukan harga pasar. */
export function valuationInput(raw, today = localDate()) {
  const value = money(raw, 'Value kini');
  return { value, date: validateEntryDate(today, today) };
}
export function validateActivity(raw) {
  const action = String(raw?.action ?? '');
  const entity = String(raw?.entity ?? '');
  if (!['created', 'edited', 'deleted'].includes(action)) throw Error('Invalid activity type.');
  if (!['account', 'holding', 'transfer', 'valuation', 'settings'].includes(entity)) throw Error('Invalid activity object.');
  const summary = String(raw?.summary ?? '').trim();
  if (!summary || summary.length > 200 || /[<>\u0000-\u001f]/.test(summary)) throw Error('Invalid activity summary.');
  return { action, entity, summary };
}

/* Rencana pembaruan nilai massal: validasi semua baris sebelum satu pun disimpan. */
export function valuationPlan(items, today = localDate()) {
  if (!Array.isArray(items) || !items.length) throw Error('No account value was changed.');
  const seen = new Set();
  return items.map((it) => {
    const accountId = String(it?.account_id ?? '').trim();
    if (!accountId) throw Error('Please choose an account.');
    if (seen.has(accountId)) throw Error('Each account may appear only once per update.');
    seen.add(accountId);
    const { value, date } = valuationInput(it.value, it.date || today);
    const note = String(it.note ?? '').trim();
    if (note.length > 200 || /[<>\u0000-\u001f]/.test(note)) throw Error('A value note can be at most 200 characters, without < >.');
    return { account_id: accountId, value, date, note };
  });
}

/* ============================================================
   Kantong v5 — pendaftaran mandiri, rekap harian kartu,
   kategori (ikon/warna/urutan/arsip). Semua fungsi murni.
   ============================================================ */

/* ---------- pendaftaran ---------- */
export const PASSWORD_MIN = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INVITE_RE = /^[A-Za-z0-9._-]{4,32}$/;

export function passwordStrength(raw) {
  const s = String(raw ?? '');
  if (!s) return { score: 0, label: 'Weak', hint: `At least ${PASSWORD_MIN} characters, mix letters and numbers.` };
  let score = 0;
  if (s.length >= PASSWORD_MIN) score++;
  if (s.length >= 12) score++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
  if (/\d/.test(s)) score++;
  if (/[^A-Za-z0-9]/.test(s)) score++;
  const label = score <= 1 ? 'Weak' : score <= 3 ? 'Fair' : 'Strong';
  const hint = label === 'Weak'
    ? `Add a number and an uppercase letter (at least ${PASSWORD_MIN} characters).`
    : label === 'Fair'
      ? 'Good enough. Add a symbol to make it stronger.'
      : 'Strong password. Keep it somewhere safe.';
  return { score, label, hint };
}

export function signupErrors(input = {}, { inviteRequired = false } = {}) {
  const errors = {};
  const email = String(input.email ?? '').trim();
  if (!email) errors.email = 'An email is required.';
  else if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'That email does not look right. Example: you@example.com';

  const password = String(input.password ?? '');
  if (!password) errors.password = 'A password is required.';
  else if (!password.trim()) errors.password = `The password cannot be only spaces (at least ${PASSWORD_MIN} characters).`;
  else if (password.length < PASSWORD_MIN) errors.password = `Password must be at least ${PASSWORD_MIN} characters.`;
  else if (password.length > 200) errors.password = 'The password can be at most 200 characters.';

  const username = String(input.username ?? '').trim();
  if (!username) errors.username = 'A nickname is required.';
  else if (!USERNAME_RE.test(username)) errors.username = 'Name: 2–24 characters — letters, numbers, spaces, or . _ -';

  if (inviteRequired) {
    const invite = String(input.inviteCode ?? '').trim();
    if (!invite) errors.invite = 'An invite code is required.';
    else if (!INVITE_RE.test(invite)) errors.invite = 'Invalid invite code (4–32 letters, numbers, . _ -).';
  }
  return errors;
}

export function signupOutcome(payload) {
  if (!payload || typeof payload !== 'object') throw Error('Invalid sign-up response.');
  const user = payload.user;
  if (!user || typeof user !== 'object') throw Error('The sign-up response contained no user.');
  if (payload.access_token) {
    return {
      kind: 'session',
      message: 'Account created. Welcome to Kantong.',
      session: { access_token: payload.access_token, refresh_token: payload.refresh_token, expires_in: payload.expires_in, user },
    };
  }
  if (Array.isArray(user.identities) && user.identities.length === 0) {
    return { kind: 'existing', message: 'This email is already registered. Sign in, or use “Forgot password?” if you lost it.' };
  }
  return { kind: 'verify', message: 'Check your email to verify. Open the link in your inbox (check spam too), then sign in.' };
}

const AUTH_ERROR_COPY = {
  rate: 'Too many attempts in a short time. Wait a few minutes, then try again.',
  disabled: 'Public sign-up is currently disabled in this Supabase project. Ask the owner to enable it under Authentication → Sign In / Providers, or to create an account for you, then try again.',
  weak: 'That password is too weak. Use at least 8 characters mixing letters and numbers, then try again.',
  exists: 'This email is already registered. Sign in, or use “Forgot password?” to reset it.',
  email: 'That email does not look right. Check it again, e.g. you@example.com.',
  network: 'No network or the request timed out. Check your connection, then try again.',
  other: 'Sign-up did not go through. Try again in a moment; if it keeps failing, sign in with an account you already have.',
};

export function mapAuthError(status, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const code = String(p.error_code || p.code || '').toLowerCase();
  const msg = String(p.msg || p.message || p.error_description || p.error || '');
  const low = msg.toLowerCase();
  let kind = 'other';
  if (!status && !msg) kind = 'network';
  else if (status === 0) kind = 'network';
  else if (/over_email_send_rate_limit|over_request_rate_limit|rate_limit_exceeded/.test(code) || status === 429 || /rate limit|too many requests|for security purposes/.test(low)) kind = 'rate';
  else if (/signup_disabled|signups_not_allowed|email_provider_disabled/.test(code) || /signups not allowed|signups are disabled|signup is disabled/.test(low)) kind = 'disabled';
  else if (/weak_password/.test(code) || /password should be|password is too short|weak password/.test(low)) kind = 'weak';
  else if (/user_already_exists|email_exists/.test(code) || /already registered|already exists/.test(low)) kind = 'exists';
  else if (/email_address_invalid|validation_failed/.test(code) || /unable to validate email|invalid email|email address is invalid/.test(low)) kind = 'email';
  return { kind, message: AUTH_ERROR_COPY[kind] };
}

export function signupNoticeText(disabled) {
  return disabled
    ? 'Public sign-up is currently disabled in this Supabase project. The owner can enable it under Authentication → Sign In / Providers → Email, then reload this page.'
    : '';
}

export function parseAuthHash(hash) {
  const raw = String(hash ?? '').replace(/^#/, '').trim();
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const errCode = p.get('error_code') || '';
  const errDesc = p.get('error_description') || '';
  if (p.get('error') || errCode) {
    return {
      type: null,
      error: /expired|otp_expired/i.test(`${errCode} ${errDesc}`)
        ? 'That link has expired or is invalid. Request a new one.'
        : 'Invalid link. Request a new one.',
    };
  }
  const access = p.get('access_token');
  const refresh = p.get('refresh_token');
  if (!access || !refresh) return null;
  return {
    type: p.get('type') || null,
    session: { access_token: access, refresh_token: refresh, expires_in: Number(p.get('expires_in')) || 3600, token_type: p.get('token_type') || 'bearer' },
    message: 'Link opened.',
  };
}

export const RESEND_COOLDOWN_SECONDS = 60;
export function resendCountdown(seconds) {
  const s = Math.ceil(Number(seconds) || 0);
  return s > 0 ? `Resend in ${s} dtk` : 'Resend verification email';
}

/* ---------- bawaan saat pertama masuk ---------- */
/* Kategori bawaan sengaja KOSONG: taksonomi universal v7 (TAXONOMY) yang mengisi.
   Nama lama (Andreas/Ortu/UKT/...) hanya dipertahankan untuk membaca data lama,
   tidak pernah dibuat untuk pengguna baru. */
export const DEFAULT_SEED_CATEGORIES = [];
export const DEFAULT_SEED_ACCOUNT = { name: 'Tunai', type: 'cash' };
export const SEED_CATEGORY_META = {
  Makan: { icon: '🍚', color: '#1c6b4b' },
  Transport: { icon: '🚌', color: '#2f6f8f' },
  Laundry: { icon: '🧺', color: '#6b5b95' },
  Kosan: { icon: '🏠', color: '#b7893f' },
  Listrik: { icon: '⚡', color: '#8a6d3b' },
  Internet: { icon: '🌐', color: '#1d4e79' },
  Rokok: { icon: '🚬', color: '#a8472c' },
  Andreas: { icon: '🎓', color: '#4b7a5a' },
  Ortu: { icon: '👨‍👩‍👦', color: '#7a3b2e' },
  UKT: { icon: '📚', color: '#4b3a70' },
  Lainnya: { icon: '✨', color: '#6c7a72' },
};

export function seedPlan({ categories = [], accounts = [], seeded = false } = {}) {
  const have = new Set(categories.map((c) => String(c?.name ?? '').trim().toLowerCase()).filter(Boolean));
  const missing = DEFAULT_SEED_CATEGORIES.filter((n) => !have.has(n.toLowerCase()));
  const hasTunai = accounts.some((a) => String(a?.name ?? '').trim().toLowerCase() === DEFAULT_SEED_ACCOUNT.name.toLowerCase());
  return { categories: seeded ? [] : missing, account: seeded ? false : !hasTunai, needed: !seeded && (missing.length > 0 || !hasTunai) };
}

/* ---------- kategori: ikon, warna, urutan, arsip ---------- */
export const CATEGORY_ICONS = ['🍚', '🚌', '🧺', '🏠', '⚡', '🌐', '🚬', '🎓', '👨‍👩‍👦', '📚', '🧾', '🛒', '💊', '🎉', '✨', '🏷️',
  /* v7 taxonomy + savings goals */
  '🍽️', '🚗', '🛍️', '✈️', '👥', '💼', '🏦', '💰', '🎯', '🛡️', '💍', '🏡', '🏖️', '📈'];
export const CATEGORY_COLORS = ['#1c6b4b', '#b7893f', '#a8472c', '#2f6f8f', '#6b5b95', '#8a6d3b', '#4b7a5a', '#7a3b2e'];
export const CATEGORY_FALLBACK = { icon: '🏷️', color: '#6c7a72' };

export function normalizeCategory(raw = {}) {
  const name = String(raw?.name ?? '').trim();
  if (!name) throw Error('A category name is required.');
  const icon = String(raw.icon ?? '');
  const color = String(raw.color ?? '');
  if (icon && !CATEGORY_ICONS.includes(icon)) throw Error('Pick an icon from the available list.');
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw Error('The color must be a #rrggbb hex code.');
  let sort = null;
  if (raw.sort_order !== null && raw.sort_order !== undefined && raw.sort_order !== '') {
    const n = Number(raw.sort_order);
    if (!Number.isInteger(n) || n < -100000 || n > 100000) throw Error('Invalid category order.');
    sort = n;
  }
  let archived = null;
  if (raw.archived_at) {
    const d = new Date(raw.archived_at);
    if (Number.isNaN(d.getTime())) throw Error('Invalid archive time.');
    archived = d.toISOString();
  }
  const kind = TX_KINDS.includes(raw.kind) ? raw.kind : (taxonOf(name)?.kind || 'expense');
  const groupFallback = taxonOf(name)?.group_name || (kind === 'income' ? INCOME_GROUP : kind === 'savings' ? SAVINGS_GROUP : kind === 'obligation' ? OBLIGATION_GROUP : 'Other');
  const groupName = String(raw.group_name ?? '').trim().slice(0, 60) || groupFallback;
  return {
    name,
    kind,
    group_name: groupName,
    enabled: raw.enabled !== false,
    icon,
    color,
    sort_order: sort,
    archived_at: archived,
    is_default: raw.is_default === true,
    renamed_from: String(raw.renamed_from ?? '').trim().slice(0, 200) || null,
  };
}

export function sortCategories(rows = []) {
  return [...rows].sort((a, b) => {
    const ao = a.sort_order === null || a.sort_order === undefined ? Number.POSITIVE_INFINITY : Number(a.sort_order);
    const bo = b.sort_order === null || b.sort_order === undefined ? Number.POSITIVE_INFINITY : Number(b.sort_order);
    if (ao !== bo) return ao < bo ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), 'id');
  });
}

export function findCategory(rows = [], name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return null;
  return rows.find((r) => String(r?.name ?? '').trim().toLowerCase() === key) || null;
}

/* Termasuk baris arsip: dipakai untuk metadata tampilan & ekspor.
   Untuk pilihan entri baru / parser, saring `archived_at` & `enabled`. */
export function categoryLookup(rows = []) {
  const map = new Map();
  for (const r of rows) {
    const key = String(r?.name ?? '').trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, r);
  }
  return map;
}

export function categoryMeta(rows = [], name) {
  const hit = findCategory(rows, name);
  return { icon: hit?.icon || CATEGORY_FALLBACK.icon, color: hit?.color || CATEGORY_FALLBACK.color, archived: !!hit?.archived_at };
}

export function categoryCreateError(rawName, rows = [], kind = null) {
  let name;
  try { name = categoryName(rawName); } catch (e) { return e.message; }
  const wantKind = kind || taxonOf(name)?.kind || 'expense';
  /* Names only need to be unique within one kind: "Gift" (income) and a
     user's own "Gift" saving bucket are different buckets of money. */
  const hit = rows.find((r) => String(r?.name ?? '').trim().toLowerCase() === name.toLowerCase()
    && (r?.kind || 'expense') === wantKind);
  if (!hit) return null;
  return hit.archived_at
    ? `Name “${hit.name}” is used by an archived category. Reactivate that category instead of creating a duplicate.`
    : `Category “${hit.name}” already exists. Pick another name or rename the existing category.`;
}

export function categoryRenameError(oldName, rawNew, rows = []) {
  let next;
  try { next = categoryName(rawNew); } catch (e) { return e.message; }
  const others = rows.filter((r) => String(r?.name ?? '').trim().toLowerCase() !== String(oldName ?? '').trim().toLowerCase());
  return categoryCreateError(next, others);
}

export function categoryDeleteBlock({ transactions = 0, budgets = 0, goals = 0 } = {}) {
  const t = Math.max(0, Number(transactions) || 0);
  const b = Math.max(0, Number(budgets) || 0);
  const g = Math.max(0, Number(goals) || 0);
  if (!t && !b && !g) return null;
  const parts = [];
  if (t) parts.push(`${t} transactions`);
  if (b) parts.push(`${b} budgets`);
  if (g) parts.push(`${g} savings goals`);
  return `This category is still used by ${parts.join(' and ')}. Delete was refused so history stays intact — archive it instead.`;
}

export function moveCategory(rows = [], name, delta) {
  const list = sortCategories(rows.filter((r) => !r.archived_at && r.enabled !== false)).map((r, idx) => ({ ...r, sort_order: idx }));
  const i = list.findIndex((r) => String(r.name).trim().toLowerCase() === String(name ?? '').trim().toLowerCase());
  if (i < 0) throw Error('Category not found.');
  const j = i + (Number(delta) < 0 ? -1 : 1);
  if (j < 0 || j >= list.length) return [];
  const a = list[i], b = list[j];
  return [{ name: a.name, sort_order: b.sort_order }, { name: b.name, sort_order: a.sort_order }].sort((x, y) => x.name.localeCompare(y.name, 'id'));
}

/* ---------- rekap harian (kartu) ---------- */
const WIB_MS = 7 * 3600 * 1000;
export function wibTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const t = new Date(d.getTime() + WIB_MS);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}

export function recapDayGroups(all = [], month, names = [], categories = []) {
  const r = recap(all, month);
  const meta = categoryLookup(categories);
  const byDate = new Map();
  for (const t of r.rows) {
    const day = byDate.get(t.date) || { date: t.date, total: 0n, income: 0n, count: 0, groups: new Map() };
    day.count += 1;
    if (t.type === 'income') {
      day.income += BigInt(t.amount);
    } else if (t.type === 'expense') {
      const amount = BigInt(t.amount);
      day.total += amount;
      const g = day.groups.get(t.category) || { category: t.category, total: 0n, entries: [] };
      g.total += amount;
      g.entries.push({ id: t.id, amount, notes: String(t.notes ?? ''), time: wibTime(t.created_at) });
      day.groups.set(t.category, g);
    }
    byDate.set(t.date, day);
  }
  const days = [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) => {
      const groups = [...d.groups.values()].map((g) => {
        const m = findCategory(categories, g.category);
        return {
          ...g,
          icon: m?.icon || CATEGORY_FALLBACK.icon,
          color: m?.color || CATEGORY_FALLBACK.color,
          archived: !!m?.archived_at,
          entries: g.entries.sort((x, y) => String(x.time || '').localeCompare(String(y.time || '')) || String(x.id).localeCompare(String(y.id))),
        };
      }).sort((a, b) => (a.total === b.total ? a.category.localeCompare(b.category, 'id') : a.total > b.total ? -1 : 1));
      return { date: d.date, weekday: new Date(`${d.date}T00:00:00Z`).getUTCDay(), total: d.total, income: d.income, count: d.count, groups };
    });
  return { month, days, totals: { income: r.income, expense: r.expense, balance: r.balance } };
}

/* ---------- anggaran + metadata kategori ---------- */
export function budgetRowsWithMeta(all = [], month, budgets = [], categories = []) {
  const base = budgetRecap(all, month, budgets, categories.map((c) => c.name));
  return base.map((row) => {
    const m = findCategory(categories, row.category);
    return {
      ...row,
      icon: m?.icon || CATEGORY_FALLBACK.icon,
      color: m?.color || CATEGORY_FALLBACK.color,
      archived: !!m?.archived_at,
      sort_order: m?.sort_order ?? null,
    };
  });
}

export function unbudgetedCategories(categories = [], budgets = [], month, all = []) {
  const have = new Set(budgets.filter((b) => b.month === month).map((b) => String(b.category).trim().toLowerCase()));
  const actual = all.length ? recap(all, month).categories : null;
  return sortCategories(categories.filter((c) => !c.archived_at && c.enabled !== false))
    .filter((c) => !have.has(String(c.name).trim().toLowerCase()))
    .map((c) => ({
      name: c.name,
      icon: c.icon || CATEGORY_FALLBACK.icon,
      color: c.color || CATEGORY_FALLBACK.color,
      actual: actual ? actual[c.name] || 0n : 0n,
    }));
}

/* ============================================================
   Kantong v7 — four-part money-flow taxonomy, dashboard metrics
   and savings goals. Pure functions: no clock, network or storage
   reads except the values passed in as arguments.
   ============================================================ */

/* Universal, transferable taxonomy. Nothing here is personal: no names of
   people, no specific bank, no specific family situation. A user may add,
   rename, archive or delete any of it — the seed runs once per account. */
export const TAXONOMY = {
  income: [
    'Salary', 'Overtime', 'Bonus & THR', 'Freelance',
    'Reimbursement', 'Gift', 'Investment Returns', 'Other Income',
  ],
  expenseGroups: [
    { name: 'Food & Beverage', icon: '🍽️', color: '#b7893f', subs: ['Meals', 'Coffee & Drinks', 'Groceries', 'Snacks', 'Food Delivery'] },
    { name: 'Transportation', icon: '🚗', color: '#2f6f8f', subs: ['Fuel', 'Public Transport', 'Ride Hailing', 'Parking & Toll', 'Vehicle Service'] },
    { name: 'Living & Household', icon: '🏠', color: '#8a6d3b', subs: ['Electricity & Water', 'Internet & Phone', 'Rent & Mortgage', 'Home Supplies', 'Laundry'] },
    { name: 'Shopping & Lifestyle', icon: '🛍️', color: '#6b5b95', subs: ['Fashion', 'Skincare', 'Makeup', 'Accessories', 'Electronics', 'Hobbies'] },
    { name: 'Health & Personal Care', icon: '💊', color: '#a8472c', subs: ['Medicine & Vitamins', 'Doctor & Hospital', 'Dental', 'Personal Care', 'Gym & Fitness'] },
    { name: 'Travel & Entertainment', icon: '✈️', color: '#1d4e79', subs: ['Vacation', 'Staycation', 'Cinema', 'Concerts & Events', 'Subscriptions', 'Hangouts'] },
    { name: 'Family & Social', icon: '👥', color: '#7a3b2e', subs: ['Family Support', 'Education Support', 'Partner', 'Gifts & Hampers', 'Weddings & Social', 'Donations', 'Social Activities'] },
    { name: 'Work & Education', icon: '💼', color: '#4b7a5a', subs: ['Work Equipment', 'Courses & Training', 'Books', 'Certification', 'Professional Development'] },
  ],
  savings: [
    'Emergency Fund', 'Wedding Fund', 'House Fund', 'Holiday Fund', 'Long-term Savings',
    'Gold', 'Mutual Funds', 'Stocks', 'Time Deposit',
  ],
  obligation: [
    'Installments', 'PayLater', 'Credit Card', 'Loans', 'Insurance', 'Tax', 'Bank Fees',
  ],
};
export const SAVINGS_GROUP = 'Savings & Investment';
export const OBLIGATION_GROUP = 'Financial Obligations';
export const INCOME_GROUP = 'Income';

export const TAXONOMY_ROWS = (() => {
  const rows = [];
  TAXONOMY.income.forEach((name, i) => rows.push({
    name, kind: 'income', group_name: INCOME_GROUP, icon: '💰', color: '#1c6b4b', sort_order: i,
  }));
  let order = TAXONOMY.income.length;
  for (const g of TAXONOMY.expenseGroups) {
    for (const name of g.subs) {
      rows.push({ name, kind: 'expense', group_name: g.name, icon: g.icon, color: g.color, sort_order: order++ });
    }
  }
  TAXONOMY.savings.forEach((name, i) => rows.push({
    name, kind: 'savings', group_name: SAVINGS_GROUP, icon: '🏦', color: '#1c6b4b', sort_order: order + i,
  }));
  order += TAXONOMY.savings.length;
  TAXONOMY.obligation.forEach((name, i) => rows.push({
    name, kind: 'obligation', group_name: OBLIGATION_GROUP, icon: '🧾', color: '#6c7a72', sort_order: order + i,
  }));
  return rows;
})();

const TAXON_INDEX = new Map(TAXONOMY_ROWS.map((r) => [r.name, { kind: r.kind, group_name: r.group_name }]));

export function taxonOf(name) {
  return TAXON_INDEX.get(String(name ?? '').trim()) || null;
}
export function kindOfCategory(name, fallback = 'expense') {
  return taxonOf(name)?.kind || fallback;
}
export function groupOfCategory(name) {
  return taxonOf(name)?.group_name || 'Other';
}
export function taxonomyNames(kind) {
  return TAXONOMY_ROWS.filter((r) => r.kind === kind).map((r) => r.name);
}
export function taxonomyGroups() {
  return [...TAXONOMY.expenseGroups.map((g) => g.name), SAVINGS_GROUP, OBLIGATION_GROUP, INCOME_GROUP];
}
export function groupMeta(name) {
  const g = TAXONOMY.expenseGroups.find((x) => x.name === name);
  if (g) return { icon: g.icon, color: g.color };
  if (name === SAVINGS_GROUP) return { icon: '🏦', color: '#1c6b4b' };
  if (name === OBLIGATION_GROUP) return { icon: '🧾', color: '#6c7a72' };
  if (name === INCOME_GROUP) return { icon: '💰', color: '#1c6b4b' };
  return CATEGORY_FALLBACK;
}

/* Savings goal validation. `saved_amount` is an optional opening amount the
   user already set aside; contributions are derived from savings transactions
   so the dashboard never counts the same money twice by guessing. */
export function validateGoal(raw = {}) {
  const name = String(raw.name ?? '').trim();
  if (!name) throw Error('A goal name is required.');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._&()/-]{0,49}$/.test(name)) throw Error('Goal name: 1–50 letters/numbers, spaces or . _ & ( ) / -.');
  const money = (value, label, { allowZero = true, fallback = 0 } = {}) => {
    if (value === null || value === undefined || value === '') return BigInt(fallback);
    const s = rupiahDigits(value);
    if (!/^\d+$/.test(s) || !Number.isSafeInteger(Number(s))) throw Error(`${label} must be whole rupiah.`);
    const n = BigInt(s);
    if (n < 0n || (!allowZero && n === 0n)) throw Error(`${label} must be ${allowZero ? 'zero or more' : 'more than zero'}.`);
    return n;
  };
  let deadline = null;
  if (raw.deadline) {
    const d = String(raw.deadline);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + 'T12:00:00Z')) || new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) !== d) throw Error('Invalid goal deadline.');
    deadline = d;
  }
  const color = String(raw.color ?? '');
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw Error('The color must be a #rrggbb hex code.');
  const icon = String(raw.icon ?? '');
  if (icon && !CATEGORY_ICONS.includes(icon)) throw Error('Pick an icon from the available list.');
  return {
    name,
    target_amount: money(raw.target_amount, 'The goal target', { allowZero: false }),
    saved_amount: money(raw.saved_amount, 'The amount already saved'),
    deadline,
    account_id: raw.account_id ? String(raw.account_id) : null,
    category: String(raw.category ?? name).trim() || name,
    color: color || '#1c6b4b',
    icon: icon || '🎯',
    archived_at: raw.archived_at ? new Date(raw.archived_at).toISOString() : null,
  };
}

export const GOAL_TEMPLATES = [
  { name: 'Emergency Fund', target_amount: '15000000', icon: '🛡️' },
  { name: 'Wedding Fund', target_amount: '50000000', icon: '💍' },
  { name: 'House Fund', target_amount: '150000000', icon: '🏡' },
  { name: 'Holiday Fund', target_amount: '12000000', icon: '🏖️' },
];

export function goalProgress(goal = {}, all = [], today = localDate()) {
  const target = BigInt(goal.target_amount ?? 0);
  const manual = BigInt(goal.saved_amount ?? 0);
  const contributions = all.filter((t) => t.type === 'savings'
    && ((t.goal_id && t.goal_id === goal.id) || (!t.goal_id && t.category === goal.name)));
  const contributed = contributions.reduce((sum, t) => sum + BigInt(t.amount), 0n);
  const saved = manual + contributed;
  const pct = target > 0n ? Number((saved * 10000n) / target) / 100 : 0;
  const daysLeft = goal.deadline
    ? Math.ceil((Date.parse(goal.deadline + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000)
    : null;
  return {
    goal,
    target,
    saved,
    manual,
    contributed,
    contributions: contributions.length,
    pct,
    cappedPct: Math.max(0, Math.min(100, pct)),
    remaining: target > saved ? target - saved : 0n,
    done: target > 0n && saved >= target,
    daysLeft,
  };
}

export function goalsOverview(goals = [], all = [], today = localDate()) {
  const active = goals.filter((g) => g && !g.archived_at);
  const rows = active.map((g) => goalProgress(g, all, today));
  const target = rows.reduce((s, r) => s + r.target, 0n);
  const saved = rows.reduce((s, r) => s + r.saved, 0n);
  return { rows, target, saved, count: rows.length, done: rows.filter((r) => r.done).length };
}

/* Budget rows for one group: an explicit group budget (scope='group') wins,
   otherwise the subcategory budgets are summed. */
export function budgetGroupRows(all = [], month, budgets = []) {
  const r = recap(all, month);
  const actual = new Map();
  for (const t of r.rows) {
    if (t.type !== 'expense') continue;
    const g = groupOfCategory(t.category);
    actual.set(g, (actual.get(g) || 0n) + BigInt(t.amount));
  }
  const direct = new Map();
  const summed = new Map();
  for (const b of budgets.filter((x) => x && x.month === month)) {
    if ((b.scope || 'category') === 'group') {
      direct.set(b.category, BigInt(b.amount));
      continue;
    }
    const g = taxonOf(b.category)?.group_name;
    if (!g) continue;
    summed.set(g, (summed.get(g) || 0n) + BigInt(b.amount));
  }
  const groups = [...new Set([
    ...TAXONOMY.expenseGroups.map((g) => g.name),
    ...actual.keys(), ...direct.keys(), ...summed.keys(),
  ])];
  return groups.map((group) => {
    const budget = direct.has(group) ? direct.get(group) : (summed.has(group) ? summed.get(group) : null);
    const spent = actual.get(group) || 0n;
    return { group, budget, actual: spent, gap: budget === null ? null : budget - spent };
  });
}

/* One month of dashboard numbers plus the Financial Insights block. */
export function dashboardMetrics({ all = [], month, budgets = [], categories = [], goals = [], today = localDate() } = {}) {
  const r = recap(all, month);
  const prev = recap(all, monthFromIndex(monthIndex(month) - 1));
  const byGroup = new Map();
  for (const t of r.rows) {
    if (t.type !== 'expense') continue;
    const g = groupOfCategory(t.category);
    byGroup.set(g, (byGroup.get(g) || 0n) + BigInt(t.amount));
  }
  const expenseByGroup = [...byGroup.entries()]
    .map(([group, total]) => ({
      group,
      total,
      share: r.expense > 0n ? Number((total * 10000n + r.expense / 2n) / r.expense) / 100 : 0,
      ...groupMeta(group),
    }))
    .sort((a, b) => (a.total === b.total ? 0 : a.total > b.total ? -1 : 1));

  const expenses = r.rows.filter((t) => t.type === 'expense');
  const biggestExpense = expenses.reduce((max, t) => (!max || BigInt(t.amount) > BigInt(max.amount) ? t : max), null);

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const elapsed = today.slice(0, 7) === month ? Math.max(1, Number(today.slice(8, 10))) : daysInMonth;
  const avgDaily = r.expense > 0n ? r.expense / BigInt(elapsed) : 0n;

  const deltaPct = prev.expense > 0n
    ? Number(((r.expense - prev.expense) * 1000n) / prev.expense) / 10
    : null;
  const savingRate = r.income > 0n ? Number((r.savings * 10000n) / r.income) / 100 : null;

  return {
    month,
    income: r.income,
    expense: r.expense,
    savings: r.savings,
    obligation: r.obligation,
    remaining: r.net,
    balance: r.balance,
    savingRate,
    expenseByGroup,
    topGroup: expenseByGroup[0] || null,
    biggestExpense,
    avgDaily,
    elapsedDays: elapsed,
    prevExpense: prev.expense,
    deltaPct,
    budgetByGroup: budgetGroupRows(all, month, budgets).filter((g) => g.budget !== null),
    groups: budgetGroupRows(all, month, budgets),
    goals: goalsOverview(goals, all, today),
    categories,
  };
}


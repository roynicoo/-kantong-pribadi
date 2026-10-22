export const CATEGORIES={income:['Gaji','Usaha','Hadiah','Lainnya'],expense:['Makan','Laundry','Kosan','Transport','Listrik','Internet','Rokok','Andreas','Ortu','UKT','ETC','Transportasi','Belanja','Tagihan','Kesehatan','Hiburan','Lainnya']};
export function categoryName(raw){const name=String(raw??'').trim();if(!/^[A-Za-z0-9][A-Za-z0-9 ._&()/-]{0,49}$/.test(name)||['Gaji','Usaha','Hadiah'].includes(name))throw Error('Kategori pengeluaran: 1–50 karakter huruf/angka, spasi atau . _ & ( ) / -, bukan kategori pemasukan.');return name;}
export function localDate(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function monthBounds(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Bulan tidak valid');const [y,m]=month.split('-').map(Number);return [`${month}-01`,`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-01`];}
export function recap(all,month){const [start,end]=monthBounds(month);const rows=all.filter(t=>t.date>=start&&t.date<end);let income=0n,expense=0n;const categories=Object.create(null);for(const t of rows){const n=BigInt(t.amount);if(t.type==='income')income+=n;else{expense+=n;categories[t.category]=(categories[t.category]||0n)+n;}}return {rows,income,expense,balance:income-expense,categories};}
export function validate(t){
 if(t.type==='expense'){categoryName(t.category);if(t.category!==String(t.category).trim())throw Error('Kategori tidak valid.');}else if(t.type!=='income'||!CATEGORIES.income.includes(t.category))throw Error('Jenis atau kategori tidak valid.');
 const raw=String(t.amount);const amount=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(amount)||amount<=0)throw Error('Nominal harus rupiah bulat positif, maksimal 9.007.199.254.740.991.');
 const date=String(t.date);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'0001-01-01'||date>'9999-12-31'||Number.isNaN(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Tanggal tidak valid.');
 const notes=String(t.notes||'').trim();if(notes.length>500)throw Error('Catatan maksimal 500 karakter.');
 const account_id=t.account_id===null||t.account_id===undefined||t.account_id===''?null:String(t.account_id);
 return {type:t.type,category:t.category,amount,date,notes,account_id};
}
export function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function toCSV(rows){const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFFtanggal,jenis,kategori,nominal_idr,catatan\r\n'+rows.map(t=>[t.date,t.type,t.category,t.amount,t.notes].map(cell).join(',')).join('\r\n');}
export function reportCSV(headers,rows){const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFF'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n');}
export function backup(rows,planning,extras){const version=planning?(extras?(Array.isArray(extras.accounts)?4:3):2):1;return JSON.stringify({app:'Kantong',version,exportedAt:new Date().toISOString(),transactions:rows,...(planning||{}),...(extras||{})},(_,v)=>typeof v==='bigint'?v.toString():v,2);}
// Empty budget means no target; zero is an intentional target.
export function budgetAmount(raw){if(raw===''||raw===null||raw===undefined)return null;const s=String(raw);const n=Number(s);if(!/^\d+$/.test(s)||!Number.isSafeInteger(n)||n<0)throw Error('Anggaran harus rupiah bulat nonnegatif yang aman.');return n;}
export function budgetRecap(all,month,budgets=[],names=[]){const r=recap(all,month);const selected=budgets.filter(b=>b.month===month);return [...new Set([...names,...Object.keys(r.categories),...selected.map(b=>b.category)])].map(category=>{const b=selected.find(x=>x.category===category);const budget=b?BigInt(b.amount):null;const actual=r.categories[category]||0n;return {category,budget,actual,gap:budget===null?null:budget-actual};});}
export function dailyRecap(all,month,names=[]){
 const r=recap(all,month), categories=[...new Set([...names,...Object.keys(r.categories)])];
 const [y,m]=month.split('-').map(Number);const count=new Date(Date.UTC(y===0?2000:y,m,0)).getUTCDate();
 const days=Array.from({length:count},(_,i)=>({date:`${month}-${String(i+1).padStart(2,'0')}`,categories:Object.fromEntries(categories.map(c=>[c,0n])),total:0n}));
 for(const t of r.rows){if(t.type!=='expense')continue;const d=days[Number(t.date.slice(8))-1];d.categories[t.category]+=BigInt(t.amount);d.total+=BigInt(t.amount);}
 return {categories,days,totals:Object.fromEntries(categories.map(c=>[c,r.categories[c]||0n])),total:r.expense};
}
export const needsImprovement=(all,month)=>recap(all,month).balance<0n;
export function improvement(rows,income,proposed={}){
 const raw=String(income);if(!/^\d+$/.test(raw))throw Error('Asumsi pemasukan harus rupiah bulat nonnegatif.');
 const result=rows.map(r=>{const baseline=r.budget??r.actual;const value=Object.hasOwn(proposed,r.category)?budgetAmount(proposed[r.category]):baseline;if(value===null)throw Error('Isi semua usulan, gunakan 0 bila perlu.');const proposal=BigInt(value);return {...r,baseline,source:r.budget===null?'actual':'budget',proposal,reduction:baseline-proposal};});
 const total=result.reduce((s,r)=>s+r.proposal,0n),baseline=result.reduce((s,r)=>s+r.baseline,0n);return {rows:result,income:BigInt(raw),total,baseline,reduction:baseline-total,remaining:BigInt(raw)-total};
}
export const idr=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);

/* ============================================================
   Kantong v4 — jadwal pemasukan rutin, saldo berjalan, onboarding.
   Semua fungsi di bawah ini murni: tidak membaca jam, jaringan, atau
   penyimpanan kecuali nilai yang diberikan sebagai argumen.
   ============================================================ */

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_MS = 86400000;

export function validateMonthString(raw, label = 'Bulan') {
  const m = String(raw ?? '');
  if (!MONTH_RE.test(m) || m < '0001-01') throw Error(`${label} tidak valid.`);
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
  if (!Number.isInteger(d) || d < 1 || d > 31) throw Error('Tanggal jatuh tempo harus 1–31.');
  return `${m}-${String(Math.min(d, daysInMonth(m))).padStart(2, '0')}`;
}
export function openingAmount(raw) {
  if (raw === '' || raw === null || raw === undefined) return 0;
  const s = String(raw);
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < 0) throw Error('Saldo awal harus rupiah bulat nonnegatif (boleh 0).');
  return n;
}
export function validateEntryDate(date, today) {
  const d = String(date ?? '');
  const t = String(today ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < '0001-01-01' || d > '9999-12-31' || Number.isNaN(Date.parse(d + 'T12:00:00Z')) || new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) !== d) throw Error('Tanggal tidak valid.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw Error('Tanggal hari ini tidak valid.');
  if (d > t) throw Error(`Tanggal ${d} belum terjadi (hari ini ${t}). Pilih hari ini atau tanggal sebelumnya.`);
  return d;
}
export function validateSchedule(raw) {
  const src = raw || {};
  const name = String(src.name ?? '').trim();
  if (!name || name.length > 50 || /[<>\u0000-\u001f]/.test(name)) throw Error('Nama pemasukan rutin: 1–50 karakter, tanpa karakter < > atau kontrol.');
  const amountRaw = String(src.amount ?? '');
  const amount = Number(amountRaw);
  if (!/^\d+$/.test(amountRaw) || !Number.isSafeInteger(amount) || amount <= 0) throw Error('Nominal pemasukan rutin harus rupiah bulat positif, maksimal 9.007.199.254.740.991.');
  const dayRaw = String(src.day ?? '');
  const day = Number(dayRaw);
  if (!/^\d{1,2}$/.test(dayRaw) || !Number.isInteger(day) || day < 1 || day > 31) throw Error('Tanggal jatuh tempo harus 1–31.');
  const startMonth = validateMonthString(src.start_month, 'Bulan mulai');
  let endMonth = src.end_month === null || src.end_month === undefined || src.end_month === '' ? null : validateMonthString(src.end_month, 'Bulan berhenti');
  if (endMonth && endMonth < startMonth) throw Error('Bulan berhenti tidak boleh sebelum bulan mulai.');
  let resumeMonth = src.resume_month === null || src.resume_month === undefined || src.resume_month === '' ? null : validateMonthString(src.resume_month, 'Bulan aktif kembali');
  if (resumeMonth && resumeMonth < startMonth) resumeMonth = null;
  const category = String(src.category ?? 'Gaji');
  if (!CATEGORIES.income.includes(category)) throw Error('Kategori pemasukan rutin tidak valid.');
  const notes = String(src.notes ?? '').trim();
  if (notes.length > 500) throw Error('Catatan maksimal 500 karakter.');
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
  if (s.end_month && String(today).slice(0, 7) > s.end_month) return `${s.name} · selesai · jadwal berakhir ${s.end_month}`;
  if (!s.active) return `${s.name} · dijeda · otomatis tiap tanggal ${s.day}`;
  return `${s.name} · otomatis tiap tanggal ${s.day}`;
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
    catch (e) { errors.push({ ...item, message: e?.message || 'Gagal mengunci pencatatan otomatis.' }); continue; }
    if (!claim || claim.claimed !== true) continue;
    let tx;
    try { tx = await store.save({ type: 'income', category: item.category, amount: String(item.amount), date: item.date, notes: item.notes }, null); }
    catch (e) {
      try { await store.releasePosting(item.schedule_id, item.month); } catch { /* biarkan klaim agar tidak dobel; pengguna melihat galat */ }
      errors.push({ ...item, message: e?.message || 'Gagal menyimpan pemasukan otomatis.' });
      continue;
    }
    try { await store.linkPosting(item.schedule_id, item.month, tx.id); }
    catch (e) { errors.push({ ...item, message: `Pemasukan ${item.month} tercatat tetapi tautannya gagal: ${e?.message || ''}` }); continue; }
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
  let carried = start;
  for (const t of all || []) if (String(t.date).slice(0, 7) < m) carried += t.type === 'income' ? BigInt(t.amount) : -BigInt(t.amount);
  const r = recap(all, m);
  return { month: m, inflow: r.income, outflow: r.expense, ending: carried + r.income - r.expense };
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
  if (!data || typeof data !== 'object' || !Array.isArray(data.transactions)) throw Error('Struktur backup tidak dikenali.');
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
  };
}

/* ---------- v4 profil: nama pengguna, avatar lokal, tema tampilan ---------- */
export const USERNAME_RE = /^[A-Za-z0-9 ._-]{2,24}$/;
export const AVATAR_COLORS = ['#0f4c44', '#1d4e79', '#7a3b2e', '#4b3a70', '#3f6b2f'];
export const AVATAR_LIMIT_BYTES = 100 * 1024;
export const AVATAR_LIMIT_CHARS = 140000;
export const THEMES = [
  { id: 'krem', label: 'Krem hijau', color: '#0f4c44', dark: '#8fd8c4' },
  { id: 'biru', label: 'Biru tenang', color: '#1d4e79', dark: '#8fc4ec' },
  { id: 'ungu', label: 'Ungu lembut', color: '#4b3a70', dark: '#c3b2e8' },
  { id: 'senja', label: 'Senja tanah', color: '#8a3b2a', dark: '#eda88f' },
];
export const PATTERNS = [
  { id: 'none', label: 'Polos' },
  { id: 'titik', label: 'Titik halus' },
  { id: 'garis', label: 'Garis miring' },
  { id: 'kisi', label: 'Kisi' },
];
export function validateUsername(raw) {
  const name = String(raw ?? '').trim();
  if (!USERNAME_RE.test(name)) throw Error('Nama pengguna: 2–24 karakter, hanya huruf, angka, spasi, titik, garis bawah, atau tanda hubung.');
  return name;
}
export function usernameFromEmail(email) {
  const local = String(email ?? '').split('@')[0] || '';
  const cleaned = local.replace(/[^A-Za-z0-9 ._-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  return cleaned.length >= 2 ? cleaned : 'Pengguna';
}
export function greetingText(name, hour = new Date().getHours()) {
  const h = Number(hour);
  const period = h >= 4 && h < 11 ? 'Selamat pagi' : h >= 11 && h < 15 ? 'Selamat siang' : h >= 15 && h < 19 ? 'Selamat sore' : 'Selamat malam';
  let safe = String(name ?? '').trim().slice(0, 24);
  if (safe.length < 2) safe = 'Pengguna';
  return `${period} · Hi, ${safe}`;
}
export function avatarInitials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((p) => p[0]).join('');
  return (initials || '?').toUpperCase().slice(0, 2);
}
/* Batas input sebelum kompresi; bukan bukti bahwa file aman diproses. */
export function validateAvatarPhoto({ type, size } = {}) {
  if (!/^image\/(jpeg|webp)$/.test(String(type || ''))) throw Error('Foto harus JPEG atau WebP. Format lain ditolak.');
  const n = Number(size);
  if (!Number.isSafeInteger(n) || n <= 0) throw Error('Ukuran file tidak valid.');
  if (n > 8 * 1024 * 1024) throw Error('Foto asli maksimal 8 MB.');
  return true;
}
/* Data URL disimpan sebagai teks pribadi di baris pengaturan; batas 100 KB biner. */
export function avatarDataError(dataUrl) {
  const s = String(dataUrl ?? '');
  if (!/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) throw Error('Data foto tidak valid.');
  const bytes = Math.floor((s.length - s.indexOf(',') - 1) * 3 / 4);
  if (bytes > AVATAR_LIMIT_BYTES || s.length > AVATAR_LIMIT_CHARS) throw Error('Foto masih lebih dari 100 KB setelah dikompres. Pilih foto lain.');
  return false;
}
export const normalizeTheme = (v) => (THEMES.some((t) => t.id === v) ? v : 'krem');
export const normalizePattern = (v) => (PATTERNS.some((p) => p.id === v) ? v : 'none');

/* ============================================================
   Kantong v4 — Akun & Aset: dompet, transfer, investasi manual.
   Tidak ada umpan harga pasar; semua nilai investasi diisi pengguna.
   ============================================================ */
export const ACCOUNT_TYPES = [
  { id: 'cash', label: 'Tunai' },
  { id: 'bank', label: 'Bank' },
  { id: 'ewallet', label: 'E-wallet' },
  { id: 'investment', label: 'Investasi' },
  { id: 'other', label: 'Lainnya' },
];
export const LIQUID_TYPES = ['cash', 'bank', 'ewallet'];
export const ACCOUNT_COLORS = ['#0f4c44', '#1d4e79', '#7a3b2e', '#4b3a70', '#3f6b2f', '#8a6d3b'];
export const HOLDING_KINDS = [
  { id: 'saham', label: 'Saham' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'reksadana', label: 'Reksadana' },
  { id: 'emas', label: 'Emas' },
  { id: 'lainnya', label: 'Lainnya' },
];

const accountName = (raw) => {
  const name = String(raw ?? '').trim();
  if (!name || name.length > 40 || /[<>\u0000-\u001f]/.test(name)) throw Error('Nama akun: 1–40 karakter, tanpa karakter < > atau kontrol.');
  return name;
};
const money = (raw, label, { allowZero = true } = {}) => {
  const s = String(raw ?? '');
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < 0 || (!allowZero && n === 0)) throw Error(`${label} harus rupiah bulat nonnegatif.`);
  return n;
};
const decimal = (raw, label, places) => {
  const s = String(raw ?? '').trim();
  const re = new RegExp(`^\\d{1,15}(\\.\\d{1,${places}})?$`);
  if (!re.test(s)) throw Error(`${label} tidak valid (maksimal ${places} desimal, tanpa tanda minus).`);
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw Error(`${label} tidak valid.`);
  return s.replace(/\.?0+$/, '') === s ? s : s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};
export function validateAccount(raw) {
  const src = raw || {};
  const type = String(src.type ?? '');
  if (!ACCOUNT_TYPES.some((t) => t.id === type)) throw Error('Jenis akun tidak valid.');
  const color = String(src.color ?? ACCOUNT_COLORS[0]);
  if (!ACCOUNT_COLORS.includes(color)) throw Error('Warna akun tidak valid.');
  const note = String(src.note ?? '').trim();
  if (note.length > 200) throw Error('Catatan akun maksimal 200 karakter.');
  const currentValue = src.current_value === null || src.current_value === undefined || src.current_value === '' ? null : money(src.current_value, 'Nilai kini akun');
  return { name: accountName(src.name), type, opening_balance: money(src.opening_balance === '' || src.opening_balance === undefined || src.opening_balance === null ? 0 : src.opening_balance, 'Saldo awal akun'), color, note, current_value: currentValue, is_archived: src.is_archived === true };
}
export function validateTransfer(raw) {
  const src = raw || {};
  const from = String(src.from_account ?? '').trim();
  const to = String(src.to_account ?? '').trim();
  if (!from || !to) throw Error('Pilih akun asal dan akun tujuan.');
  if (from === to) throw Error('Akun asal dan tujuan harus berbeda.');
  const amount = money(src.amount, 'Nominal pindah dana', { allowZero: false });
  const date = validateEntryDate(src.date, src.date);
  const note = String(src.note ?? '').trim();
  if (note.length > 200) throw Error('Catatan pindah dana maksimal 200 karakter.');
  return { from_account: from, to_account: to, amount, date, note };
}
export function validateHolding(raw) {
  const src = raw || {};
  const accountId = String(src.account_id ?? '').trim();
  if (!accountId) throw Error('Akun investasi wajib dipilih.');
  const kind = String(src.kind ?? '');
  if (!HOLDING_KINDS.some((k) => k.id === kind)) throw Error('Jenis aset tidak valid.');
  const assetName = String(src.asset_name ?? '').trim();
  if (!assetName || assetName.length > 60 || /[<>\u0000-\u001f]/.test(assetName)) throw Error('Nama aset: 1–60 karakter, tanpa karakter < > atau kontrol.');
  return {
    account_id: accountId, asset_name: assetName, kind,
    quantity: decimal(src.quantity, 'Jumlah', 8),
    avg_buy_price: decimal(src.avg_buy_price, 'Harga beli rata-rata', 4),
    current_price: decimal(src.current_price, 'Harga kini', 4),
  };
}
export const holdingValue = (h) => {
  const v = Number(h.quantity) * Number(h.current_price);
  if (!Number.isFinite(v) || v < 0 || v > 9e15) throw Error('Nilai aset di luar batas aman.');
  return BigInt(Math.round(v));
};
export const holdingCost = (h) => {
  const v = Number(h.quantity) * Number(h.avg_buy_price);
  if (!Number.isFinite(v) || v < 0 || v > 9e15) throw Error('Biaya aset di luar batas aman.');
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
  const value = money(raw, 'Nilai kini');
  return { value, date: validateEntryDate(today, today) };
}
export function validateActivity(raw) {
  const action = String(raw?.action ?? '');
  const entity = String(raw?.entity ?? '');
  if (!['created', 'edited', 'deleted'].includes(action)) throw Error('Jenis aktivitas tidak valid.');
  if (!['account', 'holding', 'transfer', 'valuation', 'settings'].includes(entity)) throw Error('Objek aktivitas tidak valid.');
  const summary = String(raw?.summary ?? '').trim();
  if (!summary || summary.length > 200 || /[<>\u0000-\u001f]/.test(summary)) throw Error('Ringkasan aktivitas tidak valid.');
  return { action, entity, summary };
}

/* Rencana pembaruan nilai massal: validasi semua baris sebelum satu pun disimpan. */
export function valuationPlan(items, today = localDate()) {
  if (!Array.isArray(items) || !items.length) throw Error('Tidak ada nilai akun yang diubah.');
  const seen = new Set();
  return items.map((it) => {
    const accountId = String(it?.account_id ?? '').trim();
    if (!accountId) throw Error('Akun wajib dipilih.');
    if (seen.has(accountId)) throw Error('Setiap akun hanya boleh muncul sekali dalam satu pembaruan.');
    seen.add(accountId);
    const { value, date } = valuationInput(it.value, it.date || today);
    const note = String(it.note ?? '').trim();
    if (note.length > 200 || /[<>\u0000-\u001f]/.test(note)) throw Error('Catatan nilai maksimal 200 karakter tanpa < >.');
    return { account_id: accountId, value, date, note };
  });
}

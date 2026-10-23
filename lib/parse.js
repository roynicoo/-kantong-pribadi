// Parser pesan WhatsApp bahasa Indonesia informal.
// Murni: tidak menyentuh jaringan, jam sistem, atau database.
import { addDays, daysInMonth, jakartaDate } from './time.js';

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Makan', 'Laundry', 'Kosan', 'Transport', 'Listrik', 'Internet', 'Rokok',
  'Andreas', 'Ortu', 'UKT', 'ETC', 'Transportasi', 'Belanja', 'Tagihan',
  'Kesehatan', 'Hiburan', 'Lainnya',
];
export const INCOME_CATEGORIES = ['Gaji', 'Usaha', 'Hadiah', 'Lainnya'];

const MAX_AMOUNT = 1_000_000_000_000; // 1 triliun
const MONEY_SUFFIX = { ribu: 1e3, rbu: 1e3, rb: 1e3, k: 1e3, jt: 1e6, juta: 1e6, miliar: 1e9, milyar: 1e9 };

const TRANSFER_RE = /\b(?:pindah(?:in)?|transfer|trf|mutasi)\b/;
const INCOME_RE = /\b(?:masuk(?:in)?|pemasukan|income|gajian|gaji|bonus|thr|terima|dapet|dapat)\b/;
const EXPENSE_RE = /\b(?:pengeluaran|keluar|bayar|beli|belanja)\b/;

const CONFIRM_WORDS = new Set([
  'ok', 'oke', 'okey', 'okay', 'okee', 'yes', 'y', 'sip', 'siap', 'ya',
  'iya', 'yap', 'yaa', 'betul', 'benar', 'simpan', 'gas', 'lanjut', 'setuju',
]);
const CANCEL_WORDS = new Set([
  'batal', 'batalkan', 'cancel', 'no', 'nggak', 'gak', 'gk', 'ga', 'tidak',
  'enggak', 'jangan', 'salah',
]);

// Sinonim -> kategori bawaan Kantong. Prioritas: makin besar makin dipilih
// saat dua kata sama panjang (mis. "beli kopi" -> Makan, bukan Belanja).
const EXPENSE_SYNONYMS = {
  Makan: ['makan', 'makanan', 'sarapan', 'makan siang', 'makan malam', 'kopi', 'ngopi', 'warung',
    'warteg', 'nasi', 'bakso', 'mie', 'ayam', 'jajan', 'cafe', 'kafe', 'resto', 'restoran',
    'minum', 'boba', 'camilan', 'snack', 'pizza', 'burger', 'sate', 'soto', 'roti', 'martabak'],
  Transport: ['bensin', 'transport', 'transportasi', 'ojek', 'grab', 'gojek', 'maxim', 'parkir',
    'tol', 'angkot', 'bus', 'kereta', 'krl', 'mrt', 'taksi', 'servis motor', 'tambal ban', 'tarif'],
  Laundry: ['laundry', 'binatu', 'cuci baju', 'cuci'],
  Kosan: ['kos', 'kosan', 'sewa kos', 'kontrakan'],
  Listrik: ['listrik', 'pln', 'token listrik', 'token pln'],
  Internet: ['internet', 'wifi', 'indihome', 'kuota', 'paket data', 'biznet', 'first media'],
  Rokok: ['rokok', 'vape', 'pod', 'marlboro'],
  Kesehatan: ['obat', 'dokter', 'klinik', 'rumah sakit', 'rs', 'vitamin', 'kesehatan', 'apotek', 'periksa'],
  Hiburan: ['nonton', 'film', 'bioskop', 'game', 'netflix', 'spotify', 'hiburan', 'konser', 'langganan'],
  Belanja: ['belanja', 'beli', 'shopee', 'tokopedia', 'baju', 'celana', 'sepatu', 'kebutuhan',
    'sabun', 'odol', 'shampo', 'sampo', 'tiktok shop'],
  Tagihan: ['tagihan', 'air', 'pdam', 'bpjs', 'asuransi', 'cicilan', 'utang', 'hutang', 'pajak', 'spp', 'iuran', 'pulsa'],
  Lainnya: ['lainnya', 'lain', 'misc'],
};
const CATEGORY_PRIORITY = {
  Makan: 60, Transport: 50, Laundry: 45, Kosan: 45, Listrik: 40, Internet: 40, Rokok: 40,
  Kesehatan: 40, Hiburan: 30, Belanja: 25, Tagihan: 25, Lainnya: 0,
};
const INCOME_SYNONYMS = {
  Gaji: ['gaji', 'gajian', 'upah', 'honor', 'fee', 'gaji bulanan'],
  Usaha: ['usaha', 'jualan', 'dagang', 'toko', 'omset', 'penjualan', 'proyek', 'freelance'],
  Hadiah: ['hadiah', 'bonus', 'thr', 'cashback', 'giveaway', 'angpao'],
  Lainnya: ['lainnya', 'lain'],
};

const FILLERS = new Set([
  'di', 'ke', 'dari', 'untuk', 'buat', 'aja', 'saja', 'dong', 'deh', 'ya', 'sih', 'yang',
  'sama', 'dan', 'utk', 'pada', 'nih', 'tuh', 'lagi', 'udah', 'sudah', 'juga', 'rp', 'idr',
  'nya', 'ku', 'aku', 'saya',
]);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (phrase) => new RegExp(`(?<![a-z0-9])${esc(phrase)}(?![a-z0-9])`);

/** Huruf kecil, tanpa aksen, spasi rapi. */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[→➡➜]/g, '->')
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function prep(text) {
  return text
    .replace(/[“”"']/g, ' ')
    .replace(/[!?;:()]/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/,(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cutAt(text, start, length) {
  return `${text.slice(0, start)} ${text.slice(start + length)}`.replace(/\s+/g, ' ').trim();
}

export function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  if (digits.startsWith('8')) digits = `62${digits}`;
  return digits;
}

/* ---------- tanggal ---------- */

function recentDayOfMonth(todayYmd, day) {
  const [ty, tm] = todayYmd.split('-').map(Number);
  for (let back = 0; back <= 24; back += 1) {
    const idx = tm - 1 - back;
    const y = ty + Math.floor(idx / 12);
    const m = ((idx % 12) + 12) % 12 + 1;
    if (day > daysInMonth(y, m)) continue;
    const cand = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (cand <= todayYmd) return cand;
  }
  return null;
}

function recentMonthDay(todayYmd, day, month, year) {
  const [ty] = todayYmd.split('-').map(Number);
  if (year) {
    const y = year < 100 ? 2000 + year : year;
    if (day > daysInMonth(y, month)) return null;
    const cand = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return cand <= todayYmd ? cand : null;
  }
  for (let back = 0; back <= 8; back += 1) {
    const y = ty - back;
    if (day > daysInMonth(y, month)) continue;
    const cand = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (cand <= todayYmd) return cand;
  }
  return null;
}

/** @returns {{ymd:string,index:number,text:string,explicit:true}|{error:string}|null} */
export function parseDateExpression(norm, now = new Date()) {
  const today = jakartaDate(now);
  const tests = [
    [/\bkemarin\s+lusa\b/, () => addDays(today, -2)],
    [/\bkemarin\b/, () => addDays(today, -1)],
    [/\b(?:hari\s+ini|tadi|sekarang|skrg|barusan)\b/, () => today],
    [/\bbesok\b/, () => addDays(today, 1)],
    [/\blusa\b/, () => addDays(today, 2)],
  ];
  for (const [re, make] of tests) {
    const m = norm.match(re);
    if (m) return { ymd: make(), index: m.index, text: m[0], explicit: true };
  }
  const tgl = norm.match(/\b(?:tgl|tanggal)\.?\s*(\d{1,2})\b/);
  if (tgl) {
    const day = Number(tgl[1]);
    if (day < 1 || day > 31) return { error: 'invalid_date' };
    const ymd = recentDayOfMonth(today, day);
    if (!ymd) return { error: 'invalid_date' };
    return { ymd, index: tgl.index, text: tgl[0], explicit: true };
  }
  const dm = norm.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return { error: 'invalid_date' };
    const ymd = recentMonthDay(today, day, month, dm[3] ? Number(dm[3]) : 0);
    if (!ymd) return { error: 'invalid_date' };
    return { ymd, index: dm.index, text: dm[0], explicit: true };
  }
  return null;
}

/* ---------- nominal ---------- */

function toNumber(raw) {
  let t = String(raw).replace(/[.,]+$/, '');
  if (!t) return null;
  const dots = (t.match(/\./g) || []).length;
  const commas = (t.match(/,/g) || []).length;
  let normalized;
  if (dots && commas) {
    const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    normalized = t.split(thou).join('').replace(dec, '.');
  } else if (dots + commas === 0) {
    normalized = t;
  } else {
    const sep = dots ? '.' : ',';
    const parts = t.split(sep);
    if (parts.length > 2) {
      if (!parts.every((p, i) => (i === 0 ? /^\d{1,3}$/.test(p) : /^\d{3}$/.test(p)))) return null;
      normalized = parts.join('');
    } else {
      const [head, tail] = parts;
      if (!/^\d{1,3}$/.test(head) || !/^\d+$/.test(tail)) return null;
      if (tail.length === 3) normalized = head + tail; // 1.900 / 18.500 / 1,900 -> ribuan
      else if (tail.length <= 2) normalized = `${head}.${tail}`; // 8.5 / 1,5 -> desimal
      else return null;
    }
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** @returns {{amount:number}|{error:string}} */
export function moneyFromToken(raw, suffixRaw = '') {
  const suffix = String(suffixRaw || '').toLowerCase();
  const value = toNumber(raw);
  if (value === null || !Number.isFinite(value)) return { error: 'invalid_amount' };
  const mult = suffix ? MONEY_SUFFIX[suffix] : 1;
  if (!mult) return { error: 'invalid_amount' };
  const amount = value * mult;
  const rounded = Math.round(amount);
  if (!Number.isFinite(amount) || Math.abs(amount - rounded) > 1e-6) return { error: 'invalid_amount' };
  if (rounded <= 0) return { error: 'zero_amount' };
  if (rounded > MAX_AMOUNT) return { error: 'too_large' };
  if (!Number.isSafeInteger(rounded)) return { error: 'invalid_amount' };
  return { amount: rounded };
}

const MONEY_RE = /(?:^|(?<=[^a-z0-9]))(?:rp\.?\s*)?(\d[\d.,]*)(?:\s*(ribu|rbu|rb|jt|juta|miliar|milyar|k))?(?:\s*rp\b)?(?=$|[^a-z0-9])/g;

function scanMoney(work) {
  const out = [];
  MONEY_RE.lastIndex = 0;
  let m;
  while ((m = MONEY_RE.exec(work))) {
    const res = moneyFromToken(m[1], m[2] || '');
    if (res.error) return { error: res.error, partial: out };
    out.push({ amount: res.amount, start: m.index, length: m[0].length });
    if (m[0].length === 0) MONEY_RE.lastIndex += 1;
  }
  return { candidates: out };
}

/* ---------- kategori & akun ---------- */

function resolveCategoryName(canonical, dbCategories) {
  const hit = dbCategories.find((c) => String(c).toLowerCase() === canonical.toLowerCase());
  if (hit) return hit;
  if (DEFAULT_EXPENSE_CATEGORIES.some((c) => c.toLowerCase() === canonical.toLowerCase())) return canonical;
  return null;
}

function matchExpenseCategory(work, dbCategories) {
  let best = null;
  const consider = (category, phrase, m, isDb) => {
    const score = phrase.length * 100 + (CATEGORY_PRIORITY[category] || 0) + (isDb ? 10 : 0) + m.index / 10000;
    if (!best || score > best.score) {
      best = { category, phrase: m[0], index: m.index, score, isDb };
    }
  };
  for (const name of dbCategories) {
    if (!name) continue;
    const m = work.match(wordRe(String(name).toLowerCase()));
    if (m) consider(String(name), String(name).toLowerCase(), m, true);
  }
  for (const name of DEFAULT_EXPENSE_CATEGORIES) {
    const m = work.match(wordRe(name.toLowerCase()));
    if (m) consider(name, name.toLowerCase(), m, false);
  }
  for (const [canonical, aliases] of Object.entries(EXPENSE_SYNONYMS)) {
    for (const alias of aliases) {
      const m = work.match(wordRe(alias));
      if (m) consider(canonical, alias, m, false);
    }
  }
  if (!best) return null;
  return { category: resolveCategoryName(best.category, dbCategories), phrase: best.phrase, index: best.index };
}

function matchIncomeCategory(work) {
  let best = null;
  for (const [category, aliases] of Object.entries(INCOME_SYNONYMS)) {
    for (const alias of aliases) {
      const m = work.match(wordRe(alias));
      if (!m) continue;
      const score = alias.length * 100 + m.index / 10000;
      if (!best || score > best.score) best = { category, phrase: m[0], index: m.index, score };
    }
  }
  if (!best) return null;
  return { category: best.category, phrase: best.phrase, index: best.index };
}

function accountAliases(account) {
  const name = String(account.name || '').toLowerCase();
  const extra = new Set();
  if (name.includes('tunai') || name.includes('cash') || account.type === 'cash') {
    ['tunai', 'cash', 'dompet', 'uang tunai'].forEach((x) => extra.add(x));
  }
  if (name.includes('indodax')) ['indodax', 'inderaja'].forEach((x) => extra.add(x));
  if (name.includes('gopay')) ['gopay', 'go pay'].forEach((x) => extra.add(x));
  if (name.includes('ovo')) extra.add('ovo');
  if (name.includes('dana')) extra.add('dana');
  if (name.includes('shopeepay')) ['shopeepay', 'spay'].forEach((x) => extra.add(x));
  return [...new Set([name, ...extra])].filter(Boolean);
}

export function matchAccount(work, accounts = []) {
  let best = null;
  for (const account of accounts) {
    if (!account || account.is_archived) continue;
    for (const alias of accountAliases(account)) {
      const m = work.match(wordRe(alias));
      if (!m) continue;
      if (!best || alias.length > best.phrase.length) {
        best = { account, phrase: m[0], index: m.index };
      }
    }
  }
  return best;
}

export function defaultAccount(accounts = []) {
  const active = accounts.filter((a) => a && !a.is_archived);
  return active.find((a) => a.type === 'cash')
    || active.find((a) => ['cash', 'bank', 'ewallet'].includes(a.type))
    || active[0]
    || null;
}

/* ---------- perintah ---------- */

export function detectCommand(norm) {
  if (!norm) return { kind: 'empty' };
  const verify = norm.match(/^(?:verifikasi|verify)\s+([0-9]{6})$/);
  if (verify) return { kind: 'verify', code: verify[1] };
  if (/^(?:verifikasi|verify)$/.test(norm)) return { kind: 'verify', code: null };
  if (/^(?:halo|hai|hi|hello|pagi|siang|sore|malam)$/.test(norm)) return { kind: 'greet' };
  if (/^(undo|batal terakhir|batalkan terakhir|hapus terakhir|undo terakhir)$/.test(norm)) return { kind: 'undo' };
  if (/^(saldo|cek saldo|saldoku|saldo aku|berapa saldo|saldo sekarang)$/.test(norm)) return { kind: 'saldo' };
  if (/^(hari ini|rekap|rekap hari ini|ringkasan|rekap sekarang)$/.test(norm)) return { kind: 'recap' };
  if (/^(bantuan|help|bantu|contoh|menu|cara pakai)$/.test(norm)) return { kind: 'help' };
  if (CONFIRM_WORDS.has(norm)) return { kind: 'confirm' };
  if (CANCEL_WORDS.has(norm)) return { kind: 'cancel' };
  return { kind: null };
}

export function isConfirm(norm, opts = {}) {
  if (opts.needsExplicitYa) return norm === 'ya';
  return CONFIRM_WORDS.has(norm);
}

export function isCancel(norm) {
  return CANCEL_WORDS.has(norm);
}

/* ---------- notes ---------- */

function cleanNotes(work) {
  const words = work
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w && !FILLERS.has(w));
  return words.join(' ').slice(0, 200).trim();
}

/* ---------- transfer ---------- */

function parseTransfer({ work, amount, date, accounts, notes: rawNotes }) {
  let body = work.replace(TRANSFER_RE, ' ').replace(/\s+/g, ' ').trim();
  let left = body;
  let right = '';
  if (body.includes('->')) {
    const parts = body.split('->');
    left = parts[0];
    right = parts.slice(1).join(' ');
  } else {
    const parts = body.split(/\s+ke\s+/);
    if (parts.length >= 2) {
      right = parts.pop();
      left = parts.join(' ');
    }
  }
  let from = matchAccount(left, accounts);
  let to = matchAccount(right, accounts);
  if (!from || !to) {
    const hits = [];
    for (const account of accounts) {
      for (const alias of accountAliases(account)) {
        const re = new RegExp(`(?<![a-z0-9])${esc(alias)}(?![a-z0-9])`, 'g');
        let m;
        while ((m = re.exec(body))) hits.push({ account, index: m.index });
      }
    }
    hits.sort((a, b) => a.index - b.index);
    const unique = [];
    for (const hit of hits) if (!unique.some((u) => u.account.id === hit.account.id)) unique.push(hit);
    if (unique.length >= 2) {
      from = from || { account: unique[0].account };
      to = to || { account: unique[unique.length - 1].account };
    }
  }
  if (!from || !to || from.account.id === to.account.id) {
    return { ok: false, reason: 'transfer_accounts', amount };
  }
  return {
    ok: true,
    intent: {
      kind: 'transfer',
      type: 'transfer',
      amount,
      from_account_id: from.account.id,
      from_account_name: from.account.name,
      to_account_id: to.account.id,
      to_account_name: to.account.name,
      date,
      notes: rawNotes || '',
      raw_text: '',
    },
  };
}

/* ---------- utama ---------- */

export function parseMessage(rawText, { now = new Date(), categories = [], accounts = [] } = {}) {
  const raw = String(rawText ?? '').slice(0, 2000);
  const norm = prep(normalize(raw));
  if (!norm) return { ok: false, reason: 'empty' };

  const dateInfo = parseDateExpression(norm, now);
  if (dateInfo && dateInfo.error) return { ok: false, reason: 'invalid_date' };

  let work = norm;
  let date = jakartaDate(now);
  let dateExplicit = false;
  if (dateInfo) {
    date = dateInfo.ymd;
    dateExplicit = true;
    work = cutAt(work, dateInfo.index, dateInfo.text.length);
  }

  if (/(?:^|\s)-\s?\d/.test(work)) return { ok: false, reason: 'negative_amount' };

  const money = scanMoney(work);
  if (money.error) return { ok: false, reason: money.error };
  const candidates = money.candidates;
  if (!candidates.length) return { ok: false, reason: 'missing_amount' };
  if (candidates.length > 1) {
    return { ok: false, reason: 'multiple_amounts', candidates: candidates.map((c) => c.amount) };
  }
  const amount = candidates[0].amount;
  work = cutAt(work, candidates[0].start, candidates[0].length);

  const hasTransfer = TRANSFER_RE.test(norm);
  const hasIncome = INCOME_RE.test(norm);
  const hasExpense = EXPENSE_RE.test(norm);
  const type = hasTransfer ? 'transfer' : hasIncome ? 'income' : 'expense';

  if (type === 'transfer') {
    const notes = cleanNotes(work.replace(TRANSFER_RE, ' '));
    const result = parseTransfer({ work, amount, date, accounts, notes });
    if (result.ok) result.intent.raw_text = raw;
    return result;
  }

  const categoryHit = type === 'income' ? matchIncomeCategory(work) : matchExpenseCategory(work, categories);
  const accountHit = matchAccount(work, accounts);
  const account = accountHit ? accountHit.account : defaultAccount(accounts);

  let rest = work;
  if (categoryHit) rest = cutAt(rest, categoryHit.index, categoryHit.phrase.length);
  if (accountHit) {
    const idx = rest.toLowerCase().indexOf(accountHit.phrase.toLowerCase());
    if (idx >= 0) rest = cutAt(rest, idx, accountHit.phrase.length);
  }
  rest = rest.replace(type === 'income' ? INCOME_RE : EXPENSE_RE, ' ');

  const notes = cleanNotes(rest) || (categoryHit ? '' : cleanNotes(work));

  return {
    ok: true,
    intent: {
      kind: 'transaction',
      type,
      amount,
      category: categoryHit ? categoryHit.category : null,
      category_phrase: categoryHit ? categoryHit.phrase : null,
      category_guessed: !categoryHit,
      account_id: account ? account.id : null,
      account_name: account ? account.name : null,
      account_guessed: !accountHit,
      date,
      date_explicit: dateExplicit,
      type_guessed: !hasTransfer && !hasIncome && !hasExpense,
      notes,
      raw_text: raw,
    },
  };
}

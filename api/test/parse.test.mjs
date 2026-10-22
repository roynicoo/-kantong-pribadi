import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMessage, detectCommand, isConfirm, isCancel, normalize, moneyFromToken,
  parseDateExpression, matchAccount, DEFAULT_EXPENSE_CATEGORIES,
} from '../lib/parse.js';
import { formatDateID, addDays } from '../lib/time.js';

const NOW = new Date('2026-10-23T03:00:00.000Z'); // 23 Okt 2026, 10:00 WIB
const ACCOUNTS = [
  { id: 'acc-tunai', name: 'Tunai', type: 'cash', is_archived: false },
  { id: 'acc-bca', name: 'BCA', type: 'bank', is_archived: false },
  { id: 'acc-indodax', name: 'Indodax', type: 'investment', is_archived: false },
];
const CATEGORIES = ['Makan', 'Transport', 'Listrik', 'Laundry', 'Kosan', 'Internet', 'Rokok', 'Lainnya'];
const ctx = (now = NOW) => ({ now, accounts: ACCOUNTS, categories: CATEGORIES });

const ok = (text, now) => {
  const res = parseMessage(text, ctx(now));
  assert.equal(res.ok, true, `harusnya bisa diparse: ${JSON.stringify(text)} -> ${res.reason}`);
  return res.intent;
};
const bad = (text, reason, now) => {
  const res = parseMessage(text, ctx(now));
  assert.equal(res.ok, false, `harusnya gagal: ${JSON.stringify(text)}`);
  assert.equal(res.reason, reason);
  return res;
};

/* ---------- tabel kasus parser ---------- */

const CASES = [
  { input: 'makan 1900', type: 'expense', amount: 1900, category: 'Makan', account: 'Tunai', date: '2026-10-23' },
  { input: 'bensin 25rb', type: 'expense', amount: 25000, category: 'Transport', account: 'Tunai' },
  { input: 'kopi 18.500', type: 'expense', amount: 18500, category: 'Makan' },
  { input: 'kemarin parkir 2rb', amount: 2000, category: 'Transport', date: '2026-10-22' },
  { input: 'tgl 20 listrik 150k', amount: 150000, category: 'Listrik', date: '2026-10-20' },
  { input: 'masuk gaji 8500000', type: 'income', amount: 8500000, category: 'Gaji' },
  { input: 'gajian 8.5jt', type: 'income', amount: 8500000, category: 'Gaji' },
  { input: 'bonus 500rb', type: 'income', amount: 500000, category: 'Hadiah' },
  { input: 'pengeluaran makan 1900', type: 'expense', amount: 1900, category: 'Makan' },
  { input: '25rb makan', amount: 25000, category: 'Makan' },
  { input: '1.900.000', amount: 1900000, category: null },
  { input: '1,5jt', amount: 1500000 },
  { input: 'makan 1.900', amount: 1900 },
  { input: 'makan 1,900', amount: 1900 },
  { input: 'Makan 1.900', amount: 1900, category: 'Makan' },
  { input: 'laundry 20rb', category: 'Laundry' },
  { input: 'kos 1,5jt', category: 'Kosan', amount: 1500000 },
  { input: 'rokok 25rb', category: 'Rokok' },
  { input: 'internet 300rb', category: 'Internet', amount: 300000 },
  { input: 'grab 15rb', category: 'Transport' },
  { input: 'makan 1900rp', amount: 1900 },
  { input: 'Rp 1.900 makan', amount: 1900, category: 'Makan' },
  { input: 'bayar listrik 150rb', category: 'Listrik', amount: 150000 },
  { input: 'beli kopi 20rb', category: 'Makan', amount: 20000 },
  { input: 'makan 1jt', amount: 1000000 },
  { input: 'makan 2miliar', amount: 2000000000 },
  { input: 'makan 1000rb', amount: 1000000 },
  { input: 'tgl 31 listrik 100k', date: '2026-08-31', amount: 100000 },
  { input: '29/02 makan 10rb', date: '2024-02-29' },
  { input: '31/12 makan 10rb', date: '2025-12-31' },
  { input: 'kemarin lusa parkir 3rb', date: '2026-10-21' },
  { input: 'kemarin makan 10rb', date: '2026-10-22' },
];

test('tabel parser: nominal, jenis, kategori, akun, tanggal', () => {
  assert.ok(CASES.length >= 30, 'minimal 30 kasus');
  for (const row of CASES) {
    const intent = ok(row.input);
    if (row.type) assert.equal(intent.type, row.type, row.input);
    if (row.amount !== undefined) assert.equal(intent.amount, row.amount, row.input);
    if (row.category !== undefined) assert.equal(intent.category, row.category, row.input);
    if (row.account) assert.equal(intent.account_name, row.account, row.input);
    if (row.date) assert.equal(intent.date, row.date, row.input);
  }
});

test('parser menolak input kosong dan nominal tidak valid', () => {
  bad('', 'empty');
  bad('   ', 'empty');
  bad('makan', 'missing_amount');
  bad('makan abc', 'missing_amount');
  bad('makan 0', 'zero_amount');
  bad('makan 0rb', 'zero_amount');
  bad('makan -5', 'negative_amount');
  bad('makan 19.5', 'invalid_amount');
  bad('makan 1000000000001', 'too_large');
  bad('makan 2000000000000', 'too_large');
  bad('31/04 makan 10rb', 'invalid_date');
});

test('dua nominal -> minta klarifikasi, bukan menebak', () => {
  const res = bad('makan 1900 2000', 'multiple_amounts');
  assert.deepEqual(res.candidates, [1900, 2000]);
});

test('transfer dua arah terbaca', () => {
  const a = ok('pindah 100rb bca ke tunai');
  assert.equal(a.kind, 'transfer');
  assert.equal(a.amount, 100000);
  assert.equal(a.from_account_name, 'BCA');
  assert.equal(a.to_account_name, 'Tunai');

  const b = ok('transfer 50k tunai -> bca');
  assert.equal(b.from_account_name, 'Tunai');
  assert.equal(b.to_account_name, 'BCA');
  assert.equal(b.amount, 50000);

  bad('transfer 50k tunai', 'transfer_accounts');
});

test('kategori tak dikenal jadi notes, bukan kategori karangan', () => {
  const intent = ok('donasi 50rb');
  assert.equal(intent.category, null);
  assert.equal(intent.category_guessed, true);
  assert.match(intent.notes, /donasi/);
});

test('catatan sisa kata tetap disimpan', () => {
  const intent = ok('makan siang di warteg 25rb');
  assert.equal(intent.category, 'Makan');
  assert.match(intent.notes, /warteg/);
});

test('nominal: ribuan dan desimal Indonesia', () => {
  assert.deepEqual(moneyFromToken('1.900'), { amount: 1900 });
  assert.deepEqual(moneyFromToken('18.500'), { amount: 18500 });
  assert.deepEqual(moneyFromToken('1.900.000'), { amount: 1900000 });
  assert.deepEqual(moneyFromToken('1,900'), { amount: 1900 });
  assert.deepEqual(moneyFromToken('8.5', 'jt'), { amount: 8500000 });
  assert.deepEqual(moneyFromToken('1,5', 'jt'), { amount: 1500000 });
  assert.deepEqual(moneyFromToken('25', 'rb'), { amount: 25000 });
  assert.deepEqual(moneyFromToken('150', 'k'), { amount: 150000 });
  assert.equal(moneyFromToken('0').error, 'zero_amount');
  assert.equal(moneyFromToken('19.5').error, 'invalid_amount');
});

test('batas WIB: tanggal UTC berbeda dari tanggal Jakarta', () => {
  // 23 Okt 18:30 UTC = 24 Okt 01:30 WIB
  const lateNight = new Date('2026-10-23T18:30:00.000Z');
  assert.equal(ok('kopi 5rb', lateNight).date, '2026-10-24');
  assert.equal(ok('kemarin kopi 5rb', lateNight).date, '2026-10-23');
  assert.equal(ok('tgl 24 listrik 10rb', lateNight).date, '2026-10-24');
  assert.equal(parseDateExpression('makan', lateNight), null);
});

test('tanggal tidak pernah ke masa depan', () => {
  const d = parseDateExpression('tgl 31', NOW);
  assert.ok(d.ymd <= '2026-10-23');
  const future = parseDateExpression('31/12/2027', NOW);
  assert.equal(future.error, 'invalid_date');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('format tanggal Indonesia', () => {
  assert.equal(formatDateID('2026-10-23'), '23 Okt 2026');
  assert.equal(formatDateID('2024-02-29'), '29 Feb 2024');
});

test('perintah dikenali tanpa konfirmasi', () => {
  assert.equal(detectCommand(normalize('saldo')).kind, 'saldo');
  assert.equal(detectCommand(normalize('Saldo')).kind, 'saldo');
  assert.equal(detectCommand(normalize('rekap')).kind, 'recap');
  assert.equal(detectCommand(normalize('hari ini')).kind, 'recap');
  assert.equal(detectCommand(normalize('undo')).kind, 'undo');
  assert.equal(detectCommand(normalize('batal terakhir')).kind, 'undo');
  assert.equal(detectCommand(normalize('bantuan')).kind, 'help');
  assert.equal(detectCommand(normalize('kapan-kapan')).kind, null);
});

test('konfirmasi & batal toleran huruf besar dan aksen', () => {
  assert.equal(isConfirm(normalize('OK')), true);
  assert.equal(isConfirm(normalize('Oké')), true);
  assert.equal(isConfirm(normalize('sip')), true);
  assert.equal(isConfirm(normalize('batal')), false);
  assert.equal(isCancel(normalize('BATAL')), true);
  assert.equal(isCancel(normalize('gak')), true);
  assert.equal(isCancel(normalize('oke')), false);
  // Overdarft butuh YA eksplisit, bukan "oke".
  assert.equal(isConfirm(normalize('oke'), { needsExplicitYa: true }), false);
  assert.equal(isConfirm(normalize('YA'), { needsExplicitYa: true }), true);
});

test('akun dicocokkan dari nama, jatuh ke tunai kalau tidak disebut', () => {
  assert.equal(matchAccount('pindah bca', ACCOUNTS).account.id, 'acc-bca');
  assert.equal(matchAccount('ke tunai', ACCOUNTS).account.id, 'acc-tunai');
  assert.equal(matchAccount('jajan indodax', ACCOUNTS).account.id, 'acc-indodax');
  const intent = ok('makan 1900');
  assert.equal(intent.account_id, 'acc-tunai');
  assert.equal(intent.account_guessed, true);
});

test('kategori bawaan Kantong v4 tetap tersedia', () => {
  assert.ok(DEFAULT_EXPENSE_CATEGORIES.includes('Makan'));
  assert.ok(DEFAULT_EXPENSE_CATEGORIES.includes('Lainnya'));
});

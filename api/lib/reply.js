// Semua teks balasan WhatsApp. Bahasa Indonesia santai, tanpa istilah teknis.
import { formatDateID } from './time.js';

export const UNKNOWN_SENDER = 'Nomor ini tidak terdaftar';
export const UNVERIFIED = 'Nomor ini belum terverifikasi. Buka Profil di Kantong, isi nomor WhatsApp, lalu tekan Hubungkan untuk dapat kode verifikasi.';
export const VERIFY_NO_CODE = 'Belum ada kode untuk nomor ini. Buka Profil di Kantong, isi nomor WhatsApp, lalu tekan Hubungkan.';
export const VERIFY_EXPIRED = 'Kode sudah kedaluwarsa. Buka Profil di Kantong lalu tekan Hubungkan lagi untuk kode baru.';
export const VERIFY_LOCKED = 'Terlalu banyak percobaan. Buka Profil di Kantong dan tekan Hubungkan lagi untuk kode baru.';
export const VERIFY_TAKEN = 'Nomor ini sudah terhubung ke akun Kantong lain. Satu nomor hanya untuk satu akun. Kalau ini nomormu, putuskan dulu dari akun yang lama.';
export const VERIFY_ALREADY = 'Nomor ini sudah terhubung ke akun ini. Langsung kirim catatan aja, misal: makan 1900';
export const VERIFY_ASK = 'Kirim kode verifikasinya kayak gini: verifikasi 123456';
export const NOTHING_PENDING = 'Nggak ada catatan yang menunggu. Kirim aja kayak: makan 1900';
export const TECHNICAL_ERROR = 'Ada gangguan di sisiku, catatan belum disimpan. Coba kirim ulang sebentar lagi ya.';
export const EXPIRED_PREFIX = 'Catatan sebelumnya sudah kedaluwarsa (lebih dari 15 menit).\n\n';
export const NEED_YA = 'Aku butuh konfirmasi tegas. Balas YA (huruf besar) kalau tetap mau dicatat, atau BATAL.';

const TYPE_LABEL = { expense: 'Pengeluaran', income: 'Pemasukan', transfer: 'Pindah dana' };

export function rp(value) {
  let n;
  try {
    n = BigInt(String(value ?? 0));
  } catch {
    n = 0n;
  }
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}Rp${digits}`;
}

export function typeLabel(intent) {
  return TYPE_LABEL[intent.type] || 'Catatan';
}

function categoryLine(intent) {
  if (intent.type === 'transfer') return `Dari: ${intent.from_account_name || '-'}\nKe: ${intent.to_account_name || '-'}`;
  if (intent.category) return `Kategori: ${intent.category}`;
  const hint = intent.notes ? ` (kata: "${intent.notes}")` : '';
  return `Kategori: belum jelas, kucatat sebagai Lainnya${hint}`;
}

export function pendingSummary(intent, { dryRun = false } = {}) {
  const lines = [`Catat ${typeLabel(intent).toLowerCase()}?`, ''];
  lines.push(`Nominal: ${rp(intent.amount)}`);
  lines.push(categoryLine(intent));
  if (intent.type !== 'transfer') lines.push(`Akun: ${intent.account_name || '-'}`);
  lines.push(`Tanggal: ${formatDateID(intent.date)}`);
  if (intent.notes && intent.category) lines.push(`Catatan: ${intent.notes}`);
  lines.push('', 'Balas OK untuk simpan, atau BATAL');
  if (dryRun) lines.push('', 'mode uji: tidak disimpan');
  return lines.join('\n');
}

export function committed({ intent, accountName, balance, transactionId, dryRun = false }) {
  const head = dryRun ? 'mode uji: tidak disimpan' : 'Tersimpan';
  const short = String(transactionId || '').slice(0, 8);
  const lines = [`${head} ${dryRun ? '' : '✅'}`.trim()];
  if (intent.type === 'transfer') {
    lines.push(`${typeLabel(intent)} ${rp(intent.amount)} · ${intent.from_account_name} → ${intent.to_account_name} · ${formatDateID(intent.date)}`);
  } else {
    const cat = intent.category || 'Lainnya';
    lines.push(`${typeLabel(intent)} ${rp(intent.amount)} · ${cat} · ${accountName || intent.account_name || '-'} · ${formatDateID(intent.date)}`);
  }
  if (dryRun) {
    lines.push('Kalau ini beneran, transaksinya bakal tercatat seperti di atas.');
  } else {
    if (accountName && balance !== undefined && balance !== null) lines.push(`Saldo ${accountName}: ${rp(balance)}`);
    lines.push(`ID: ${short}`);
  }
  return lines.join('\n');
}

export function cancelled() {
  return 'Oke, dibatalkan. Nggak ada yang dicatat.';
}

export function nothingToCancel() {
  return 'Nggak ada catatan yang perlu dibatalkan.';
}

export function overdraftWarning({ accountName, balance, amount }) {
  return [
    `Saldo ${accountName} cuma ${rp(balance)}, nggak cukup buat ${rp(amount)}.`,
    '',
    'Kalau tetap mau dicatat (saldo jadi minus), balas YA. Kalau nggak, balas BATAL.',
  ].join('\n');
}

export function clarify(reason, { pendingIntent = null, expired = false, candidates = [] } = {}) {
  let text;
  switch (reason) {
    case 'empty':
      text = 'Pesannya kosong. Coba: makan 1900';
      break;
    case 'missing_amount':
      text = 'Nominalnya belum ada. Contoh: makan 1900, bensin 25rb';
      break;
    case 'multiple_amounts':
      text = `Ada ${candidates.length > 1 ? 'beberapa' : 'dua'} nominal (${candidates.map((c) => rp(c)).join(' dan ')}). Kirim ulang satu nominal aja ya.`;
      break;
    case 'zero_amount':
    case 'invalid_amount':
      text = 'Nominalnya nggak valid. Pakai angka rupiah bulat, contoh: makan 1900 atau bensin 25rb';
      break;
    case 'negative_amount':
      text = 'Nominal minus nggak bisa dicatat. Kalau ini koreksi, pakai undo di aplikasi ya.';
      break;
    case 'too_large':
      text = 'Nominalnya kegedean (maksimal Rp1.000.000.000.000). Cek lagi ya.';
      break;
    case 'invalid_date':
      text = 'Tanggalnya nggak valid. Contoh: tgl 20 listrik 150k atau 20/09 makan 25rb';
      break;
    case 'transfer_accounts':
      text = 'Akun asal/tujuan belum jelas. Contoh: pindah 100rb bca ke tunai';
      break;
    default:
      text = 'Aku belum paham. Contoh: makan 1900, masuk gaji 8.5jt, pindah 100rb bca ke tunai. Ketik bantuan buat lihat semua.';
  }
  if (expired) text = `${EXPIRED_PREFIX}${text}\n\nKirim ulang catatannya ya.`;
  if (pendingIntent) {
    text += `\n\nCatatan yang masih menunggu: ${typeLabel(pendingIntent).toLowerCase()} ${rp(pendingIntent.amount)}. Balas OK untuk simpan, atau BATAL.`;
  }
  return text;
}

export function saldo({ ready, total, accounts }) {
  if (!accounts.length) return 'Belum ada akun di Kantong. Tambah akun dulu di aplikasi, lalu kirim saldo lagi.';
  const lines = ['Saldo kamu', '', `Uang siap pakai: ${rp(ready)}`, `Total aset: ${rp(total)}`, ''];
  for (const a of accounts) lines.push(`· ${a.name} ${rp(a.balance)}`);
  return lines.join('\n');
}

export function recap({ today, income, expense, categories }) {
  const head = `Rekap hari ini · ${formatDateID(today)}`;
  if (income === 0n && expense === 0n) {
    return `${head}\n\nBelum ada catatan hari ini. Kirim misal: makan 1900`;
  }
  const lines = [head, '', `Pengeluaran ${rp(expense)}`];
  for (const row of categories) lines.push(`· ${row.category} ${rp(row.total)}`);
  lines.push('', `Pemasukan ${rp(income)}`);
  return lines.join('\n');
}

export function undoConfirm({ intent, transactionId }) {
  const short = String(transactionId || '').slice(0, 8);
  const line = intent.type === 'transfer'
    ? `${typeLabel(intent)} ${rp(intent.amount)} · ${intent.from_account_name} → ${intent.to_account_name}`
    : `${typeLabel(intent)} ${rp(intent.amount)} · ${intent.category || 'Lainnya'} · ${intent.account_name || '-'}`;
  return [
    'Hapus transaksi terakhir?',
    '',
    `${line} · ${formatDateID(intent.date)}`,
    `ID: ${short}`,
    '',
    'Balas OK untuk hapus, atau BATAL',
  ].join('\n');
}

export function undoDone({ intent, accountName, balance }) {
  const lines = ['Sudah dihapus.'];
  if (accountName && balance !== undefined && balance !== null) lines.push(`Saldo ${accountName}: ${rp(balance)}`);
  return lines.join('\n');
}

export function undoEmpty() {
  return 'Nggak ada transaksi dari bot dalam 30 menit terakhir. Kalau lebih lama, hapus lewat aplikasi ya.';
}

export function undoMissing() {
  return 'Transaksi itu sudah nggak ada, jadi nggak ada yang perlu dihapus.';
}

export function verifySuccess({ name, phone }) {
  return [
    `Halo, ${name}! Nomor ${phone} sekarang terhubung ke akun Kantong kamu.`,
    '',
    'Mulai catat dari nomor ini, misal:',
    'makan 1900',
    'masuk gaji 8.5jt',
    '',
    'Ketik bantuan buat lihat semua contoh.',
  ].join('\n');
}

export function verifyWrong(left) {
  return `Kode salah. Sisa ${left} percobaan. Cek lagi di Profil Kantong, atau tekan Hubungkan untuk kode baru.`;
}

export function greet({ name }) {
  return [
    `Halo, ${name}.`,
    '',
    'Kirim catatan kayak: makan 1900, bensin 25rb, kemarin parkir 2rb, atau masuk gaji 8.5jt.',
    'Perintah: saldo · hari ini · rekap · undo · bantuan',
  ].join('\n');
}

export function help(name = '') {
  const head = name ? `Halo, ${name}.` : null;
  return [
    ...(head ? [head, ''] : []),
    'Contoh yang bisa kamu kirim:',
    '',
    'makan 1900',
    'bensin 25rb',
    'kopi 18.500',
    'kemarin parkir 2rb',
    'tgl 20 listrik 150k',
    'masuk gaji 8.5jt',
    'bonus 500rb',
    'pindah 100rb bca ke tunai',
    '',
    'Perintah: saldo · hari ini · rekap · undo · bantuan',
    '',
    'Aku nggak pernah kirim pesan duluan, jadi balas saja pesanku.',
  ].join('\n');
}

export function superseded() {
  return 'Catatan sebelumnya kubatalkan.';
}

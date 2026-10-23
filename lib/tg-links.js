// Routing chat Telegram -> akun Kantong + verifikasi 6 digit.
// Semua pembacaan data akun memakai user_id hasil tautan, bukan input pesan.
import { jakartaDate, formatDateID } from './time.js';
import { displayNameOf } from './links.js';

/** Tabel kanal Telegram. Dipakai flow.js lewat config.tables. */
export const TG_TABLES = {
  messages: 'tg_messages',
  messageIdColumn: 'tg_message_id',
  pending: 'tg_pending',
  senderColumn: 'chat_id',
  commandLog: 'tg_commands',
};

export const MAX_VERIFY_ATTEMPTS = 5;

/* ---------- teks ---------- */

export const UNVERIFIED_TEXT = [
  'Chat Telegram ini belum terverifikasi, jadi belum bisa mencatat apa pun.',
  '',
  'Buka Kantong → Profil → Telegram, tekan Hubungkan Telegram sampai dapat kode 6 digit, lalu kirim di sini:',
  'verifikasi 123456',
].join('\n');

export const VERIFY_ASK_TEXT = 'Kirim kodenya kayak gini: verifikasi 123456. Kodenya ada di Profil → Telegram di aplikasi Kantong.';

export const VERIFY_NO_CODE_TEXT = [
  'Kode itu nggak ketemu, mungkin sudah dipakai atau salah ketik.',
  '',
  'Buka Profil → Telegram di aplikasi Kantong, tekan Hubungkan Telegram lagi buat kode baru, lalu kirim: verifikasi 123456',
].join('\n');

export const VERIFY_EXPIRED_TEXT = 'Kodenya sudah kedaluwarsa (berlaku 10 menit). Buka Profil → Telegram di aplikasi, tekan Hubungkan Telegram lagi buat kode baru.';

export const VERIFY_LOCKED_TEXT = 'Kebanyakan salah kode dari chat ini. Minta kode baru besok lewat Profil → Telegram, atau pakai catatan manual di aplikasi dulu.';

export const VERIFY_TAKEN_TEXT = 'Chat ini sudah terhubung ke akun Kantong lain. Satu chat Telegram hanya untuk satu akun. Putuskan dulu dari akun yang lama.';

export function verifyWrongText(left) {
  return `Kode salah. Sisa ${left} percobaan hari ini. Cek lagi di Profil → Telegram, atau tekan Hubungkan Telegram buat kode baru.`;
}

export function verifySuccessText({ name }) {
  return [
    `Halo, ${name}! Chat Telegram ini sekarang terhubung ke akun Kantong kamu.`,
    '',
    'Mulai catat dari sini, misal:',
    'makan 1900',
    'masuk gaji 8,5jt',
    '',
    'Ketik bantuan buat lihat semua contoh.',
  ].join('\n');
}

/**
 * Tentukan pemilik chat.
 * status: 'linked' | 'unverified'
 * Chat yang belum pernah terhubung SELALU 'unverified' (tidak ada nomor asing),
 * jadi balasannya "belum terverifikasi" dan tidak boleh menulis.
 */
export async function resolveChat(db, chatId, config = {}) { // eslint-disable-line no-unused-vars
  const rows = await db.select('tg_links', {
    select: 'chat_id,user_id,verified_at,last_seen_at',
    filters: { chat_id: `eq.${chatId}` },
    limit: 1,
  });
  const link = rows && rows[0];
  if (link && link.verified_at) return { status: 'linked', userId: link.user_id, chatId, link };
  return { status: 'unverified', chatId, link: link || null };
}

/** Catat pemakaian terakhir, maksimal sekali per 5 menit. */
export async function touchChat(db, link, now = new Date()) {
  if (!link || !link.chat_id) return;
  const last = link.last_seen_at ? new Date(link.last_seen_at).getTime() : 0;
  if (now.getTime() - last < 5 * 60 * 1000) return;
  try {
    await db.patch('tg_links', { chat_id: `eq.${link.chat_id}` }, { last_seen_at: now.toISOString() });
  } catch {
    /* tidak kritis */
  }
}

async function readAttempts(db, chatId) {
  const rows = await db.select('tg_verify_attempts', {
    select: 'chat_id,day,attempts',
    filters: { chat_id: `eq.${chatId}` },
    limit: 1,
  });
  return (rows && rows[0]) || null;
}

async function countFailure(db, chatId, now) {
  const today = jakartaDate(now);
  const row = await readAttempts(db, chatId);
  const sameDay = row && String(row.day).slice(0, 10) === today;
  const attempts = (sameDay ? Number(row.attempts || 0) : 0) + 1;
  try {
    await db.insert('tg_verify_attempts', {
      chat_id: chatId,
      day: today,
      attempts,
      updated_at: now.toISOString(),
    }, { onConflict: 'chat_id' });
  } catch {
    /* penghitung gagal tidak boleh menutupi balasan */
  }
  return attempts;
}

/**
 * Proses "verifikasi 123456" dari sebuah chat.
 * Kode dicari berdasarkan nilainya (chat belum terhubung, jadi chat id belum
 * dikenal). Karena itu kode 6 digit + kedaluwarsa 10 menit + batas 5 percobaan
 * per chat per hari adalah satu-satunya pengaman: kode harus dirahasiakan.
 */
export async function verifyChatCode(db, chatId, code, now = new Date()) {
  const today = jakartaDate(now);
  const attemptRow = await readAttempts(db, chatId);
  if (attemptRow && String(attemptRow.day).slice(0, 10) === today
    && Number(attemptRow.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
    return { text: VERIFY_LOCKED_TEXT, status: 'cancelled' };
  }

  const candidates = await db.select('tg_link_codes', {
    select: 'user_id,code,expires_at,attempts',
    filters: { code: `eq.${code}` },
    limit: 5,
  });
  if (!candidates || !candidates.length) {
    const attempts = await countFailure(db, chatId, now);
    return {
      text: attempts >= MAX_VERIFY_ATTEMPTS ? VERIFY_LOCKED_TEXT : verifyWrongText(MAX_VERIFY_ATTEMPTS - attempts),
      status: 'cancelled',
    };
  }

  const active = candidates.filter((row) => new Date(row.expires_at).getTime() > now.getTime());
  if (!active.length) {
    for (const row of candidates) await db.remove('tg_link_codes', { user_id: `eq.${row.user_id}` });
    return { text: VERIFY_EXPIRED_TEXT, status: 'cancelled' };
  }
  if (active.length > 1) {
    // Dua akun memakai kode yang sama: jangan tebak, anggap gagal.
    const attempts = await countFailure(db, chatId, now);
    return {
      text: attempts >= MAX_VERIFY_ATTEMPTS ? VERIFY_LOCKED_TEXT : verifyWrongText(MAX_VERIFY_ATTEMPTS - attempts),
      status: 'cancelled',
    };
  }

  const match = active[0];

  // Chat ini sudah terverifikasi milik akun lain? Jangan pernah ambil alih.
  const taken = await db.select('tg_links', {
    select: 'user_id,chat_id,verified_at',
    filters: { chat_id: `eq.${chatId}` },
    limit: 5,
  });
  const other = (taken || []).find((row) => row.user_id !== match.user_id && row.verified_at);
  if (other) return { text: VERIFY_TAKEN_TEXT, status: 'cancelled' };

  try {
    // Satu akun satu chat: chat lama (kalau ada) dilepas lebih dulu.
    await db.remove('tg_links', { user_id: `eq.${match.user_id}` });
    await db.remove('tg_links', { chat_id: `eq.${chatId}` });
    await db.insert('tg_links', {
      chat_id: chatId,
      user_id: match.user_id,
      verified_at: now.toISOString(),
      last_seen_at: now.toISOString(),
    }, { onConflict: 'chat_id' });
  } catch (err) {
    if (err && err.status === 409) return { text: VERIFY_TAKEN_TEXT, status: 'cancelled' };
    throw err;
  }

  await db.remove('tg_link_codes', { user_id: `eq.${match.user_id}` });
  try {
    await db.remove('tg_verify_attempts', { chat_id: `eq.${chatId}` });
  } catch {
    /* pembersihan penghitung tidak kritis */
  }

  const name = await displayNameOf(db, match.user_id);
  return {
    text: verifySuccessText({ name, now }),
    status: 'cancelled',
    userId: match.user_id,
    chatId,
  };
}

/** Teks status untuk bagian Profil → Telegram di aplikasi. */
export function chatLinkStatusText(link, now = new Date()) {
  if (!link) return 'Belum terhubung. Catatan dari Telegram belum masuk ke akun ini.';
  if (!link.verified_at) return 'Menunggu verifikasi. Kirim kodenya dari Telegram ke bot.';
  const seen = link.last_seen_at ? new Date(link.last_seen_at) : null;
  if (!seen || Number.isNaN(seen.getTime())) return 'Terhubung · belum pernah dipakai.';
  const diff = Math.max(0, now.getTime() - seen.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Terhubung · terakhir dipakai barusan.';
  if (minutes < 60) return `Terhubung · terakhir dipakai ${minutes} menit lalu.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Terhubung · terakhir dipakai ${hours} jam lalu.`;
  return `Terhubung · terakhir dipakai ${formatDateID(seen.toISOString().slice(0, 10))}.`;
}

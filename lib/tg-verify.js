// Verifikasi permintaan webhook Telegram: secret token + bentuk update.
// Tidak menyentuh jaringan; aman dipakai di tes offline.
import crypto from 'node:crypto';

// Telegram mengirim header ini kalau setWebhook memakai secret_token.
export const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined;
  if (typeof headers.get === 'function') {
    const viaGet = headers.get(name);
    if (viaGet !== null && viaGet !== undefined) return viaGet;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === name) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

/**
 * Bandingkan X-Telegram-Bot-Api-Secret-Token dengan TG_WEBHOOK_SECRET.
 * Perbandingan memakai digest SHA-256 supaya panjangnya selalu sama dan
 * tidak bocor lewat waktu (timing safe). Env kosong = tolak semua.
 */
export function verifySecretToken(headers, expected) {
  if (!expected) return false;
  const given = headerValue(headers, SECRET_HEADER);
  if (typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given, 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Ambil pesan teks dari satu update Telegram.
 * Hanya update.message (bukan edited_message, callback_query, channel_post)
 * dari chat pribadi. Grup/kanal diabaikan supaya data tidak bocor ke orang lain.
 * @returns {{updateId:string, chatId:string, text:string, fromName:string}|null}
 */
export function readUpdate(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.update_id === undefined || payload.update_id === null) return null;
  const msg = payload.message;
  if (!msg || typeof msg !== 'object') return null;
  const chat = msg.chat || {};
  if (chat.type && chat.type !== 'private') return null; // grup & kanal tidak didukung
  if (chat.id === undefined || chat.id === null) return null;
  const text = typeof msg.text === 'string' ? msg.text : '';
  return {
    updateId: String(payload.update_id),
    chatId: String(chat.id),
    text,
    fromName: String((msg.from && (msg.from.first_name || msg.from.username)) || '').slice(0, 40),
  };
}

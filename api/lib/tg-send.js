// Kirim teks lewat Telegram Bot API. Tanpa dependensi, hanya fetch bawaan Node.
// Selalu teks polos: tanpa parse_mode Markdown/HTML, supaya isi pesan pengguna
// (catatan, nama akun) tidak bisa jadi markup atau tautan aneh.
export const TELEGRAM_MAX_TEXT = 4096;
export const TELEGRAM_API_BASE = 'https://api.telegram.org';

/** Potong teks panjang di batas baris kalau memungkinkan. */
export function splitText(text, max = TELEGRAM_MAX_TEXT) {
  const raw = String(text ?? '');
  if (!raw) return [];
  const out = [];
  let rest = raw;
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    const cut = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
    const at = cut > max * 0.6 ? cut : max;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

export async function sendTelegramText({
  token,
  chatId,
  text,
  fetchImpl,
  apiBase,
  timeoutMs = 10000,
} = {}) {
  if (!token || chatId === undefined || chatId === null || !text) {
    throw new Error('Parameter kirim Telegram belum lengkap.');
  }
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const base = String(apiBase || TELEGRAM_API_BASE).replace(/\/+$/, '');
  for (const chunk of splitText(text)) {
    const response = await doFetch(`${base}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        text: chunk,
        disable_web_page_preview: true,
        // parse_mode sengaja TIDAK dikirim: teks dikirim apa adanya.
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      // Jangan pernah mencetak token atau isi pesan ke log.
      const err = new Error(`tg_send_${response.status}`);
      err.status = response.status;
      throw err;
    }
  }
  return true;
}

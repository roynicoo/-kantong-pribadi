// Webhook Telegram Bot API untuk Kantong.
// POST saja: header X-Telegram-Bot-Api-Secret-Token wajib cocok dengan
// TG_WEBHOOK_SECRET, lalu update diproses idempoten dan dibalas lewat
// api.telegram.org. Tanpa dependensi, tanpa parse mode.
import { verifySecretToken, readUpdate } from './lib/tg-verify.js';
import { createSupabase } from './lib/supabase.js';
import { sendTelegramText } from './lib/tg-send.js';
import { handleTgMessage, tgConfig } from './lib/tg-flow.js';

async function readJsonBody(req) {
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8'));
    } catch {
      return null;
    }
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

export function createHandler(options = {}) {
  return async function handler(req, res) {
    const env = options.env || process.env;

    if (req.method !== 'POST') {
      res.status(405).send('method not allowed');
      return;
    }

    // 1. Autentikasi: rahasia ada di header, bukan di body.
    if (!verifySecretToken(req.headers, env.TG_WEBHOOK_SECRET)) {
      res.status(401).send('invalid secret token');
      return;
    }

    const payload = await readJsonBody(req);
    if (!payload) {
      res.status(400).send('bad json');
      return;
    }

    const cfg = tgConfig(env);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !cfg.token) {
      // Konfigurasi belum lengkap: jangan balas 200 supaya kelihatan di log Vercel.
      res.status(503).send('bridge not configured');
      return;
    }

    const update = readUpdate(payload);
    // Update tanpa teks (foto, stiker, edit, callback) diabaikan.
    if (!update || !update.text.trim()) {
      res.status(200).send('ok');
      return;
    }

    const db = createSupabase({
      url: env.SUPABASE_URL,
      key: env.SUPABASE_SERVICE_ROLE_KEY,
      fetchImpl: options.fetchImpl,
    });
    const doFetch = options.fetchImpl || ((...args) => globalThis.fetch(...args));

    try {
      const result = await handleTgMessage({ update, db, config: cfg });
      if (result && result.text) {
        await sendTelegramText({
          token: cfg.token,
          chatId: update.chatId,
          text: result.text,
          fetchImpl: doFetch,
          apiBase: options.apiBase,
        });
      }
    } catch (err) {
      // Jangan pernah mencetak isi pesan. Cukup kode galat.
      console.error('[tg] gagal memproses pesan', (err && (err.status || err.message)) || 'unknown');
    }

    // Selalu 200 setelah secret cocok, supaya Telegram tidak mengulang terus.
    res.status(200).send('ok');
  };
}

export default createHandler();

// Webhook WhatsApp Cloud API untuk Kantong.
// GET  : verifikasi hub.challenge
// POST : verifikasi X-Hub-Signature-256 atas body MENTAH, lalu proses pesan.
import { verifyChallenge, verifySignature } from '../lib/verify.js';
import { createSupabase } from '../lib/supabase.js';
import { sendText } from '../lib/send.js';
import { handleMessage } from '../lib/flow.js';
import { normalizePhone } from '../lib/parse.js';

// Body mentah wajib: signature dihitung dari byte asli yang dikirim Meta.
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function readConfig(env) {
  // Routing utama: wa_links (nomor -> akun). Dua env di bawah hanya fallback
  // bootstrap lama, didokumentasikan sebagai deprecated.
  const ownerNumbers = String(env.WA_OWNER_NUMBER || '')
    .split(',').map((x) => normalizePhone(x)).filter(Boolean);
  const bootstrapNumber = ownerNumbers.length === 1 ? ownerNumbers[0] : null;
  const dryRun = String(env.WA_DRY_RUN || '') === '1' || ownerNumbers.length > 1;
  return {
    dryRun,
    bootstrapNumber,
    bootstrapNumbers: ownerNumbers,
    bootstrapUserId: env.WA_OWNER_USER_ID || '',
    // ownerUserId diisi per pesan dari wa_links.
    ownerUserId: '',
    token: env.WA_TOKEN || '',
    phoneNumberId: env.WA_PHONE_NUMBER_ID || '',
    verifyToken: env.WA_VERIFY_TOKEN || '',
    apiVersion: env.WA_API_VERSION || 'v22.0',
  };
}

function extractTextMessages(payload) {
  const out = [];
  if (!payload || !Array.isArray(payload.entry)) return out;
  for (const entry of payload.entry) {
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!change || change.field !== 'messages') continue;
      const value = change.value || {};
      if (!Array.isArray(value.messages)) continue; // statuses -> diabaikan
      for (const msg of value.messages) {
        if (!msg || msg.type !== 'text') continue;
        const from = String(msg.from || '');
        if (!from || from.endsWith('@g.us')) continue; // grup tidak didukung
        const text = msg.text && typeof msg.text.body === 'string' ? msg.text.body : '';
        if (!text.trim()) continue;
        out.push({ id: String(msg.id || ''), from, text });
      }
    }
  }
  return out;
}

export function createHandler(options = {}) {
  return async function handler(req, res) {
    const env = options.env || process.env;

    if (req.method === 'GET') {
      const result = verifyChallenge(req.query || {}, env.WA_VERIFY_TOKEN);
      res.status(result.status);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(result.body);
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).send('method not allowed');
      return;
    }

    const raw = await readRawBody(req);
    const signature = req.headers && (req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256']);
    if (!env.WA_APP_SECRET || !verifySignature(raw, signature, env.WA_APP_SECRET)) {
      res.status(401).send('invalid signature');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      res.status(400).send('bad json');
      return;
    }

    const cfg = readConfig(env);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !cfg.token || !cfg.phoneNumberId) {
      // Konfigurasi belum lengkap: jangan balas 200 supaya kelihatan di log Vercel.
      res.status(503).send('bridge not configured');
      return;
    }

    const messages = extractTextMessages(payload);
    const db = createSupabase({
      url: env.SUPABASE_URL,
      key: env.SUPABASE_SERVICE_ROLE_KEY,
      fetchImpl: options.fetchImpl,
    });
    const doFetch = options.fetchImpl || ((...args) => globalThis.fetch(...args));

    for (const message of messages) {
      if (!message.id) continue;
      try {
        const result = await handleMessage({ message, db, config: cfg });
        if (result && result.text) {
          await sendText({
            token: cfg.token,
            phoneNumberId: cfg.phoneNumberId,
            to: message.from,
            text: result.text,
            version: cfg.apiVersion,
            fetchImpl: doFetch,
          });
        }
      } catch (err) {
        // Jangan pernah mencetak isi pesan. Cukup kode galat.
        console.error('[wa] gagal memproses pesan', (err && (err.status || err.message)) || 'unknown');
      }
    }

    // Selalu 200 untuk event yang sudah lolos signature, supaya Meta tidak retry.
    res.status(200).send('ok');
  };
}

export default createHandler();

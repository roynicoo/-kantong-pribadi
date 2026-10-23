// Verifikasi webhook Meta: signature X-Hub-Signature-256 + GET challenge.
import crypto from 'node:crypto';

/**
 * Bandingkan HMAC-SHA256 dari body MENTAH dengan header Meta.
 * Body mentah wajib dipakai: JSON yang di-serialize ulang akan berbeda byte-nya.
 */
export function verifySignature(rawBody, headerValue, appSecret) {
  if (!appSecret || typeof headerValue !== 'string' || !headerValue) return false;
  const match = headerValue.match(/^sha256=([0-9a-f]{64})$/i);
  if (!match) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
  const expected = crypto.createHmac('sha256', appSecret).update(raw).digest();
  let given;
  try {
    given = Buffer.from(match[1], 'hex');
  } catch {
    return false;
  }
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

export function signBody(rawBody, appSecret) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
  return `sha256=${crypto.createHmac('sha256', appSecret).update(raw).digest('hex')}`;
}

/** GET verification handshake. */
export function verifyChallenge(query, expectedToken) {
  const q = query || {};
  const mode = q['hub.mode'];
  const token = q['hub.verify_token'];
  const challenge = q['hub.challenge'];
  if (mode === 'subscribe' && expectedToken && token === expectedToken
    && typeof challenge === 'string' && challenge.length > 0 && challenge.length <= 512) {
    return { status: 200, body: challenge };
  }
  return { status: 403, body: 'forbidden' };
}

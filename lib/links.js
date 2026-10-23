// Routing nomor WhatsApp -> akun Kantong + verifikasi kepemilikan nomor.
// Semua pembacaan data akun memakai user_id hasil tautan, bukan input pesan.
import { formatDateID } from './time.js';
import * as reply from './reply.js';

export const MAX_ATTEMPTS = 5;

export function phoneToLocal(e164) {
  const s = String(e164 || '');
  if (!/^628\d{8,11}$/.test(s)) return s;
  return `0${s.slice(2)}`;
}

export async function displayNameOf(db, userId) {
  if (!userId) return 'Pengguna';
  try {
    const rows = await db.select('app_settings', {
      select: 'display_name',
      filters: { user_id: `eq.${userId}` },
      limit: 1,
    });
    const name = rows && rows[0] && rows[0].display_name;
    if (name && String(name).trim()) return String(name).trim().slice(0, 24);
  } catch {
    /* nama hanya untuk sapaan; jangan gagalkan pesan */
  }
  return 'Pengguna';
}

/**
 * Tentukan pemilik nomor.
 * status: 'linked' | 'unverified' | 'unknown'
 * Bootstrap (WA_OWNER_NUMBER + WA_OWNER_USER_ID) hanya fallback lama.
 */
export async function resolveSender(db, phone, config) {
  const rows = await db.select('wa_links', {
    select: 'user_id,phone_e164,verified_at,last_seen_at',
    filters: { phone_e164: `eq.${phone}` },
    limit: 1,
  });
  const link = rows && rows[0];
  if (link && link.verified_at) {
    return { status: 'linked', userId: link.user_id, phone, link };
  }
  if (link && !link.verified_at) {
    return { status: 'unverified', phone, link };
  }
  const bootstrapList = config.bootstrapNumbers
    || (config.bootstrapNumber ? [config.bootstrapNumber] : []);
  if (config.bootstrapUserId && bootstrapList.includes(phone)) {
    return { status: 'linked', userId: config.bootstrapUserId, phone, bootstrap: true };
  }
  return { status: 'unknown', phone };
}

/** Catat pemakaian terakhir, maksimal sekali per 5 menit. */
export async function touchLink(db, link, now = new Date()) {
  if (!link || !link.user_id) return;
  const last = link.last_seen_at ? new Date(link.last_seen_at).getTime() : 0;
  if (now.getTime() - last < 5 * 60 * 1000) return;
  try {
    await db.patch('wa_links', { user_id: `eq.${link.user_id}` }, { last_seen_at: now.toISOString() });
  } catch {
    /* tidak kritis */
  }
}

function attemptsLeft(row) {
  return Math.max(0, MAX_ATTEMPTS - Number(row.attempts || 0));
}

/**
 * Proses "verifikasi 123456" dari nomor pengirim.
 * Hanya nomor yang benar-benar mengirim pesan yang bisa memverifikasi kode
 * untuk nomor itu — tidak ada verifikasi jarak jauh.
 */
export async function verifyCode(db, phone, code, now = new Date()) {
  const candidates = await db.select('wa_link_codes', {
    select: '*',
    filters: { phone_e164: `eq.${phone}` },
    limit: 10,
  });
  const active = (candidates || []).filter((row) => new Date(row.expires_at).getTime() > now.getTime());

  if (!candidates || !candidates.length) {
    return { text: reply.VERIFY_NO_CODE, status: 'cancelled' };
  }
  if (!active.length) {
    for (const row of candidates) await db.remove('wa_link_codes', { user_id: `eq.${row.user_id}` });
    return { text: reply.VERIFY_EXPIRED, status: 'cancelled' };
  }

  const match = active.find((row) => String(row.code) === String(code));

  if (!match) {
    const row = active[0];
    const attempts = Number(row.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await db.remove('wa_link_codes', { user_id: `eq.${row.user_id}` });
      return { text: reply.VERIFY_LOCKED, status: 'cancelled' };
    }
    await db.patch('wa_link_codes', { user_id: `eq.${row.user_id}` }, { attempts });
    return { text: reply.verifyWrong(attemptsLeft({ attempts })), status: 'cancelled' };
  }

  // Nomor sudah terverifikasi milik akun lain? Jangan pernah ambil alih.
  const taken = await db.select('wa_links', {
    select: 'user_id',
    filters: { phone_e164: `eq.${phone}` },
    limit: 5,
  });
  const other = (taken || []).find((row) => row.user_id !== match.user_id && row.verified_at !== null);
  if (other) {
    return { text: reply.VERIFY_TAKEN, status: 'cancelled' };
  }

  try {
    await db.insert('wa_links', {
      user_id: match.user_id,
      phone_e164: phone,
      verified_at: now.toISOString(),
      last_seen_at: now.toISOString(),
    }, { onConflict: 'user_id' });
  } catch (err) {
    if (err && err.status === 409) return { text: reply.VERIFY_TAKEN, status: 'cancelled' };
    throw err;
  }

  await db.remove('wa_link_codes', { user_id: `eq.${match.user_id}` });
  const name = await displayNameOf(db, match.user_id);
  return {
    text: reply.verifySuccess({ name, phone: phoneToLocal(phone) }),
    status: 'cancelled',
    userId: match.user_id,
  };
}

export function linkStatusText(link, now = new Date()) {
  if (!link) return 'Belum terhubung.';
  if (!link.verified_at) {
    const until = formatDateID(String(link.expires_at || '').slice(0, 10));
    return `Menunggu verifikasi${link.expires_at ? ` · kode berlaku sampai ${until}` : ''}.`;
  }
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

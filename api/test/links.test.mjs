// Routing multi-akun: nomor -> wa_links -> akun. Termasuk verifikasi kode,
// penolakan takeover, dan isolasi data antar akun.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../wa.js';
import { createWorld, seedDefault } from './fake-supabase.mjs';
import { signBody } from '../lib/verify.js';

const ROY = '628131854317';
const NICOLAS = '6281233434573';
const SECRET = 'app-secret-uji';

function seedTwo() {
  const base = seedDefault();
  base.accounts.push({
    id: 'acc-n-tunai', user_id: 'user-2', name: 'Tunai', type: 'cash',
    opening_balance: 75000, current_value: null, is_archived: false,
    created_at: '2026-01-04T00:00:00.000Z',
  });
  base.transactions.push({
    id: 'tx-n-1', user_id: 'user-2', type: 'expense', amount: 5000,
    category: 'Makan', date: '2026-10-23', account_id: 'acc-n-tunai',
    notes: '', created_at: '2026-10-23T00:00:00.000Z',
  });
  base.app_settings.push({
    user_id: 'user-2', display_name: 'Nicolas', theme: 'krem', pattern: 'none',
    onboarding_completed: true, onboarding_skipped: false, opening_balance: 0,
    opening_balance_date: null,
  });
  base.wa_links.push(
    { user_id: 'user-1', phone_e164: ROY, verified_at: '2026-10-01T00:00:00.000Z', created_at: '2026-10-01T00:00:00.000Z', last_seen_at: null },
    { user_id: 'user-2', phone_e164: NICOLAS, verified_at: '2026-10-01T00:00:00.000Z', created_at: '2026-10-01T00:00:00.000Z', last_seen_at: null },
  );
  return base;
}

function env(over = {}) {
  return {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    WA_TOKEN: 'wa-token',
    WA_PHONE_NUMBER_ID: '123456789',
    WA_VERIFY_TOKEN: 'verify',
    WA_APP_SECRET: SECRET,
    // Routing murni lewat wa_links: bootstrap lama sengaja dikosongkan.
    WA_OWNER_NUMBER: '',
    WA_OWNER_USER_ID: '',
    ...over,
  };
}

function makeRes() {
  const res = {
    statusCode: 0, body: '', headers: {},
    status(c) { res.statusCode = c; return res; },
    setHeader(k, v) { res.headers[k] = v; },
    send(b) { res.body = String(b); return res; },
  };
  return res;
}

let seq = 0;
const nextId = () => `wamid.LINK${++seq}`;

async function setup(seed = seedTwo(), over = {}) {
  const world = createWorld({ seed });
  const handler = createHandler({ env: env(over), fetchImpl: world.fetch });
  const send = async (text, { from = ROY, id } = {}) => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: '123456789' },
        messages: [{ from, id: id || nextId(), timestamp: '1', type: 'text', text: { body: text } }],
      } }] }],
    });
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hub-signature-256': signBody(raw, SECRET) },
      body: Buffer.from(raw),
    }, res);
    return res;
  };
  const lastText = () => (world.sent.length ? world.sent[world.sent.length - 1].text : null);
  return { world, send, lastText };
}

const futureIso = (minutes = 10) => new Date(Date.now() + minutes * 60000).toISOString();

test('pesan dari nomor Nicolas hanya menulis ke akun Nicolas', async () => {
  const { world, send, lastText } = await setup();
  await send('makan 1900', { from: NICOLAS });
  assert.match(lastText(), /Catat pengeluaran/);
  await send('ok', { from: NICOLAS });

  const rows = world.rows('transactions');
  const botRow = rows.find((r) => r.id !== 'tx-n-1');
  assert.ok(botRow, 'transaksi baru harus ada');
  assert.equal(botRow.user_id, 'user-2');
  assert.equal(botRow.account_id, 'acc-n-tunai');
  assert.equal(rows.filter((r) => r.user_id === 'user-1').length, 0, 'akun Roy tidak boleh tersentuh');
  assert.match(lastText(), /Saldo Tunai: Rp68\.100/);
});

test('saldo tidak membocorkan akun lain', async () => {
  const { send, lastText } = await setup();
  await send('saldo', { from: NICOLAS });
  const text = lastText();
  assert.match(text, /Uang siap pakai: Rp70\.000/);
  assert.match(text, /Total aset: Rp70\.000/);
  assert.doesNotMatch(text, /BCA/);
  assert.doesNotMatch(text, /Indodax/);
  assert.doesNotMatch(text, /Rp50\.000/);
});

test('nomor belum terverifikasi tidak dirutekan', async () => {
  const seed = seedTwo();
  seed.wa_links = seed.wa_links.filter((l) => l.phone_e164 !== ROY);
  seed.wa_links.push({ user_id: 'user-1', phone_e164: ROY, verified_at: null, created_at: '2026-10-01T00:00:00.000Z', last_seen_at: null });
  const { world, send, lastText } = await setup(seed);
  await send('makan 1900', { from: ROY });
  await send('ok', { from: ROY });
  assert.match(lastText(), /belum terverifikasi/);
  assert.equal(world.rows('transactions').filter((r) => r.user_id === 'user-1').length, 0);
});

test('verifikasi 123456 menghubungkan nomor + sapaan nama akun', async () => {
  const seed = seedDefault();
  seed.wa_link_codes.push({
    user_id: 'user-1', code: '123456', phone_e164: ROY,
    expires_at: futureIso(), attempts: 0, created_at: new Date().toISOString(),
  });
  const { world, send, lastText } = await setup(seed);
  await send('verifikasi 123456', { from: ROY });
  assert.match(lastText(), /Halo, Roy/);
  assert.match(lastText(), /terhubung ke akun Kantong/);
  const link = world.rows('wa_links').find((l) => l.phone_e164 === ROY);
  assert.ok(link && link.verified_at, 'verified_at harus terisi');
  assert.equal(world.rows('wa_link_codes').length, 0, 'kode dipakai sekali');
});

test('kode salah mengurangi percobaan, lalu terkunci', async () => {
  const seed = seedDefault();
  seed.wa_link_codes.push({
    user_id: 'user-1', code: '123456', phone_e164: ROY,
    expires_at: futureIso(), attempts: 0, created_at: new Date().toISOString(),
  });
  const { world, send, lastText } = await setup(seed);
  await send('verifikasi 000000', { from: ROY });
  assert.match(lastText(), /Sisa 4 percobaan/);
  assert.equal(world.rows('wa_link_codes')[0].attempts, 1);
  for (let i = 0; i < 4; i += 1) await send('verifikasi 000000', { from: ROY });
  assert.match(lastText(), /Terlalu banyak percobaan/);
  assert.equal(world.rows('wa_link_codes').length, 0);
  await send('verifikasi 123456', { from: ROY });
  assert.match(lastText(), /Belum ada kode/);
});

test('kode kedaluwarsa ditolak dan dibersihkan', async () => {
  const seed = seedDefault();
  seed.wa_link_codes.push({
    user_id: 'user-1', code: '123456', phone_e164: ROY,
    expires_at: '2020-01-01T00:00:00.000Z', attempts: 0, created_at: '2020-01-01T00:00:00.000Z',
  });
  const { world, send, lastText } = await setup(seed);
  await send('verifikasi 123456', { from: ROY });
  assert.match(lastText(), /kedaluwarsa/);
  assert.equal(world.rows('wa_link_codes').length, 0);
  assert.equal(world.rows('wa_links').length, 0);
});

test('nomor milik akun lain tidak bisa diambil alih', async () => {
  const seed = seedTwo();
  // Kode dibuat untuk akun Roy tapi dengan nomor milik Nicolas (skenario serangan).
  seed.wa_link_codes.push({
    user_id: 'user-1', code: '111111', phone_e164: NICOLAS,
    expires_at: futureIso(), attempts: 0, created_at: new Date().toISOString(),
  });
  const { world, send, lastText } = await setup(seed);
  await send('verifikasi 111111', { from: NICOLAS });
  assert.match(lastText(), /sudah terhubung ke akun Kantong lain/);
  const owner = world.rows('wa_links').find((l) => l.phone_e164 === NICOLAS);
  assert.equal(owner.user_id, 'user-2');
});

test('ganti nomor baru berlaku setelah kode baru terverifikasi', async () => {
  const seed = seedDefault();
  seed.wa_links.push({
    user_id: 'user-1', phone_e164: ROY, verified_at: '2026-10-01T00:00:00.000Z',
    created_at: '2026-10-01T00:00:00.000Z', last_seen_at: null,
  });
  seed.wa_link_codes.push({
    user_id: 'user-1', code: '654321', phone_e164: '628111222333',
    expires_at: futureIso(), attempts: 0, created_at: new Date().toISOString(),
  });
  const { world, send, lastText } = await setup(seed);

  // Nomor lama masih aktif sebelum verifikasi nomor baru.
  await send('makan 1900', { from: ROY });
  assert.match(lastText(), /Catat pengeluaran/);

  await send('verifikasi 654321', { from: '628111222333' });
  assert.match(lastText(), /terhubung ke akun Kantong/);
  const links = world.rows('wa_links').filter((l) => l.user_id === 'user-1');
  assert.equal(links.length, 1);
  assert.equal(links[0].phone_e164, '628111222333');

  // Nomor lama tidak lagi dikenali.
  await send('makan 2000', { from: ROY });
  assert.match(lastText(), /tidak terdaftar/);
});

test('sapaan memakai nama pemilik akun, bukan nama tetap', async () => {
  const { send, lastText } = await setup();
  await send('halo', { from: NICOLAS });
  assert.match(lastText(), /^Halo, Nicolas\./);
  await send('halo', { from: ROY });
  assert.match(lastText(), /^Halo, Roy\./);
});

test('verifikasi tanpa kode memberi contoh format', async () => {
  const { send, lastText } = await setup();
  await send('verifikasi', { from: ROY });
  assert.match(lastText(), /verifikasi 123456/);
});

test('perintah verifikasi tidak bisa dipakai untuk akun lain lewat pesan', async () => {
  const seed = seedTwo();
  seed.wa_link_codes.push({
    user_id: 'user-2', code: '222222', phone_e164: NICOLAS,
    expires_at: futureIso(), attempts: 0, created_at: new Date().toISOString(),
  });
  const { world, send, lastText } = await setup(seed);
  // Roy mengirim kode milik Nicolas dari nomornya sendiri.
  await send('verifikasi 222222', { from: ROY });
  assert.match(lastText(), /Belum ada kode/);
  const nicolas = world.rows('wa_links').find((l) => l.user_id === 'user-2');
  assert.equal(nicolas.phone_e164, NICOLAS);
  assert.equal(nicolas.verified_at, '2026-10-01T00:00:00.000Z', 'tidak boleh berubah');
  assert.equal(world.rows('wa_link_codes').length, 1, 'kode Nicolas tetap ada');
});

test('mode uji berlaku juga untuk nomor yang sudah terhubung', async () => {
  const { world, send, lastText } = await setup(seedTwo(), { WA_DRY_RUN: '1' });
  await send('makan 1900', { from: NICOLAS });
  await send('ok', { from: NICOLAS });
  assert.match(lastText(), /mode uji: tidak disimpan/);
  assert.equal(world.rows('transactions').filter((r) => r.user_id === 'user-2').length, 1, 'hanya transaksi awal, bukan yang baru');
  assert.equal(world.rows('wa_messages')[1].status, 'dryrun');
});

test('kode verifikasi duplikat tidak menambah percobaan dua kali', async () => {
  const seed = seedDefault();
  seed.wa_link_codes.push({
    user_id: 'user-1', code: '123456', phone_e164: ROY,
    expires_at: futureIso(), attempts: 0, created_at: new Date().toISOString(),
  });
  const { world, send } = await setup(seed);
  const id = 'wamid.SAME';
  await send('verifikasi 000000', { from: ROY, id });
  await send('verifikasi 000000', { from: ROY, id });
  assert.equal(world.rows('wa_link_codes')[0].attempts, 1);
});

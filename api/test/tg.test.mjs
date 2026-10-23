// Jembatan Telegram: auth secret token, idempotensi update_id, verifikasi chat,
// pencatatan lewat pipeline yang sama, dan isolasi antar akun.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../tg.js';
import { createWorld, seedDefault } from './fake-supabase.mjs';
import { CHEATSHEET } from '../lib/tg-flow.js';

const ROY_CHAT = '111111111';
const NICOLAS_CHAT = '222222222';
const SECRET = 'tg-secret-uji';

function env(over = {}) {
  return {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    TG_BOT_TOKEN: '123:token-uji',
    TG_WEBHOOK_SECRET: SECRET,
    ...over,
  };
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: '',
    headers: {},
    status(code) { res.statusCode = code; return res; },
    setHeader(key, value) { res.headers[key] = value; },
    send(body) { res.body = String(body); return res; },
  };
  return res;
}

function seedWithLinks({ royVerified = true } = {}) {
  const base = seedDefault();
  base.tg_links = [{
    chat_id: royVerified ? ROY_CHAT : ROY_CHAT,
    user_id: 'user-1',
    verified_at: royVerified ? '2026-10-01T00:00:00.000Z' : null,
    created_at: '2026-10-01T00:00:00.000Z',
    last_seen_at: null,
  }];
  base.tg_messages = [];
  base.tg_pending = [];
  base.tg_commands = [];
  base.tg_link_codes = [];
  base.tg_verify_attempts = [];
  return base;
}

function seedTwoUsers() {
  const base = seedWithLinks();
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
  base.tg_links.push({
    chat_id: NICOLAS_CHAT, user_id: 'user-2', verified_at: '2026-10-01T00:00:00.000Z',
    created_at: '2026-10-01T00:00:00.000Z', last_seen_at: null,
  });
  return base;
}

let seq = 0;
const nextUpdate = () => ++seq;

function updatePayload(text, { chatId = ROY_CHAT, updateId, chatType = 'private' } = {}) {
  return {
    update_id: updateId === undefined ? nextUpdate() : updateId,
    message: {
      message_id: 1,
      date: 1761180000,
      chat: { id: Number(chatId), type: chatType },
      from: { id: Number(chatId), first_name: 'Roy', is_bot: false },
      text,
    },
  };
}

async function setup({ seed = seedWithLinks(), over = {}, secret = SECRET } = {}) {
  const world = createWorld({ seed });
  const handler = createHandler({ env: env(over), fetchImpl: world.fetch });
  const post = async (payload, { secretToken = secret, headers = {} } = {}) => {
    const res = makeRes();
    const h = { 'content-type': 'application/json', ...headers };
    if (secretToken !== null) h['x-telegram-bot-api-secret-token'] = secretToken;
    await handler({ method: 'POST', headers: h, body: payload }, res);
    return res;
  };
  const send = async (text, opts = {}) => post(
    typeof text === 'string' ? updatePayload(text, opts) : text,
    opts,
  );
  const lastText = () => (world.tgSent.length ? world.tgSent[world.tgSent.length - 1].text : null);
  return { world, handler, post, send, lastText };
}

const futureIso = (minutes = 10) => new Date(Date.now() + minutes * 60000).toISOString();

/* ---------- autentikasi ---------- */

test('secret token salah, kosong, atau env kosong -> 401 tanpa tulisan dan tanpa balasan', async () => {
  const { world, send, post } = await setup();
  const wrong = await send('makan 1900', { secretToken: 'secret-palsu' });
  assert.equal(wrong.statusCode, 401);
  assert.equal(world.rows('tg_messages').length, 0);
  assert.equal(world.rows('transactions').length, 0);
  assert.equal(world.tgSent.length, 0);

  const missing = await post(updatePayload('makan 1900'), { secretToken: null });
  assert.equal(missing.statusCode, 401);

  const empty = await setup({ over: { TG_WEBHOOK_SECRET: '' } });
  const res = await empty.send('makan 1900', { secretToken: '' });
  assert.equal(res.statusCode, 401);
  assert.equal(empty.world.tgSent.length, 0);
});

test('secret token benar -> 200 dan update diproses', async () => {
  const { world, send, lastText } = await setup();
  const res = await send('saldo');
  assert.equal(res.statusCode, 200);
  assert.match(lastText(), /Saldo kamu/);
  assert.equal(world.rows('tg_messages').length, 1);
});

test('metode selain POST ditolak 405', async () => {
  const { handler } = await setup();
  const res = makeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

/* ---------- idempotensi ---------- */

test('update_id duplikat tidak diproses dua kali', async () => {
  const { world, send } = await setup();
  const updateId = nextUpdate();
  await send('makan 1900', { updateId });
  await send('makan 1900', { updateId });
  assert.equal(world.rows('tg_messages').length, 1);
  assert.equal(world.rows('tg_pending').length, 1);
  assert.equal(world.tgSent.length, 1);
});

/* ---------- chat belum terverifikasi ---------- */

test('chat belum terverifikasi diblokir dan tidak bisa menulis', async () => {
  const { world, send, lastText } = await setup({ seed: seedWithLinks({ royVerified: false }) });
  await send('makan 1900');
  assert.match(lastText(), /belum terverifikasi/);
  assert.equal(world.rows('tg_pending').length, 0);
  assert.equal(world.rows('transactions').length, 0);

  await send('ok');
  assert.match(lastText(), /belum terverifikasi/);
  assert.equal(world.rows('transactions').length, 0);
});

test('chat yang belum pernah terhubung sama sekali juga diblokir', async () => {
  const seed = seedWithLinks();
  seed.tg_links = [];
  const { world, send, lastText } = await setup({ seed });
  await send('saldo');
  assert.match(lastText(), /belum terverifikasi/);
  assert.equal(world.rows('tg_links').length, 0);
});

/* ---------- verifikasi ---------- */

test('verifikasi 123456 menghubungkan chat + sapaan nama akun', async () => {
  const seed = seedWithLinks({ royVerified: false });
  seed.tg_link_codes.push({
    user_id: 'user-1', code: '123456', expires_at: futureIso(), attempts: 0,
    created_at: new Date().toISOString(),
  });
  const { world, send, lastText } = await setup({ seed });
  await send('verifikasi 123456');
  assert.match(lastText(), /Halo, Roy/);
  assert.match(lastText(), /terhubung ke akun Kantong/);
  const link = world.rows('tg_links').find((l) => String(l.chat_id) === ROY_CHAT);
  assert.ok(link && link.verified_at, 'verified_at harus terisi');
  assert.equal(String(link.user_id), 'user-1');
  assert.equal(world.rows('tg_link_codes').length, 0, 'kode dipakai sekali');

  // setelah verifikasi, pencatatan jalan normal
  await send('makan 1900');
  assert.match(lastText(), /Catat pengeluaran/);
});

test('tanpa kode, verifikasi hanya memberi contoh format', async () => {
  const { send, lastText } = await setup();
  await send('verifikasi');
  assert.match(lastText(), /verifikasi 123456/);
});

test('kode kedaluwarsa ditolak dan dibersihkan', async () => {
  const seed = seedWithLinks({ royVerified: false });
  seed.tg_link_codes.push({
    user_id: 'user-1', code: '123456', expires_at: '2020-01-01T00:00:00.000Z', attempts: 0,
    created_at: '2020-01-01T00:00:00.000Z',
  });
  const { world, send, lastText } = await setup({ seed });
  await send('verifikasi 123456');
  assert.match(lastText(), /kedaluwarsa/);
  assert.equal(world.rows('tg_link_codes').length, 0);
  assert.equal(world.rows('tg_links').filter((l) => l.verified_at).length, 0);
});

test('kode salah mengurangi percobaan, lalu terkunci', async () => {
  const seed = seedWithLinks({ royVerified: false });
  seed.tg_link_codes.push({
    user_id: 'user-1', code: '123456', expires_at: futureIso(), attempts: 0,
    created_at: new Date().toISOString(),
  });
  const { world, send, lastText } = await setup({ seed });
  await send('verifikasi 000000');
  assert.match(lastText(), /Sisa 4 percobaan/);
  assert.equal(world.rows('tg_verify_attempts')[0].attempts, 1);

  for (let i = 0; i < 4; i += 1) await send('verifikasi 000000');
  assert.match(lastText(), /Kebanyakan salah kode/);

  // kode benar pun ditolak selama terkunci
  await send('verifikasi 123456');
  assert.match(lastText(), /Kebanyakan salah kode/);
  assert.equal(world.rows('tg_links').filter((l) => l.verified_at).length, 0);
});

test('kode milik akun lain tidak bisa mengambil alih chat terverifikasi', async () => {
  const seed = seedTwoUsers();
  seed.tg_link_codes.push({
    user_id: 'user-1', code: '654321', expires_at: futureIso(), attempts: 0,
    created_at: new Date().toISOString(),
  });
  const { world, send, lastText } = await setup({ seed });
  // Nicolas mengirim kode milik akun Roy dari chat-nya sendiri.
  await send('verifikasi 654321', { chatId: NICOLAS_CHAT });
  assert.match(lastText(), /sudah terhubung ke akun Kantong lain/);
  const owner = world.rows('tg_links').find((l) => String(l.chat_id) === NICOLAS_CHAT);
  assert.equal(String(owner.user_id), 'user-2');
});

test('kode dipakai dari chat lain memindahkan tautan akun (chat lama lepas)', async () => {
  const seed = seedWithLinks();
  seed.tg_link_codes.push({
    user_id: 'user-1', code: '222333', expires_at: futureIso(), attempts: 0,
    created_at: new Date().toISOString(),
  });
  const { world, send, lastText } = await setup({ seed });
  await send('verifikasi 222333', { chatId: '333444555' });
  assert.match(lastText(), /Halo, Roy/);
  const links = world.rows('tg_links').filter((l) => String(l.user_id) === 'user-1');
  assert.equal(links.length, 1, 'satu akun hanya satu chat');
  assert.equal(String(links[0].chat_id), '333444555');

  // chat lama tidak lagi dikenali
  await send('saldo', { chatId: ROY_CHAT });
  assert.match(lastText(), /belum terverifikasi/);
});

/* ---------- pencatatan ---------- */

test('pengeluaran: ringkasan dulu, OK menulis tepat sekali, OK ganda tidak menulis lagi', async () => {
  const { world, send, lastText } = await setup();
  await send('makan 1900');
  assert.equal(world.rows('transactions').length, 0);
  assert.equal(world.rows('tg_pending').length, 1);
  assert.equal(String(world.rows('tg_pending')[0].chat_id), ROY_CHAT);
  assert.match(lastText(), /Rp1\.900/);
  assert.match(lastText(), /Makan/);
  assert.match(lastText(), /Tunai/);
  assert.match(lastText(), /Balas OK untuk simpan, atau BATAL/);

  const okId = nextUpdate();
  await send('ok', { updateId: okId });
  assert.equal(world.rows('transactions').length, 1);
  assert.match(lastText(), /Tersimpan/);
  assert.match(lastText(), /Saldo Tunai: Rp48\.100/);

  // Telegram mengirim ulang update yang sama
  await send('ok', { updateId: okId });
  assert.equal(world.rows('transactions').length, 1);
  assert.equal(world.tgSent.length, 2, 'duplikat tidak dibalas ulang');

  // OK baru tanpa catatan menunggu
  await send('ok');
  assert.equal(world.rows('transactions').length, 1);
  assert.match(lastText(), /Nggak ada catatan yang menunggu/);
  assert.equal(world.rows('tg_pending').length, 0);
});

test('BATAL tidak menulis apa pun', async () => {
  const { world, send, lastText } = await setup();
  await send('bensin 25rb');
  await send('BATAL');
  assert.equal(world.rows('transactions').length, 0);
  assert.equal(world.rows('tg_pending').length, 0);
  assert.match(lastText(), /dibatalkan/i);
});

test('overdarft minta YA eksplisit sebelum mencatat', async () => {
  const { world, send, lastText } = await setup();
  await send('makan 60000'); // Tunai hanya Rp50.000
  await send('ok');
  assert.equal(world.rows('transactions').length, 0);
  assert.match(lastText(), /nggak cukup/);
  await send('oke');
  assert.equal(world.rows('transactions').length, 0);
  assert.match(lastText(), /YA \(huruf besar\)/);
  await send('YA');
  assert.equal(world.rows('transactions').length, 1);
  assert.match(lastText(), /Saldo Tunai: -Rp10\.000/);
});

test('masuk gaji 8,5jt tercatat sebagai pemasukan Gaji', async () => {
  const { world, send, lastText } = await setup();
  await send('masuk gaji 8,5jt');
  assert.match(lastText(), /Catat pemasukan/);
  await send('ok');
  const tx = world.rows('transactions')[0];
  assert.equal(tx.type, 'income');
  assert.equal(tx.amount, 8500000);
  assert.equal(tx.category, 'Gaji');
});

test('pindah 100rb bca ke tunai menulis ke tabel transfers', async () => {
  const { world, send, lastText } = await setup();
  await send('pindah 100rb bca ke tunai');
  assert.match(lastText(), /Dari: BCA/);
  await send('ok');
  assert.equal(world.rows('transfers').length, 1);
  assert.equal(world.rows('transactions').length, 0);
  assert.equal(world.rows('transfers')[0].amount, 100000);
  assert.match(lastText(), /BCA → Tunai/);
});

test('saldo dan hari ini membaca data akun pemilik chat', async () => {
  const { send, lastText } = await setup();
  await send('saldo');
  const text = lastText();
  assert.match(text, /Uang siap pakai: Rp150\.000/);
  assert.match(text, /Total aset: Rp2\.150\.000/);

  await send('makan 1900');
  await send('ok');
  await send('hari ini');
  assert.match(lastText(), /Rekap hari ini/);
  assert.match(lastText(), /· Makan Rp1\.900/);
});

test('batal terakhir menghapus transaksi bot dan tidak menyentuh transaksi manual', async () => {
  const { world, send, lastText } = await setup();
  await send('makan 1900');
  await send('ok');
  world.tables.transactions.push({
    id: 'manual-1', user_id: 'user-1', type: 'expense', amount: 5000,
    category: 'Makan', date: '2026-10-23', account_id: 'acc-tunai',
    created_at: new Date().toISOString(),
  });
  await send('batal terakhir');
  assert.match(lastText(), /Hapus transaksi terakhir/);
  assert.equal(world.rows('transactions').length, 2);
  await send('ok');
  assert.equal(world.rows('transactions').length, 1);
  assert.equal(world.rows('transactions')[0].id, 'manual-1');
  assert.match(lastText(), /Sudah dihapus/);
});

/* ---------- isolasi ---------- */

test('dua chat tidak saling melihat atau menulis data akun lain', async () => {
  const { world, send, lastText } = await setup({ seed: seedTwoUsers() });
  await send('makan 1900', { chatId: NICOLAS_CHAT });
  assert.match(lastText(), /Catat pengeluaran/);
  await send('ok', { chatId: NICOLAS_CHAT });
  const rows = world.rows('transactions').filter((r) => r.id !== 'tx-n-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, 'user-2');
  assert.equal(rows[0].account_id, 'acc-n-tunai');
  assert.equal(world.rows('transactions').filter((r) => r.user_id === 'user-1').length, 0);
  assert.match(lastText(), /Saldo Tunai: Rp68\.100/);

  await send('saldo', { chatId: NICOLAS_CHAT });
  const text = lastText();
  assert.match(text, /Uang siap pakai: Rp68\.100/);
  assert.doesNotMatch(text, /BCA/);
  assert.doesNotMatch(text, /Indodax/);
});

/* ---------- /start dan /help ---------- */

test('/start dan /help mengirim contekan 5 baris', async () => {
  assert.equal(CHEATSHEET.length, 5, 'contekan harus 5 baris');
  const { send, lastText } = await setup();
  await send('/start');
  const start = lastText();
  assert.match(start, /Halo, Roy/);
  for (const line of CHEATSHEET) assert.ok(start.includes(line), `start harus memuat: ${line}`);
  assert.match(start, /nggak pernah kirim pesan duluan/);

  await send('/help');
  const help = lastText();
  for (const line of CHEATSHEET) assert.ok(help.includes(line), `help harus memuat: ${line}`);

  // Bentuk tanpa garis miring juga harus jalan (perintah parser biasa).
  await send('bantuan');
  const bantuan = lastText();
  for (const line of CHEATSHEET) assert.ok(bantuan.includes(line), `bantuan harus memuat: ${line}`);
});

test('/verifikasi 123456 (pakai garis miring) juga diterima', async () => {
  const seed = seedWithLinks({ royVerified: false });
  seed.tg_link_codes.push({
    user_id: 'user-1', code: '123456', expires_at: futureIso(), attempts: 0,
    created_at: new Date().toISOString(),
  });
  const { world, send, lastText } = await setup({ seed });
  await send('/verifikasi 123456');
  assert.match(lastText(), /terhubung ke akun Kantong/);
  assert.ok(world.rows('tg_links').some((l) => l.verified_at), 'tautan harus terverifikasi');
});

test('/start dari chat belum terverifikasi tetap diblokir dengan petunjuk kode', async () => {
  const { send, lastText } = await setup({ seed: seedWithLinks({ royVerified: false }) });
  await send('/start');
  assert.match(lastText(), /belum terverifikasi/);
  assert.match(lastText(), /verifikasi 123456/);
});

/* ---------- bentuk pesan ---------- */

test('balasan memakai teks polos: tanpa parse_mode, preview dimatikan', async () => {
  const { world, send } = await setup();
  await send('makan 1900');
  const sent = world.tgSent[0];
  assert.equal(sent.chat_id, ROY_CHAT);
  assert.equal(sent.parse_mode, undefined, 'tidak boleh ada parse_mode');
  assert.equal(sent.disable_web_page_preview, true);
});

test('update non-teks, grup, dan update_id hilang diabaikan', async () => {
  const { world, send, post } = await setup();
  const photo = {
    update_id: nextUpdate(),
    message: { message_id: 2, chat: { id: Number(ROY_CHAT), type: 'private' }, from: { id: 1 }, photo: [{ file_id: 'x' }] },
  };
  const r1 = await post(photo);
  assert.equal(r1.statusCode, 200);
  assert.equal(world.tgSent.length, 0);

  const group = await send('makan 1900', { chatType: 'group' });
  assert.equal(group.statusCode, 200);
  assert.equal(world.tgSent.length, 0);
  assert.equal(world.rows('tg_messages').length, 0);

  const noId = await post({ message: { chat: { id: Number(ROY_CHAT), type: 'private' }, text: 'makan 1900' } });
  assert.equal(noId.statusCode, 200);
  assert.equal(world.tgSent.length, 0);
});

test('body bukan JSON -> 400 (setelah secret cocok)', async () => {
  const { post } = await setup();
  const res = await post('{bukan json');
  assert.equal(res.statusCode, 400);
});

test('konfigurasi kurang -> 503 supaya kelihatan di log', async () => {
  const { post } = await setup({ over: { TG_BOT_TOKEN: '' } });
  const res = await post(updatePayload('makan 1900'));
  assert.equal(res.statusCode, 503);
});

test('mode uji TG_DRY_RUN=1 tidak menulis transaksi', async () => {
  const { world, send, lastText } = await setup({ over: { TG_DRY_RUN: '1' } });
  await send('makan 1900');
  assert.match(lastText(), /mode uji: tidak disimpan/);
  await send('ok');
  assert.equal(world.rows('transactions').length, 0);
  assert.match(lastText(), /mode uji: tidak disimpan/);
  assert.equal(world.rows('tg_messages')[1].status, 'dryrun');
});

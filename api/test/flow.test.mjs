import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../wa.js';
import { createWorld, seedDefault } from './fake-supabase.mjs';
import { signBody } from '../lib/verify.js';

const OWNER = '628131854317';
const OWNER_UID = 'user-1';
const SECRET = 'app-secret-uji';
const VERIFY = 'verify-token-uji';

function env(over = {}) {
  return {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    WA_TOKEN: 'wa-token',
    WA_PHONE_NUMBER_ID: '123456789',
    WA_VERIFY_TOKEN: VERIFY,
    WA_APP_SECRET: SECRET,
    WA_OWNER_NUMBER: OWNER,
    WA_OWNER_USER_ID: OWNER_UID,
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

function payload(text, { from = OWNER, id, type = 'text' } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: '123456789' },
          messages: [{
            from,
            id,
            timestamp: '1700000000',
            type,
            ...(type === 'text' ? { text: { body: text } } : {}),
          }],
        },
      }],
    }],
  };
}

let seq = 0;
const nextId = () => `wamid.TEST${++seq}`;

async function setup({ over = {}, seed = seedDefault() } = {}) {
  const world = createWorld({ seed });
  const handler = createHandler({ env: env(over), fetchImpl: world.fetch });
  const send = async (text, opts = {}) => {
    const raw = JSON.stringify(payload(text, { id: opts.id || nextId(), from: opts.from, type: opts.type }));
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hub-signature-256': signBody(raw, opts.secret || SECRET) },
      body: Buffer.from(raw),
    }, res);
    return res;
  };
  const lastText = () => (world.sent.length ? world.sent[world.sent.length - 1].text : null);
  return { world, handler, send, lastText };
}

test('GET verification: challenge benar -> 200 teks apa adanya', async () => {
  const { handler } = await setup();
  const res = makeRes();
  await handler({
    method: 'GET',
    query: { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '839201' },
    headers: {},
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '839201');
});

test('GET verification: token salah -> 403', async () => {
  const { handler } = await setup();
  const res = makeRes();
  await handler({
    method: 'GET',
    query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'salah', 'hub.challenge': '1' },
    headers: {},
  }, res);
  assert.equal(res.statusCode, 403);
});

test('signature salah -> 401, tidak ada yang ditulis', async () => {
  const { world, send } = await setup();
  const res = await send('makan 1900', { secret: 'secret-palsu' });
  assert.equal(res.statusCode, 401);
  assert.equal(world.rows('wa_messages').length, 0);
  assert.equal(world.rows('transactions').length, 0);
  assert.equal(world.sent.length, 0);
});

test('body diubah setelah ditandatangani -> 401', async () => {
  const { world, handler } = await setup();
  const raw = JSON.stringify(payload('makan 1900', { id: 'wamid.tamper' }));
  const signature = signBody(raw, SECRET);
  const res = makeRes();
  await handler({
    method: 'POST',
    headers: { 'x-hub-signature-256': signature },
    body: Buffer.from(raw.replace('makan 1900', 'makan 9000000')),
  }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(world.sent.length, 0);
});

test('pesan pertama tidak menulis transaksi: hanya ringkasan + minta OK', async () => {
  const { world, send, lastText } = await setup();
  const res = await send('makan 1900');
  assert.equal(res.statusCode, 200);
  assert.equal(world.rows('transactions').length, 0);
  assert.equal(world.rows('wa_pending').length, 1);
  assert.equal(world.rows('wa_pending')[0].from_number, OWNER);
  const text = lastText();
  assert.match(text, /Rp1\.900/);
  assert.match(text, /Makan/);
  assert.match(text, /Tunai/);
  assert.match(text, /Balas OK untuk simpan, atau BATAL/);
});

test('konfirmasi menulis tepat sekali walau OK dikirim dua kali', async () => {
  const { world, send, lastText } = await setup();
  await send('makan 1900');
  const okId = nextId();
  await send('ok', { id: okId });
  assert.equal(world.rows('transactions').length, 1);
  const text = lastText();
  assert.match(text, /Tersimpan/);
  assert.match(text, /Saldo Tunai: Rp48\.100/);
  assert.match(text, /ID: /);

  // duplikat persis dari Meta
  await send('ok', { id: okId });
  assert.equal(world.rows('transactions').length, 1);
  assert.equal(world.sent.length, 2);

  // OK baru tanpa pending
  await send('ok');
  assert.equal(world.rows('transactions').length, 1);
  assert.match(lastText(), /Nggak ada catatan yang menunggu/);
  assert.equal(world.rows('wa_pending').length, 0);
});

test('batal tidak menulis apa pun', async () => {
  const { world, send, lastText } = await setup();
  await send('makan 1900');
  await send('BATAL');
  assert.equal(world.rows('transactions').length, 0);
  assert.equal(world.rows('wa_pending').length, 0);
  assert.match(lastText(), /dibatalkan/i);
});

test('pesan duplikat (wa_message_id sama) tidak membuat pending kedua', async () => {
  const { world, send } = await setup();
  const id = nextId();
  await send('makan 1900', { id });
  await send('makan 1900', { id });
  assert.equal(world.rows('wa_messages').length, 1);
  assert.equal(world.rows('wa_pending').length, 1);
  assert.equal(world.sent.length, 1);
});

test('pending kedaluwarsa -> minta kirim ulang', async () => {
  const { world, send, lastText } = await setup();
  world.tables.wa_pending.push({
    from_number: OWNER,
    intent: { kind: 'transaction', type: 'expense', amount: 999, category: 'Makan', account_id: 'acc-tunai', account_name: 'Tunai', date: '2026-01-01', notes: '' },
    expires_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
  });
  await send('halo');
  assert.match(lastText(), /kedaluwarsa/);
  assert.equal(world.rows('wa_pending').length, 0);
  assert.equal(world.rows('transactions').length, 0);
});

test('overdarft: butuh YA eksplisit sebelum mencatat', async () => {
  const { world, send, lastText } = await setup();
  await send('makan 60000'); // Tunai hanya Rp50.000
  await send('ok');
  assert.equal(world.rows('transactions').length, 0);
  assert.match(lastText(), /nggak cukup/);
  assert.match(lastText(), /balas YA/);
  assert.equal(world.rows('wa_pending')[0].intent.needs_explicit_ya, true);

  await send('oke');
  assert.equal(world.rows('transactions').length, 0);
  assert.match(lastText(), /YA \(huruf besar\)/);

  await send('YA');
  assert.equal(world.rows('transactions').length, 1);
  assert.match(lastText(), /Saldo Tunai: -Rp10\.000/);
});

test('undo hanya menghapus transaksi milik bot', async () => {
  const { world, send, lastText } = await setup();
  await send('makan 1900');
  await send('ok');
  const botTx = world.rows('transactions')[0];
  assert.ok(botTx);

  // transaksi manual pengguna, lebih baru, tidak boleh ikut terhapus
  world.tables.transactions.push({
    id: 'manual-1', user_id: OWNER_UID, type: 'expense', amount: 5000,
    category: 'Makan', date: '2026-10-23', account_id: 'acc-tunai', created_at: new Date().toISOString(),
  });

  await send('undo');
  assert.match(lastText(), /Hapus transaksi terakhir/);
  assert.equal(world.rows('transactions').length, 2);
  await send('ok');
  assert.equal(world.rows('transactions').length, 1);
  assert.equal(world.rows('transactions')[0].id, 'manual-1');
  assert.match(lastText(), /Sudah dihapus/);
});

test('undo tanpa transaksi bot -> tidak menghapus apa pun', async () => {
  const { world, send, lastText } = await setup();
  world.tables.transactions.push({
    id: 'manual-2', user_id: OWNER_UID, type: 'expense', amount: 5000,
    category: 'Makan', date: '2026-10-23', account_id: 'acc-tunai', created_at: new Date().toISOString(),
  });
  await send('undo');
  assert.match(lastText(), /Nggak ada transaksi dari bot/);
  assert.equal(world.rows('transactions').length, 1);
});

test('nomor asing: dibalas sekali sehari, pesan berikutnya diam', async () => {
  const { world, send, lastText } = await setup();
  await send('makan 1900', { from: '628999999999' });
  assert.equal(lastText(), 'Nomor ini tidak terdaftar');
  assert.equal(world.rows('wa_messages').length, 0);
  const before = world.sent.length;
  await send('makan 2000', { from: '628999999999' });
  assert.equal(world.sent.length, before);
  assert.equal(world.rows('wa_command_log').length, 1);
});

test('statuses dan pesan non-teks diabaikan', async () => {
  const { world, handler } = await setup();
  const statusPayload = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }],
  };
  const raw = JSON.stringify(statusPayload);
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-hub-signature-256': signBody(raw, SECRET) }, body: Buffer.from(raw) }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(world.rows('wa_messages').length, 0);

  const mediaRaw = JSON.stringify(payload('', { id: 'wamid.IMG', type: 'image' }));
  const res2 = makeRes();
  await handler({ method: 'POST', headers: { 'x-hub-signature-256': signBody(mediaRaw, SECRET) }, body: Buffer.from(mediaRaw) }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(world.sent.length, 0);
});

test('mode uji: tidak ada tulisan ke transaksi', async () => {
  const { world, send, lastText } = await setup({ over: { WA_DRY_RUN: '1' } });
  await send('makan 1900');
  assert.match(lastText(), /mode uji: tidak disimpan/);
  await send('ok');
  assert.equal(world.rows('transactions').length, 0);
  assert.match(lastText(), /mode uji: tidak disimpan/);
  assert.equal(world.rows('wa_messages')[1].status, 'dryrun');
});

test('mode uji juga aktif saat WA_OWNER_NUMBER berisi daftar nomor tes', async () => {
  const { world, send, lastText } = await setup({ over: { WA_OWNER_NUMBER: `${OWNER},628111111111` } });
  await send('makan 1900');
  await send('ok');
  assert.equal(world.rows('transactions').length, 0);
  assert.match(lastText(), /mode uji: tidak disimpan/);
});

test('saldo: uang siap pakai + total aset', async () => {
  const { send, lastText } = await setup();
  await send('saldo');
  const text = lastText();
  assert.match(text, /Uang siap pakai: Rp150\.000/);
  assert.match(text, /Total aset: Rp2\.150\.000/);
  assert.match(text, /Tunai Rp50\.000/);
  assert.match(text, /BCA Rp100\.000/);
  assert.match(text, /Indodax Rp2\.000\.000/);
});

test('rekap hari ini menjumlah per kategori', async () => {
  const { send, lastText } = await setup();
  await send('makan 1900');
  await send('ok');
  await send('rekap');
  const text = lastText();
  assert.match(text, /Rekap hari ini/);
  assert.match(text, /Pengeluaran Rp1\.900/);
  assert.match(text, /· Makan Rp1\.900/);
});

test('transfer menulis ke tabel transfers, bukan transactions', async () => {
  const { world, send, lastText } = await setup();
  await send('pindah 100rb bca ke tunai');
  assert.match(lastText(), /pindah dana/i);
  assert.match(lastText(), /Dari: BCA/);
  await send('ok');
  assert.match(lastText(), /BCA → Tunai/);
  assert.equal(world.rows('transfers').length, 1);
  assert.equal(world.rows('transactions').length, 0);
  assert.equal(world.rows('transfers')[0].amount, 100000);
  assert.match(lastText(), /Saldo BCA: Rp0/);
});

test('masuk gaji tercatat sebagai pemasukan', async () => {
  const { world, send, lastText } = await setup();
  await send('masuk gaji 8.5jt');
  assert.match(lastText(), /Catat pemasukan/);
  await send('ok');
  const tx = world.rows('transactions')[0];
  assert.equal(tx.type, 'income');
  assert.equal(tx.amount, 8500000);
  assert.equal(tx.category, 'Gaji');
  assert.match(lastText(), /Saldo Tunai: Rp8\.550\.000/);
});

test('kategori tak dikenal: simpan sebagai Lainnya + sebut di balasan', async () => {
  const { world, send, lastText } = await setup();
  await send('donasi 50rb');
  assert.match(lastText(), /belum jelas/);
  await send('ok');
  const tx = world.rows('transactions')[0];
  assert.equal(tx.category, 'Lainnya');
  assert.match(tx.notes, /donasi/);
});

test('konfigurasi kurang -> 503 supaya kelihatan di log', async () => {
  const { handler } = await setup({ over: { SUPABASE_SERVICE_ROLE_KEY: '' } });
  const raw = JSON.stringify(payload('makan 1900', { id: 'wamid.CFG' }));
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-hub-signature-256': signBody(raw, SECRET) }, body: Buffer.from(raw) }, res);
  assert.equal(res.statusCode, 503);
});

// Simulator Telegram lokal: tidak menyentuh jaringan atau database asli.
// Melihat balasan bot untuk sederet pesan, termasuk /start dan verifikasi.
//
// Pakai:
//   node api/test/simulate-tg.mjs "makan 1900" "ok"
//   node api/test/simulate-tg.mjs "/start" "saldo" "batal terakhir"
//   SIM_TG_CHAT=222 SIM_TG_VERIFIED=0 node api/test/simulate-tg.mjs "makan 1900"
//   SIM_NOW=2026-10-23T18:30:00Z node api/test/simulate-tg.mjs "kopi 18.500"
import { createWorld, seedDefault } from './fake-supabase.mjs';
import { createSupabase } from '../lib/supabase.js';
import { handleTgMessage, tgConfig } from '../lib/tg-flow.js';

const messages = process.argv.slice(2).filter((a) => a.trim());
if (!messages.length) messages.push('/start', 'makan 1900', 'ok', 'saldo');

const chatId = String(process.env.SIM_TG_CHAT || '999000111');
const verified = String(process.env.SIM_TG_VERIFIED || '1') !== '0';

const now = process.env.SIM_NOW ? new Date(process.env.SIM_NOW) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error('SIM_NOW tidak valid. Contoh: SIM_NOW=2026-10-23T18:30:00Z');
  process.exit(1);
}

const seed = seedDefault();
seed.tg_links = verified
  ? [{
    chat_id: chatId,
    user_id: 'user-1',
    verified_at: '2026-10-01T00:00:00.000Z',
    created_at: '2026-10-01T00:00:00.000Z',
    last_seen_at: null,
  }]
  : [];
// Kode contoh supaya "verifikasi 123456" bisa dicoba walau belum terhubung.
seed.tg_link_codes = [{
  user_id: 'user-1',
  code: '123456',
  expires_at: new Date(now.getTime() + 10 * 60000).toISOString(),
  attempts: 0,
  created_at: now.toISOString(),
}];

const world = createWorld({ seed });
const db = createSupabase({ url: 'https://lokal.invalid', key: 'lokal', fetchImpl: world.fetch });
const config = tgConfig({ TG_BOT_TOKEN: 'token-lokal', TG_DRY_RUN: '1' });

console.log(`# simulasi Telegram ${now.toISOString()} · chat ${chatId} · ${verified ? 'terhubung' : 'belum terverifikasi'}`);
console.log('# mode uji: tidak ada transaksi yang disimpan, tidak ada jaringan\n');

for (const [i, text] of messages.entries()) {
  const result = await handleTgMessage({
    update: { updateId: String(i + 1), chatId, text, fromName: 'Roy' },
    db,
    config,
    now,
  });
  console.log(`> ${text}`);
  console.log(result.text ?? '(tidak ada balasan)');
  console.log('');
}

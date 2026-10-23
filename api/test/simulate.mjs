// Simulator lokal: tidak menyentuh jaringan atau database asli.
// Pakai: node api/test/simulate.mjs "makan 1900"
//       node api/test/simulate.mjs "makan 1900" "ok"
//       SIM_NOW=2026-10-23T18:30:00Z node api/test/simulate.mjs "kopi 18.500"
import { createWorld, seedDefault } from './fake-supabase.mjs';
import { createSupabase } from '../lib/supabase.js';
import { handleMessage } from '../lib/flow.js';

const messages = process.argv.slice(2).filter((a) => a.trim());
if (!messages.length) messages.push('makan 1900');

const now = process.env.SIM_NOW ? new Date(process.env.SIM_NOW) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error('SIM_NOW tidak valid. Contoh: SIM_NOW=2026-10-23T18:30:00Z');
  process.exit(1);
}

const seed = seedDefault();
seed.wa_links.push({
  user_id: 'user-1',
  phone_e164: '628131854317',
  verified_at: '2026-10-01T00:00:00.000Z',
  created_at: '2026-10-01T00:00:00.000Z',
  last_seen_at: null,
});
const world = createWorld({ seed });
const db = createSupabase({ url: 'https://lokal.invalid', key: 'lokal', fetchImpl: world.fetch });
const config = { dryRun: true, bootstrapNumbers: [], bootstrapUserId: '', ownerUserId: '' };

console.log(`# simulasi ${now.toISOString()} (mode uji, tanpa jaringan)\n`);
for (const [i, text] of messages.entries()) {
  const result = await handleMessage({
    message: { id: `sim-${i + 1}`, from: '628131854317', text },
    db,
    config,
    now,
  });
  console.log(`> ${text}`);
  console.log(result.text ?? '(tidak ada balasan)');
  console.log('');
}

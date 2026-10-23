// Penjaga regresi: menambahkan jembatan Telegram tidak boleh mengubah
// perilaku WhatsApp. Menjalankan empat berkas tes WhatsApp yang lama dan
// memastikan jumlahnya tetap 55 dan semuanya lulus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const WA_FILES = [
  'test/parse.test.mjs',
  'test/verify.test.mjs',
  'test/flow.test.mjs',
  'test/links.test.mjs',
];

test('suite WhatsApp tetap 55/55', () => {
  // Node menandai proses tes anak lewat NODE_TEST_CONTEXT; hapus supaya
  // berkas tes WhatsApp benar-benar dijalankan, bukan dilewati.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', ...WA_FILES], {
    encoding: 'utf8',
    timeout: 120000,
    env,
  });
  assert.equal(result.status, 0, `tes WhatsApp gagal:\n${result.stdout}\n${result.stderr}`);
  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/(?:ℹ|#)\s*pass\s+(\d+)/);
  assert.ok(match, `jumlah pass tidak terbaca:\n${output}`);
  assert.equal(Number(match[1]), 55, 'jumlah tes WhatsApp harus tetap 55');
  assert.doesNotMatch(output, /(?:ℹ|#)\s*fail\s+[1-9]/);
});

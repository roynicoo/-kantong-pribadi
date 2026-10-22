import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifySignature, signBody, verifyChallenge } from '../lib/verify.js';

const SECRET = 'app-secret-rahasia';
const BODY = '{"object":"whatsapp_business_account","entry":[]}';

test('signature valid diterima (body mentah)', () => {
  const header = signBody(BODY, SECRET);
  assert.equal(verifySignature(BODY, header, SECRET), true);
  assert.equal(verifySignature(Buffer.from(BODY, 'utf8'), header, SECRET), true);
});

test('signature menolak body yang diubah', () => {
  const header = signBody(BODY, SECRET);
  const tampered = BODY.replace('[]', '[{"x":1}]');
  assert.equal(verifySignature(tampered, header, SECRET), false);
});

test('signature menolak secret salah, header kosong, dan format aneh', () => {
  const header = signBody(BODY, SECRET);
  assert.equal(verifySignature(BODY, header, 'secret-lain'), false);
  assert.equal(verifySignature(BODY, '', SECRET), false);
  assert.equal(verifySignature(BODY, undefined, SECRET), false);
  assert.equal(verifySignature(BODY, 'deadbeef', SECRET), false);
  assert.equal(verifySignature(BODY, `sha256=${'0'.repeat(64)}`, SECRET), false);
  assert.equal(verifySignature(BODY, header, ''), false);
});

test('signature tidak lolos kalau JSON di-serialize ulang', () => {
  const spaced = '{ "object": "whatsapp_business_account", "entry": [] }';
  const header = signBody(spaced, SECRET);
  assert.equal(verifySignature(BODY, header, SECRET), false);
});

test('GET verification mengembalikan challenge apa adanya', () => {
  const res = verifyChallenge(
    { 'hub.mode': 'subscribe', 'hub.verify_token': 'token-123', 'hub.challenge': '987654321' },
    'token-123',
  );
  assert.deepEqual(res, { status: 200, body: '987654321' });
});

test('GET verification menolak token salah, mode salah, atau tanpa challenge', () => {
  assert.equal(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'salah', 'hub.challenge': '1' }, 'token-123').status, 403);
  assert.equal(verifyChallenge({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'token-123', 'hub.challenge': '1' }, 'token-123').status, 403);
  assert.equal(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'token-123' }, 'token-123').status, 403);
  assert.equal(verifyChallenge({}, 'token-123').status, 403);
  assert.equal(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'token-123', 'hub.challenge': '1' }, '').status, 403);
});

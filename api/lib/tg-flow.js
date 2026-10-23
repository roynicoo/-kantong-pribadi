// Alur chat Telegram: pembungkus tipis di atas flow.js (pipeline yang sama).
// Yang beda hanya nama tabel, teks sapaan, dan perintah /start /help.
import { handleMessage } from './flow.js';
import {
  TG_TABLES,
  resolveChat,
  touchChat,
  verifyChatCode,
  UNVERIFIED_TEXT,
  VERIFY_ASK_TEXT,
} from './tg-links.js';

/** 5 baris contekan, dipakai /start dan /help. */
export const CHEATSHEET = [
  'makan 1900 · bensin 25rb · kopi 18.500',
  'masuk gaji 8,5jt',
  'pindah 100rb bca ke tunai',
  'saldo · hari ini · batal terakhir',
  'bantuan · contoh lain',
];

export function tgHelp(name = '') {
  const head = name ? `Halo, ${name}. Ini yang bisa kamu kirim:` : 'Ini yang bisa kamu kirim:';
  return [head, ...CHEATSHEET, '', 'Aku tanya dulu "simpan?" — balas OK atau BATAL.'].join('\n');
}

export function tgGreet({ name } = {}) {
  return [
    `Halo, ${name || 'Pengguna'}. Aku Kantong: catat uang lewat chat, tanpa buka aplikasi.`,
    '',
    ...CHEATSHEET,
    '',
    'Aku nggak pernah kirim pesan duluan. Kalau salah, balas BATAL atau ketik batal terakhir.',
  ].join('\n');
}

const SLASH_COMMANDS = {
  start: 'halo',
  help: 'bantuan',
  bantuan: 'bantuan',
  saldo: 'saldo',
  hariini: 'hari ini',
  rekap: 'rekap',
  undo: 'undo',
  batal: 'batal',
  verifikasi: 'verifikasi',
  verify: 'verifikasi',
};

/**
 * Telegram mengirim "/start", "/help", "/verifikasi 123456".
 * Ubah bentuk perintah jadi bentuk yang sudah dikenal parser Kantong.
 * Perintah tak dikenal dibiarkan apa adanya supaya parser yang menjelaskan.
 */
export function stripTelegramCommand(text) {
  const raw = String(text ?? '').trim();
  const m = raw.match(/^\/([A-Za-z_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/);
  if (!m) return raw;
  const base = SLASH_COMMANDS[m[1].toLowerCase()];
  if (!base) return raw;
  const rest = (m[2] || '').trim();
  return rest ? `${base} ${rest}` : base;
}

export function tgConfig(env = {}) {
  return {
    tables: TG_TABLES,
    dryRun: String(env.TG_DRY_RUN || '') === '1',
    ownerUserId: '',
    token: env.TG_BOT_TOKEN || '',
    // Chat id tidak boleh dinormalkan seperti nomor telepon.
    normalizeSender: (value) => String(value),
    resolveLink: resolveChat,
    touchLink: touchChat,
    verify: verifyChatCode,
    copy: {
      UNVERIFIED: UNVERIFIED_TEXT,
      UNKNOWN_SENDER: UNVERIFIED_TEXT,
      VERIFY_ASK: VERIFY_ASK_TEXT,
      greet: tgGreet,
      help: tgHelp,
    },
  };
}

/**
 * Proses satu update Telegram. Idempoten lewat `tg:<update_id>` di tg_messages.
 * @returns {Promise<{text:string|null, status:string}>}
 */
export async function handleTgMessage({ update, db, config, now = new Date() }) {
  return handleMessage({
    message: {
      id: `tg:${update.updateId}`,
      from: update.chatId,
      text: stripTelegramCommand(update.text),
    },
    db,
    config,
    now,
  });
}

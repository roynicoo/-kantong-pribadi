// Alur percakapan: idempotensi, konfirmasi, overdarft, undo, mode uji.
import { detectCommand, isConfirm, parseMessage, normalize, normalizePhone } from './parse.js';
import { resolveSender, touchLink, verifyCode, displayNameOf } from './links.js';
import { INCOME_CATEGORIES } from './parse.js';
import { accountBalance, assetTotals, defaultAccountId } from './balances.js';
import { jakartaDate } from './time.js';
import * as reply from './reply.js';

export const PENDING_TTL_MS = 15 * 60 * 1000;
export const UNDO_WINDOW_MS = 30 * 60 * 1000;

/**
 * Nama tabel/kolom per kanal. Bawaan = WhatsApp, jadi pemanggil lama
 * (wa.js) tidak berubah perilakunya. Telegram mengirim set sendiri lewat
 * config.tables supaya pipeline (konfirmasi, overdarft, undo) dipakai ulang.
 */
export const WA_TABLES = {
  messages: 'wa_messages',
  messageIdColumn: 'wa_message_id',
  pending: 'wa_pending',
  senderColumn: 'from_number',
  commandLog: 'wa_command_log',
};

function tablesOf(config) {
  const given = (config && config.tables) || {};
  return { ...WA_TABLES, ...given };
}

/* ---------- akses data kecil ---------- */

async function getPending(db, from, t) {
  const rows = await db.select(t.pending, {
    select: '*',
    filters: { [t.senderColumn]: `eq.${from}` },
    limit: 1,
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function putPending(db, from, intent, expiresAt, t) {
  const nowIso = new Date().toISOString();
  await db.insert(t.pending, {
    [t.senderColumn]: from,
    intent,
    expires_at: expiresAt.toISOString(),
    updated_at: nowIso,
  }, { onConflict: t.senderColumn });
}

async function clearPending(db, from, t) {
  await db.remove(t.pending, { [t.senderColumn]: `eq.${from}` });
}

async function insertMessageRow(db, waMessageId, from, body, t) {
  const rows = await db.insert(t.messages, {
    [t.messageIdColumn]: String(waMessageId).slice(0, 200),
    [t.senderColumn]: from,
    body: String(body ?? '').slice(0, 2000),
    status: 'pending',
  }, { onConflict: t.messageIdColumn, ignoreDuplicates: true });
  return rows.length ? rows[0] : null;
}

async function loadBasics(db, config) {
  const uid = config.ownerUserId;
  const [accounts, categories] = await Promise.all([
    db.selectAll('accounts', {
      select: 'id,name,type,opening_balance,current_value,is_archived',
      filters: { user_id: `eq.${uid}` },
      order: 'created_at.asc',
    }),
    db.selectAll('expense_categories', { select: 'name,enabled', filters: { user_id: `eq.${uid}` }, order: 'name.asc' }),
  ]);
  return {
    accounts: (accounts || []).filter((a) => a && a.is_archived !== true),
    categories: (categories || []).filter((c) => c.enabled !== false).map((c) => c.name),
  };
}

async function loadMoney(db, config) {
  const uid = config.ownerUserId;
  const [accounts, transactions, transfers, holdings, valuations] = await Promise.all([
    db.selectAll('accounts', {
      select: 'id,name,type,opening_balance,current_value,is_archived',
      filters: { user_id: `eq.${uid}` },
      order: 'created_at.asc',
    }),
    db.selectAll('transactions', { select: 'id,type,amount,account_id,date', filters: { user_id: `eq.${uid}` }, order: 'date.asc' }),
    db.selectAll('transfers', { select: 'id,from_account,to_account,amount,date', filters: { user_id: `eq.${uid}` }, order: 'date.asc' }),
    db.selectAll('investment_holdings', { select: 'account_id,quantity,current_price', filters: { user_id: `eq.${uid}` } }),
    db.selectAll('account_valuations', { select: 'account_id,date,value', filters: { user_id: `eq.${uid}` }, order: 'date.asc' }),
  ]);
  const active = (accounts || []).filter((a) => a && a.is_archived !== true);
  return {
    accounts: active,
    transactions: transactions || [],
    transfers: transfers || [],
    holdings: holdings || [],
    valuations: valuations || [],
  };
}

function balanceData(money) {
  return {
    accounts: money.accounts,
    transactions: money.transactions,
    transfers: money.transfers,
    holdings: money.holdings,
    valuations: money.valuations,
  };
}

function balanceOf(money, accountId) {
  const account = money.accounts.find((a) => a.id === accountId)
    || money.accounts.find((a) => a.id === defaultAccountId(money.accounts));
  if (!account) return null;
  return { account, balance: accountBalance(account, balanceData(money)) };
}

/* ---------- throttle nomor asing ---------- */

async function claimUnknownSlot(db, from, now, t) {
  const rows = await db.insert(t.commandLog, { [t.senderColumn]: from, day: jakartaDate(now) }, {
    onConflict: `${t.senderColumn},day`,
    ignoreDuplicates: true,
  });
  return rows.length > 0;
}

/* ---------- alur utama ---------- */

async function finishRow(db, rowId, result, t) {
  try {
    await db.patch(t.messages, { id: `eq.${rowId}` }, {
      status: result.status || 'pending',
      intent: result.intentForLog === undefined ? null : result.intentForLog,
      transaction_id: result.transactionId || null,
      error: result.error ? String(result.error).slice(0, 300) : null,
      processed_at: new Date().toISOString(),
    });
  } catch {
    /* pencatatan galat tidak boleh menutupi balasan */
  }
}

export async function handleMessage({ message, db, config, now = new Date() }) {
  const t = tablesOf(config);
  // Kanal boleh menentukan normalisasi pengirim sendiri (Telegram: chat id).
  const normalizeSender = config.normalizeSender || normalizePhone;
  const from = normalizeSender(message.from);
  const body = String(message.text ?? '').slice(0, 2000);
  // Salinan teks boleh berbeda per kanal; mekanikanya tetap sama.
  const copy = config.copy ? { ...reply, ...config.copy } : reply;
  const norm = normalize(body);
  const cmd = detectCommand(norm);

  // 1. Verifikasi nomor boleh datang dari nomor yang BELUM terhubung.
  if (cmd.kind === 'verify') {
    if (!cmd.code) return { text: copy.VERIFY_ASK, status: 'cancelled' };
    const row = await insertMessageRow(db, message.id, from, body, t);
    if (!row) return { text: null, status: 'duplicate' };
    try {
      const verify = config.verify || verifyCode;
      const result = await verify(db, from, cmd.code, now);
      await finishRow(db, row.id, result, t);
      return result;
    } catch (err) {
      await finishRow(db, row.id, { status: 'error', error: err && err.message }, t);
      return { text: copy.TECHNICAL_ERROR, status: 'error', error: err && err.message };
    }
  }

  // 2. Routing: pengirim -> tautan kanal -> user_id. Tidak ada tebakan.
  const resolve = config.resolveLink || resolveSender;
  const link = await resolve(db, from, config);
  if (link.status === 'unknown') {
    const first = await claimUnknownSlot(db, from, now, t);
    return { text: first ? copy.UNKNOWN_SENDER : null, status: first ? 'rejected' : 'throttled' };
  }

  const row = await insertMessageRow(db, message.id, from, body, t);
  if (!row) return { text: null, status: 'duplicate' };

  if (link.status === 'unverified') {
    await finishRow(db, row.id, { status: 'cancelled', error: 'unverified' }, t);
    return { text: copy.UNVERIFIED, status: 'cancelled' };
  }

  const scoped = { ...config, ownerUserId: link.userId };
  try {
    if (!link.bootstrap) await (config.touchLink || touchLink)(db, link.link, now);
    const result = await route({ from, body, db, config: scoped, now, copy, t });
    await finishRow(db, row.id, result, t);
    return result;
  } catch (err) {
    await finishRow(db, row.id, { status: 'error', error: err && err.message }, t);
    return { text: copy.TECHNICAL_ERROR, status: 'error', error: err && err.message };
  }
}

async function route(ctx) {
  const R = ctx.copy;
  const t = ctx.t;
  const norm = normalize(ctx.body);
  const cmd = detectCommand(norm);

  let pending = await getPending(ctx.db, ctx.from, t);
  let expired = false;
  if (pending && new Date(pending.expires_at).getTime() <= ctx.now.getTime()) {
    await clearPending(ctx.db, ctx.from, t);
    pending = null;
    expired = true;
  }
  const expiredPrefix = expired ? `${reply.EXPIRED_PREFIX}\n\n` : '';

  if (cmd.kind === 'greet') {
    const name = await displayNameOf(ctx.db, ctx.config.ownerUserId);
    return { text: expiredPrefix + R.greet({ name }), status: 'cancelled' };
  }
  if (cmd.kind === 'help') {
    const name = await displayNameOf(ctx.db, ctx.config.ownerUserId);
    return { text: expiredPrefix + R.help(name), status: 'cancelled' };
  }
  if (cmd.kind === 'saldo') return saldoReply(ctx);
  if (cmd.kind === 'recap') return recapReply(ctx);
  if (cmd.kind === 'undo') return undoRequest(ctx);

  if (cmd.kind === 'cancel') {
    if (!pending) return { text: reply.nothingToCancel(), status: 'cancelled' };
    await clearPending(ctx.db, ctx.from, t);
    return { text: reply.cancelled(), status: 'cancelled' };
  }

  if (pending && cmd.kind === 'confirm') {
    const needsYa = !!pending.intent.needs_explicit_ya;
    if (needsYa && !isConfirm(norm, { needsExplicitYa: true })) {
      return { text: reply.NEED_YA, status: 'pending', intentForLog: pending.intent };
    }
    return commitPending(ctx, pending);
  }

  if (cmd.kind === 'confirm') {
    return { text: 'Nggak ada catatan yang menunggu. Kirim dulu catatannya, misal: makan 1900', status: 'cancelled' };
  }

  const basics = await loadBasics(ctx.db, ctx.config);
  const parsed = parseMessage(ctx.body, { now: ctx.now, categories: basics.categories, accounts: basics.accounts });

  if (!parsed.ok) {
    return {
      text: reply.clarify(parsed.reason, {
        pendingIntent: pending ? pending.intent : null,
        expired,
        candidates: parsed.candidates || [],
      }),
      status: pending ? 'pending' : 'cancelled',
      intentForLog: pending ? pending.intent : null,
    };
  }

  const intent = parsed.intent;
  const expiresAt = new Date(ctx.now.getTime() + PENDING_TTL_MS);
  await putPending(ctx.db, ctx.from, intent, expiresAt, t);
  const prefix = expired ? reply.EXPIRED_PREFIX : pending ? `${reply.superseded()}\n\n` : '';
  return {
    text: prefix + reply.pendingSummary(intent, { dryRun: ctx.config.dryRun }),
    status: 'pending',
    intentForLog: intent,
  };
}

/* ---------- konfirmasi ---------- */

async function overdraftCheck(ctx, intent) {
  if (intent.type === 'income') return null;
  if (intent.needs_explicit_ya) return null;
  const accountId = intent.type === 'transfer' ? intent.from_account_id : intent.account_id;
  if (!accountId) return null;
  const money = await loadMoney(ctx.db, ctx.config);
  const account = money.accounts.find((a) => a.id === accountId);
  if (!account || account.type === 'investment') return null;
  const bal = accountBalance(account, balanceData(money));
  const need = BigInt(intent.amount);
  if (bal - need < 0n) return { accountName: account.name, balance: bal, amount: intent.amount };
  return null;
}

async function commitPending(ctx, pending) {
  const intent = pending.intent;
  if (intent.kind === 'undo') return commitUndo(ctx, pending);

  const warn = await overdraftCheck(ctx, intent);
  if (warn) {
    await putPending(ctx.db, ctx.from, { ...intent, needs_explicit_ya: true, overdraft: true }, new Date(pending.expires_at), ctx.t);
    return { text: reply.overdraftWarning(warn), status: 'pending', intentForLog: { ...intent, needs_explicit_ya: true } };
  }

  // Klaim atomik: hanya satu permintaan yang berhasil menghapus baris pending.
  const claimed = await ctx.db.remove(ctx.t.pending, { [ctx.t.senderColumn]: `eq.${ctx.from}` });
  if (!claimed || !claimed.length) return { text: null, status: 'cancelled' };
  const target = claimed[0].intent || intent;

  if (ctx.config.dryRun) {
    return { text: reply.committed({ intent: target, dryRun: true }), status: 'dryrun', intentForLog: target };
  }

  if (target.kind === 'transfer') {
    const rows = await ctx.db.insert('transfers', {
      user_id: ctx.config.ownerUserId,
      from_account: target.from_account_id,
      to_account: target.to_account_id,
      amount: target.amount,
      date: target.date,
      note: String(target.notes || '').slice(0, 200),
    });
    const transfer = rows[0];
    const money = await loadMoney(ctx.db, ctx.config);
    const after = balanceOf(money, target.from_account_id);
    const text = reply.committed({
      intent: target,
      accountName: after ? after.account.name : target.from_account_name,
      balance: after ? after.balance : undefined,
      transactionId: transfer && transfer.id,
    });
    return { text, status: 'committed', transactionId: transfer && transfer.id, intentForLog: target };
  }

  let category = target.category || 'Lainnya';
  if (target.type === 'income' && !INCOME_CATEGORIES.includes(category)) category = 'Lainnya';

  const rows = await ctx.db.insert('transactions', {
    user_id: ctx.config.ownerUserId,
    type: target.type,
    amount: target.amount,
    category,
    date: target.date,
    notes: String(target.notes || '').slice(0, 200),
    account_id: target.account_id || null,
  });
  const transaction = rows[0];
  const money = await loadMoney(ctx.db, ctx.config);
  const after = balanceOf(money, target.account_id);
  const text = reply.committed({
    intent: { ...target, category },
    accountName: after ? after.account.name : target.account_name,
    balance: after ? after.balance : undefined,
    transactionId: transaction && transaction.id,
  });
  return {
    text: money.accounts.length ? text : `${text}\n\nTambah akun di aplikasi biar saldo ikut kehitung.`,
    status: 'committed',
    transactionId: transaction && transaction.id,
    intentForLog: target,
  };
}

/* ---------- undo ---------- */

async function undoRequest(ctx) {
  const since = new Date(ctx.now.getTime() - UNDO_WINDOW_MS).toISOString();
  const rows = await ctx.db.select(ctx.t.messages, {
    select: '*',
    filters: { [ctx.t.senderColumn]: `eq.${ctx.from}`, status: 'eq.committed', created_at: `gte.${since}` },
    order: 'processed_at.desc',
    limit: 20,
  });
  const candidates = (rows || []).filter((r) => r.transaction_id && r.intent && ['transaction', 'transfer'].includes(r.intent.kind));
  const row = candidates[0];
  if (!row) return { text: reply.undoEmpty(), status: 'cancelled' };

  const table = row.intent.kind === 'transfer' ? 'transfers' : 'transactions';
  const found = await ctx.db.select(table, {
    select: 'id',
    filters: { id: `eq.${row.transaction_id}`, user_id: `eq.${ctx.config.ownerUserId}` },
    limit: 1,
  });
  if (!found || !found.length) return { text: reply.undoMissing(), status: 'cancelled' };

  const undoIntent = {
    kind: 'undo',
    target: table,
    transaction_id: row.transaction_id,
    log_id: row.id,
    summary: row.intent,
  };
  await putPending(ctx.db, ctx.from, undoIntent, new Date(ctx.now.getTime() + PENDING_TTL_MS), ctx.t);
  return {
    text: reply.undoConfirm({ intent: row.intent, transactionId: row.transaction_id }),
    status: 'pending',
    intentForLog: undoIntent,
  };
}

async function commitUndo(ctx, pending) {
  const claimed = await ctx.db.remove(ctx.t.pending, { [ctx.t.senderColumn]: `eq.${ctx.from}` });
  if (!claimed || !claimed.length) return { text: null, status: 'cancelled' };
  const intent = claimed[0].intent || pending.intent;
  if (intent.kind !== 'undo') return { text: reply.NOTHING_PENDING, status: 'cancelled' };

  if (ctx.config.dryRun) {
    return { text: 'mode uji: tidak disimpan. Di produksi, transaksi ini bakal dihapus.', status: 'dryrun', intentForLog: intent };
  }

  const deleted = await ctx.db.remove(intent.target, {
    id: `eq.${intent.transaction_id}`,
    user_id: `eq.${ctx.config.ownerUserId}`,
  });
  if (!deleted || !deleted.length) return { text: reply.undoMissing(), status: 'cancelled' };

  await ctx.db.patch(ctx.t.messages, { id: `eq.${intent.log_id}` }, { status: 'undone' });
  const money = await loadMoney(ctx.db, ctx.config);
  const summary = intent.summary || {};
  const after = balanceOf(money, summary.account_id || summary.from_account_id);
  return {
    text: reply.undoDone({
      intent: intent.summary || {},
      accountName: after ? after.account.name : (intent.summary && intent.summary.account_name),
      balance: after ? after.balance : undefined,
    }),
    status: 'cancelled',
    intentForLog: intent,
  };
}

/* ---------- perintah baca ---------- */

async function saldoReply(ctx) {
  const money = await loadMoney(ctx.db, ctx.config);
  const totals = assetTotals(money.accounts, balanceData(money));
  const accounts = money.accounts.map((a) => ({
    name: a.name,
    balance: totals.byAccount.get(a.id) ?? 0n,
  }));
  return {
    text: reply.saldo({ ready: totals.ready, total: totals.total, accounts }),
    status: 'cancelled',
  };
}

async function recapReply(ctx) {
  const today = jakartaDate(ctx.now);
  const money = await loadMoney(ctx.db, ctx.config);
  const rows = money.transactions.filter((t) => String(t.date).slice(0, 10) === today);
  let income = 0n;
  let expense = 0n;
  const byCategory = new Map();
  for (const t of rows) {
    const amount = BigInt(String(t.amount ?? 0));
    if (t.type === 'income') {
      income += amount;
    } else {
      expense += amount;
      const key = t.category || 'Lainnya';
      byCategory.set(key, (byCategory.get(key) || 0n) + amount);
    }
  }
  const categories = [...byCategory.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => (a.total === b.total ? 0 : a.total > b.total ? -1 : 1));
  return { text: reply.recap({ today, income, expense, categories }), status: 'cancelled' };
}

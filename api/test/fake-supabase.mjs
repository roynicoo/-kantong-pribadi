// Supabase REST palsu untuk tes offline: cukup untuk endpoint yang dipakai bridge.
// Tidak ada jaringan, tidak ada paket npm.
import crypto from 'node:crypto';

const NOW = () => new Date().toISOString();

const DEFAULTS = {
  transactions: { id: () => crypto.randomUUID(), created_at: NOW },
  transfers: { id: () => crypto.randomUUID(), created_at: NOW },
  accounts: { id: () => crypto.randomUUID(), created_at: NOW },
  expense_categories: {},
  monthly_budgets: {},
  investment_holdings: { id: () => crypto.randomUUID() },
  account_valuations: { id: () => crypto.randomUUID() },
  app_settings: {},
  wa_messages: { id: () => crypto.randomUUID(), created_at: NOW, processed_at: null },
  wa_pending: {},
  wa_command_log: { id: () => crypto.randomUUID(), created_at: NOW },
  wa_links: { created_at: NOW },
  wa_link_codes: { created_at: NOW },
  tg_messages: { id: () => crypto.randomUUID(), created_at: NOW, processed_at: null },
  tg_pending: {},
  tg_commands: { id: () => crypto.randomUUID(), created_at: NOW },
  tg_links: { created_at: NOW },
  tg_link_codes: { created_at: NOW },
  tg_verify_attempts: { updated_at: NOW },
};

function coerce(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') return value;
  if (/^-?\d+(\.\d+)?$/.test(String(value))) return Number(value);
  return String(value);
}

function compare(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    return na === nb ? 0 : na > nb ? 1 : -1;
  }
  const sa = String(a);
  const sb = String(b);
  return sa === sb ? 0 : sa > sb ? 1 : -1;
}

function matches(row, filters) {
  for (const [column, expression] of Object.entries(filters)) {
    if (column === 'select' || column === 'order' || column === 'limit' || column === 'offset' || column === 'on_conflict') continue;
    const raw = String(expression);
    const dot = raw.indexOf('.');
    const op = dot === -1 ? 'eq' : raw.slice(0, dot);
    const operand = dot === -1 ? raw : raw.slice(dot + 1);
    const value = row[column];
    if (op === 'eq') {
      if (String(value) !== operand) return false;
    } else if (op === 'neq') {
      if (String(value) === operand) return false;
    } else if (op === 'gt') {
      if (!(compare(value, operand) > 0)) return false;
    } else if (op === 'gte') {
      if (!(compare(value, operand) >= 0)) return false;
    } else if (op === 'lt') {
      if (!(compare(value, operand) < 0)) return false;
    } else if (op === 'lte') {
      if (!(compare(value, operand) <= 0)) return false;
    } else if (op === 'in') {
      const list = operand.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      if (!list.some((x) => String(value) === x)) return false;
    } else if (op === 'not') {
      if (operand === 'is.null') {
        if (value === null || value === undefined) return false;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

function applyOrder(rows, order) {
  if (!order) return rows;
  const clauses = String(order).split(',').map((c) => c.trim()).filter(Boolean);
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const clause of clauses) {
      const [column, dir] = clause.split('.');
      const cmp = compare(a[column], b[column]);
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
  return sorted;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function createWorld({ seed = {} } = {}) {
  const tables = {};
  for (const name of Object.keys(DEFAULTS)) tables[name] = [];
  for (const [name, rows] of Object.entries(seed)) {
    if (!tables[name]) tables[name] = [];
    tables[name] = rows.map((r) => ({ ...r }));
  }
  const sent = [];
  const tgSent = [];
  const calls = [];

  function insertRow(table, row, { ignoreDuplicates = false, onConflict = '' } = {}) {
    if (table === 'transactions') {
      if (!row.category || typeof row.category !== 'string') return { status: 400, body: { message: 'category_not_null' } };
      if (!(Number(row.amount) > 0)) return { status: 400, body: { message: 'amount_check' } };
      if (!row.type || !['income', 'expense'].includes(row.type)) return { status: 400, body: { message: 'type_check' } };
    }
    if (table === 'wa_messages' && !row.wa_message_id) return { status: 400, body: { message: 'wa_message_id_not_null' } };
    if (table === 'wa_links') {
      if (!/^628[0-9]{8,11}$/.test(String(row.phone_e164 || ''))) return { status: 400, body: { message: 'phone_check' } };
      const other = (tables.wa_links || []).find((r) => r.phone_e164 === row.phone_e164 && r.user_id !== row.user_id);
      if (other) return { status: 409, body: { message: 'duplicate key value violates unique constraint "wa_links_phone_e164_key"' } };
    }
    if (table === 'wa_link_codes' && !/^[0-9]{6}$/.test(String(row.code || ''))) {
      return { status: 400, body: { message: 'code_check' } };
    }
    if (table === 'tg_messages' && !row.tg_message_id) {
      return { status: 400, body: { message: 'tg_message_id_not_null' } };
    }
    if (table === 'tg_links') {
      if (!/^[0-9]{1,20}$/.test(String(row.chat_id ?? ''))) return { status: 400, body: { message: 'chat_id_check' } };
      const other = (tables.tg_links || []).find((r) => r.user_id === row.user_id && String(r.chat_id) !== String(row.chat_id));
      if (other) return { status: 409, body: { message: 'duplicate key value violates unique constraint "tg_links_user_id_key"' } };
    }
    if (table === 'tg_link_codes' && !/^[0-9]{6}$/.test(String(row.code || ''))) {
      return { status: 400, body: { message: 'code_check' } };
    }
    const defaults = DEFAULTS[table] || {};
    const conflictCols = onConflict ? String(onConflict).split(',').map((c) => c.trim()) : [];
    if (conflictCols.length) {
      const existing = (tables[table] || []).find((r) => conflictCols.every((c) => String(r[c]) === String(row[c])));
      if (existing) {
        if (ignoreDuplicates) return { status: 201, body: [] };
        Object.assign(existing, row);
        return { status: 201, body: [{ ...existing }] };
      }
    }
    const created = { ...row };
    for (const [column, make] of Object.entries(defaults)) {
      if (created[column] === undefined) created[column] = typeof make === 'function' ? make() : make;
    }
    tables[table].push(created);
    return { status: 201, body: [{ ...created }] };
  }

  async function fetchImpl(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url, method });

    if (url.includes('graph.facebook.com')) {
      const body = init.body ? JSON.parse(init.body) : {};
      sent.push({ to: body.to, text: body.text && body.text.body });
      return json({ messaging_product: 'whatsapp', messages: [{ id: `wamid.out.${sent.length}` }] }, 200);
    }

    if (url.includes('api.telegram.org')) {
      const body = init.body ? JSON.parse(init.body) : {};
      tgSent.push({
        chat_id: body.chat_id,
        text: body.text,
        parse_mode: body.parse_mode,
        disable_web_page_preview: body.disable_web_page_preview,
      });
      return json({ ok: true, result: { message_id: 1000 + tgSent.length, chat: { id: Number(body.chat_id) } } }, 200);
    }

    const parsed = new URL(url);
    const prefix = '/rest/v1/';
    if (!parsed.pathname.startsWith(prefix)) return json({ message: 'not found' }, 404);
    const table = parsed.pathname.slice(prefix.length);
    if (!tables[table]) tables[table] = [];
    const rows = tables[table];
    const params = Object.fromEntries(parsed.searchParams.entries());
    const prefer = String((init.headers && (init.headers.Prefer || init.headers.prefer)) || '');

    if (method === 'GET') {
      let out = rows.filter((r) => matches(r, params));
      out = applyOrder(out, params.order);
      const offset = params.offset ? Number(params.offset) : 0;
      const limit = params.limit ? Number(params.limit) : out.length;
      out = out.slice(offset, offset + limit);
      return json(out.map((r) => ({ ...r })), 200);
    }

    if (method === 'POST') {
      const body = init.body ? JSON.parse(init.body) : {};
      const list = Array.isArray(body) ? body : [body];
      const result = [];
      for (const row of list) {
        const res = insertRow(table, row, {
          ignoreDuplicates: prefer.includes('ignore-duplicates'),
          onConflict: params.on_conflict || '',
        });
        if (res.status >= 400) return json(res.body, res.status);
        result.push(...res.body);
      }
      return json(result, 201);
    }

    if (method === 'PATCH') {
      const patch = init.body ? JSON.parse(init.body) : {};
      const updated = [];
      for (const row of rows) {
        if (!matches(row, params)) continue;
        Object.assign(row, patch);
        updated.push({ ...row });
      }
      return json(updated, 200);
    }

    if (method === 'DELETE') {
      const removed = [];
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i], params)) removed.push(...rows.splice(i, 1));
      }
      return json(removed.map((r) => ({ ...r })), 200);
    }

    return json({ message: 'method not allowed' }, 405);
  }

  return {
    fetch: fetchImpl,
    tables,
    sent,
    tgSent,
    calls,
    rows: (table) => tables[table] || [],
    reset: () => Object.keys(tables).forEach((k) => { tables[k] = []; }),
  };
}

export const FAKE_NOW = '2026-10-23T03:00:00.000Z'; // 10:00 WIB

export function seedDefault() {
  return {
    accounts: [
      { id: 'acc-tunai', user_id: 'user-1', name: 'Tunai', type: 'cash', opening_balance: 50000, current_value: null, is_archived: false, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'acc-bca', user_id: 'user-1', name: 'BCA', type: 'bank', opening_balance: 100000, current_value: null, is_archived: false, created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'acc-indodax', user_id: 'user-1', name: 'Indodax', type: 'investment', opening_balance: 0, current_value: 2000000, is_archived: false, created_at: '2026-01-03T00:00:00.000Z' },
    ],
    expense_categories: [
      { user_id: 'user-1', name: 'Makan', enabled: true },
      { user_id: 'user-1', name: 'Transport', enabled: true },
      { user_id: 'user-1', name: 'Listrik', enabled: true },
      { user_id: 'user-1', name: 'Laundry', enabled: true },
      { user_id: 'user-1', name: 'Kosan', enabled: true },
      { user_id: 'user-1', name: 'Internet', enabled: true },
      { user_id: 'user-1', name: 'Rokok', enabled: true },
      { user_id: 'user-1', name: 'Lainnya', enabled: true },
    ],
    transactions: [],
    transfers: [],
    wa_messages: [],
    wa_pending: [],
    wa_command_log: [],
    wa_links: [],
    wa_link_codes: [],
    app_settings: [
      { user_id: 'user-1', display_name: 'Roy', theme: 'krem', pattern: 'none', onboarding_completed: true, onboarding_skipped: false, opening_balance: 0, opening_balance_date: null },
    ],
  };
}

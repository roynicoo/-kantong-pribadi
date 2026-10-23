// Saldo akun: meniru aturan core.js Kantong v4.
// Transaksi tanpa account_id dianggap milik akun default (sama seperti aplikasi).
export const LIQUID_TYPES = ['cash', 'bank', 'ewallet'];

const big = (v) => {
  try {
    return BigInt(String(v ?? 0));
  } catch {
    return 0n;
  }
};

export function holdingValue(holding) {
  const q = Number(holding.quantity);
  const p = Number(holding.current_price);
  const v = q * p;
  if (!Number.isFinite(v) || v < 0) return 0n;
  return BigInt(Math.round(v));
}

export function defaultAccountId(accounts = []) {
  const active = accounts.filter((a) => a && !a.is_archived);
  const pick = active.find((a) => a.type === 'cash')
    || active.find((a) => LIQUID_TYPES.includes(a.type))
    || active[0];
  return pick ? pick.id : null;
}

export function latestValuation(valuations = [], accountId) {
  const rows = valuations
    .filter((v) => v.account_id === accountId)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const last = rows[rows.length - 1];
  return last ? { value: big(last.value) } : null;
}

export function accountBalance(account, data = {}) {
  const accounts = data.accounts || [account];
  const fallbackId = data.defaultAccountId ?? defaultAccountId(accounts);
  if (account.type === 'investment') {
    const mine = (data.holdings || []).filter((h) => h.account_id === account.id);
    if (mine.length) return mine.reduce((s, h) => s + holdingValue(h), 0n);
    const snap = latestValuation(data.valuations || [], account.id);
    if (account.current_value !== null && account.current_value !== undefined) return big(account.current_value);
    if (snap) return snap.value;
    return big(account.opening_balance);
  }
  let bal = big(account.opening_balance);
  for (const t of data.transactions || []) {
    const owner = t.account_id || fallbackId;
    if (owner !== account.id) continue;
    bal += t.type === 'income' ? big(t.amount) : -big(t.amount);
  }
  for (const tr of data.transfers || []) {
    if (tr.from_account === account.id) bal -= big(tr.amount);
    if (tr.to_account === account.id) bal += big(tr.amount);
  }
  return bal;
}

export function assetTotals(accounts = [], data = {}) {
  const active = accounts.filter((a) => a && !a.is_archived);
  let total = 0n;
  let ready = 0n;
  const byAccount = new Map();
  for (const a of active) {
    const bal = accountBalance(a, { ...data, accounts: active });
    byAccount.set(a.id, bal);
    total += bal;
    if (a.type !== 'investment') ready += bal;
  }
  return { total, ready, byAccount };
}

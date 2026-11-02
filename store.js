import {validate,categoryName,budgetAmount,monthBounds,sortTransactions} from './core.js';
export class DemoStore{
 constructor(storage=globalThis.localStorage){this.storage=storage;this.key='kantong.demo.v1';}
 async all(){const rows=JSON.parse(this.storage.getItem(this.key)||'[]');if(!Array.isArray(rows))throw Error('The demo data is corrupted. Clear the site storage after backing up.');return sortTransactions(rows);}
 async save(raw,id){const t=validate(raw);const rows=await this.all();if(id){const i=rows.findIndex(r=>r.id===id);if(i<0)throw Error('Transaction not found.');/* created_at dipertahankan agar jam rekap harian tidak hilang saat mengubah entri. */rows[i]={...rows[i],...t,id,updated_at:new Date().toISOString()};}else{t.id=crypto.randomUUID();t.created_at=new Date().toISOString();t.updated_at=t.created_at;rows.push(t);}this.storage.setItem(this.key,JSON.stringify(rows));return id?{...t,id}:t;}
 async remove(id){const rows=await this.all();this.storage.setItem(this.key,JSON.stringify(rows.filter(r=>r.id!==id)));}
}

export class CloudStore{
 constructor(config,fetcher=globalThis.fetch.bind(globalThis),storage=globalThis.localStorage){this.url=config.url.replace(/\/$/,'');this.key=config.anonKey;this.fetcher=fetcher;this.storage=storage;this.sessionKey='kantong.session.'+this.url;this.session=null;this.refreshing=null;try{this.session=JSON.parse(storage?.getItem(this.sessionKey)||'null');}catch{storage?.removeItem(this.sessionKey);}}
 remember(data){this.session={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:data.expires_at||Math.floor(Date.now()/1000)+data.expires_in,user:data.user};this.storage?.setItem(this.sessionKey,JSON.stringify(this.session));}
 async signIn(email,password){const data=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})},false);this.remember(data);}
 async ready(){if(!this.session?.access_token)throw Error('Please sign in first.');if(this.session.expires_at> Date.now()/1000+60)return;if(!this.refreshing)this.refreshing=this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:this.session.refresh_token})},false).then(d=>this.remember(d)).finally(()=>{this.refreshing=null;});await this.refreshing;}
 async signOut(){try{await this.ready();await this.request('/auth/v1/logout',{method:'POST'});}finally{this.session=null;this.storage?.removeItem(this.sessionKey);}}
 async all(){await this.ready();let rows=[],offset=0;for(;;){const page=await this.request(`/rest/v1/transactions?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=date.desc,id.desc&limit=1000&offset=${offset}`);if(!Array.isArray(page))throw Error('Invalid data response.');if(!page.length)break;rows.push(...page);offset+=page.length;}return sortTransactions(rows);}
 async save(raw,id){const t=validate(raw);await this.ready();const OPTIONAL_NULL=['account_id','payment_method','need_want','goal_id'];const body={...Object.fromEntries(Object.entries(t).filter(([k,v])=>!(OPTIONAL_NULL.includes(k)&&v===null))),user_id:this.session.user.id};const data=await this.request('/rest/v1/transactions'+(id?`?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(this.session.user.id)}`:''),{method:id?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});if(!Array.isArray(data)||data.length!==1)throw Error('Transaction not found or not allowed.');return data[0];}
 async remove(id){await this.ready();const data=await this.request(`/rest/v1/transactions?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(this.session.user.id)}`,{method:'DELETE',headers:{Prefer:'return=representation'}});if(!Array.isArray(data)||data.length!==1)throw Error('Transaction not found or not allowed.');}
 async request(path,options={},authenticated=true){let response;try{response=await this.fetcher(this.url+path,{...options,headers:{apikey:this.key,...(authenticated?{Authorization:`Bearer ${this.session?.access_token}`}:{}),'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000)});}catch{throw Error('No network or the request timed out. Try again; check the list before saving again.');}const data=response.status===204?null:await response.json();if(!response.ok)throw Error(data?.message||data?.error_description||data?.msg||'The request failed.');return data;}
}
// Planning metadata has a separate demo key; never used as a cloud fallback.
DemoStore.prototype.planning=async function(){return JSON.parse(this.storage.getItem('kantong.demo.planning.v3')||'{"categories":[],"budgets":[],"scenarios":[]}');};
DemoStore.prototype.putPlanning=async function(table,row,keys,remove=false){const p=await this.planning();const eq=(x,k)=>k==='kind'?((x.kind||'expense')===(row.kind||'expense')):x[k]===row[k];p[table]=p[table].filter(x=>!keys.every(k=>eq(x,k)));if(!remove)p[table].push(row);this.storage.setItem('kantong.demo.planning.v3',JSON.stringify(p));return row;};
CloudStore.prototype.planning=async function(){await this.ready();const entries=await Promise.all([['categories','expense_categories','name'],['budgets','monthly_budgets','month,category'],['scenarios','improvement_scenarios','month']].map(async([key,table,order])=>{const rows=[];let offset=0;for(;;){const page=await this.request(`/rest/v1/${table}?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=${order}&limit=1000&offset=${offset}`);if(!Array.isArray(page))throw Error('Invalid planning data.');if(!page.length)break;rows.push(...page);offset+=page.length;}return [key,rows];}));return Object.fromEntries(entries);};
CloudStore.prototype.putPlanning=async function(table,row,keys,remove=false){await this.ready();const db={categories:'expense_categories',budgets:'monthly_budgets',scenarios:'improvement_scenarios'}[table];const owner=this.session.user.id;const filter=['user_id',...keys].map(k=>`${k}=eq.${encodeURIComponent(k==='user_id'?owner:row[k])}`).join('&');
 const data=await this.request(`/rest/v1/${db}?${remove?filter:'on_conflict='+['user_id',...keys].join(',')}`,{method:remove?'DELETE':'POST',headers:{Prefer:remove?'return=representation':'resolution=merge-duplicates,return=representation'},...(!remove?{body:JSON.stringify({...row,user_id:owner})}:{})});
 if(!Array.isArray(data)||(!remove&&data.length!==1))throw Error('Planning could not be saved.');
 // Explicit readback verifies the exact metadata target after a write.
 const check=await this.request(`/rest/v1/${db}?select=*&${filter}`);if(!Array.isArray(check)||(remove?check.length!==0:check.length!==1))throw Error('The save could not be verified. Reload before trying again.');return remove?row:check[0];};
for(const Store of [DemoStore,CloudStore]){
 Store.prototype.setCategory=async function(name,enabled=true,kind='expense'){return this.putPlanning('categories',{name:categoryName(name),kind,enabled:!!enabled},['kind','name']);};
 Store.prototype.setBudget=async function(month,category,raw){monthBounds(month);const amount=budgetAmount(raw);return this.putPlanning('budgets',{month,category:categoryName(category),scope:'category',...(amount===null?{}:{amount})},['month','category'],amount===null);};
 Store.prototype.setGroupBudget=async function(month,group,raw){monthBounds(month);const amount=budgetAmount(raw);const clean=String(group||'').trim();if(!/^[A-Za-z0-9][A-Za-z0-9 ._&()/-]{0,59}$/.test(clean))throw Error('Invalid group name.');return this.putPlanning('budgets',{month,category:clean,scope:'group',...(amount===null?{}:{amount})},['month','category'],amount===null);};
 Store.prototype.setScenario=async function(month,income,proposed){monthBounds(month);const raw=String(income);if(!/^\d{1,100}$/.test(raw)||!proposed||Array.isArray(proposed)||typeof proposed!=='object')throw Error('Invalid simulation.');const clean=Object.fromEntries(Object.entries(proposed).map(([k,v])=>{const n=budgetAmount(v);if(n===null)throw Error('A proposal is required.');return [categoryName(k),String(n)];}));return this.putPlanning('scenarios',{month,income:raw,proposed:clean},['month']);};
}

/* One save action for the whole budget table. Only the rows the user changed
   are written; a blank value removes the target, 0 is an intentional zero.
   Every failure is reported per row instead of pretending the batch worked. */
DemoStore.prototype.saveBudgetBatch = async function (month, entries = []) {
  monthBounds(month);
  const saved = [], failed = [];
  for (const e of entries) {
    const scope = e.scope === 'group' ? 'group' : 'category';
    const name = String(e.category || '').trim();
    try {
      const amount = budgetAmount(e.amount);
      if (scope === 'group') await this.setGroupBudget(month, name, amount === null ? '' : String(amount));
      else await this.setBudget(month, name, amount === null ? '' : String(amount));
      saved.push({ category: name, scope, amount });
    } catch (err) {
      failed.push({ category: name, scope, message: err.message || 'Could not save.' });
    }
  }
  return { saved, failed };
};
CloudStore.prototype.saveBudgetBatch = async function (month, entries = []) {
  monthBounds(month);
  await this.ready();
  const owner = this.session.user.id;
  const upserts = [], removals = [], saved = [], failed = [];
  for (const e of entries) {
    const scope = e.scope === 'group' ? 'group' : 'category';
    const name = String(e.category || '').trim();
    try {
      const amount = budgetAmount(e.amount);
      if (amount === null) removals.push({ category: name, scope });
      else upserts.push({ user_id: owner, month, category: name, scope, amount });
    } catch (err) {
      failed.push({ category: name, scope, message: err.message || 'Could not save.' });
    }
  }
  if (upserts.length) {
    try {
      const data = await this.request('/rest/v1/monthly_budgets?on_conflict=user_id,month,category', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(upserts),
      });
      if (!Array.isArray(data)) throw Error('The budget could not be saved.');
      for (const row of data) saved.push({ category: row.category, scope: row.scope || 'category', amount: row.amount });
    } catch (err) {
      for (const row of upserts) failed.push({ category: row.category, scope: row.scope, message: err.message || 'Could not save.' });
    }
  }
  for (const row of removals) {
    try {
      const data = await this.request(`/rest/v1/monthly_budgets?user_id=eq.${encodeURIComponent(owner)}&month=eq.${encodeURIComponent(month)}&category=eq.${encodeURIComponent(row.category)}`, {
        method: 'DELETE', headers: { Prefer: 'return=representation' },
      });
      if (!Array.isArray(data)) throw Error('The budget could not be cleared.');
      saved.push({ category: row.category, scope: row.scope, amount: null });
    } catch (err) {
      failed.push({ category: row.category, scope: row.scope, message: err.message || 'Could not clear.' });
    }
  }
  return { saved, failed };
};



/* ============================================================
   Kantong v4 — pengaturan, jadwal pemasukan rutin, penanda posting.
   Data demo memakai kunci terpisah dari cloud; tidak ada fallback diam-diam.
   ============================================================ */
export { autoPost } from './core.js';
import { normalizeSettings, validateSchedule, openingAmount, avatarDataError, validateAccount, validateTransfer, validateHolding, valuationPlan, validateActivity, latestValuation, normalizeWaPhone } from './core.js';

const DEMO_V4 = 'kantong.demo.v4';
const emptyV4 = () => ({ settings: { onboarding_completed: false, onboarding_skipped: false, opening_balance: 0, opening_balance_date: null }, schedules: [], postings: [], accounts: [], transfers: [], holdings: [], valuations: [], activity: [] });
const V4_ARRAYS = ['schedules', 'postings', 'accounts', 'transfers', 'holdings', 'valuations', 'activity'];
const validDate = (d) => { if (d === null) return null; const s = String(d); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T12:00:00Z')) || new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) !== s) throw Error('Invalid opening balance date.'); return s; };

DemoStore.prototype.v4 = async function () {
  let raw;
  try { raw = JSON.parse(this.storage.getItem(DEMO_V4) || 'null'); } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return emptyV4();
  const base = emptyV4();
  base.settings = raw.settings || base.settings;
  for (const key of V4_ARRAYS) base[key] = Array.isArray(raw[key]) ? raw[key] : [];
  return base;
};
DemoStore.prototype.commitV4 = async function (fn) {
  const data = await this.v4();
  const next = fn(data) || data;
  this.storage.setItem(DEMO_V4, JSON.stringify(next));
  return next;
};
DemoStore.prototype.settings = async function () { return normalizeSettings((await this.v4()).settings); };
DemoStore.prototype.waLink = async function () { return null; };
DemoStore.prototype.requestWaCode = async function () {
  throw Error('WhatsApp verification needs an online account. Demo mode only stores data in this browser.');
};
DemoStore.prototype.unlinkWa = async function () {
  throw Error('Demo mode has no WhatsApp link.');
};
DemoStore.prototype.tgLink = async function () { return null; };
DemoStore.prototype.requestTgCode = async function () {
  throw Error('Telegram verification needs an online account. Demo mode only stores data in this browser.');
};
DemoStore.prototype.unlinkTg = async function () {
  throw Error('Demo mode has no Telegram link.');
};
DemoStore.prototype.saveSettings = async function (patch = {}) {
  if (patch.avatar_kind === 'photo' && patch.avatar_data) avatarDataError(patch.avatar_data);
  let saved;
  await this.commitV4((data) => {
    const merged = { ...normalizeSettings(data.settings), ...patch };
    merged.opening_balance = openingAmount(merged.opening_balance);
    merged.onboarding_completed = merged.onboarding_completed === true;
    merged.onboarding_skipped = merged.onboarding_skipped === true;
    merged.opening_balance_date = validDate(merged.opening_balance_date ?? null);
    const clean = normalizeSettings(merged);
    if (merged.avatar_kind === 'photo' && merged.avatar_data && !clean.avatar_data) throw Error('Invalid photo data or larger than 100 KB.');
    data.settings = clean; saved = clean;
  });
  return normalizeSettings(saved);
};
DemoStore.prototype.schedules = async function () { return (await this.v4()).schedules.map((s) => ({ ...s })); };
DemoStore.prototype.saveSchedule = async function (raw, id) {
  const clean = validateSchedule(raw);
  let row;
  await this.commitV4((data) => {
    if (id) {
      const i = data.schedules.findIndex((x) => x.id === id);
      if (i < 0) throw Error('Schedule not found.');
      data.schedules[i] = { ...clean, id };
      row = data.schedules[i];
    } else {
      row = { ...clean, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      data.schedules.push(row);
    }
  });
  return { ...row };
};
DemoStore.prototype.deleteSchedule = async function (id) {
  await this.commitV4((data) => {
    if (!data.schedules.some((x) => x.id === id)) throw Error('Schedule not found.');
    data.schedules = data.schedules.filter((x) => x.id !== id);
    data.postings = data.postings.filter((p) => p.schedule_id !== id);
  });
};
DemoStore.prototype.setScheduleActive = async function (id, active, resumeMonth) {
  const row = (await this.schedules()).find((x) => x.id === id);
  if (!row) throw Error('Schedule not found.');
  return this.saveSchedule({ ...row, active: !!active, resume_month: active && !row.active ? (resumeMonth || new Date().toISOString().slice(0, 7)) : row.resume_month }, id);
};
DemoStore.prototype.postings = async function () { return (await this.v4()).postings.map((p) => ({ ...p })); };
DemoStore.prototype.claimPosting = async function ({ schedule_id, month, amount }) {
  let out = { claimed: false };
  await this.commitV4((data) => {
    const found = data.postings.find((p) => p.schedule_id === schedule_id && p.month === month);
    if (found) { out = { claimed: false, posting: { ...found } }; return; }
    const row = { schedule_id, month, amount: amount ?? null, status: 'posted', transaction_id: null, created_at: new Date().toISOString() };
    data.postings.push(row); out = { claimed: true, posting: { ...row } };
  });
  return out;
};
DemoStore.prototype.linkPosting = async function (schedule_id, month, transaction_id) {
  await this.commitV4((data) => {
    const row = data.postings.find((p) => p.schedule_id === schedule_id && p.month === month);
    if (!row) throw Error('Auto-posting marker not found.');
    row.transaction_id = transaction_id; row.status = 'posted';
  });
};
DemoStore.prototype.releasePosting = async function (schedule_id, month) {
  await this.commitV4((data) => { data.postings = data.postings.filter((p) => !(p.schedule_id === schedule_id && p.month === month && p.status === 'posted')); });
};
DemoStore.prototype.dismissPosting = async function (schedule_id, month) {
  await this.commitV4((data) => {
    const row = data.postings.find((p) => p.schedule_id === schedule_id && p.month === month);
    if (!row) throw Error('Auto-posting marker not found.');
    row.status = 'dismissed'; row.transaction_id = null;
  });
};
DemoStore.prototype.restorePosting = async function (schedule_id, month, transaction_id) {
  await this.commitV4((data) => {
    const row = data.postings.find((p) => p.schedule_id === schedule_id && p.month === month);
    if (!row) throw Error('Auto-posting marker not found.');
    row.status = 'posted'; row.transaction_id = transaction_id ?? row.transaction_id;
  });
};

const OWNER_KEYS = (owner, row) => ['user_id', 'schedule_id', 'month'].map((k) => `${k}=eq.${encodeURIComponent(k === 'user_id' ? owner : row[k])}`).join('&');

CloudStore.prototype.settings = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/app_settings?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}`);
  if (!Array.isArray(data)) throw Error('Invalid settings.');
  if (data.length > 1) throw Error('Duplicate settings detected. Check the database.');
  return normalizeSettings(data[0] || null);
};
CloudStore.prototype.saveSettings = async function (patch = {}) {
  if (patch.avatar_kind === 'photo' && patch.avatar_data) avatarDataError(patch.avatar_data);
  await this.ready();
  const current = await this.settings();
  const merged = normalizeSettings({ ...current, ...patch });
  if (patch.avatar_kind === 'photo' && patch.avatar_data && !merged.avatar_data) throw Error('Invalid photo data or larger than 100 KB.');
  const owner = this.session.user.id;
  const body = { user_id: owner, onboarding_completed: merged.onboarding_completed, onboarding_skipped: merged.onboarding_skipped, opening_balance: merged.opening_balance, opening_balance_date: merged.opening_balance_date, display_name: merged.display_name, avatar_color: merged.avatar_color, avatar_kind: merged.avatar_kind, avatar_data: merged.avatar_data, theme: merged.theme, pattern: merged.pattern };
  const data = await this.request('/rest/v1/app_settings?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Could not save the settings.');
  const check = await this.request(`/rest/v1/app_settings?select=*&user_id=eq.${encodeURIComponent(owner)}`);
  if (!Array.isArray(check) || check.length !== 1) throw Error('The settings save could not be verified. Reload before trying again.');
  return normalizeSettings(check[0]);
};
/* ============================================================
   WhatsApp: tautan nomor <-> akun.
   Satu nomor hanya untuk satu akun (dijaga unique index di database).
   Kode verifikasi ditulis lewat fungsi security definer; aplikasi hanya
   membaca barisnya sendiri.
   ============================================================ */
CloudStore.prototype.waLink = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/wa_links?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}`);
  if (!Array.isArray(data)) throw Error('Invalid WhatsApp status.');
  if (data.length > 1) throw Error('Duplicate WhatsApp link detected. Check the database.');
  return data[0] || null;
};
CloudStore.prototype.requestWaCode = async function (phone) {
  const normalized = normalizeWaPhone(phone);
  await this.ready();
  let data;
  try {
    data = await this.request('/rest/v1/rpc/kantong_wa_request_code', { method: 'POST', body: JSON.stringify({ p_phone: normalized }) });
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (msg.includes('nomor_sudah_dipakai')) throw Error('This number is already connected to another Kantong account. One number per account.');
    if (msg.includes('nomor_sudah_terhubung')) throw Error('This number is already connected to this account.');
    if (msg.includes('nomor_tidak_valid')) throw Error('Invalid Indonesian WhatsApp number. Example: 081233434573.');
    if (msg.includes('harus_masuk')) throw Error('Sign in first to connect a number.');
    if (msg.includes('does not exist') || msg.includes('Could not find')) throw Error('WhatsApp support is not enabled yet. Run kantong-wa-migration.sql once, then reload.');
    throw Error('Could not create a verification code. Try again.');
  }
  if (!data || !data.code) throw Error('Could not create a verification code. Try again.');
  return data;
};
CloudStore.prototype.unlinkWa = async function () {
  await this.ready();
  await this.request('/rest/v1/rpc/kantong_wa_unlink', { method: 'POST', body: JSON.stringify({}) });
  return true;
};

/* ============================================================
   Telegram: tautan chat <-> akun.
   Chat belum dikenal sebelum kode dikirim ke bot, jadi kode dibuat dulu
   lewat fungsi security definer, lalu bot yang menulis tautannya.
   ============================================================ */
CloudStore.prototype.tgLink = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/tg_links?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}`);
  if (!Array.isArray(data)) throw Error('Invalid Telegram status.');
  if (data.length > 1) throw Error('Duplicate Telegram link detected. Check the database.');
  return data[0] || null;
};
CloudStore.prototype.requestTgCode = async function () {
  await this.ready();
  let data;
  try {
    data = await this.request('/rest/v1/rpc/kantong_tg_request_code', { method: 'POST', body: JSON.stringify({}) });
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (msg.includes('sudah_terhubung')) throw Error('This Telegram chat is already connected to this account. To switch chats, disconnect first.');
    if (msg.includes('harus_masuk')) throw Error('Sign in first to connect Telegram.');
    if (msg.includes('does not exist') || msg.includes('Could not find')) throw Error('Telegram support is not enabled yet. Run kantong-tg-migration.sql once, then reload.');
    throw Error('Could not create a verification code. Try again.');
  }
  if (!data || !data.code) throw Error('Could not create a verification code. Try again.');
  return data;
};
CloudStore.prototype.unlinkTg = async function () {
  await this.ready();
  await this.request('/rest/v1/rpc/kantong_tg_unlink', { method: 'POST', body: JSON.stringify({}) });
  return true;
};

CloudStore.prototype.schedules = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/income_schedules?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=created_at.asc`);
  if (!Array.isArray(data)) throw Error('Invalid income schedule.');
  return data;
};
CloudStore.prototype.saveSchedule = async function (raw, id) {
  const clean = validateSchedule(raw);
  await this.ready();
  const owner = this.session.user.id;
  const body = { ...clean, user_id: owner };
  const data = await this.request('/rest/v1/income_schedules' + (id ? `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}` : ''), { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Schedule not found or not allowed.');
  return data[0];
};
CloudStore.prototype.deleteSchedule = async function (id) {
  await this.ready();
  const data = await this.request(`/rest/v1/income_schedules?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(this.session.user.id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Schedule not found or not allowed.');
};
CloudStore.prototype.setScheduleActive = async function (id, active, resumeMonth) {
  const row = (await this.schedules()).find((x) => x.id === id);
  if (!row) throw Error('Schedule not found.');
  return this.saveSchedule({ ...row, active: !!active, resume_month: active && !row.active ? (resumeMonth || new Date().toISOString().slice(0, 7)) : row.resume_month }, id);
};
CloudStore.prototype.postings = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/income_postings?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=month.asc`);
  if (!Array.isArray(data)) throw Error('Invalid auto-posting marker.');
  return data;
};
CloudStore.prototype.claimPosting = async function ({ schedule_id, month, amount }) {
  await this.ready();
  const data = await this.request('/rest/v1/income_postings?on_conflict=user_id,schedule_id,month', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ user_id: this.session.user.id, schedule_id, month, amount: amount ?? null, status: 'posted' }) });
  if (!Array.isArray(data)) throw Error('The automatic posting claim failed.');
  return data.length === 1 ? { claimed: true, posting: data[0] } : { claimed: false };
};
CloudStore.prototype.linkPosting = async function (schedule_id, month, transaction_id) {
  await this.ready();
  const filter = OWNER_KEYS(this.session.user.id, { schedule_id, month });
  const data = await this.request(`/rest/v1/income_postings?${filter}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ transaction_id, status: 'posted' }) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Could not save the auto-posting link.');
  return data[0];
};
CloudStore.prototype.releasePosting = async function (schedule_id, month) {
  await this.ready();
  await this.request(`/rest/v1/income_postings?${OWNER_KEYS(this.session.user.id, { schedule_id, month })}&status=eq.posted`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
};
CloudStore.prototype.dismissPosting = async function (schedule_id, month) {
  await this.ready();
  const filter = OWNER_KEYS(this.session.user.id, { schedule_id, month });
  const data = await this.request(`/rest/v1/income_postings?${filter}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'dismissed', transaction_id: null }) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('The automatic entry could not be marked settled; the transaction was not deleted.');
  return data[0];
};
CloudStore.prototype.restorePosting = async function (schedule_id, month, transaction_id) {
  await this.ready();
  const filter = OWNER_KEYS(this.session.user.id, { schedule_id, month });
  await this.request(`/rest/v1/income_postings?${filter}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'posted', transaction_id }) });
};

/* ============================================================
   Kantong v4 — Akun & Aset: CRUD, transfer, holdings, valuasi, audit.
   Semua mutasi menulis jejak aktivitas setelah sukses; kegagalan
   tidak pernah menghasilkan angka "seolah berhasil".
   ============================================================ */
const act = (action, entity, summary) => validateActivity({ action, entity, summary });

DemoStore.prototype.logActivity = function (data, action, entity, summary) {
  let clean;
  try { clean = act(action, entity, summary); } catch { return; }
  data.activity.unshift({ id: crypto.randomUUID(), action: clean.action, entity: clean.entity, summary: clean.summary, created_at: new Date().toISOString() });
  data.activity = data.activity.slice(0, 200);
};
DemoStore.prototype.accounts = async function () { return (await this.v4()).accounts.map((a) => ({ ...a })); };
DemoStore.prototype.saveAccount = async function (raw, id) {
  const clean = validateAccount(raw);
  let row;
  await this.commitV4((data) => {
    if (id) {
      const i = data.accounts.findIndex((x) => x.id === id);
      if (i < 0) throw Error('Account not found.');
      data.accounts[i] = { ...data.accounts[i], ...clean, id };
      row = data.accounts[i];
      this.logActivity(data, 'edited', 'account', `Account ${clean.name} edited`);
    } else {
      row = { ...clean, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      data.accounts.push(row);
      this.logActivity(data, 'created', 'account', `Account ${clean.name} created`);
    }
  });
  return { ...row };
};
DemoStore.prototype.archiveAccount = async function (id, archived = true) {
  const row = (await this.accounts()).find((a) => a.id === id);
  if (!row) throw Error('Account not found.');
  const saved = await this.saveAccount({ ...row, is_archived: archived }, id);
  await this.commitV4((data) => { this.logActivity(data, 'edited', 'account', archived ? `Account ${row.name} archived` : `Account ${row.name} reactivated`); });
  return saved;
};
DemoStore.prototype.transfers = async function () { return (await this.v4()).transfers.map((t) => ({ ...t })); };
DemoStore.prototype.saveTransfer = async function (raw, id) {
  const clean = validateTransfer(raw);
  let row;
  await this.commitV4((data) => {
    if (id) {
      const i = data.transfers.findIndex((x) => x.id === id);
      if (i < 0) throw Error('Transfer not found.');
      data.transfers[i] = { ...data.transfers[i], ...clean, id };
      row = data.transfers[i];
      this.logActivity(data, 'edited', 'transfer', `Transfer ${clean.amount} edited`);
    } else {
      row = { ...clean, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      data.transfers.push(row);
      this.logActivity(data, 'created', 'transfer', `Transfer ${clean.amount} recorded`);
    }
  });
  return { ...row };
};
DemoStore.prototype.deleteTransfer = async function (id) {
  await this.commitV4((data) => {
    const row = data.transfers.find((x) => x.id === id);
    if (!row) throw Error('Transfer not found.');
    data.transfers = data.transfers.filter((x) => x.id !== id);
    this.logActivity(data, 'deleted', 'transfer', `Transfer ${row.amount} deleted`);
  });
};
DemoStore.prototype.holdings = async function () { return (await this.v4()).holdings.map((h) => ({ ...h })); };
DemoStore.prototype.saveHolding = async function (raw, id) {
  const clean = validateHolding(raw);
  let row;
  await this.commitV4((data) => {
    if (id) {
      const i = data.holdings.findIndex((x) => x.id === id);
      if (i < 0) throw Error('Asset not found.');
      data.holdings[i] = { ...data.holdings[i], ...clean, id, updated_at: new Date().toISOString() };
      row = data.holdings[i];
      this.logActivity(data, 'edited', 'holding', `Asset ${clean.asset_name} edited`);
    } else {
      row = { ...clean, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      data.holdings.push(row);
      this.logActivity(data, 'created', 'holding', `Asset ${clean.asset_name} added`);
    }
  });
  return { ...row };
};
DemoStore.prototype.deleteHolding = async function (id) {
  await this.commitV4((data) => {
    const row = data.holdings.find((x) => x.id === id);
    if (!row) throw Error('Asset not found.');
    data.holdings = data.holdings.filter((x) => x.id !== id);
    this.logActivity(data, 'deleted', 'holding', `Asset ${row.asset_name} deleted`);
  });
};
DemoStore.prototype.valuations = async function () { return (await this.v4()).valuations.map((v) => ({ ...v })); };
DemoStore.prototype.saveValuation = async function (accountId, raw, note = '', date = '') {
  let row;
  await this.commitV4((data) => {
    const account = data.accounts.find((a) => a.id === accountId);
    if (!account) throw Error('Account not found.');
    const [clean] = valuationPlan([{ account_id: accountId, value: raw, note, date }]);
    row = { ...clean, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    data.valuations.push(row);
    account.current_value = clean.value;
    this.logActivity(data, 'created', 'valuation', `Value for ${account.name} updated`);
  });
  return { ...row };
};
DemoStore.prototype.saveValuations = async function (items) {
  const plan = valuationPlan(items); // seluruh baris divalidasi sebelum menulis
  let saved = [];
  await this.commitV4((data) => {
    saved = plan.map((item) => {
      const account = data.accounts.find((a) => a.id === item.account_id);
      if (!account) throw Error('Account not found.');
      const row = { ...item, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      data.valuations.push(row);
      account.current_value = item.value;
      this.logActivity(data, 'created', 'valuation', `Value for ${account.name} updated`);
      return row;
    });
  });
  return { saved: saved.map((r) => ({ ...r })), errors: [] };
};
DemoStore.prototype.deleteValuation = async function (id) {
  await this.commitV4((data) => {
    const row = data.valuations.find((v) => v.id === id);
    if (!row) throw Error('Value note not found.');
    data.valuations = data.valuations.filter((v) => v.id !== id);
    const account = data.accounts.find((a) => a.id === row.account_id);
    if (account) {
      const latest = latestValuation(data.valuations, row.account_id);
      account.current_value = latest ? Number(latest.value) : null;
    }
    this.logActivity(data, 'deleted', 'valuation', `Value note ${row.date} deleted`);
  });
};
DemoStore.prototype.activity = async function (limit = 50) { return (await this.v4()).activity.slice(0, Math.max(1, Math.min(50, Number(limit) || 50))); };

CloudStore.prototype.logActivity = async function (action, entity, summary) {
  let clean;
  try { clean = act(action, entity, summary); } catch { return; }
  try {
    await this.request('/rest/v1/app_activity', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...clean, user_id: this.session.user.id }) });
  } catch { /* audit tidak boleh membatalkan mutasi yang sudah sukses */ }
};
CloudStore.prototype.accounts = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/accounts?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=created_at.asc`);
  if (!Array.isArray(data)) throw Error('Invalid account list.');
  return data;
};
CloudStore.prototype.saveAccount = async function (raw, id) {
  const clean = validateAccount(raw);
  await this.ready();
  const owner = this.session.user.id;
  const data = await this.request('/rest/v1/accounts' + (id ? `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}` : ''), { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...clean, user_id: owner }) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Account not found or not allowed.');
  await this.logActivity(id ? 'edited' : 'created', 'account', `Account ${clean.name} ${id ? 'edited' : 'created'}`);
  return data[0];
};
CloudStore.prototype.archiveAccount = async function (id, archived = true) {
  const row = (await this.accounts()).find((a) => a.id === id);
  if (!row) throw Error('Account not found.');
  const saved = await this.saveAccount({ ...row, is_archived: archived }, id);
  await this.logActivity('edited', 'account', archived ? `Account ${row.name} archived` : `Account ${row.name} reactivated`);
  return saved;
};
CloudStore.prototype.transfers = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/transfers?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=date.desc`);
  if (!Array.isArray(data)) throw Error('Invalid transfer list.');
  return data;
};
CloudStore.prototype.saveTransfer = async function (raw, id) {
  const clean = validateTransfer(raw);
  await this.ready();
  const owner = this.session.user.id;
  const data = await this.request('/rest/v1/transfers' + (id ? `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}` : ''), { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...clean, user_id: owner }) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Could not save the transfer.');
  await this.logActivity(id ? 'edited' : 'created', 'transfer', `Transfer ${clean.amount} ${id ? 'edited' : 'recorded'}`);
  return data[0];
};
CloudStore.prototype.deleteTransfer = async function (id) {
  await this.ready();
  const data = await this.request(`/rest/v1/transfers?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(this.session.user.id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Transfer not found or not allowed.');
  await this.logActivity('deleted', 'transfer', 'Transfer deleted');
};
CloudStore.prototype.holdings = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/investment_holdings?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=created_at.asc`);
  if (!Array.isArray(data)) throw Error('Invalid asset list.');
  return data;
};
CloudStore.prototype.saveHolding = async function (raw, id) {
  const clean = validateHolding(raw);
  await this.ready();
  const owner = this.session.user.id;
  const data = await this.request('/rest/v1/investment_holdings' + (id ? `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}` : ''), { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...clean, user_id: owner }) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Could not save the asset.');
  await this.logActivity(id ? 'edited' : 'created', 'holding', `Asset ${clean.asset_name} ${id ? 'edited' : 'added'}`);
  return data[0];
};
CloudStore.prototype.deleteHolding = async function (id) {
  await this.ready();
  const data = await this.request(`/rest/v1/investment_holdings?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(this.session.user.id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Asset not found or not allowed.');
  await this.logActivity('deleted', 'holding', 'Asset deleted');
};
CloudStore.prototype.valuations = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/account_valuations?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=date.asc`);
  if (!Array.isArray(data)) throw Error('Invalid value history.');
  return data;
};
CloudStore.prototype.saveValuation = async function (accountId, raw, note = '', date = '') {
  await this.ready();
  const owner = this.session.user.id;
  const [clean] = valuationPlan([{ account_id: accountId, value: raw, note, date }]);
  const data = await this.request('/rest/v1/account_valuations', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...clean, user_id: owner }) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Could not save the account value.');
  const patch = await this.request(`/rest/v1/accounts?id=eq.${encodeURIComponent(accountId)}&user_id=eq.${encodeURIComponent(owner)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ current_value: clean.value }) });
  if (!Array.isArray(patch) || patch.length !== 1) throw Error('The value was saved but the account\'s current value was not updated. Reload to see the real state.');
  await this.logActivity('created', 'valuation', 'Account value updated');
  return data[0];
};
CloudStore.prototype.saveValuations = async function (items) {
  const plan = valuationPlan(items);
  const saved = [], errors = [];
  for (const item of plan) {
    try { saved.push(await this.saveValuation(item.account_id, item.value, item.note, item.date)); }
    catch (e) { errors.push({ account_id: item.account_id, message: e?.message || 'Could not save the value.' }); }
  }
  return { saved, errors };
};
CloudStore.prototype.deleteValuation = async function (id) {
  await this.ready();
  const owner = this.session.user.id;
  const data = await this.request(`/rest/v1/account_valuations?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Value note not found or not allowed.');
  const accountId = data[0].account_id;
  const all = await this.valuations();
  const latest = latestValuation(all, accountId);
  await this.request(`/rest/v1/accounts?id=eq.${encodeURIComponent(accountId)}&user_id=eq.${encodeURIComponent(owner)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ current_value: latest ? Number(latest.value) : null }) });
  await this.logActivity('deleted', 'valuation', `Value note ${data[0].date} deleted`);
};
CloudStore.prototype.activity = async function (limit = 50) {
  await this.ready();
  const n = Math.max(1, Math.min(50, Number(limit) || 50));
  const data = await this.request(`/rest/v1/app_activity?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=created_at.desc&limit=${n}`);
  if (!Array.isArray(data)) throw Error('Invalid activity history.');
  return data;
};

import { CATEGORY_ICONS, SEED_CATEGORY_META, CATEGORY_FALLBACK, sortCategories, normalizeCategory, findCategory,
  categoryCreateError, categoryRenameError, categoryDeleteBlock, moveCategory, seedPlan, DEFAULT_SEED_ACCOUNT,
  signupOutcome, mapAuthError, TAXONOMY_ROWS, validateGoal } from './core.js';

/* ============================================================
   Kantong v5 — pendaftaran mandiri, kategori (ikon/warna/urutan/
   arsip), dan penanaman bawaan yang idempoten.

   Aturan: tidak ada fallback diam-diam ke localStorage; kegagalan
   tulis selalu dilaporkan, dan penanaman ulang tidak pernah
   menggandakan baris (kunci unik user_id+name).
   ============================================================ */

const DEMO_SEED_KEY = 'kantong.demo.seed.v5';

/* Baris kategori lama (sebelum v5) tetap bisa dipakai: nilai yang tidak
   dikenal diganti aman, bukan membuang barisnya. */
function lenientCategory(raw = {}) {
  const icon = String(raw.icon ?? '');
  const color = String(raw.color ?? '');
  const sort = Number.isInteger(raw.sort_order) ? raw.sort_order : (raw.sort_order === null || raw.sort_order === undefined ? null : Number(raw.sort_order));
  const kind = ['income', 'expense', 'savings', 'obligation'].includes(raw.kind) ? raw.kind : 'expense';
  return {
    name: String(raw.name ?? '').trim(),
    kind,
    group_name: String(raw.group_name ?? '').trim().slice(0, 60) || (kind === 'savings' ? 'Savings & Investment' : kind === 'obligation' ? 'Financial Obligations' : kind === 'income' ? 'Income' : 'Other'),
    enabled: raw.enabled !== false,
    icon: CATEGORY_ICONS.includes(icon) ? icon : '',
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '',
    sort_order: Number.isInteger(sort) ? sort : null,
    archived_at: raw.archived_at ? String(raw.archived_at) : null,
    is_default: raw.is_default === true,
    renamed_from: raw.renamed_from ? String(raw.renamed_from).slice(0, 200) : null,
  };
}
const lowerName = (v) => String(v ?? '').trim().toLowerCase();
const migrationHint = (e) => {
  const msg = String(e?.message || '');
  return /PGRST204|column .* does not exist|Could not find the '.*' column|schema cache/i.test(msg)
    ? 'Migration v5 has not run: the icon/color/order columns are missing. Run kantong-v5-migration.sql once, then reload.'
    : msg;
};
const seedRows = (names, base = 0) => names.map((name, i) => {
  const meta = SEED_CATEGORY_META[name] || CATEGORY_FALLBACK;
  return { name, enabled: true, icon: meta.icon, color: meta.color, sort_order: base + i, archived_at: null, is_default: true };
});

/* ---------- Demo ---------- */
DemoStore.prototype.categories = async function () {
  const p = await this.planning();
  return sortCategories((p.categories || []).map(lenientCategory).filter((c) => c.name));
};
DemoStore.prototype.seedState = async function () {
  return { seeded: !!this.storage.getItem(DEMO_SEED_KEY), at: this.storage.getItem(DEMO_SEED_KEY) || null, supported: true };
};
DemoStore.prototype.markSeeded = async function () {
  const at = new Date().toISOString();
  this.storage.setItem(DEMO_SEED_KEY, at);
  return { seeded: true, at, supported: true };
};
DemoStore.prototype.saveCategory = async function (raw) {
  const clean = normalizeCategory(raw);
  const rows = await this.categories();
  const existing = rows.find((r) => String(r.name).toLowerCase() === clean.name.toLowerCase() && (r.kind || 'expense') === clean.kind);
  if (!existing) {
    const err = categoryCreateError(clean.name, rows, clean.kind);
    if (err) throw Error(err);
  }
  const p = await this.planning();
  const i = (p.categories || []).findIndex((r) => lowerName(r.name) === lowerName(clean.name) && (r.kind || 'expense') === clean.kind);
  const merged = i >= 0 ? { ...p.categories[i], ...clean, name: p.categories[i].name } : { ...clean };
  if (i >= 0) p.categories[i] = merged; else (p.categories = p.categories || []).push(merged);
  this.storage.setItem('kantong.demo.planning.v3', JSON.stringify(p));
  return lenientCategory(merged);
};
DemoStore.prototype.categoryUsage = async function (name) {
  const rows = await this.categories();
  const row = findCategory(rows, name);
  if (!row) throw Error('Category not found.');
  const all = await this.all();
  const p = await this.planning();
  const goals = (await this.goals()).filter((g) => g.category === row.name || g.name === row.name);
  const usage = {
    transactions: all.filter((t) => t.category === row.name).length,
    budgets: (p.budgets || []).filter((b) => b.category === row.name).length,
  };
  if (goals.length) usage.goals = goals.length;
  return usage;
};
DemoStore.prototype.renameCategory = async function (oldName, nextName) {
  const rows = await this.categories();
  /* Kategori bawaan (mis. Makan) boleh belum punya baris sendiri. */
  if (!String(oldName ?? '').trim()) throw Error('Category not found.');
  const current = findCategory(rows, oldName) || { name: String(oldName).trim(), enabled: true, icon: '', color: '', sort_order: null, archived_at: null, is_default: false };
  const err = categoryRenameError(current.name, nextName, rows);
  if (err) throw Error(err);
  const next = categoryName(nextName);
  if (next === current.name) return { ...current, moved: 0 };

  const all = await this.all();
  let moved = 0;
  for (const t of all) if (t.category === current.name) { t.category = next; moved += 1; }
  if (moved) this.storage.setItem('kantong.demo.v1', JSON.stringify(all));

  const p = await this.planning();
  p.budgets = (p.budgets || []).map((b) => (b.category === current.name ? { ...b, category: next } : b));
  p.scenarios = (p.scenarios || []).map((s) => {
    if (!s.proposed || !Object.hasOwn(s.proposed, current.name)) return s;
    const proposed = Object.fromEntries(Object.entries(s.proposed).map(([k, v]) => [k === current.name ? next : k, v]));
    return { ...s, proposed };
  });
  const chain = [current.renamed_from, current.name].filter(Boolean).join(',');
  p.categories = (p.categories || []).filter((r) => !(lowerName(r.name) === lowerName(current.name) && (r.kind || 'expense') === (current.kind || 'expense')));
  p.categories.push({ ...current, name: next, renamed_from: chain });
  this.storage.setItem('kantong.demo.planning.v3', JSON.stringify(p));
  /* Savings goals point at a category by name, so rename must follow too. */
  await this.commitV7((data) => {
    data.goals = (data.goals || []).map((g) => (g.category === current.name ? { ...g, category: next } : g));
    return data;
  });
  return { ...current, name: next, moved };
};
DemoStore.prototype.archiveCategory = async function (name, archived = true) {
  const rows = await this.categories();
  const row = findCategory(rows, name);
  if (!row) throw Error('Category not found.');
  return this.saveCategory({ ...row, archived_at: archived ? new Date().toISOString() : null, enabled: archived ? false : true });
};
DemoStore.prototype.deleteCategory = async function (name) {
  const rows = await this.categories();
  const row = findCategory(rows, name);
  if (!row) throw Error('Category not found.');
  const block = categoryDeleteBlock(await this.categoryUsage(row.name));
  if (block) throw Error(block);
  await this.putPlanning('categories', { name: row.name, kind: row.kind }, ['kind', 'name'], true);
  return row.name;
};
DemoStore.prototype.moveCategory = async function (name, delta) {
  const rows = await this.categories();
  const pairs = moveCategory(rows, name, delta);
  for (const pair of pairs) {
    const row = findCategory(rows, pair.name);
    await this.saveCategory({ ...row, sort_order: pair.sort_order });
  }
  return pairs;
};
DemoStore.prototype.seedDefaults = async function () {
  const state = await this.seedState();
  const rows = await this.categories();
  const accounts = await this.accounts();
  const plan = seedPlan({ categories: rows, accounts, seeded: state.seeded });
  if (!plan.needed) {
    if (!state.seeded) await this.markSeeded();
    return { categories: 0, account: false };
  }
  let added = 0;
  if (plan.categories.length) {
    const p = await this.planning();
    const base = (p.categories || []).reduce((max, r) => Math.max(max, Number.isInteger(r.sort_order) ? r.sort_order : -1), -1) + 1;
    p.categories = [...(p.categories || []), ...seedRows(plan.categories, base)];
    this.storage.setItem('kantong.demo.planning.v3', JSON.stringify(p));
    added = plan.categories.length;
  }
  if (plan.account) await this.saveAccount({ name: DEFAULT_SEED_ACCOUNT.name, type: DEFAULT_SEED_ACCOUNT.type, opening_balance: 0 }, null);
  await this.markSeeded();
  return { categories: added, account: !!plan.account };
};

/* ---------- Cloud ---------- */
CloudStore.prototype.authRequest = async function (path, options = {}) {
  let response;
  try {
    response = await this.fetcher(this.url + path, {
      ...options,
      headers: { apikey: this.key, 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { status: 0, payload: null };
  }
  let payload = null;
  try { payload = response.status === 204 ? null : await response.json(); } catch { payload = null; }
  return { status: response.status, payload };
};
CloudStore.prototype.signUp = async function ({ email, password, username, redirectTo } = {}) {
  const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
  const { status, payload } = await this.authRequest('/auth/v1/signup' + q, {
    method: 'POST',
    body: JSON.stringify({ email, password, data: { display_name: username } }),
  });
  if (status >= 400 || !payload) {
    const mapped = mapAuthError(status, payload);
    const err = Error(mapped.message);
    err.kind = mapped.kind;
    err.status = status;
    throw err;
  }
  const outcome = signupOutcome(payload);
  if (outcome.kind === 'session') this.remember({ ...outcome.session, user: payload.user });
  return outcome;
};
CloudStore.prototype.requestPasswordReset = async function (email, redirectTo) {
  const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
  const { status, payload } = await this.authRequest('/auth/v1/recover' + q, { method: 'POST', body: JSON.stringify({ email }) });
  if (status >= 400) throw Error(mapAuthError(status, payload).message);
  return true;
};
CloudStore.prototype.resendConfirmation = async function (email, redirectTo) {
  const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
  const { status, payload } = await this.authRequest('/auth/v1/resend' + q, { method: 'POST', body: JSON.stringify({ type: 'signup', email }) });
  if (status >= 400) throw Error(mapAuthError(status, payload).message);
  return true;
};
CloudStore.prototype.setNewPassword = async function (password) {
  if (!this.session?.access_token) throw Error('The recovery link is no longer valid. Request a new one via “Forgot password?”.');
  const { status, payload } = await this.authRequest('/auth/v1/user', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${this.session.access_token}` },
    body: JSON.stringify({ password }),
  });
  if (status >= 400) {
    const mapped = mapAuthError(status, payload);
    throw Error(mapped.kind === 'weak' ? mapped.message : 'The password could not be changed. Request a new link and try again.');
  }
  if (payload?.id) {
    this.session.user = payload;
    this.storage?.setItem(this.sessionKey, JSON.stringify(this.session));
  }
  return true;
};
/* Tautan pemulihan Supabase hanya membawa token, bukan objek pengguna.
   Profil diambil lewat token itu sebelum aplikasi memakai user_id. */
CloudStore.prototype.loadUser = async function () {
  if (!this.session?.access_token) throw Error('Session unavailable.');
  const { status, payload } = await this.authRequest('/auth/v1/user', {
    headers: { Authorization: `Bearer ${this.session.access_token}` },
  });
  if (status >= 400 || !payload?.id) throw Error('The recovery session has expired. Request a new link.');
  this.session.user = payload;
  this.storage?.setItem(this.sessionKey, JSON.stringify(this.session));
  return payload;
};
CloudStore.prototype.acceptRecoverySession = function (session) {
  if (!session?.access_token) throw Error('Invalid recovery link.');
  this.remember({ ...session, user: session.user || this.session?.user || null });
  return this.session;
};

CloudStore.prototype.categories = async function () {
  await this.ready();
  const owner = this.session.user.id;
  let data;
  try {
    data = await this.request(`/rest/v1/expense_categories?select=*&user_id=eq.${encodeURIComponent(owner)}&order=sort_order.asc.nullslast,name.asc`);
  } catch {
    // Kolom v5 belum ada (migrasi belum jalan): tetap tampilkan nama & status.
    data = await this.request(`/rest/v1/expense_categories?select=*&user_id=eq.${encodeURIComponent(owner)}&order=name.asc`);
  }
  if (!Array.isArray(data)) throw Error('Invalid category list.');
  return sortCategories(data.map(lenientCategory).filter((c) => c.name));
};
CloudStore.prototype.seedState = async function () {
  await this.ready();
  try {
    const data = await this.request(`/rest/v1/app_settings?select=categories_seeded,seeded_at&user_id=eq.${encodeURIComponent(this.session.user.id)}`);
    if (!Array.isArray(data) || !data.length) return { seeded: false, at: null, supported: true };
    return { seeded: data[0].categories_seeded === true, at: data[0].seeded_at || null, supported: true };
  } catch {
    return { seeded: false, at: null, supported: false };
  }
};
CloudStore.prototype.markSeeded = async function () {
  await this.ready();
  const at = new Date().toISOString();
  const owner = this.session.user.id;
  const data = await this.request('/rest/v1/app_settings?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: owner, categories_seeded: true, seeded_at: at }),
  });
  if (!Array.isArray(data) || !data.length) throw Error('Could not save the default-category marker.');
  return { seeded: true, at, supported: true };
};
CloudStore.prototype.saveCategory = async function (raw) {
  const clean = normalizeCategory(raw);
  const rows = await this.categories();
  const existing = rows.find((r) => String(r.name).toLowerCase() === clean.name.toLowerCase() && r.kind === clean.kind);
  if (!existing) {
    const err = categoryCreateError(clean.name, rows, clean.kind);
    if (err) throw Error(err);
  }
  await this.ready();
  const owner = this.session.user.id;
  const body = {
    user_id: owner,
    name: clean.name,
    kind: clean.kind,
    group_name: clean.group_name,
    enabled: clean.enabled,
    icon: clean.icon || null,
    color: clean.color || null,
    sort_order: clean.sort_order,
    archived_at: clean.archived_at,
    is_default: clean.is_default,
    renamed_from: clean.renamed_from,
  };
  let data;
  try {
    data = await this.request('/rest/v1/expense_categories?on_conflict=user_id,kind,name', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw Error(migrationHint(e));
  }
  if (!Array.isArray(data) || data.length !== 1) throw Error('Could not save the category.');
  const check = await this.request(`/rest/v1/expense_categories?select=*&user_id=eq.${encodeURIComponent(owner)}&name=eq.${encodeURIComponent(clean.name)}&kind=eq.${encodeURIComponent(clean.kind)}`);
  if (!Array.isArray(check) || check.length !== 1) throw Error('The category save could not be verified. Reload before trying again.');
  return lenientCategory(check[0]);
};
CloudStore.prototype.categoryUsage = async function (name) {
  await this.ready();
  const owner = this.session.user.id;
  const rows = await this.categories();
  const row = findCategory(rows, name);
  if (!row) throw Error('Category not found.');
  const tx = await this.request(`/rest/v1/transactions?select=id&user_id=eq.${encodeURIComponent(owner)}&category=eq.${encodeURIComponent(row.name)}&limit=1000`);
  const budgets = (await this.planning()).budgets.filter((b) => b.category === row.name).length;
  let goals = 0;
  try {
    const g = await this.request(`/rest/v1/savings_goals?select=id&user_id=eq.${encodeURIComponent(owner)}&category=eq.${encodeURIComponent(row.name)}`);
    goals = Array.isArray(g) ? g.length : 0;
  } catch { goals = 0; }
  const usage = { transactions: Array.isArray(tx) ? tx.length : 0, budgets };
  if (goals) usage.goals = goals;
  return usage;
};
CloudStore.prototype.renameCategory = async function (oldName, nextName) {
  const rows = await this.categories();
  if (!String(oldName ?? '').trim()) throw Error('Category not found.');
  const current = findCategory(rows, oldName) || { name: String(oldName).trim(), enabled: true, icon: '', color: '', sort_order: null, archived_at: null, is_default: false };
  const err = categoryRenameError(current.name, nextName, rows);
  if (err) throw Error(err);
  const next = categoryName(nextName);
  if (next === current.name) return { ...current, moved: 0 };
  await this.ready();
  const owner = this.session.user.id;
  const done = [];
  try {
    const tx = await this.request(`/rest/v1/transactions?user_id=eq.${encodeURIComponent(owner)}&category=eq.${encodeURIComponent(current.name)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ category: next }),
    });
    if (!Array.isArray(tx)) throw Error('The transaction could not be updated.');
    done.push(`${tx.length} transactions`);
    const budgets = (await this.planning()).budgets.filter((b) => b.category === current.name);
    if (budgets.length) {
      const moved = await this.request('/rest/v1/monthly_budgets?on_conflict=user_id,month,category', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(budgets.map((b) => ({ user_id: owner, month: b.month, category: next, amount: b.amount }))),
      });
      if (!Array.isArray(moved)) throw Error('The budget could not be moved.');
      await this.request(`/rest/v1/monthly_budgets?user_id=eq.${encodeURIComponent(owner)}&category=eq.${encodeURIComponent(current.name)}`, { method: 'DELETE' });
      done.push(`${budgets.length} budgets`);
    }
    const scenarios = (await this.planning()).scenarios.filter((s) => s.proposed && Object.hasOwn(s.proposed, current.name));
    for (const s of scenarios) {
      const proposed = Object.fromEntries(Object.entries(s.proposed).map(([k, v]) => [k === current.name ? next : k, v]));
      await this.request(`/rest/v1/improvement_scenarios?user_id=eq.${encodeURIComponent(owner)}&month=eq.${encodeURIComponent(s.month)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ proposed }),
      });
    }
    await this.saveCategory({ ...current, name: next, renamed_from: [current.renamed_from, current.name].filter(Boolean).join(',') });
    await this.request('/rest/v1/savings_goals?user_id=eq.' + encodeURIComponent(owner) + '&category=eq.' + encodeURIComponent(current.name), {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ category: next }),
    }).catch(() => null);
    await this.request(`/rest/v1/expense_categories?user_id=eq.${encodeURIComponent(owner)}&name=eq.${encodeURIComponent(current.name)}&kind=eq.${encodeURIComponent(current.kind || 'expense')}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
  } catch (e) {
    throw Error(`Rename stopped after ${done.length ? done.join(', ') : 'the first step'}: ${e.message} Reload to see the actual state.`);
  }
  return { ...current, name: next, moved: 1 };
};
CloudStore.prototype.archiveCategory = async function (name, archived = true) {
  const rows = await this.categories();
  const row = findCategory(rows, name);
  if (!row) throw Error('Category not found.');
  return this.saveCategory({ ...row, archived_at: archived ? new Date().toISOString() : null, enabled: archived ? false : true });
};
CloudStore.prototype.deleteCategory = async function (name) {
  const rows = await this.categories();
  const row = findCategory(rows, name);
  if (!row) throw Error('Category not found.');
  const block = categoryDeleteBlock(await this.categoryUsage(row.name));
  if (block) throw Error(block);
  await this.ready();
  try {
    const data = await this.request(`/rest/v1/expense_categories?user_id=eq.${encodeURIComponent(this.session.user.id)}&name=eq.${encodeURIComponent(row.name)}&kind=eq.${encodeURIComponent(row.kind || 'expense')}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (!Array.isArray(data) || data.length !== 1) throw Error('Category not found or not allowed.');
  } catch (e) {
    const msg = String(e?.message || '');
    if (/kategori_dipakai_transaksi/.test(msg)) throw Error('This category is still used by transactions. Delete was refused so history stays intact — archive it instead.');
    if (/kategori_dipakai_anggaran/.test(msg)) throw Error('This category still has a budget. Delete was refused — archive it instead.');
    throw e;
  }
  return row.name;
};
CloudStore.prototype.moveCategory = async function (name, delta) {
  const rows = await this.categories();
  const pairs = moveCategory(rows, name, delta);
  for (const pair of pairs) {
    const row = findCategory(rows, pair.name);
    await this.saveCategory({ ...row, sort_order: pair.sort_order });
  }
  return pairs;
};
CloudStore.prototype.seedDefaults = async function () {
  const state = await this.seedState();
  const rows = await this.categories();
  const accounts = await this.accounts();
  const plan = seedPlan({ categories: rows, accounts, seeded: state.seeded });
  if (!plan.needed) {
    if (!state.seeded && state.supported) await this.markSeeded();
    return { categories: 0, account: false };
  }
  await this.ready();
  const owner = this.session.user.id;
  let added = 0;
  if (plan.categories.length) {
    const base = rows.reduce((max, r) => Math.max(max, Number.isInteger(r.sort_order) ? r.sort_order : -1), -1) + 1;
    let data;
    try {
      data = await this.request('/rest/v1/expense_categories?on_conflict=user_id,name', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(seedRows(plan.categories, base).map((r) => ({ ...r, user_id: owner }))),
      });
    } catch (e) {
      throw Error(migrationHint(e));
    }
    if (!Array.isArray(data)) throw Error('Could not save the default categories.');
    added = data.length;
  }
  if (plan.account) await this.saveAccount({ name: DEFAULT_SEED_ACCOUNT.name, type: DEFAULT_SEED_ACCOUNT.type, opening_balance: 0 }, null);
  if (state.supported) await this.markSeeded();
  return { categories: added, account: !!plan.account };
};

/* ============================================================
   Kantong v7 — savings goals and the universal taxonomy seed.

   The seed is deliberately generic and runs ONCE per account. It never
   re-adds a category the user renamed, archived or deleted, because after
   the first run the flag is set and the seed body is never executed again.
   ============================================================ */

const DEMO_V7 = 'kantong.demo.v7';
const DEMO_TAXONOMY_KEY = 'kantong.demo.taxonomy.v7';
const emptyV7 = () => ({ goals: [] });

function lenientGoal(raw = {}) {
  const num = (v) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
  };
  return {
    id: raw.id ? String(raw.id) : null,
    name: String(raw.name ?? '').trim(),
    target_amount: num(raw.target_amount),
    saved_amount: num(raw.saved_amount),
    deadline: raw.deadline ? String(raw.deadline).slice(0, 10) : null,
    account_id: raw.account_id || null,
    category: String(raw.category ?? raw.name ?? '').trim(),
    color: /^#[0-9a-fA-F]{6}$/.test(String(raw.color ?? '')) ? String(raw.color) : '#1c6b4b',
    icon: String(raw.icon ?? '') || '🎯',
    archived_at: raw.archived_at ? String(raw.archived_at) : null,
    created_at: raw.created_at ? String(raw.created_at) : null,
  };
}

DemoStore.prototype.v7 = async function () {
  let raw;
  try { raw = JSON.parse(this.storage.getItem(DEMO_V7) || 'null'); } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return emptyV7();
  return { goals: Array.isArray(raw.goals) ? raw.goals : [] };
};
DemoStore.prototype.commitV7 = async function (fn) {
  const data = await this.v7();
  const next = fn(data) || data;
  this.storage.setItem(DEMO_V7, JSON.stringify(next));
  return next;
};
DemoStore.prototype.goals = async function () {
  return (await this.v7()).goals.map(lenientGoal).filter((g) => g.name)
    .sort((a, b) => (a.archived_at ? 1 : 0) - (b.archived_at ? 1 : 0) || a.name.localeCompare(b.name));
};
DemoStore.prototype.saveGoal = async function (raw, id = null) {
  const clean = validateGoal(raw);
  const row = {
    ...clean,
    target_amount: Number(clean.target_amount),
    saved_amount: Number(clean.saved_amount),
    id: id || crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  const goals = (await this.goals());
  if (!id) {
    const dup = goals.find((g) => g.name.toLowerCase() === clean.name.toLowerCase() && !g.archived_at);
    if (dup) throw Error(`A savings goal named “${dup.name}” already exists.`);
    if (goals.filter((g) => !g.archived_at).length >= 40) throw Error('Up to 40 active goals. Archive one first.');
  }
  await this.commitV7((data) => {
    data.goals = (data.goals || []).filter((g) => g.id !== row.id).concat([row]);
    return data;
  });
  return lenientGoal(row);
};
DemoStore.prototype.archiveGoal = async function (id, archived = true) {
  const goal = (await this.goals()).find((g) => g.id === id);
  if (!goal) throw Error('Savings goal not found.');
  return this.saveGoal({ ...goal, archived_at: archived ? new Date().toISOString() : null }, id);
};
DemoStore.prototype.deleteGoal = async function (id) {
  const goal = (await this.goals()).find((g) => g.id === id);
  if (!goal) throw Error('Savings goal not found.');
  const all = await this.all();
  const used = all.filter((t) => t.goal_id === id).length;
  if (used) throw Error(`This goal is linked to ${used} savings entries. Delete was refused so history stays intact — archive it instead.`);
  await this.commitV7((data) => { data.goals = (data.goals || []).filter((g) => g.id !== id); return data; });
  return goal.name;
};
DemoStore.prototype.taxonomySeeded = async function () {
  return { seeded: !!this.storage.getItem(DEMO_TAXONOMY_KEY), at: this.storage.getItem(DEMO_TAXONOMY_KEY) || null, supported: true };
};
DemoStore.prototype.seedTaxonomy = async function () {
  const st = await this.taxonomySeeded();
  if (st.seeded) return { categories: 0, account: false, skipped: true };
  const rows = await this.categories();
  const missing = TAXONOMY_ROWS.filter((r) => !rows.some((c) => c.name.toLowerCase() === r.name.toLowerCase() && c.kind === r.kind));
  if (missing.length) {
    const p = await this.planning();
    p.categories = [...(p.categories || []), ...missing.map((r) => ({
      name: r.name, kind: r.kind, group_name: r.group_name, enabled: true,
      icon: r.icon, color: r.color, sort_order: r.sort_order, archived_at: null, is_default: true, renamed_from: null,
    }))];
    this.storage.setItem('kantong.demo.planning.v3', JSON.stringify(p));
  }
  const accounts = await this.accounts();
  let account = false;
  if (!accounts.some((a) => String(a.name).trim().toLowerCase() === DEFAULT_SEED_ACCOUNT.name.toLowerCase())) {
    await this.saveAccount({ name: DEFAULT_SEED_ACCOUNT.name, type: DEFAULT_SEED_ACCOUNT.type, opening_balance: 0 }, null);
    account = true;
  }
  this.storage.setItem(DEMO_TAXONOMY_KEY, new Date().toISOString());
  return { categories: missing.length, account, skipped: false };
};

CloudStore.prototype.goals = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/savings_goals?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=created_at.asc`);
  if (!Array.isArray(data)) throw Error('Invalid savings goal list.');
  return data.map(lenientGoal).filter((g) => g.name);
};
CloudStore.prototype.saveGoal = async function (raw, id = null) {
  const clean = validateGoal(raw);
  await this.ready();
  const owner = this.session.user.id;
  const body = {
    user_id: owner,
    name: clean.name,
    target_amount: clean.target_amount.toString(),
    saved_amount: clean.saved_amount.toString(),
    deadline: clean.deadline,
    account_id: clean.account_id,
    category: clean.category,
    color: clean.color,
    icon: clean.icon,
    archived_at: clean.archived_at,
  };
  const q = id ? `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}` : '';
  const data = await this.request('/rest/v1/savings_goals' + q, {
    method: id ? 'PATCH' : 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!Array.isArray(data) || data.length !== 1) throw Error('The savings goal could not be saved.');
  return lenientGoal(data[0]);
};
CloudStore.prototype.archiveGoal = async function (id, archived = true) {
  const goal = (await this.goals()).find((g) => g.id === id);
  if (!goal) throw Error('Savings goal not found.');
  return this.saveGoal({ ...goal, archived_at: archived ? new Date().toISOString() : null }, id);
};
CloudStore.prototype.deleteGoal = async function (id) {
  await this.ready();
  const owner = this.session.user.id;
  const used = await this.request(`/rest/v1/transactions?select=id&user_id=eq.${encodeURIComponent(owner)}&goal_id=eq.${encodeURIComponent(id)}&limit=1000`);
  if (Array.isArray(used) && used.length) throw Error(`This goal is linked to ${used.length} savings entries. Delete was refused so history stays intact — archive it instead.`);
  const data = await this.request(`/rest/v1/savings_goals?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}`, {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Savings goal not found or not allowed.');
  return data[0].name;
};
CloudStore.prototype.taxonomySeeded = async function () {
  await this.ready();
  try {
    const data = await this.request(`/rest/v1/app_settings?select=taxonomy_seeded,taxonomy_seeded_at&user_id=eq.${encodeURIComponent(this.session.user.id)}`);
    if (!Array.isArray(data) || !data.length) return { seeded: false, at: null, supported: true };
    return { seeded: data[0].taxonomy_seeded === true, at: data[0].taxonomy_seeded_at || null, supported: true };
  } catch {
    return { seeded: false, at: null, supported: false };
  }
};
CloudStore.prototype.seedTaxonomy = async function () {
  const st = await this.taxonomySeeded();
  if (!st.supported) throw Error('Migration v7 has not run: the categories.kind column is missing. Run kantong-v7-migration.sql once, then reload.');
  if (st.seeded) return { categories: 0, account: false, skipped: true };
  await this.ready();
  const owner = this.session.user.id;
  const have = await this.categories();
  const missing = TAXONOMY_ROWS.filter((r) => !have.some((c) => c.name.toLowerCase() === r.name.toLowerCase() && c.kind === r.kind));
  let added = 0;
  if (missing.length) {
    let data;
    try {
      data = await this.request('/rest/v1/expense_categories?on_conflict=user_id,kind,name', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(missing.map((r) => ({
          user_id: owner, name: r.name, kind: r.kind, group_name: r.group_name, enabled: true,
          icon: r.icon, color: r.color, sort_order: r.sort_order, archived_at: null, is_default: true, renamed_from: null,
        }))),
      });
    } catch (e) {
      throw Error(migrationHint(e));
    }
    if (!Array.isArray(data)) throw Error('The default categories could not be saved.');
    added = data.length;
  }
  const accounts = await this.accounts();
  let account = false;
  if (!accounts.some((a) => String(a.name).trim().toLowerCase() === DEFAULT_SEED_ACCOUNT.name.toLowerCase())) {
    await this.saveAccount({ name: DEFAULT_SEED_ACCOUNT.name, type: DEFAULT_SEED_ACCOUNT.type, opening_balance: 0 }, null);
    account = true;
  }
  const at = new Date().toISOString();
  const mark = await this.request('/rest/v1/app_settings?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: owner, taxonomy_seeded: true, taxonomy_seeded_at: at }),
  });
  if (!Array.isArray(mark) || !mark.length) throw Error('Could not save the taxonomy marker.');
  return { categories: added, account, skipped: false };
};

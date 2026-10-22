import {validate,categoryName,budgetAmount,monthBounds} from './core.js';
export class DemoStore{
 constructor(storage=globalThis.localStorage){this.storage=storage;this.key='kantong.demo.v1';}
 async all(){const rows=JSON.parse(this.storage.getItem(this.key)||'[]');if(!Array.isArray(rows))throw Error('Data demo rusak. Hapus penyimpanan situs setelah mencadangkan.');return rows.sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));}
 async save(raw,id){const t=validate(raw);const rows=await this.all();if(id){const i=rows.findIndex(r=>r.id===id);if(i<0)throw Error('Transaksi tidak ditemukan.');rows[i]={...t,id};}else{t.id=crypto.randomUUID();rows.push(t);}this.storage.setItem(this.key,JSON.stringify(rows));return id?{...t,id}:t;}
 async remove(id){const rows=await this.all();this.storage.setItem(this.key,JSON.stringify(rows.filter(r=>r.id!==id)));}
}

export class CloudStore{
 constructor(config,fetcher=globalThis.fetch.bind(globalThis),storage=globalThis.localStorage){this.url=config.url.replace(/\/$/,'');this.key=config.anonKey;this.fetcher=fetcher;this.storage=storage;this.sessionKey='kantong.session.'+this.url;this.session=null;this.refreshing=null;try{this.session=JSON.parse(storage?.getItem(this.sessionKey)||'null');}catch{storage?.removeItem(this.sessionKey);}}
 remember(data){this.session={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:data.expires_at||Math.floor(Date.now()/1000)+data.expires_in,user:data.user};this.storage?.setItem(this.sessionKey,JSON.stringify(this.session));}
 async signIn(email,password){const data=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})},false);this.remember(data);}
 async ready(){if(!this.session?.access_token)throw Error('Silakan masuk terlebih dahulu.');if(this.session.expires_at> Date.now()/1000+60)return;if(!this.refreshing)this.refreshing=this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:this.session.refresh_token})},false).then(d=>this.remember(d)).finally(()=>{this.refreshing=null;});await this.refreshing;}
 async signOut(){try{await this.ready();await this.request('/auth/v1/logout',{method:'POST'});}finally{this.session=null;this.storage?.removeItem(this.sessionKey);}}
 async all(){await this.ready();let rows=[],offset=0;for(;;){const page=await this.request(`/rest/v1/transactions?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=date.desc,id.desc&limit=1000&offset=${offset}`);if(!Array.isArray(page))throw Error('Respons data tidak valid.');if(!page.length)return rows;rows.push(...page);offset+=page.length;}}
 async save(raw,id){const t=validate(raw);await this.ready();const data=await this.request('/rest/v1/transactions'+(id?`?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(this.session.user.id)}`:''),{method:id?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({...Object.fromEntries(Object.entries(t).filter(([k,v])=>!(k==='account_id'&&v===null))),user_id:this.session.user.id})});if(!Array.isArray(data)||data.length!==1)throw Error('Transaksi tidak ditemukan atau tidak diizinkan.');return data[0];}
 async remove(id){await this.ready();const data=await this.request(`/rest/v1/transactions?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(this.session.user.id)}`,{method:'DELETE',headers:{Prefer:'return=representation'}});if(!Array.isArray(data)||data.length!==1)throw Error('Transaksi tidak ditemukan atau tidak diizinkan.');}
 async request(path,options={},authenticated=true){let response;try{response=await this.fetcher(this.url+path,{...options,headers:{apikey:this.key,...(authenticated?{Authorization:`Bearer ${this.session?.access_token}`}:{}),'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(20000)});}catch{throw Error('Jaringan tidak tersedia atau waktu habis. Coba lagi; periksa daftar sebelum mengulang simpan.');}const data=response.status===204?null:await response.json();if(!response.ok)throw Error(data?.message||data?.error_description||data?.msg||'Permintaan gagal.');return data;}
}
// Planning metadata has a separate demo key; never used as a cloud fallback.
DemoStore.prototype.planning=async function(){return JSON.parse(this.storage.getItem('kantong.demo.planning.v3')||'{"categories":[],"budgets":[],"scenarios":[]}');};
DemoStore.prototype.putPlanning=async function(table,row,keys,remove=false){const p=await this.planning();p[table]=p[table].filter(x=>!keys.every(k=>x[k]===row[k]));if(!remove)p[table].push(row);this.storage.setItem('kantong.demo.planning.v3',JSON.stringify(p));return row;};
CloudStore.prototype.planning=async function(){await this.ready();const entries=await Promise.all([['categories','expense_categories','name'],['budgets','monthly_budgets','month,category'],['scenarios','improvement_scenarios','month']].map(async([key,table,order])=>{const rows=[];let offset=0;for(;;){const page=await this.request(`/rest/v1/${table}?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=${order}&limit=1000&offset=${offset}`);if(!Array.isArray(page))throw Error('Data perencanaan tidak valid.');if(!page.length)break;rows.push(...page);offset+=page.length;}return [key,rows];}));return Object.fromEntries(entries);};
CloudStore.prototype.putPlanning=async function(table,row,keys,remove=false){await this.ready();const db={categories:'expense_categories',budgets:'monthly_budgets',scenarios:'improvement_scenarios'}[table];const owner=this.session.user.id;const filter=['user_id',...keys].map(k=>`${k}=eq.${encodeURIComponent(k==='user_id'?owner:row[k])}`).join('&');
 const data=await this.request(`/rest/v1/${db}?${remove?filter:'on_conflict='+['user_id',...keys].join(',')}`,{method:remove?'DELETE':'POST',headers:{Prefer:remove?'return=representation':'resolution=merge-duplicates,return=representation'},...(!remove?{body:JSON.stringify({...row,user_id:owner})}:{})});
 if(!Array.isArray(data)||(!remove&&data.length!==1))throw Error('Perencanaan gagal disimpan.');
 // Explicit readback verifies the exact metadata target after a write.
 const check=await this.request(`/rest/v1/${db}?select=*&${filter}`);if(!Array.isArray(check)||(remove?check.length!==0:check.length!==1))throw Error('Simpan belum dapat diverifikasi. Muat ulang sebelum mengulang.');return remove?row:check[0];};
for(const Store of [DemoStore,CloudStore]){
 Store.prototype.setCategory=async function(name,enabled=true){return this.putPlanning('categories',{name:categoryName(name),enabled:!!enabled},['name']);};
 Store.prototype.setBudget=async function(month,category,raw){monthBounds(month);const amount=budgetAmount(raw);return this.putPlanning('budgets',{month,category:categoryName(category),...(amount===null?{}:{amount})},['month','category'],amount===null);};
 Store.prototype.setScenario=async function(month,income,proposed){monthBounds(month);const raw=String(income);if(!/^\d{1,100}$/.test(raw)||!proposed||Array.isArray(proposed)||typeof proposed!=='object')throw Error('Simulasi tidak valid.');const clean=Object.fromEntries(Object.entries(proposed).map(([k,v])=>{const n=budgetAmount(v);if(n===null)throw Error('Usulan wajib diisi.');return [categoryName(k),String(n)];}));return this.putPlanning('scenarios',{month,income:raw,proposed:clean},['month']);};
}



/* ============================================================
   Kantong v4 — pengaturan, jadwal pemasukan rutin, penanda posting.
   Data demo memakai kunci terpisah dari cloud; tidak ada fallback diam-diam.
   ============================================================ */
export { autoPost } from './core.js';
import { normalizeSettings, validateSchedule, openingAmount, avatarDataError, validateAccount, validateTransfer, validateHolding, valuationPlan, validateActivity, latestValuation } from './core.js';

const DEMO_V4 = 'kantong.demo.v4';
const emptyV4 = () => ({ settings: { onboarding_completed: false, onboarding_skipped: false, opening_balance: 0, opening_balance_date: null }, schedules: [], postings: [], accounts: [], transfers: [], holdings: [], valuations: [], activity: [] });
const V4_ARRAYS = ['schedules', 'postings', 'accounts', 'transfers', 'holdings', 'valuations', 'activity'];
const validDate = (d) => { if (d === null) return null; const s = String(d); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T12:00:00Z')) || new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) !== s) throw Error('Tanggal saldo awal tidak valid.'); return s; };

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
    if (merged.avatar_kind === 'photo' && merged.avatar_data && !clean.avatar_data) throw Error('Data foto tidak valid atau melebihi 100 KB.');
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
      if (i < 0) throw Error('Jadwal tidak ditemukan.');
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
    if (!data.schedules.some((x) => x.id === id)) throw Error('Jadwal tidak ditemukan.');
    data.schedules = data.schedules.filter((x) => x.id !== id);
    data.postings = data.postings.filter((p) => p.schedule_id !== id);
  });
};
DemoStore.prototype.setScheduleActive = async function (id, active, resumeMonth) {
  const row = (await this.schedules()).find((x) => x.id === id);
  if (!row) throw Error('Jadwal tidak ditemukan.');
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
    if (!row) throw Error('Penanda pencatatan otomatis tidak ditemukan.');
    row.transaction_id = transaction_id; row.status = 'posted';
  });
};
DemoStore.prototype.releasePosting = async function (schedule_id, month) {
  await this.commitV4((data) => { data.postings = data.postings.filter((p) => !(p.schedule_id === schedule_id && p.month === month && p.status === 'posted')); });
};
DemoStore.prototype.dismissPosting = async function (schedule_id, month) {
  await this.commitV4((data) => {
    const row = data.postings.find((p) => p.schedule_id === schedule_id && p.month === month);
    if (!row) throw Error('Penanda pencatatan otomatis tidak ditemukan.');
    row.status = 'dismissed'; row.transaction_id = null;
  });
};
DemoStore.prototype.restorePosting = async function (schedule_id, month, transaction_id) {
  await this.commitV4((data) => {
    const row = data.postings.find((p) => p.schedule_id === schedule_id && p.month === month);
    if (!row) throw Error('Penanda pencatatan otomatis tidak ditemukan.');
    row.status = 'posted'; row.transaction_id = transaction_id ?? row.transaction_id;
  });
};

const OWNER_KEYS = (owner, row) => ['user_id', 'schedule_id', 'month'].map((k) => `${k}=eq.${encodeURIComponent(k === 'user_id' ? owner : row[k])}`).join('&');

CloudStore.prototype.settings = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/app_settings?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}`);
  if (!Array.isArray(data)) throw Error('Pengaturan tidak valid.');
  if (data.length > 1) throw Error('Pengaturan ganda terdeteksi. Periksa database.');
  return normalizeSettings(data[0] || null);
};
CloudStore.prototype.saveSettings = async function (patch = {}) {
  if (patch.avatar_kind === 'photo' && patch.avatar_data) avatarDataError(patch.avatar_data);
  await this.ready();
  const current = await this.settings();
  const merged = normalizeSettings({ ...current, ...patch });
  if (patch.avatar_kind === 'photo' && patch.avatar_data && !merged.avatar_data) throw Error('Data foto tidak valid atau melebihi 100 KB.');
  const owner = this.session.user.id;
  const body = { user_id: owner, onboarding_completed: merged.onboarding_completed, onboarding_skipped: merged.onboarding_skipped, opening_balance: merged.opening_balance, opening_balance_date: merged.opening_balance_date, display_name: merged.display_name, avatar_color: merged.avatar_color, avatar_kind: merged.avatar_kind, avatar_data: merged.avatar_data, theme: merged.theme, pattern: merged.pattern };
  const data = await this.request('/rest/v1/app_settings?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Pengaturan gagal disimpan.');
  const check = await this.request(`/rest/v1/app_settings?select=*&user_id=eq.${encodeURIComponent(owner)}`);
  if (!Array.isArray(check) || check.length !== 1) throw Error('Simpan pengaturan belum dapat diverifikasi. Muat ulang sebelum mengulang.');
  return normalizeSettings(check[0]);
};
CloudStore.prototype.schedules = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/income_schedules?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=created_at.asc`);
  if (!Array.isArray(data)) throw Error('Jadwal pemasukan tidak valid.');
  return data;
};
CloudStore.prototype.saveSchedule = async function (raw, id) {
  const clean = validateSchedule(raw);
  await this.ready();
  const owner = this.session.user.id;
  const body = { ...clean, user_id: owner };
  const data = await this.request('/rest/v1/income_schedules' + (id ? `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}` : ''), { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Jadwal tidak ditemukan atau tidak diizinkan.');
  return data[0];
};
CloudStore.prototype.deleteSchedule = async function (id) {
  await this.ready();
  const data = await this.request(`/rest/v1/income_schedules?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(this.session.user.id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Jadwal tidak ditemukan atau tidak diizinkan.');
};
CloudStore.prototype.setScheduleActive = async function (id, active, resumeMonth) {
  const row = (await this.schedules()).find((x) => x.id === id);
  if (!row) throw Error('Jadwal tidak ditemukan.');
  return this.saveSchedule({ ...row, active: !!active, resume_month: active && !row.active ? (resumeMonth || new Date().toISOString().slice(0, 7)) : row.resume_month }, id);
};
CloudStore.prototype.postings = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/income_postings?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=month.asc`);
  if (!Array.isArray(data)) throw Error('Penanda pencatatan otomatis tidak valid.');
  return data;
};
CloudStore.prototype.claimPosting = async function ({ schedule_id, month, amount }) {
  await this.ready();
  const data = await this.request('/rest/v1/income_postings?on_conflict=user_id,schedule_id,month', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ user_id: this.session.user.id, schedule_id, month, amount: amount ?? null, status: 'posted' }) });
  if (!Array.isArray(data)) throw Error('Klaim pencatatan otomatis gagal.');
  return data.length === 1 ? { claimed: true, posting: data[0] } : { claimed: false };
};
CloudStore.prototype.linkPosting = async function (schedule_id, month, transaction_id) {
  await this.ready();
  const filter = OWNER_KEYS(this.session.user.id, { schedule_id, month });
  const data = await this.request(`/rest/v1/income_postings?${filter}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ transaction_id, status: 'posted' }) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Tautan pencatatan otomatis gagal disimpan.');
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
  if (!Array.isArray(data) || data.length !== 1) throw Error('Catatan otomatis tidak dapat ditandai lunas; transaksi tidak dihapus.');
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
      if (i < 0) throw Error('Akun tidak ditemukan.');
      data.accounts[i] = { ...data.accounts[i], ...clean, id };
      row = data.accounts[i];
      this.logActivity(data, 'edited', 'account', `Akun ${clean.name} diubah`);
    } else {
      row = { ...clean, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      data.accounts.push(row);
      this.logActivity(data, 'created', 'account', `Akun ${clean.name} dibuat`);
    }
  });
  return { ...row };
};
DemoStore.prototype.archiveAccount = async function (id, archived = true) {
  const row = (await this.accounts()).find((a) => a.id === id);
  if (!row) throw Error('Akun tidak ditemukan.');
  const saved = await this.saveAccount({ ...row, is_archived: archived }, id);
  await this.commitV4((data) => { this.logActivity(data, 'edited', 'account', archived ? `Akun ${row.name} diarsipkan` : `Akun ${row.name} diaktifkan kembali`); });
  return saved;
};
DemoStore.prototype.transfers = async function () { return (await this.v4()).transfers.map((t) => ({ ...t })); };
DemoStore.prototype.saveTransfer = async function (raw, id) {
  const clean = validateTransfer(raw);
  let row;
  await this.commitV4((data) => {
    if (id) {
      const i = data.transfers.findIndex((x) => x.id === id);
      if (i < 0) throw Error('Pindah dana tidak ditemukan.');
      data.transfers[i] = { ...data.transfers[i], ...clean, id };
      row = data.transfers[i];
      this.logActivity(data, 'edited', 'transfer', `Pindah dana ${clean.amount} diubah`);
    } else {
      row = { ...clean, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      data.transfers.push(row);
      this.logActivity(data, 'created', 'transfer', `Pindah dana ${clean.amount} dicatat`);
    }
  });
  return { ...row };
};
DemoStore.prototype.deleteTransfer = async function (id) {
  await this.commitV4((data) => {
    const row = data.transfers.find((x) => x.id === id);
    if (!row) throw Error('Pindah dana tidak ditemukan.');
    data.transfers = data.transfers.filter((x) => x.id !== id);
    this.logActivity(data, 'deleted', 'transfer', `Pindah dana ${row.amount} dihapus`);
  });
};
DemoStore.prototype.holdings = async function () { return (await this.v4()).holdings.map((h) => ({ ...h })); };
DemoStore.prototype.saveHolding = async function (raw, id) {
  const clean = validateHolding(raw);
  let row;
  await this.commitV4((data) => {
    if (id) {
      const i = data.holdings.findIndex((x) => x.id === id);
      if (i < 0) throw Error('Aset tidak ditemukan.');
      data.holdings[i] = { ...data.holdings[i], ...clean, id, updated_at: new Date().toISOString() };
      row = data.holdings[i];
      this.logActivity(data, 'edited', 'holding', `Aset ${clean.asset_name} diubah`);
    } else {
      row = { ...clean, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      data.holdings.push(row);
      this.logActivity(data, 'created', 'holding', `Aset ${clean.asset_name} ditambahkan`);
    }
  });
  return { ...row };
};
DemoStore.prototype.deleteHolding = async function (id) {
  await this.commitV4((data) => {
    const row = data.holdings.find((x) => x.id === id);
    if (!row) throw Error('Aset tidak ditemukan.');
    data.holdings = data.holdings.filter((x) => x.id !== id);
    this.logActivity(data, 'deleted', 'holding', `Aset ${row.asset_name} dihapus`);
  });
};
DemoStore.prototype.valuations = async function () { return (await this.v4()).valuations.map((v) => ({ ...v })); };
DemoStore.prototype.saveValuation = async function (accountId, raw, note = '', date = '') {
  let row;
  await this.commitV4((data) => {
    const account = data.accounts.find((a) => a.id === accountId);
    if (!account) throw Error('Akun tidak ditemukan.');
    const [clean] = valuationPlan([{ account_id: accountId, value: raw, note, date }]);
    row = { ...clean, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    data.valuations.push(row);
    account.current_value = clean.value;
    this.logActivity(data, 'created', 'valuation', `Nilai ${account.name} diperbarui`);
  });
  return { ...row };
};
DemoStore.prototype.saveValuations = async function (items) {
  const plan = valuationPlan(items); // seluruh baris divalidasi sebelum menulis
  let saved = [];
  await this.commitV4((data) => {
    saved = plan.map((item) => {
      const account = data.accounts.find((a) => a.id === item.account_id);
      if (!account) throw Error('Akun tidak ditemukan.');
      const row = { ...item, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      data.valuations.push(row);
      account.current_value = item.value;
      this.logActivity(data, 'created', 'valuation', `Nilai ${account.name} diperbarui`);
      return row;
    });
  });
  return { saved: saved.map((r) => ({ ...r })), errors: [] };
};
DemoStore.prototype.deleteValuation = async function (id) {
  await this.commitV4((data) => {
    const row = data.valuations.find((v) => v.id === id);
    if (!row) throw Error('Catatan nilai tidak ditemukan.');
    data.valuations = data.valuations.filter((v) => v.id !== id);
    const account = data.accounts.find((a) => a.id === row.account_id);
    if (account) {
      const latest = latestValuation(data.valuations, row.account_id);
      account.current_value = latest ? Number(latest.value) : null;
    }
    this.logActivity(data, 'deleted', 'valuation', `Catatan nilai ${row.date} dihapus`);
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
  if (!Array.isArray(data)) throw Error('Daftar akun tidak valid.');
  return data;
};
CloudStore.prototype.saveAccount = async function (raw, id) {
  const clean = validateAccount(raw);
  await this.ready();
  const owner = this.session.user.id;
  const data = await this.request('/rest/v1/accounts' + (id ? `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}` : ''), { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...clean, user_id: owner }) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Akun tidak ditemukan atau tidak diizinkan.');
  await this.logActivity(id ? 'edited' : 'created', 'account', `Akun ${clean.name} ${id ? 'diubah' : 'dibuat'}`);
  return data[0];
};
CloudStore.prototype.archiveAccount = async function (id, archived = true) {
  const row = (await this.accounts()).find((a) => a.id === id);
  if (!row) throw Error('Akun tidak ditemukan.');
  const saved = await this.saveAccount({ ...row, is_archived: archived }, id);
  await this.logActivity('edited', 'account', archived ? `Akun ${row.name} diarsipkan` : `Akun ${row.name} diaktifkan kembali`);
  return saved;
};
CloudStore.prototype.transfers = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/transfers?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=date.desc`);
  if (!Array.isArray(data)) throw Error('Daftar pindah dana tidak valid.');
  return data;
};
CloudStore.prototype.saveTransfer = async function (raw, id) {
  const clean = validateTransfer(raw);
  await this.ready();
  const owner = this.session.user.id;
  const data = await this.request('/rest/v1/transfers' + (id ? `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}` : ''), { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...clean, user_id: owner }) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Pindah dana gagal disimpan.');
  await this.logActivity(id ? 'edited' : 'created', 'transfer', `Pindah dana ${clean.amount} ${id ? 'diubah' : 'dicatat'}`);
  return data[0];
};
CloudStore.prototype.deleteTransfer = async function (id) {
  await this.ready();
  const data = await this.request(`/rest/v1/transfers?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(this.session.user.id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Pindah dana tidak ditemukan atau tidak diizinkan.');
  await this.logActivity('deleted', 'transfer', 'Pindah dana dihapus');
};
CloudStore.prototype.holdings = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/investment_holdings?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=created_at.asc`);
  if (!Array.isArray(data)) throw Error('Daftar aset tidak valid.');
  return data;
};
CloudStore.prototype.saveHolding = async function (raw, id) {
  const clean = validateHolding(raw);
  await this.ready();
  const owner = this.session.user.id;
  const data = await this.request('/rest/v1/investment_holdings' + (id ? `?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}` : ''), { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...clean, user_id: owner }) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Aset gagal disimpan.');
  await this.logActivity(id ? 'edited' : 'created', 'holding', `Aset ${clean.asset_name} ${id ? 'diubah' : 'ditambahkan'}`);
  return data[0];
};
CloudStore.prototype.deleteHolding = async function (id) {
  await this.ready();
  const data = await this.request(`/rest/v1/investment_holdings?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(this.session.user.id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Aset tidak ditemukan atau tidak diizinkan.');
  await this.logActivity('deleted', 'holding', 'Aset dihapus');
};
CloudStore.prototype.valuations = async function () {
  await this.ready();
  const data = await this.request(`/rest/v1/account_valuations?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=date.asc`);
  if (!Array.isArray(data)) throw Error('Riwayat nilai tidak valid.');
  return data;
};
CloudStore.prototype.saveValuation = async function (accountId, raw, note = '', date = '') {
  await this.ready();
  const owner = this.session.user.id;
  const [clean] = valuationPlan([{ account_id: accountId, value: raw, note, date }]);
  const data = await this.request('/rest/v1/account_valuations', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...clean, user_id: owner }) });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Nilai akun gagal disimpan.');
  const patch = await this.request(`/rest/v1/accounts?id=eq.${encodeURIComponent(accountId)}&user_id=eq.${encodeURIComponent(owner)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ current_value: clean.value }) });
  if (!Array.isArray(patch) || patch.length !== 1) throw Error('Nilai tersimpan tetapi nilai kini akun gagal diperbarui. Muat ulang untuk melihat keadaan sebenarnya.');
  await this.logActivity('created', 'valuation', 'Nilai akun diperbarui');
  return data[0];
};
CloudStore.prototype.saveValuations = async function (items) {
  const plan = valuationPlan(items);
  const saved = [], errors = [];
  for (const item of plan) {
    try { saved.push(await this.saveValuation(item.account_id, item.value, item.note, item.date)); }
    catch (e) { errors.push({ account_id: item.account_id, message: e?.message || 'Gagal menyimpan nilai.' }); }
  }
  return { saved, errors };
};
CloudStore.prototype.deleteValuation = async function (id) {
  await this.ready();
  const owner = this.session.user.id;
  const data = await this.request(`/rest/v1/account_valuations?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(owner)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!Array.isArray(data) || data.length !== 1) throw Error('Catatan nilai tidak ditemukan atau tidak diizinkan.');
  const accountId = data[0].account_id;
  const all = await this.valuations();
  const latest = latestValuation(all, accountId);
  await this.request(`/rest/v1/accounts?id=eq.${encodeURIComponent(accountId)}&user_id=eq.${encodeURIComponent(owner)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ current_value: latest ? Number(latest.value) : null }) });
  await this.logActivity('deleted', 'valuation', `Catatan nilai ${data[0].date} dihapus`);
};
CloudStore.prototype.activity = async function (limit = 50) {
  await this.ready();
  const n = Math.max(1, Math.min(50, Number(limit) || 50));
  const data = await this.request(`/rest/v1/app_activity?select=*&user_id=eq.${encodeURIComponent(this.session.user.id)}&order=created_at.desc&limit=${n}`);
  if (!Array.isArray(data)) throw Error('Riwayat aktivitas tidak valid.');
  return data;
};

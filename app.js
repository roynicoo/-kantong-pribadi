import {CATEGORIES,localDate,recap,idr,escapeHTML as esc,validate,toCSV,backup} from './core.js';
import {CloudStore,DemoStore} from './store.js';
const $=id=>document.getElementById(id);
let store=null,cloud=null,all=[],editing=null,busy=false,loaded=false,lastSync='';
const config=window.KANTONG_CONFIG||{};
function message(text,error=false){$('notice').textContent=text;$('notice').className=error?'error':'';$('notice').hidden=!text;}
function setBusy(value){busy=value;$('entry-fields').disabled=value||!loaded;for(const id of ['refresh','print','csv','json','logout','month'])$(id).disabled=value||(!loaded&&['print','csv','json'].includes(id));document.querySelectorAll('[data-edit],[data-delete]').forEach(b=>b.disabled=value);}
function categoryOptions(){const select=$('category');select.replaceChildren(...CATEGORIES[$('type').value].map(c=>new Option(c,c)));}
function reset(){editing=null;$('entry').reset();$('date').value=localDate();categoryOptions();$('save').textContent='Simpan transaksi';$('form-title').textContent='Catat transaksi';$('cancel').hidden=true;}
function render(){const r=recap(all,$('month').value);$('balance').textContent=idr(r.balance);$('income').textContent=idr(r.income);$('expense').textContent=idr(r.expense);$('count').textContent=r.rows.length;$('empty').hidden=r.rows.length>0;
 $('period-label').textContent=new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric'}).format(new Date($('month').value+'-15T12:00:00'));
 $('rows').innerHTML=r.rows.map(t=>`<tr><td><strong>${esc(t.date.split('-').reverse().join('/'))}</strong><p class="transaction-note">${esc(t.notes||'Tanpa catatan')}</p></td><td><span class="badge">${esc(t.category)}</span></td><td class="number amount-${t.type==='income'?'income':'expense'}">${t.type==='income'?'+':'−'} ${esc(idr(t.amount))}</td><td class="actions"><div class="row-actions"><button type="button" aria-label="Ubah transaksi" title="Ubah transaksi" data-edit="${esc(t.id)}">✎</button><button type="button" aria-label="Hapus transaksi" title="Hapus transaksi" data-delete="${esc(t.id)}">×</button></div></td></tr>`).join('');
 const cats=Object.entries(r.categories).sort((a,b)=>a[1]>b[1]?-1:a[1]<b[1]?1:0);$('categories').innerHTML=cats.length?cats.map(([c,n])=>`<div><div class="category-line"><span>${esc(c)}</span><strong>${esc(idr(n))}</strong></div><div class="track"><span style="width:${Number(n*10000n/r.expense)/100}%"></span></div></div>`).join(''):'<p class="category-empty">Belum ada pengeluaran di bulan ini.</p>';
}
function syncLabel(){return store instanceof DemoStore?'Demo lokal · tidak tersinkron':`Cloud Supabase · dimuat ${lastSync}. Muat ulang untuk pembaruan perangkat lain.`;}
async function load(){loaded=false;$('sync').textContent='Memuat seluruh transaksi…';setBusy(true);try{const rows=await store.all();all=rows;lastSync=new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});loaded=true;render();$('sync').textContent=syncLabel();}catch(e){$('sync').textContent='Data belum berhasil dimuat · laporan dan perubahan dinonaktifkan.';message(e.message,true);}finally{setBusy(false);}}
async function enter(next){store=next;all=[];loaded=false;$('gate').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('identity').textContent=store instanceof DemoStore?'Mode demo lokal':cloud.session.user.email||'Akun pribadi';$('month').value=localDate().slice(0,7);reset();message('');await load();}
$('type').addEventListener('change',categoryOptions);$('cancel').addEventListener('click',reset);
$('month').addEventListener('change',()=>{try{render();}catch{message('Pilih bulan yang valid.',true);}});
$('demo').addEventListener('click',()=>{try{enter(new DemoStore());}catch(e){message(e.message,true);}});
$('refresh').addEventListener('click',()=>{if(!busy){message('');load();}});
$('entry').addEventListener('submit',async e=>{e.preventDefault();if(busy||!loaded)return;let t;try{t=validate(Object.fromEntries(new FormData($('entry'))));}catch(error){message(error.message,true);return;}setBusy(true);message('Menyimpan transaksi…');try{await store.save(t,editing);const date=t.date;reset();$('month').value=date.slice(0,7);await load();if(loaded)message('Transaksi tersimpan.');}catch(error){message(error.message,true);}finally{setBusy(false);}});
$('rows').addEventListener('click',async e=>{if(busy||!loaded)return;const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit){const t=all.find(r=>r.id===edit.dataset.edit);if(!t)return;editing=t.id;$('type').value=t.type;categoryOptions();for(const key of ['amount','date','category','notes'])$(key).value=t[key]||'';$('save').textContent='Simpan perubahan';$('form-title').textContent='Ubah transaksi';$('cancel').hidden=false;$('amount').focus();return;}if(del&&confirm('Hapus transaksi ini? Tindakan ini tidak dapat dibatalkan.')){setBusy(true);try{await store.remove(del.dataset.delete);if(editing===del.dataset.delete)reset();await load();if(loaded)message('Transaksi dihapus.');}catch(error){message(error.message,true);}finally{setBusy(false);}}});
$('logout').addEventListener('click',async()=>{if(busy)return;setBusy(true);let warning='';if(store===cloud){try{await cloud.signOut();}catch{warning='Sesi lokal dihapus. Logout server gagal; sesi di perangkat lain mungkin masih aktif.';}}store=null;all=[];loaded=false;editing=null;render();$('workspace').hidden=true;$('gate').hidden=false;$('logout').hidden=true;$('identity').textContent='';$('password').value='';setBusy(false);message(warning,!!warning);});
$('login').addEventListener('submit',async e=>{e.preventDefault();const button=$('login').querySelector('button');if(button.disabled)return;button.disabled=true;message('Sedang masuk…');try{await cloud.signIn($('email').value.trim(),$('password').value);$('password').value='';await enter(cloud);}catch(error){$('password').value='';message(error.message,true);}finally{button.disabled=false;}});
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('csv').addEventListener('click',()=>{if(loaded&&!busy)download(toCSV(recap(all,$('month').value).rows),`kantong-${$('month').value}.csv`,'text/csv;charset=utf-8');});
$('json').addEventListener('click',()=>{if(loaded&&!busy)download(backup(all),`kantong-backup-${localDate()}.json`,'application/json');});
$('print').addEventListener('click',()=>{if(loaded&&!busy)window.print();});
window.addEventListener('storage',e=>{if(cloud&&e.key===cloud.sessionKey&&store===cloud){all=[];loaded=false;render();$('sync').textContent='Sesi berubah di tab lain. Muat ulang halaman sebelum melanjutkan.';setBusy(false);}});
categoryOptions();$('date').value=localDate();
async function initialize(){
 try{
  if(!config.url||!config.anonKey){$('setup').textContent='Cloud belum dikonfigurasi.';return;}
  const u=new URL(config.url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('URL Supabase harus berupa origin HTTPS.');
  if(config.anonKey.startsWith('sb_secret_'))throw Error('Gunakan anon / publishable key, bukan secret key.');
  if(config.anonKey.split('.').length===3){try{const payload=JSON.parse(atob(config.anonKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role!=='anon')throw Error('role');}catch{throw Error('Kunci harus anon publik, bukan service_role.');}}
  $('setup').textContent='Memeriksa kesiapan database…';
  const response=await fetch(u.origin+'/rest/v1/transactions?select=id&limit=0',{headers:{apikey:config.anonKey},signal:AbortSignal.timeout(10000)});
  if(!response.ok){const data=await response.json();if(data.code==='PGRST205'){$('setup').textContent='Database belum disiapkan. Jalankan supabase/schema.sql melalui SQL Editor pemilik proyek.';return;}if(data.code!=='42501')throw Error(data.message||'Koneksi proyek belum siap.');}
  cloud=new CloudStore(config);$('setup').textContent='Masuk untuk mengakses catatan pribadi lintas perangkat.';$('login').hidden=false;
  if(!store&&cloud.session?.access_token)await enter(cloud);
 }catch(error){$('setup').textContent='Konfigurasi belum tersedia: '+error.message;}
}
initialize();

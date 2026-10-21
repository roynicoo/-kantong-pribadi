export const CATEGORIES={income:['Gaji','Usaha','Hadiah','Lainnya'],expense:['Makan','Laundry','Kosan','Transport','Listrik','Internet','Rokok','Andreas','Ortu','UKT','ETC','Transportasi','Belanja','Tagihan','Kesehatan','Hiburan','Lainnya']};
export function categoryName(raw){const name=String(raw??'').trim();if(!/^[A-Za-z0-9][A-Za-z0-9 ._&()/-]{0,49}$/.test(name)||['Gaji','Usaha','Hadiah'].includes(name))throw Error('Kategori pengeluaran: 1–50 karakter huruf/angka, spasi atau . _ & ( ) / -, bukan kategori pemasukan.');return name;}
export function localDate(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function monthBounds(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Bulan tidak valid');const [y,m]=month.split('-').map(Number);return [`${month}-01`,`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-01`];}
export function recap(all,month){const [start,end]=monthBounds(month);const rows=all.filter(t=>t.date>=start&&t.date<end);let income=0n,expense=0n;const categories=Object.create(null);for(const t of rows){const n=BigInt(t.amount);if(t.type==='income')income+=n;else{expense+=n;categories[t.category]=(categories[t.category]||0n)+n;}}return {rows,income,expense,balance:income-expense,categories};}
export function validate(t){
 if(t.type==='expense'){categoryName(t.category);if(t.category!==String(t.category).trim())throw Error('Kategori tidak valid.');}else if(t.type!=='income'||!CATEGORIES.income.includes(t.category))throw Error('Jenis atau kategori tidak valid.');
 const raw=String(t.amount);const amount=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(amount)||amount<=0)throw Error('Nominal harus rupiah bulat positif, maksimal 9.007.199.254.740.991.');
 const date=String(t.date);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'0001-01-01'||date>'9999-12-31'||Number.isNaN(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Tanggal tidak valid.');
 const notes=String(t.notes||'').trim();if(notes.length>500)throw Error('Catatan maksimal 500 karakter.');return {type:t.type,category:t.category,amount,date,notes};
}
export function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function toCSV(rows){const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFFtanggal,jenis,kategori,nominal_idr,catatan\r\n'+rows.map(t=>[t.date,t.type,t.category,t.amount,t.notes].map(cell).join(',')).join('\r\n');}
export function reportCSV(headers,rows){const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFF'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n');}
export function backup(rows,planning){return JSON.stringify({app:'Kantong',version:planning?2:1,exportedAt:new Date().toISOString(),transactions:rows,...(planning||{})},(_,v)=>typeof v==='bigint'?v.toString():v,2);}
// Empty budget means no target; zero is an intentional target.
export function budgetAmount(raw){if(raw===''||raw===null||raw===undefined)return null;const s=String(raw);const n=Number(s);if(!/^\d+$/.test(s)||!Number.isSafeInteger(n)||n<0)throw Error('Anggaran harus rupiah bulat nonnegatif yang aman.');return n;}
export function budgetRecap(all,month,budgets=[],names=[]){const r=recap(all,month);const selected=budgets.filter(b=>b.month===month);return [...new Set([...names,...Object.keys(r.categories),...selected.map(b=>b.category)])].map(category=>{const b=selected.find(x=>x.category===category);const budget=b?BigInt(b.amount):null;const actual=r.categories[category]||0n;return {category,budget,actual,gap:budget===null?null:budget-actual};});}
export function dailyRecap(all,month,names=[]){
 const r=recap(all,month), categories=[...new Set([...names,...Object.keys(r.categories)])];
 const [y,m]=month.split('-').map(Number);const count=new Date(Date.UTC(y===0?2000:y,m,0)).getUTCDate();
 const days=Array.from({length:count},(_,i)=>({date:`${month}-${String(i+1).padStart(2,'0')}`,categories:Object.fromEntries(categories.map(c=>[c,0n])),total:0n}));
 for(const t of r.rows){if(t.type!=='expense')continue;const d=days[Number(t.date.slice(8))-1];d.categories[t.category]+=BigInt(t.amount);d.total+=BigInt(t.amount);}
 return {categories,days,totals:Object.fromEntries(categories.map(c=>[c,r.categories[c]||0n])),total:r.expense};
}
export const needsImprovement=(all,month)=>recap(all,month).balance<0n;
export function improvement(rows,income,proposed={}){
 const raw=String(income);if(!/^\d+$/.test(raw))throw Error('Asumsi pemasukan harus rupiah bulat nonnegatif.');
 const result=rows.map(r=>{const baseline=r.budget??r.actual;const value=Object.hasOwn(proposed,r.category)?budgetAmount(proposed[r.category]):baseline;if(value===null)throw Error('Isi semua usulan, gunakan 0 bila perlu.');const proposal=BigInt(value);return {...r,baseline,source:r.budget===null?'actual':'budget',proposal,reduction:baseline-proposal};});
 const total=result.reduce((s,r)=>s+r.proposal,0n),baseline=result.reduce((s,r)=>s+r.baseline,0n);return {rows:result,income:BigInt(raw),total,baseline,reduction:baseline-total,remaining:BigInt(raw)-total};
}
export const idr=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);

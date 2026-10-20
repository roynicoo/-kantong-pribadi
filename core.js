export const CATEGORIES={income:['Gaji','Usaha','Hadiah','Lainnya'],expense:['Makan','Transportasi','Belanja','Tagihan','Kesehatan','Hiburan','Lainnya']};
export function localDate(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function monthBounds(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Bulan tidak valid');const [y,m]=month.split('-').map(Number);return [`${month}-01`,`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-01`];}
export function recap(all,month){const [start,end]=monthBounds(month);const rows=all.filter(t=>t.date>=start&&t.date<end);let income=0n,expense=0n;const categories={};for(const t of rows){const n=BigInt(t.amount);if(t.type==='income')income+=n;else{expense+=n;categories[t.category]=(categories[t.category]||0n)+n;}}return {rows,income,expense,balance:income-expense,categories};}
export function validate(t){
 if(!CATEGORIES[t.type]?.includes(t.category))throw Error('Jenis atau kategori tidak valid.');
 const raw=String(t.amount);const amount=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(amount)||amount<=0)throw Error('Nominal harus rupiah bulat positif, maksimal 9.007.199.254.740.991.');
 const date=String(t.date);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'0001-01-01'||date>'9999-12-31'||Number.isNaN(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Tanggal tidak valid.');
 const notes=String(t.notes||'').trim();if(notes.length>500)throw Error('Catatan maksimal 500 karakter.');return {type:t.type,category:t.category,amount,date,notes};
}
export function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function toCSV(rows){const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFFtanggal,jenis,kategori,nominal_idr,catatan\r\n'+rows.map(t=>[t.date,t.type,t.category,t.amount,t.notes].map(cell).join(',')).join('\r\n');}
export function backup(rows){return JSON.stringify({app:'Kantong',version:1,exportedAt:new Date().toISOString(),transactions:rows},null,2);}
export const idr=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);

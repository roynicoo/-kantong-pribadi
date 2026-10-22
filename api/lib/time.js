// Waktu & tanggal untuk zona Asia/Jakarta (WIB, UTC+7).
// Semua fungsi murni: tidak memakai jam sistem kecuali argumen `now`.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');
const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Tanggal Jakarta (YYYY-MM-DD) untuk sebuah instant. */
export function jakartaDate(now = new Date()) {
  const d = new Date(now.getTime() + WIB_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Jam Jakarta (HH:MM) untuk sebuah instant. */
export function jakartaTime(now = new Date()) {
  const d = new Date(now.getTime() + WIB_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function isValidYmd(value) {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Geser tanggal YYYY-MM-DD sejumlah hari (boleh negatif). */
export function addDays(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 2026-10-23 -> "23 Okt 2026" */
export function formatDateID(ymd) {
  const s = String(ymd ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS_ID[m - 1] || '?'} ${y}`;
}

/** Awal & akhir hari (ISO) untuk query created_at. */
export function jakartaDayBounds(now = new Date()) {
  const today = jakartaDate(now);
  const start = new Date(`${addDays(today, -1)}T17:00:00.000Z`); // 00:00 WIB
  const end = new Date(`${today}T17:00:00.000Z`);
  return { today, start: start.toISOString(), end: end.toISOString() };
}

// Klien Supabase REST minimal (PostgREST) memakai service role.
// Tanpa dependensi: hanya fetch bawaan Node.
const enc = encodeURIComponent;

function buildQuery({ select, filters = {}, order, limit, offset } = {}) {
  const parts = [];
  if (select) parts.push(`select=${enc(select)}`);
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    parts.push(`${enc(key)}=${enc(String(value))}`);
  }
  if (order) parts.push(`order=${enc(order)}`);
  if (limit !== undefined) parts.push(`limit=${Number(limit)}`);
  if (offset !== undefined) parts.push(`offset=${Number(offset)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function createSupabase({ url, key, fetchImpl } = {}) {
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diisi.');
  const base = String(url).replace(/\/+$/, '');
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));

  async function request(path, { method = 'GET', body, prefer } = {}) {
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (prefer) headers.Prefer = prefer;
    const response = await doFetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      // Jangan pernah mencetak isi baris ke stdout: bisa memuat pesan pribadi.
      const err = new Error(`supabase_${response.status}`);
      err.status = response.status;
      try {
        err.detail = (await response.text()).slice(0, 200);
      } catch {
        err.detail = '';
      }
      throw err;
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  function select(table, options = {}) {
    return request(`/rest/v1/${table}${buildQuery(options)}`);
  }

  /** Ambil semua baris dengan paginasi (maks 20 halaman = 20.000 baris). */
  async function selectAll(table, { pageSize = 1000, ...options } = {}) {
    const rows = [];
    for (let page = 0; page < 20; page += 1) {
      const chunk = await select(table, { ...options, limit: pageSize, offset: page * pageSize });
      if (!Array.isArray(chunk)) throw new Error('Respons data tidak valid.');
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
    }
    return rows;
  }

  async function insert(table, row, { onConflict, ignoreDuplicates = false, returning = 'representation', select: sel = '*' } = {}) {
    const query = onConflict
      ? `?on_conflict=${String(onConflict).split(',').map((c) => enc(c.trim())).join(',')}${sel ? `&select=${enc(sel)}` : ''}`
      : `?select=${enc(sel)}`;
    const resolution = onConflict ? `resolution=${ignoreDuplicates ? 'ignore-duplicates' : 'merge-duplicates'},` : '';
    const prefer = `${resolution}return=${returning}`;
    const data = await request(`/rest/v1/${table}${query}`, { method: 'POST', body: row, prefer });
    return Array.isArray(data) ? data : [];
  }

  async function patch(table, filters, row, { returning = 'representation' } = {}) {
    const data = await request(`/rest/v1/${table}${buildQuery({ filters })}`, {
      method: 'PATCH',
      body: row,
      prefer: `return=${returning}`,
    });
    return Array.isArray(data) ? data : [];
  }

  async function remove(table, filters, { returning = 'representation' } = {}) {
    const data = await request(`/rest/v1/${table}${buildQuery({ filters })}`, {
      method: 'DELETE',
      prefer: `return=${returning}`,
    });
    return Array.isArray(data) ? data : [];
  }

  return { select, selectAll, insert, patch, remove, request };
}

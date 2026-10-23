// Kirim teks via WhatsApp Cloud API. Bot hanya membalas, tidak pernah memulai.
export async function sendText({ token, phoneNumberId, to, text, version, fetchImpl } = {}) {
  if (!token || !phoneNumberId || !to || !text) throw new Error('Parameter kirim belum lengkap.');
  const v = version || 'v22.0';
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const response = await doFetch(`https://graph.facebook.com/${v}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: String(text).slice(0, 4096) },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const err = new Error(`wa_send_${response.status}`);
    err.status = response.status;
    throw err;
  }
  return true;
}

// POST /autoverify  { code, ocr? }   -- called by the buyer's browser after the receipt is sent (and while waiting).
// ocr = what the browser read from the receipt screenshot: { amount, time, tx }
// 1) Clear problems on the receipt (paid less than the order amount, receipt too old) -> rejected at once.
// 2) Otherwise the order is approved when the owner's Telebirr payment SMS (stored by /smswebhook) matches it.
export async function onRequestPost({ request, env }) {
  const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
  try {
    const SB = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_KEY;
    const H = { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' };
    const { code, ocr } = await request.json();
    if (!code || String(code).length > 40) return json({ auto: false });
    const rows = await (await fetch(`${SB}/rest/v1/orders?code=eq.${encodeURIComponent(code)}&status=eq.awaiting_review&select=id,amount`, { headers: H })).json();
    const o = Array.isArray(rows) && rows[0];
    if (!o) return json({ auto: false });

    if (ocr && typeof ocr === 'object') {
      const why = [];
      const amt = Number(ocr.amount);
      if (Number.isFinite(amt) && amt > 0 && amt < Number(o.amount) - 0.5) why.push(`Receipt amount ${amt} ETB is less than the order amount ${o.amount} ETB`);
      const t = Date.parse(ocr.time);
      if (!Number.isNaN(t)) {
        const age = Date.now() - t;
        if (age > 3 * 3600e3) why.push('Receipt is older than 3 hours');
        if (age < -15 * 60e3) why.push('Receipt time is in the future');
      }
      if (why.length) {
        await fetch(`${SB}/rest/v1/rpc/reject_order`, { method: 'POST', headers: H, body: JSON.stringify({ p_id: o.id, p_note: 'Auto-rejected: ' + why.join('; ') + '.' }) });
        return json({ auto: false, rejected: true });
      }
    }

    const r = await fetch(`${SB}/rest/v1/rpc/try_pay_match`, { method: 'POST', headers: H, body: JSON.stringify({ p_order: o.id }) });
    const res = r.ok ? await r.json() : 'error';
    return json({ auto: res === 'ok', rejected: res === 'rejected' });
  } catch (e) {
    return json({ auto: false });
  }
}

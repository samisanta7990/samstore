// POST /autoverify  { code }   -- called by the buyer's browser after the receipt is sent (and while waiting).
// The order is approved automatically when the owner's Telebirr payment SMS (stored by /smswebhook) matches it.
export async function onRequestPost({ request, env }) {
  const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
  try {
    const SB = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_KEY;
    const H = { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' };
    const { code } = await request.json();
    if (!code || String(code).length > 40) return json({ auto: false });
    const rows = await (await fetch(`${SB}/rest/v1/orders?code=eq.${encodeURIComponent(code)}&status=eq.awaiting_review&select=id`, { headers: H })).json();
    const o = Array.isArray(rows) && rows[0];
    if (!o) return json({ auto: false });
    const r = await fetch(`${SB}/rest/v1/rpc/try_pay_match`, { method: 'POST', headers: H, body: JSON.stringify({ p_order: o.id }) });
    const res = r.ok ? await r.json() : 'error';
    return json({ auto: res === 'ok' });
  } catch (e) {
    return json({ auto: false });
  }
}

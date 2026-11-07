// POST /smswebhook?key=SECRET
// An SMS-forwarder app on the owner's phone sends every incoming Telebirr SMS here.
// We store the payment and approve any waiting order that matches it.
export async function onRequest({ request, env }) {
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  try {
    const url = new URL(request.url);
    if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) return json({ error: 'auth' }, 401);

    let b = {};
    const ct = request.headers.get('content-type') || '';
    if (request.method === 'POST') {
      const raw = await request.text();
      try { b = JSON.parse(raw); } catch (e) { b = Object.fromEntries(new URLSearchParams(raw)); }
    }
    for (const [k, v] of url.searchParams) if (k !== 'key' && !(k in b)) b[k] = v;
    const pick = (...ks) => { for (const k of ks) if (b[k] != null && String(b[k]).trim()) return String(b[k]); return ''; };
    const text = pick('text', 'message', 'body', 'content', 'sms', 'msg').slice(0, 1000);
    const from = pick('from', 'sender', 'number', 'phone', 'address').slice(0, 60);
    if (!text) return json({ ignored: 'empty' });

    // Only incoming-money messages
    if (!/received|ተቀብ|ደርሶ/i.test(text)) return json({ ignored: 'not a received-money message' });
    const rest = text.slice(Math.max(0, text.search(/received|ተቀብ|ደርሶ/i)));
    const am = rest.match(/(?:ETB|Birr|ብር)\s*([\d,]+(?:\.\d{1,2})?)/i) || text.match(/(?:ETB|Birr|ብር)\s*([\d,]+(?:\.\d{1,2})?)/i);
    const tm = text.match(/transaction\s*(?:number|no\.?|id)\s*(?:is)?\s*[:\-]?\s*([A-Z0-9]{8,16})/i) || text.match(/\b([A-Z][A-Z0-9]{9})\b/);
    if (!am || !tm) return json({ ignored: 'could not read amount or transaction number' });
    const amount = Number(am[1].replace(/,/g, '')), tx = tm[1].toUpperCase();

    const SB = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_KEY;
    const H = { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' };
    const norm = (t) => t.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
    const ins = await fetch(`${SB}/rest/v1/payments?on_conflict=tx_norm`, {
      method: 'POST', headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ tx, tx_norm: norm(tx), amount, sender: from, raw: text }),
    });
    if (!ins.ok) return json({ error: 'db' }, 500);

    // Try to approve waiting orders that this payment could belong to
    const orders = await (await fetch(`${SB}/rest/v1/orders?status=eq.awaiting_review&amount=lte.${amount}&select=id&order=id.asc&limit=30`, { headers: H })).json();
    let approved = 0;
    for (const o of Array.isArray(orders) ? orders : []) {
      const r = await fetch(`${SB}/rest/v1/rpc/try_pay_match`, { method: 'POST', headers: H, body: JSON.stringify({ p_order: o.id }) });
      if (r.ok && (await r.json()) === 'ok') approved++;
    }
    return json({ stored: true, approved });
  } catch (e) {
    return json({ error: 'server' }, 500);
  }
}

// POST /smswebhook?key=SECRET
// An SMS-forwarder app on the owner's phone sends every incoming Telebirr SMS here.
// We store the payment and approve any waiting order that matches it.

// Reads the amount and the transaction/activity number from a Telebirr "money received" SMS.
// Amharic: "ውድ Samuel ከ NAME(2519****1646) 20.00 ብር በ 06/11/2026 14:36:56 ተቀብለዋል። የሂሳብ እንቅስቃሴ ቁጥርዎ DK69S0CDGZ ነዉ። አሁን ያለዎት ቀሪ ሂሳብ 783.50 ብር ነዉ።"
// English: "You have received ETB 228.00 from NAME on ... Your transaction number is XXXXXXXXXX. Your balance is ETB 1,000.00"
export function parseSms(text) {
  const head = text.split(/ቀሪ|balance/i)[0];            // ignore the balance part
  const num = '([\\d,]+(?:\\.\\d{1,2})?)';
  const cands = [];
  for (const m of head.matchAll(new RegExp(num + '\\s*(?:ብር|ETB|Birr)', 'gi'))) cands.push([m.index, m[1]]);
  for (const m of head.matchAll(new RegExp('(?:ETB|Birr|ብር)\\s*' + num, 'gi'))) cands.push([m.index, m[1]]);
  cands.sort((a, b) => a[0] - b[0]);
  const amount = cands.length ? Number(cands[0][1].replace(/,/g, '')) : NaN;
  const lab = text.match(/(?:transaction\s*(?:number|no\.?|id)|ቁጥርዎ|ቁጥር)\s*(?:is)?\s*[:\-]?\s*([A-Z0-9]{8,16})/i);
  let tx = lab ? lab[1].toUpperCase() : '';
  if (!/\d/.test(tx)) {
    tx = '';
    for (const m of text.matchAll(/\b([A-Z][A-Z0-9]{9})\b/g)) if (/\d/.test(m[1])) { tx = m[1]; break; }
  }
  return amount > 0 && tx ? { amount, tx } : null;
}

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
    // heartbeat: proves the phone is forwarding SMS right now (used to decide when a missing payment means "fake")
    try {
      const K0 = env.SUPABASE_SERVICE_KEY;
      await fetch(`${env.SUPABASE_URL}/rest/v1/sms_heartbeat?on_conflict=id`, { method: 'POST', headers: { apikey: K0, Authorization: 'Bearer ' + K0, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 1, last_at: new Date().toISOString() }) });
    } catch (e) {}

    // Only incoming-money messages (English: "received", Amharic: "ተቀብለዋል")
    if (!/received|ተቀብ|ደርሶ/i.test(text)) return json({ ignored: 'not a received-money message' });
    const parsed = parseSms(text);
    if (!parsed) return json({ ignored: 'could not read amount or transaction number' });
    const { amount, tx } = parsed;

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

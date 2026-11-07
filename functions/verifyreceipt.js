// POST /verifyreceipt  { order_id }   (admin only)
// Looks up the buyer's Telebirr transaction number on Telebirr's public receipt page
// and compares amount / receiver / status. It only REPORTS; the admin still approves.
const RECEIVER_NAME = 'Samuel';
const RECEIVER_PHONE = '0994042855';

export async function onRequestPost({ request, env }) {
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  try {
    const SB = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_KEY;
    const H = { apikey: K, Authorization: 'Bearer ' + K };
    const auth = request.headers.get('authorization') || '';
    const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: K, Authorization: auth } });
    if (!u.ok) return json({ error: 'auth' }, 401);
    const uid = (await u.json()).id;
    const ad = await (await fetch(`${SB}/rest/v1/admins?user_id=eq.${uid}&select=user_id`, { headers: H })).json();
    if (!Array.isArray(ad) || !ad.length) return json({ error: 'auth' }, 403);

    const { order_id } = await request.json();
    const rows = await (await fetch(`${SB}/rest/v1/orders?id=eq.${Number(order_id)}&select=id,amount,tx_ref`, { headers: H })).json();
    const o = rows && rows[0];
    if (!o) return json({ error: 'order' }, 404);
    if (!o.tx_ref) return json({ ok: false, reason: 'notx' });

    const dups = await (await fetch(`${SB}/rest/v1/orders?tx_ref=eq.${encodeURIComponent(o.tx_ref)}&id=neq.${o.id}&select=id`, { headers: H })).json();
    const dup = Array.isArray(dups) ? dups.map(d => d.id) : [];
    const url = 'https://transactioninfo.ethiotelecom.et/receipt/' + encodeURIComponent(o.tx_ref);

    let html = '', status = 0;
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
      status = r.status; html = await r.text();
    } catch (e) { return json({ ok: false, reason: 'fetch', url, tx: o.tx_ref, dup }); }
    if (status !== 200 || html.length < 200) return json({ ok: false, reason: 'fetch', status, url, tx: o.tx_ref, dup });

    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const low = text.toLowerCase(), amt = Number(o.amount);
    const checks = {
      found: low.includes(String(o.tx_ref).toLowerCase()),
      receiver: low.includes(RECEIVER_NAME.toLowerCase()) || text.includes(RECEIVER_PHONE.slice(-4)),
      amount: new RegExp('(?<![\\d.,])' + amt + '(?:\\.0+)?(?![\\d])').test(text),
      done: /completed|success|ተሳክቷል|ተጠናቅቋል/i.test(text),
    };
    return json({ ok: true, checks, dup, url, tx: o.tx_ref, amount: amt, snippet: text.slice(0, 260) });
  } catch (e) {
    return json({ error: 'server' }, 500);
  }
}

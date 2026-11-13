// POST /notifyall  {text}  (Authorization: Bearer <admin access token>)
// Sends a push to every saved phone and the text to every linked Telegram account.
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();
async function vapidAuth(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 43200, sub: 'mailto:samisanta7990@gmail.com' })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(h + '.' + p));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}
export async function onRequestPost({ request, env }) {
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  try {
    const SB = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_KEY;
    const auth = request.headers.get('authorization') || '';
    const a = await fetch(`${SB}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { apikey: K, Authorization: auth, 'content-type': 'application/json' }, body: '{}' });
    if (!a.ok || (await a.json()) !== true) return json({ error: 'auth' }, 401);
    const { text } = await request.json();
    const H = { apikey: K, Authorization: 'Bearer ' + K };
    const subs = await (await fetch(`${SB}/rest/v1/push_subs?select=id,endpoint`, { headers: H })).json();
    let push = 0;
    for (const s of Array.isArray(subs) ? subs : []) {
      try {
        const r = await fetch(s.endpoint, { method: 'POST', headers: { TTL: '3600', Authorization: await vapidAuth(env, s.endpoint), 'Content-Length': '0' } });
        if (r.ok) push++;
        else if (r.status === 404 || r.status === 410) await fetch(`${SB}/rest/v1/push_subs?id=eq.${s.id}`, { method: 'DELETE', headers: H });
      } catch (e) {}
    }
    let tg = 0;
    if (text && env.BOT_TOKEN) {
      const links = await (await fetch(`${SB}/rest/v1/tg_links?select=tg_id`, { headers: H })).json();
      for (const l of Array.isArray(links) ? links : []) {
        try {
          const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: l.tg_id, text }) });
          if (r.ok) tg++;
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 60));
      }
    }
    return json({ push, telegram: tg });
  } catch (e) { return json({ error: 'server' }, 500); }
}

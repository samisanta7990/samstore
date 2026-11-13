// POST /notifytest  (Authorization: Bearer <user access token>)
// Sends a test push to the phones of the logged-in user only.
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
    const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: K, Authorization: request.headers.get('authorization') || '' } });
    if (!u.ok) return json({ error: 'auth' }, 401);
    const uid = (await u.json()).id;
    const subs = await (await fetch(`${SB}/rest/v1/push_subs?user_id=eq.${uid}&select=id,endpoint`, { headers: { apikey: K, Authorization: 'Bearer ' + K } })).json();
    const st = [];
    for (const s of Array.isArray(subs) ? subs : []) {
      try {
        const r = await fetch(s.endpoint, { method: 'POST', headers: { TTL: '60', Urgency: 'high', Authorization: await vapidAuth(env, s.endpoint), 'Content-Length': '0' } });
        st.push(r.status);
      } catch (e) { st.push('err'); }
    }
    return json({ phones: st.length, status: st });
  } catch (e) { return json({ error: 'server' }, 500); }
}

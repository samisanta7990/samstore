// GET /pushcheck            -> shows whether the push keys are set up correctly
// GET /pushcheck?send=XXXXXXXX -> also sends a test push to every saved phone
//   (XXXXXXXX = first 8 characters of the "d" value of VAPID_PRIVATE_JWK)
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const enc = new TextEncoder();

async function vapidAuth(env, endpoint, jwk) {
  const aud = new URL(endpoint).origin;
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 43200, sub: 'mailto:samisanta7990@gmail.com' })));
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(h + '.' + p));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

export async function onRequestGet({ request, env }) {
  const out = {
    hasPublic: !!env.VAPID_PUBLIC,
    hasPrivateJwk: !!env.VAPID_PRIVATE_JWK,
    hasSupabaseUrl: !!env.SUPABASE_URL,
    hasServiceKey: !!env.SUPABASE_SERVICE_KEY,
    publicLength: env.VAPID_PUBLIC ? env.VAPID_PUBLIC.length : 0,
  };
  let jwk = null;
  try {
    jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
    out.jwkParses = true;
    const pub = new Uint8Array(65); pub[0] = 4; pub.set(unb(jwk.x), 1); pub.set(unb(jwk.y), 33);
    out.publicMatchesPrivate = b64u(pub) === env.VAPID_PUBLIC;
    await vapidAuth(env, 'https://fcm.googleapis.com/x', jwk);
    out.signOk = true;
  } catch (e) { out.jwkError = String(e && e.message || e); }

  let subs = [];
  try {
    const K = env.SUPABASE_SERVICE_KEY;
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/push_subs?select=id,user_id,endpoint`, { headers: { apikey: K, Authorization: 'Bearer ' + K } });
    const j = await r.json();
    subs = Array.isArray(j) ? j : [];
    out.savedPhones = subs.length;
    if (!Array.isArray(j)) out.subsError = JSON.stringify(j).slice(0, 150);
  } catch (e) { out.subsError = String(e && e.message || e); }

  const q = new URL(request.url).searchParams.get('send');
  if (q && jwk && jwk.d && q === jwk.d.slice(0, 8)) {
    out.results = [];
    for (const s of subs) {
      try {
        const r = await fetch(s.endpoint, { method: 'POST', headers: { TTL: '60', Urgency: 'high', Authorization: await vapidAuth(env, s.endpoint, jwk), 'Content-Length': '0' } });
        out.results.push({ id: s.id, host: new URL(s.endpoint).host, status: r.status, body: (await r.text()).slice(0, 120) });
      } catch (e) { out.results.push({ id: s.id, error: String(e && e.message || e) }); }
    }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json' } });
}

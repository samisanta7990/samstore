// POST /notifypush  { msg_id }   (Authorization: Bearer <user access token>)
// Sends a web-push "you have a new message" to the other side of a conversation.
// Needs env vars: VAPID_PUBLIC (base64url public key) and VAPID_PRIVATE_JWK (private key as JSON).
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
    if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE_JWK) return json({ sent: 0, reason: 'no-keys' });
    const SB = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_KEY;
    const H = { apikey: K, Authorization: 'Bearer ' + K };
    const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: K, Authorization: request.headers.get('authorization') || '' } });
    if (!u.ok) return json({ error: 'auth' }, 401);
    const uid = (await u.json()).id;
    const { msg_id } = await request.json();
    const ms = await (await fetch(`${SB}/rest/v1/messages?id=eq.${Number(msg_id)}&select=id,conv_id,sender_id,role,kind`, { headers: H })).json();
    const m = ms && ms[0];
    if (!m || m.sender_id !== uid) return json({ error: 'msg' }, 403);
    const cs = await (await fetch(`${SB}/rest/v1/conversations?id=eq.${m.conv_id}&select=kind,buyer_id,seller_id`, { headers: H })).json();
    const c = cs && cs[0];
    if (!c) return json({ sent: 0 });

    let to = [];
    if (c.kind === 'support') {
      if (m.role === 'admin') to = [c.buyer_id];
      else to = (await (await fetch(`${SB}/rest/v1/admins?select=user_id`, { headers: H })).json()).map((a) => a.user_id);
    } else {
      to = [m.sender_id === c.buyer_id ? c.seller_id : c.buyer_id].filter(Boolean);
      // a deal was agreed or an exchange accepted: tell the admins too
      if (m.kind === 'deal_agree' || m.kind === 'exchange_accept') {
        const ad = await (await fetch(`${SB}/rest/v1/admins?select=user_id`, { headers: H })).json();
        to = to.concat(ad.map((a) => a.user_id));
      }
    }
    to = to.filter((x) => x && x !== uid);
    if (!to.length) return json({ sent: 0 });

    const subs = await (await fetch(`${SB}/rest/v1/push_subs?user_id=in.(${to.join(',')})&select=id,endpoint`, { headers: H })).json();
    let sent = 0;
    for (const s of Array.isArray(subs) ? subs : []) {
      try {
        const r = await fetch(s.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'high', Authorization: await vapidAuth(env, s.endpoint), 'Content-Length': '0' } });
        if (r.status === 404 || r.status === 410) await fetch(`${SB}/rest/v1/push_subs?id=eq.${s.id}`, { method: 'DELETE', headers: H });
        else if (r.ok) sent++;
      } catch (e) {}
    }
    return json({ sent });
  } catch (e) {
    return json({ error: 'server' }, 500);
  }
}

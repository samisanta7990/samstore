// Telegram login for Sam Store: verifies Telegram's signed data, then creates/signs in a Supabase user.
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export async function onRequestPost({ request, env }) {
  const u = await request.json().catch(() => null);
  if (!u || !u.hash || !u.id || !u.auth_date) return J({ error: 'Bad request' }, 400);
  const enc = new TextEncoder();
  const data = Object.keys(u).filter(k => k !== 'hash').sort().map(k => k + '=' + u[k]).join('\n');
  const k0 = await crypto.subtle.digest('SHA-256', enc.encode(env.BOT_TOKEN));
  const key = await crypto.subtle.importKey('raw', k0, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  if (sig !== u.hash || Date.now() / 1000 - Number(u.auth_date) > 86400) return J({ error: 'Telegram verification failed' }, 401);
  const SB = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_KEY;
  const H = { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' };
  const ex = await (await fetch(`${SB}/rest/v1/tg_links?tg_id=eq.${encodeURIComponent(u.id)}&select=user_id`, { headers: H })).json();
  const email = `tg${u.id}@telegram.samstore.app`;
  const pw = hex(await crypto.subtle.digest('SHA-256', enc.encode(env.TG_PASS_SECRET + ':' + u.id)));
  await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: H,
    body: JSON.stringify({ email, password: pw, email_confirm: true, user_metadata: { tg: u.username ? '@' + u.username : u.first_name } }) });
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: pw }) });
  const s = await r.json();
  if (!s.access_token) return J({ error: 'Login failed' }, 500);
  if (Array.isArray(ex) && ex.length && ex[0].user_id !== s.user.id)
    return J({ error: 'This Telegram is already linked to another account. Log in with that account.' }, 409);
  await fetch(`${SB}/rest/v1/tg_links?on_conflict=user_id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: s.user.id, tg_id: u.id, username: u.username || null, first_name: u.first_name || null }) });
  return J({ access_token: s.access_token, refresh_token: s.refresh_token });
}

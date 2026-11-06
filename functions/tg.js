// Cloudflare Pages Function: Telegram bot -> forwards customer messages to the admin, admin replies are sent back.
export async function onRequestPost({ request, env }) {
  if (env.HOOK_SECRET && request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.HOOK_SECRET)
    return new Response('forbidden', { status: 403 });
  const u = await request.json().catch(() => null);
  const m = u && u.message;
  if (!m) return new Response('ok');
  const api = (method, body) => fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const admin = String(env.ADMIN_CHAT), chat = String(m.chat.id);
  if (chat === admin) {
    const r = m.reply_to_message, id = r && ((r.text || r.caption || '').match(/\[(\d+)\]/) || [])[1];
    if (id && m.text) await api('sendMessage', { chat_id: id, text: m.text });
    return new Response('ok');
  }
  if (m.text === '/start') {
    await api('sendMessage', { chat_id: chat, text: 'Welcome to Sam Store! Send your message here and we will reply soon.' });
    return new Response('ok');
  }
  // Seller replies: (1) a price -> send final price (+100) to the buyer, (2) a code -> save it for the admin.
  let handled = false;
  const t = (m.text || '').trim();
  if (m.text && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      const SB = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_KEY;
      const H = { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' };
      const get = async (u) => await (await fetch(`${SB}/rest/v1/${u}`, { headers: H })).json();
      const patch = (u, b) => fetch(`${SB}/rest/v1/${u}`, { method: 'PATCH', headers: H, body: JSON.stringify(b) });
      const lk = await get(`tg_links?tg_id=eq.${m.from.id}&select=user_id`);
      if (lk && lk[0]) {
        const cats = await get(`catalog?seller_id=eq.${lk[0].user_id}&cat=eq.account&select=id,label`);
        if (Array.isArray(cats) && cats.length) {
          const ids = cats.map(c => c.id).join(',');
          const pm = t.replace(/,/g, '').match(/^(\d{3,6})\s*(birr|etb|br)?$/i);
          if (pm) {
            const pr = await get(`price_requests?catalog_id=in.(${ids})&answered=eq.false&order=id.desc&limit=1&select=catalog_id`);
            if (Array.isArray(pr) && pr[0]) {
              const cid = pr[0].catalog_id, final = Number(pm[1]) + 100, c = cats.find(x => x.id == cid);
              const reqs = await get(`price_requests?catalog_id=eq.${cid}&answered=eq.false&select=user_id`);
              for (const r of reqs) {
                const b = await get(`tg_links?user_id=eq.${r.user_id}&select=tg_id`);
                if (b && b[0]) await api('sendMessage', { chat_id: b[0].tg_id, text: `\u{1F4AC} Final price for the account (${c.label}): ${final} ETB.\nTo buy, open https://samstore.pages.dev and tap Buy.` });
              }
              await patch(`price_requests?catalog_id=eq.${cid}&answered=eq.false`, { answered: true });
              await patch(`catalog?id=eq.${cid}`, { price: final });
              await api('sendMessage', { chat_id: chat, text: `\u2705 Price sent to the buyer. Your price: ${pm[1]} ETB.` });
              handled = true;
            }
          }
          if (!handled && /^(?=.*\d)[A-Za-z0-9]{4,10}$/.test(t)) {
            const ask = await get(`seller_asks?catalog_id=in.(${ids})&code=is.null&order=id.desc&limit=1&select=id`);
            if (Array.isArray(ask) && ask[0]) {
              await patch(`seller_asks?id=eq.${ask[0].id}`, { code: t, got_at: new Date().toISOString() });
              await api('sendMessage', { chat_id: chat, text: '\u2705 Code received. Thank you!' });
              handled = true;
            }
          }
        }
      }
    } catch (e) {}
  }
  // If the customer replies with a short code while we are waiting for one, save it on their order.
  if (!handled && /^(?=.*\d)[A-Za-z0-9]{4,10}$/.test(t) && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    try {
      const SB = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_KEY;
      const H = { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' };
      const l = await (await fetch(`${SB}/rest/v1/tg_links?tg_id=eq.${m.from.id}&select=user_id`, { headers: H })).json();
      if (l && l[0]) {
        const o = await (await fetch(`${SB}/rest/v1/orders?user_id=eq.${l[0].user_id}&code_req=is.true&kcode=is.null&order=id.desc&limit=1&select=id`, { headers: H })).json();
        if (o && o[0]) {
          await fetch(`${SB}/rest/v1/orders?id=eq.${o[0].id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ kcode: t }) });
          await api('sendMessage', { chat_id: chat, text: '✅ Code received for order #' + o[0].id + '. Thank you!' });
        }
      }
    } catch (e) {}
  }
  const who = (m.from.username ? '@' + m.from.username : m.from.first_name) + ' [' + chat + ']';
  await api('sendMessage', { chat_id: admin, text: '💬 ' + who + ':\n' + (m.text || '(media below)') });
  if (!m.text) await api('copyMessage', { chat_id: admin, from_chat_id: chat, message_id: m.message_id });
  return new Response('ok');
}

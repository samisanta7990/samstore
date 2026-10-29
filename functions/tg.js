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
  const who = (m.from.username ? '@' + m.from.username : m.from.first_name) + ' [' + chat + ']';
  await api('sendMessage', { chat_id: admin, text: '💬 ' + who + ':\n' + (m.text || '(media below)') });
  if (!m.text) await api('copyMessage', { chat_id: admin, from_chat_id: chat, message_id: m.message_id });
  return new Response('ok');
}

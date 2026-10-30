// One-time helper: open https://samstore.pages.dev/setup?key=YOUR_HOOK_SECRET to connect the bot to /tg
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.HOOK_SECRET || url.searchParams.get('key') !== env.HOOK_SECRET)
    return new Response('forbidden', { status: 403 });
  const T = env.BOT_TOKEN;
  const me = await (await fetch(`https://api.telegram.org/bot${T}/getMe`)).json();
  let hook = null;
  if (me.ok) {
    hook = await (await fetch(`https://api.telegram.org/bot${T}/setWebhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: url.origin + '/tg', secret_token: env.HOOK_SECRET, allowed_updates: ['message'] }) })).json();
  }
  return new Response(JSON.stringify({ bot: me.ok ? me.result.username : me, webhook: hook }, null, 1),
    { headers: { 'content-type': 'application/json' } });
}

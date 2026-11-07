// POST /autoverify  { code }   -- called by the buyer's browser right after the receipt is sent.
// Verifies the Telebirr transaction on Telebirr's public receipt page and, if EVERYTHING matches
// and the amount is not above AUTO_MAX, approves the order automatically.
const RECEIVER_NAME = 'Samuel';
const RECEIVER_PHONE = '0994042855';
const AUTO_MAX = 1000;   // ETB. Orders above this are only checked, then wait for the admin.

export async function onRequestPost({ request, env }) {
  const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
  try {
    const SB = env.SUPABASE_URL, K = env.SUPABASE_SERVICE_KEY;
    const H = { apikey: K, Authorization: 'Bearer ' + K, 'content-type': 'application/json' };
    const { code } = await request.json();
    if (!code || String(code).length > 40) return json({ auto: false });

    const rows = await (await fetch(`${SB}/rest/v1/orders?code=eq.${encodeURIComponent(code)}&status=eq.awaiting_review&select=id,amount,tx_ref`, { headers: H })).json();
    const o = Array.isArray(rows) && rows[0];
    if (!o || !o.tx_ref) return json({ auto: false });

    const note = (t) => fetch(`${SB}/rest/v1/orders?id=eq.${o.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ auto_note: t }) });

    const dups = await (await fetch(`${SB}/rest/v1/orders?tx_ref=eq.${encodeURIComponent(o.tx_ref)}&id=neq.${o.id}&select=id`, { headers: H })).json();
    if (Array.isArray(dups) && dups.length) { await note('Auto-check: transaction number already used on order #' + dups.map(d => d.id).join(', #')); return json({ auto: false }); }

    let html = '', status = 0;
    try {
      const r = await fetch('https://transactioninfo.ethiotelecom.et/receipt/' + encodeURIComponent(o.tx_ref), { headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
      status = r.status; html = await r.text();
    } catch (e) { await note('Auto-check: could not reach Telebirr. Please check manually.'); return json({ auto: false }); }
    if (status !== 200 || html.length < 200) { await note('Auto-check: Telebirr receipt not available yet (HTTP ' + status + '). Please check manually.'); return json({ auto: false }); }

    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const low = text.toLowerCase(), amt = Number(o.amount);
    const num = '(?<![\\d.,])' + amt + '(?:\\.0{1,2})?';
    const checks = {
      found: low.includes(String(o.tx_ref).toLowerCase()),
      receiver: low.includes(RECEIVER_NAME.toLowerCase()) || text.includes(RECEIVER_PHONE.slice(-4)),
      amount: new RegExp(num + '\\s*(?:birr|etb|br|ብር)', 'i').test(text) || new RegExp('amount[^0-9]{0,40}' + num + '(?![\\d])', 'i').test(text),
      done: /completed|success|ተሳክቷል|ተጠናቅቋል/i.test(text),
    };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (failed.length) { await note('Auto-check failed: ' + failed.join(', ') + '. Please check manually.'); return json({ auto: false }); }
    if (amt > AUTO_MAX) { await note('Auto-check passed (' + amt + ' ETB) but above the auto-approve limit. Please approve manually.'); return json({ auto: false }); }

    const ap = await fetch(`${SB}/rest/v1/rpc/auto_approve`, { method: 'POST', headers: H, body: JSON.stringify({ p_id: o.id }) });
    const ok = ap.ok && (await ap.json()) === true;
    await note(ok ? 'Auto-approved: Telebirr receipt matched (' + amt + ' ETB).' : 'Auto-check passed but approval failed. Please approve manually.');
    return json({ auto: ok });
  } catch (e) {
    return json({ auto: false });
  }
}

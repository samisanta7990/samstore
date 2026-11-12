// SAM STORE service worker: always loads the live site (so website updates reach the app at once).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0f17;color:#ecedf3;font-family:system-ui;text-align:center"><div><h2>SAM STORE</h2><p>No internet connection.<br>Please check your connection and try again.</p></div>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});

// Push notifications (empty push -> generic message)
self.addEventListener('push', (e) => {
  e.waitUntil(self.registration.showNotification('SAM STORE', {
    body: '\u{1F4AC} You have a new message', icon: '/icon-192.png', badge: '/icon-192.png',
    tag: 'sam-msg', renotify: true, data: { url: '/?msgs=1' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate('/?msgs=1'); return c.focus(); } }
    return self.clients.openWindow('/?msgs=1');
  }));
});

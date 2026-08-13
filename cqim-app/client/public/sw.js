/* CQIM Web Push service worker. Notifications never include message plaintext. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {}; }
  if (data.encrypted !== true || data.type !== 'encrypted_message') return;

  const chatId = typeof data.chatId === 'string' ? data.chatId : '';
  const title = 'CQIM';
  const options = {
    body: '🔒 收到一条加密消息',
    icon: '/icon-192.png',
    badge: '/icon-128.png',
    tag: chatId ? `cqim-chat-${chatId}` : 'cqim-encrypted-message',
    renotify: true,
    data: { chatId, messageId: data.messageId || '', senderId: data.senderId || '' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const chatId = typeof data.chatId === 'string' ? data.chatId : '';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({ type: 'cqim:open-chat-from-notification', chatId });
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(chatId ? `/?chatId=${encodeURIComponent(chatId)}` : '/');
    }
  })());
});

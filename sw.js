/* Pulse: фоновый помощник для уведомлений. Только показывает напоминания, ничего не кэширует. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  const url = typeof d.url === "string" && /^#[a-z]{2,10}$/.test(d.url) ? d.url : "#home";
  e.waitUntil(self.registration.showNotification(String(d.title || "Pulse").slice(0, 80), {
    body: String(d.body || "").slice(0, 300), tag: typeof d.tag === "string" ? d.tag.slice(0, 64) : undefined,
    icon: "icon-192.png", badge: "icon-192.png", data: { url }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "#home", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ("focus" in w) { if ("navigate" in w) w.navigate(target).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(target);
  }));
});

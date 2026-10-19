// Настоящий sw.js в Chromium: приходит push → показывается уведомление с нужным текстом; нажатие открывает раздел.
const { chromium } = require(process.env.PW);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); await ctx.grantPermissions(['notifications'], { origin: 'http://localhost:8099' });
  await ctx.route(/supabase\.co|googleapis|gstatic/, r => r.abort());
  const p = await ctx.newPage(); await p.goto('http://localhost:8099/');
  await p.evaluate(async () => { await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const res = await sw.evaluate(async () => {
    const shown = []; self.registration.showNotification = async (t, o) => { shown.push({ title: t, ...o }); }; // в headless-браузере нет системных уведомлений — перехватываем вызов
    self.registration.getNotifications = async () => shown;
    const data = { title: 'Задача на 09:30', body: 'Позвонить клиенту', tag: 'task-t1', url: '#tasks' };
    const ev = new PushEvent('push', { data: JSON.stringify(data) });
    let waited; ev.waitUntil = pr => { waited = pr; }; self.dispatchEvent(ev); await waited;
    const n = [...await self.registration.getNotifications()];
    const bad = new PushEvent('push', { data: JSON.stringify({ title: 'x', url: 'javascript:alert(1)' }) }); let w2; bad.waitUntil = pr => { w2 = pr; }; self.dispatchEvent(bad); await w2;
    const n2 = (await self.registration.getNotifications()).find(x => x.title === 'x');
    return { count: n.length, title: n[0] && n[0].title, body: n[0] && n[0].body, url: n[0] && n[0].data.url, badUrl: n2 && n2.data.url };
  });
  const ok = res.count === 1 && res.title === 'Задача на 09:30' && res.body === 'Позвонить клиенту' && res.url === '#tasks' && res.badUrl === '#home';
  console.log((ok ? 'OK   ' : 'FAIL ') + 'sw.js показывает уведомление, опасная ссылка заменяется на «Обзор»', JSON.stringify(res));
  await b.close(); process.exit(ok ? 0 : 1);
})();

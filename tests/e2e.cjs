// Сквозная проверка сайта на мок-сервере Supabase (auth + REST с изоляцией по пользователю).
// Запуск: PW=<путь к playwright> node tests/e2e.cjs  (сайт должен раздаваться на http://127.0.0.1:8099)
const { chromium } = require(process.env.PW);
const crypto = require('crypto');
const BASE = 'http://127.0.0.1:8099/';
const SB = 'https://xhvamuaxrhshfouztqfn.supabase.co'; // запросы перехватываются моком, в сеть не уходят
const users = {}, tokens = {}, rows = [];
const results = []; const check = (name, ok) => { results.push([ok ? 'OK  ' : 'FAIL', name]); };
function json(route, status, body){ return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }); }
function issue(u){ const at = crypto.randomUUID(), rt = crypto.randomUUID(); tokens[at] = u.id; tokens['r:' + rt] = u.id;
  return { access_token: at, refresh_token: rt, expires_in: 3600, expires_at: Math.floor(Date.now()/1000) + 3600, user: { id: u.id, email: u.email, user_metadata: { name: u.name } } }; }
async function mock(route){
  const req = route.request(); const url = new URL(req.url()); const m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (req.headers()['apikey'] !== 'pk_test_publishable_key_123456') return json(route, 401, { message: 'bad apikey' });
  const auth = (req.headers()['authorization'] || '').replace('Bearer ', ''); const uid = tokens[auth];
  const body = req.postData() ? JSON.parse(req.postData()) : {};
  const p = url.pathname;
  if (p === '/auth/v1/signup') { if (Object.values(users).some(u => u.email === body.email)) return json(route, 422, { error_code: 'user_already_exists', msg: 'User already registered' });
    const u = { id: crypto.randomUUID(), email: body.email, pass: body.password, name: body.data && body.data.name }; users[u.id] = u; return json(route, 200, issue(u)); }
  if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') { const u = Object.values(users).find(u => u.email === body.email && u.pass === body.password); return u ? json(route, 200, issue(u)) : json(route, 400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }); }
  if (p === '/auth/v1/token') { const id = tokens['r:' + body.refresh_token]; return id ? json(route, 200, issue(users[id])) : json(route, 400, { msg: 'invalid refresh' }); }
  if (p === '/auth/v1/logout') { delete tokens[auth]; return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
  if (p === '/auth/v1/user') return uid ? json(route, 200, { id: uid, email: users[uid].email, user_metadata: { name: users[uid].name } }) : json(route, 401, {});
  if (p === '/rest/v1/items') {
    if (!uid) return json(route, 401, { message: 'JWT required' });
    if (m === 'GET') return json(route, 200, rows.filter(r => r.user_id === uid).map(({ col, id, data }) => ({ col, id, data })));
    if (m === 'POST') { const b = Array.isArray(body) ? body : [body]; for (const r of b) { const i = rows.findIndex(x => x.user_id === uid && x.col === r.col && x.id === r.id); const row = { user_id: uid, col: r.col, id: r.id, data: r.data }; i >= 0 ? rows[i] = row : rows.push(row); } return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } }); }
    if (m === 'DELETE') { const col = url.searchParams.get('col').slice(3), id = url.searchParams.get('id').slice(3); for (let i = rows.length - 1; i >= 0; i--) if (rows[i].user_id === uid && rows[i].col === col && rows[i].id === id) rows.splice(i, 1); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
  }
  return json(route, 404, {});
}
process.on("unhandledRejection", async e => { console.log("ERR", e.message.split("\n")[0]); console.log("results so far", JSON.stringify(results)); if (global.__page) { console.log("authmsg:", await global.__page.textContent(".authmsg").catch(()=>"-")); console.log("errs:", JSON.stringify(global.__errs)); } process.exit(1); });
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const csp = [], errs = [], dialogs = [];
  await ctx.route(SB + '/**', mock);
  await ctx.route(BASE + 'config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.PULT_CONFIG=Object.freeze({url:"${SB}",key:"pk_test_publishable_key_123456"});` }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage(); global.__page = page; global.__errs = errs;
  page.on('console', m => { if (/Content Security Policy|Refused/.test(m.text())) csp.push(m.text()); });
  page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(BASE);
  check('Без входа показан экран входа, приложение скрыто', await page.isVisible('#auth form') && await page.isHidden('.app'));
  // регистрация Алисы
  await page.click('text=Создать аккаунт');
  await page.fill('#aName', 'Алиса'); await page.fill('#aEmail', 'alice@test.ru'); await page.fill('#aPass', 'Secret123!'); await page.fill('#aPass2', 'Secret123!');
  await page.click('#auth .btn.pri'); await page.waitForSelector('.app:not([hidden])');
  check('Алиса зарегистрировалась и видит «Добрый …, Алиса!»', (await page.textContent('h1')).includes('Алиса'));
  // данные Алисы + попытка XSS
  await page.click('[data-v="tasks"]'); await page.fill('#tTitle', '<img src=x onerror=alert(1)>Секрет Алисы'); await page.click('form .btn.pri');
  await page.click('[data-v="money"]'); await page.fill('#qText', '1500 продукты'); await page.click('form .btn.pri');
  await page.waitForTimeout(300);
  check('Записи Алисы сохранены на сервере', rows.filter(r => r.col === 'tasks').length === 1 && rows.some(r => r.col === 'money'));
  await page.click('[data-v="tasks"]');
  check('XSS в названии задачи показан как текст, а не выполнен', (await page.textContent('#view')).includes('<img src=x onerror=alert(1)>Секрет Алисы') && dialogs.length === 0 && (await page.$$('#view img')).length === 0);
  // выход
  await page.click('.rail .foot [data-click="logout"]');
  await page.waitForSelector('#auth form');
  check('После выхода токен удалён из браузера', await page.evaluate(() => localStorage.getItem('pult.session.v1') === null));
  check('После выхода данные Алисы не остаются на странице', !(await page.content()).includes('Секрет Алисы'));
  // Боб
  await page.click('text=Создать аккаунт');
  await page.fill('#aName', 'Боб'); await page.fill('#aEmail', 'bob@test.ru'); await page.fill('#aPass', 'Bobpass99'); await page.fill('#aPass2', 'Bobpass99');
  await page.click('#auth .btn.pri'); await page.waitForSelector('.app:not([hidden])'); await page.waitForTimeout(200);
  await page.click('[data-v="tasks"]'); await page.click('text=Сегодня');
  check('Боб не видит задачи Алисы', !(await page.textContent('#view')).includes('Секрет Алисы'));
  await page.click('[data-v="money"]');
  check('Боб не видит расходы Алисы', !(await page.textContent('#view')).includes('продукты'));
  // повторный вход Алисы с неправильным паролем
  await page.click('.rail .foot [data-click="logout"]'); await page.waitForSelector('#auth form');
  await page.fill('#aEmail', 'alice@test.ru'); await page.fill('#aPass', 'wrongpass1'); await page.click('#auth .btn.pri'); await page.waitForTimeout(200);
  check('Неверный пароль не пускает в кабинет', (await page.textContent('.authmsg')).includes('Неверная почта или пароль') && await page.isHidden('.app'));
  await page.fill('#aPass', 'Secret123!'); await page.click('#auth .btn.pri'); await page.waitForSelector('.app:not([hidden])'); await page.waitForTimeout(200);
  await page.click('[data-v="tasks"]');
  check('Алиса снова входит и видит свои данные', (await page.textContent('#view')).includes('Секрет Алисы'));
  // перезагрузка: сессия восстанавливается
  await page.reload(); await page.waitForSelector('.app:not([hidden])'); await page.waitForTimeout(200);
  check('После перезагрузки Алиса остаётся в своём кабинете', (await page.textContent('#who')).includes('Алиса'));
  // кнопки во всех разделах
  const n = c => rows.filter(r => r.col === c).length;
  await page.click('[data-v="tasks"]'); await page.click('#view .check'); await page.waitForTimeout(150);
  check('Задача отмечается выполненной', rows.find(r => r.col === 'tasks').data.done === true);
  await page.click('[data-v="habits"]'); await page.fill('#hName', 'Зарядка'); await page.click('form .btn.pri'); await page.waitForTimeout(150);
  await page.click('.hab-check'); await page.waitForTimeout(150);
  const hl = rows.find(r => r.col === 'habits').data.log, td = await page.evaluate(() => today());
  check('Привычка отмечается именно на сегодня', n('habits') === 1 && hl[td] === true && Object.keys(hl).length === 1);
  check('Квадрат привычки стал отмеченным', await page.$eval('.hab-check', e => e.classList.contains('on')));
  await page.click('.hab-check'); await page.waitForTimeout(150);
  check('Повторное нажатие снимает отметку', !rows.find(r => r.col === 'habits').data.log[td]);
  await page.click('[data-v="home"]'); await page.click('.hpill'); await page.waitForTimeout(150);
  check('Отметка с «Обзора» тоже ставится на сегодня', rows.find(r => r.col === 'habits').data.log[td] === true);
  await page.click('[data-v="health"]'); await page.click('[data-click="water"] >> nth=1'); await page.click('[data-click="mood"] >> nth=3');
  await page.fill('#hSleep', '7,5'); await page.press('#hSleep', 'Tab'); await page.waitForTimeout(200);
  const h = rows.find(r => r.col === 'health'); check('Здоровье: вода, настроение, сон сохраняются', h && h.data.water === 1 && h.data.mood === 4 && h.data.sleep === 7.5);
  await page.click('[data-v="money"]'); await page.click('[data-click="moneyTab"] >> text=Подписки'); await page.fill('#sName', 'Облако'); await page.fill('#sPrice', '149,5'); await page.click('form.form .btn.pri'); await page.waitForTimeout(150);
  await page.click('text=Оплачено'); await page.waitForTimeout(150);
  check('Подписка добавляется (цена с запятой) и «Оплачено» пишет расход', n('subs') === 1 && rows.find(r => r.col === 'subs').data.price === 149.5 && rows.some(r => r.col === 'money' && r.data.note === 'Облако'));
  await page.click('[data-v="notes"]'); await page.click('text=Новая заметка'); await page.fill('#noteTitle', 'Идея'); await page.waitForTimeout(900);
  check('Заметка создаётся и сохраняется сама', rows.some(r => r.col === 'notes' && r.data.title === 'Идея'));
  await page.click('[data-v="board"]'); await page.fill('#kAddidea', 'Баня'); await page.press('#kAddidea', 'Enter'); await page.waitForTimeout(150);
  await page.click('[data-click="moveCard"]'); await page.waitForTimeout(150);
  check('Карточка добавляется и двигается по доске', rows.find(r => r.col === 'board').data.col === 'doing');
  await page.click('[data-v="cal"]'); const w1 = await page.textContent('.sub'); await page.click('[data-click="weekShift"] >> nth=1'); const w2 = await page.textContent('.sub');
  check('Календарь листается по неделям', w1 !== w2);
  await page.click('[data-v="board"]'); const before = n('board'); await page.click('.kcard [data-click="del"]'); await page.waitForTimeout(150);
  check('Удаление работает', n('board') === before - 1);
  // все разделы рендерятся без ошибок
  for (const v of ['home','tasks','habits','cal','health','money','notes','board']) { await page.click(`[data-v="${v}"]`); }
  await page.screenshot({ path: process.env.SHOT || '/tmp/e2e.png' });
  check('Нет нарушений политики безопасности (CSP) в консоли', csp.length === 0);
  check('Нет ошибок JavaScript', errs.length === 0);
  if (csp.length) console.log(csp.slice(0,5)); if (errs.length) console.log(errs.slice(0,5));
  console.table(results.map(([s, n]) => ({ итог: s, проверка: n })));
  console.log('passed', results.filter(r => r[0] === 'OK  ').length, 'failed', results.filter(r => r[0] !== 'OK  ').length);
  await b.close();
})();

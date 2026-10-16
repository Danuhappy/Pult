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
  await page.click('[data-v="money"]');
  check('Аналитика финансов открывается первой и рисует графики', (await page.$$('#view svg.chart')).length >= 4 && (await page.textContent('#view')).includes('Расходы нарастающим итогом'));
  await page.click('[data-click="moneyTab"] >> text=Обязательные платежи'); await page.fill('#sName', 'Облако'); await page.fill('#sPrice', '149,5'); await page.click('form.form .btn.pri'); await page.waitForTimeout(150);
  await page.click('text=Оплачено'); await page.waitForTimeout(150);
  check('Подписка добавляется (цена с запятой) и «Оплачено» пишет расход', n('subs') === 1 && rows.find(r => r.col === 'subs').data.price === 149.5 && rows.some(r => r.col === 'money' && r.data.note === 'Облако'));
  await page.selectOption('#sKind', 'mortgage'); await page.fill('#sName', 'Ипотека'); await page.fill('#sPrice', '25000'); await page.fill('#sRest', '1 500 000'); await page.click('form.form .btn.pri'); await page.waitForTimeout(150);
  const mort = () => rows.find(r => r.col === 'subs' && r.data.kind === 'mortgage');
  check('Ипотека добавляется с остатком долга', mort() && mort().data.rest === 1500000 && mort().data.total === 1500000);
  await page.click('.card:has-text("Кредиты и ипотека") [data-click="paySub"]'); await page.waitForTimeout(150);
  check('«Оплачено» по ипотеке уменьшает остаток и пишет расход «Ипотека»', mort().data.rest === 1475000 && rows.some(r => r.col === 'money' && r.data.cat === 'Ипотека' && r.data.amount === 25000));
  check('Показан прогресс выплаты и число платежей', (await page.textContent('#view')).includes('ещё ≈ 59 платежей'));
  await page.click('[data-v="notes"]'); await page.click('text=Новая заметка'); await page.fill('#noteTitle', 'Идея'); await page.waitForTimeout(900);
  check('Заметка создаётся и сохраняется сама', rows.some(r => r.col === 'notes' && r.data.title === 'Идея'));
  await page.fill('#noteGroupIn', 'Дом'); await page.press('#noteGroupIn', 'Tab'); await page.waitForTimeout(200);
  await page.click('.stkrow [data-click="toggleSticker"] >> nth=2'); await page.waitForTimeout(150);
  await page.click('[data-click="togglePin"]'); await page.waitForTimeout(150);
  const note = () => rows.find(r => r.col === 'notes' && r.data.title === 'Идея').data;
  check('Заметке задаётся группа, стикер и закрепление', note().group === 'Дом' && note().stickers.includes('idea') && note().pinned === true);
  await page.click('text=Новая заметка'); await page.fill('#noteTitle', 'Список покупок'); await page.waitForTimeout(900);
  check('Новая заметка не затирает старую', note().group === 'Дом' && note().title === 'Идея');
  await page.click('.gchip >> text=Дом'); await page.waitForTimeout(100);
  const listTxt = await page.textContent('#noteItems');
  check('Фильтр по группе показывает только её заметки', listTxt.includes('Идея') && !listTxt.includes('Список покупок'));
  await page.click('text=Новая заметка'); await page.fill('#noteTitle', 'Ремонт крыши'); await page.waitForTimeout(900);
  check('Новая заметка при выбранной группе сразу попадает в неё', rows.find(r => r.col === 'notes' && r.data.title === 'Ремонт крыши').data.group === 'Дом');
  await page.click('.ngroups .gchip >> nth=0'); await page.click('.row [data-click="noteFilterSticker"]'); await page.waitForTimeout(100);
  const st = await page.textContent('#noteItems');
  check('Фильтр по стикеру работает', st.includes('Идея') && !st.includes('Список покупок'));
  await page.click('.row [data-click="noteFilterSticker"]'); await page.fill('#noteSearch', 'покуп'); await page.waitForTimeout(100);
  const sr = await page.textContent('#noteItems');
  check('Поиск по заметкам работает', sr.includes('Список покупок') && !sr.includes('Идея'));
  await page.fill('#noteSearch', '');
  await page.click('[data-v="home"]'); check('Доски показаны на «Обзоре», отдельного раздела нет', await page.isVisible('#view .kan') && !(await page.$('[data-v="board"]')));
  await page.fill('#kAddidea', 'Баня'); await page.press('#kAddidea', 'Enter'); await page.waitForTimeout(150);
  await page.click('[data-click="moveCard"]'); await page.waitForTimeout(150);
  check('Карточка добавляется и двигается по доске', rows.find(r => r.col === 'board').data.col === 'doing');
  await page.click('[data-v="cal"]'); const w1 = await page.textContent('.sub'); await page.click('[data-click="weekShift"] >> nth=1'); const w2 = await page.textContent('.sub');
  check('Календарь листается по неделям', w1 !== w2);
  await page.click('[data-v="home"]'); const before = n('board'); await page.click('.kcard [data-click="del"]'); await page.waitForTimeout(150);
  check('Удаление работает', n('board') === before - 1);
  // загрузка банковской выписки
  const ST = require('path').join(__dirname, 'statements', 'out');
  const EXP = JSON.parse(require('fs').readFileSync(ST + '/expected.json'));
  const bankRows = () => rows.filter(r => r.col === 'money' && r.data.src === 'bank' && r.user_id === rows.find(x => x.col === 'tasks').user_id);
  await page.click('[data-v="money"]');
  await page.setInputFiles('#stmtIn', ST + '/sber.pdf'); await page.waitForSelector('#impSum', { timeout: 20000 });
  check('Выписка Сбера (PDF): найдены все операции, суммы сходятся', (await page.textContent('#impSum')).includes(`Выбрано ${EXP.count} из ${EXP.count}`) && (await page.$$('.improw')).length === EXP.count);
  const sumTxt = await page.textContent('#impSum'), want = await page.evaluate(e => [rub(e.exp), rub(e.inc)], EXP);
  check('В предпросмотре верные итоги расходов и доходов', sumTxt.includes(want[0]) && sumTxt.includes(want[1]));
  if (!(sumTxt.includes(want[0]) && sumTxt.includes(want[1]))) console.log('sum:', sumTxt, want);
  await page.click('.improw input[type=checkbox] >> nth=0'); await page.waitForTimeout(50);
  check('Снятая галочка уменьшает число к загрузке', (await page.textContent('#impSave')).includes(String(EXP.count - 1)));
  await page.click('.improw input[type=checkbox] >> nth=0');
  await page.selectOption('.improw select >> nth=0', 'Кафе');
  await page.click('#impSave'); await page.waitForSelector('#impSum', { state: 'detached' }); await page.waitForTimeout(200);
  const br = bankRows();
  check('Операции из выписки сохранены одним пакетом', br.length === EXP.count && Math.round(br.filter(r => r.data.type === 'exp').reduce((s, r) => s + r.data.amount, 0) * 100) / 100 === EXP.exp);
  check('Изменённая вручную категория сохранилась', br.some(r => r.data.cat === 'Кафе'));
  check('Категории расставлены автоматически', br.filter(r => r.data.cat === 'Еда').length > 0 && br.filter(r => r.data.cat === 'Топливо').length > 0 && br.filter(r => r.data.type === 'inc').every(r => r.data.cat === 'Доход'));
  check('После загрузки открыт нужный месяц со списком операций', (await page.textContent('#view')).includes('PYATEROCHKA') && (await page.textContent('.sub')).includes('сентябрь'));
  await page.setInputFiles('#stmtIn', ST + '/sber.pdf'); await page.waitForSelector('#impSum');
  check('Повторная загрузка той же выписки не создаёт дублей', (await page.textContent('#impSum')).includes(`Выбрано 0 из ${EXP.count}`) && await page.isDisabled('#impSave'));
  await page.click('[data-click="stmtCancel"]');
  await page.setInputFiles('#stmtIn', ST + '/tbank.csv'); await page.waitForSelector('#impSum');
  check('Те же операции из другого файла (Т-Банк CSV) помечены как «похоже, уже записано»', (await page.textContent('#impSum')).includes(`Выбрано 0 из ${EXP.count}`) && (await page.textContent('.implist')).includes('похоже, уже записано'));
  check('Отклонённая банком операция не попала в список', !(await page.textContent('.implist')).includes('ОТКЛОНЕНО'));
  await page.click('[data-click="stmtCancel"]');
  const tmp = require('os').tmpdir();
  require('fs').writeFileSync(tmp + '/xss.csv', 'Дата;Сумма;Описание\n05.10.2026;-100,00;<img src=x onerror=alert(2)>Магазин\n');
  await page.setInputFiles('#stmtIn', tmp + '/xss.csv'); await page.waitForSelector('#impSum');
  check('Описание из файла показывается как текст (защита от XSS)', (await page.textContent('.implist')).includes('<img src=x onerror=alert(2)>Магазин') && (await page.$$('.implist img')).length === 0 && dialogs.length === 0);
  await page.click('[data-click="stmtCancel"]');
  require('fs').writeFileSync(tmp + '/junk.pdf', '%PDF-1.4 это не настоящий pdf');
  await page.setInputFiles('#stmtIn', tmp + '/junk.pdf'); await page.waitForSelector('.banner:has-text("Не получилось прочитать")', { timeout: 15000 });
  check('Битый файл: понятное сообщение, без падения', true);
  await page.click('[data-click="stmtCancel"]');
  // все разделы рендерятся без ошибок
  await page.click('[data-v="habits"]'); check('Плашки про уведомления больше нет', !(await page.textContent('#view')).includes('Напишите в чат'));
  for (const v of ['home','tasks','habits','cal','health','money','notes']) { await page.click(`[data-v="${v}"]`); }
  // телефон: разделы внизу экрана
  await page.setViewportSize({ width: 390, height: 844 }); await page.click('[data-v="home"]'); await page.waitForTimeout(150);
  const nb = await page.evaluate(() => { const r = document.querySelector('#nav').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, w: r.width }; });
  check('На телефоне вкладки разделов прижаты к низу экрана', Math.round(nb.bottom) === nb.h && nb.top > nb.h - 120 && Math.round(nb.w) === 390);
  await page.click('[data-v="money"]'); await page.waitForTimeout(150);
  check('Нижняя вкладка переключает раздел', (await page.textContent('h1')).includes('Финансы') && await page.$eval('[data-v="money"]', e => e.classList.contains('on')));
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(100);
  check('Нижние вкладки не закрывают конец страницы', await page.evaluate(() => { const c = [...document.querySelectorAll('main .card')].pop().getBoundingClientRect(); return c.bottom <= document.querySelector('#nav').getBoundingClientRect().top; }));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.screenshot({ path: process.env.SHOT || '/tmp/e2e.png' });
  check('Нет нарушений политики безопасности (CSP) в консоли', csp.length === 0);
  check('Нет ошибок JavaScript', errs.length === 0);
  if (csp.length) console.log(csp.slice(0,5)); if (errs.length) console.log(errs.slice(0,5));
  console.table(results.map(([s, n]) => ({ итог: s, проверка: n })));
  console.log('passed', results.filter(r => r[0] === 'OK  ').length, 'failed', results.filter(r => r[0] !== 'OK  ').length);
  await b.close();
})();

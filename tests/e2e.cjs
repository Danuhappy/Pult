// Сквозная проверка сайта на мок-сервере Supabase (auth + REST с изоляцией по пользователю).
// Запуск: PW=<путь к playwright> node tests/e2e.cjs  (сайт должен раздаваться на http://127.0.0.1:8099)
const { chromium } = require(process.env.PW);
const crypto = require('crypto');
const BASE = 'http://127.0.0.1:8099/';
const SB = 'https://xhvamuaxrhshfouztqfn.supabase.co'; // запросы перехватываются моком, в сеть не уходят
const users = {}, tokens = {}, rows = [], pushSubs = [], pushTests = [], hsTok = {};
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
  if (p.startsWith('/rest/v1/rpc/health_token_')) { if (!uid) return json(route, 401, {}); const a = p.slice('/rest/v1/rpc/health_token_'.length);
    if (a === 'new') { hsTok[uid] = { t: 'pulse_' + crypto.randomBytes(24).toString('hex'), created: new Date().toISOString(), used: null }; return json(route, 200, hsTok[uid].t); }
    if (a === 'info') return json(route, 200, hsTok[uid] ? { created: hsTok[uid].created, used: hsTok[uid].used } : null);
    if (a === 'revoke') { delete hsTok[uid]; return json(route, 200, null); } }
  if (p === '/rest/v1/rpc/push_subscribe') { if (!uid) return json(route, 401, {}); pushSubs.push({ user_id: uid, ...body }); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
  if (p === '/rest/v1/push_subs' && m === 'DELETE') { const ep = url.searchParams.get('endpoint').slice(3); for (let i = pushSubs.length - 1; i >= 0; i--) if (pushSubs[i].user_id === uid && pushSubs[i].p_endpoint === ep) pushSubs.splice(i, 1); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
  if (p === '/functions/v1/push') { if (url.searchParams.get('action') === 'vapid') return json(route, 200, { key: 'B' + 'A'.repeat(86) }); if (body.action === 'test') { pushTests.push(uid); return uid ? json(route, 200, { sent: 1 }) : json(route, 401, {}); } }
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
  // день отдыха: привычка не по плану сегодня всё равно видна и отмечается
  const wd = await page.evaluate(() => new Date().getDay());
  await page.click('[data-v="habits"]'); await page.click(`.hday[data-args='["${rows.find(r => r.col === 'habits').id}",${wd}]']`); await page.waitForTimeout(150);
  const hb = () => rows.find(r => r.col === 'habits').data;
  check('У привычки можно поменять дни недели', !hb().days.includes(wd) && hb().days.length === 6);
  check('В день отдыха кнопка отметки на странице привычек не заблокирована', !(await page.$eval('.hab-check', e => e.disabled)) && (await page.textContent('#view')).includes('по плану отдых'));
  await page.click('[data-v="home"]'); await page.waitForTimeout(100);
  check('В день отдыха привычка всё равно видна на «Обзоре»', await page.isVisible('.hpill.rest'));
  const before2 = !!hb().log[td]; await page.click('.hpill'); await page.waitForTimeout(150);
  check('И её можно отметить на «Обзоре»', !!hb().log[td] === !before2);
  await page.click('.hpill'); await page.waitForTimeout(150);
  await page.click('[data-v="habits"]'); await page.click(`.hday[data-args='["${rows.find(r => r.col === 'habits').id}",${wd}]']`); await page.waitForTimeout(150);
  check('День возвращается обратно', hb().days.includes(wd));
  await page.click('[data-v="home"]'); await page.waitForTimeout(100);
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
  // изменение операции и запоминание категории
  const myUid = rows.find(x => x.col === 'tasks').user_id;
  const pyat = () => rows.filter(r => r.user_id === myUid && r.col === 'money' && /PYATEROCHKA/.test(r.data.note || ''));
  await page.click('[data-v="money"]'); await page.click('.mtabs [data-args=\'["ops"]\']'); await page.waitForTimeout(150);
  const opT = pyat()[0]; const others = pyat().length - 1;
  await page.click(`.opopen[data-args='["${opT.id}"]']`); await page.waitForTimeout(150);
  check('Нажатие на операцию открывает форму изменения', await page.isVisible('form.opedit'));
  await page.fill('form.opedit [name="a"]', '999,50'); await page.selectOption('form.opedit [name="c"]', 'Дом и стройка'); await page.fill('form.opedit [name="n"]', 'PYATEROCHKA 1234 (исправил)');
  await page.click('form.opedit .btn.pri'); await page.waitForTimeout(400);
  const t2 = rows.find(r => r.id === opT.id).data;
  check('Сумма, категория и описание операции сохранены', t2.amount === 999.5 && t2.cat === 'Дом и стройка' && t2.note === 'PYATEROCHKA 1234 (исправил)');
  check('Остальные такие же операции тоже получили новую категорию', others > 0 && pyat().every(r => r.data.cat === 'Дом и стройка'));
  const rules = (rows.find(r => r.user_id === myUid && r.col === 'meta' && r.id === 'catrules') || { data: {} }).data.r || {};
  check('Правило запомнено: «pyaterochka» → «Дом и стройка»', rules.pyaterochka === 'Дом и стройка');
  await page.fill('#qText', '300 Пятёрочка pyaterochka'); await page.click('form[data-submit="addQuick"] .btn.pri'); await page.waitForTimeout(250);
  check('Новая запись про это место сама получает выученную категорию', rows.some(r => r.user_id === myUid && r.col === 'money' && r.data.amount === 300 && r.data.cat === 'Дом и стройка'));
  await page.click(`.opopen[data-args='["${opT.id}"]']`); await page.waitForTimeout(100); await page.fill('form.opedit [name="a"]', '0'); await page.click('form.opedit .btn.pri'); await page.waitForTimeout(150);
  check('Нулевая сумма не сохраняется', rows.find(r => r.id === opT.id).data.amount === 999.5 && await page.isVisible('form.opedit'));
  await page.click('form.opedit [data-click="opCancel"]'); await page.waitForTimeout(100);
  check('«Отмена» закрывает форму без изменений', !(await page.isVisible('form.opedit')));
  // заметки на телефоне: список → заметка → назад
  await page.setViewportSize({ width: 390, height: 844 }); await page.click('[data-v="notes"]'); await page.waitForTimeout(150);
  check('На телефоне сначала виден список заметок', await page.isVisible('#noteItems') && !(await page.isVisible('#noteText')));
  await page.click('#noteItems .nitem >> nth=0'); await page.waitForTimeout(150);
  check('Нажатие на заметку открывает её для изменения', await page.isVisible('#noteText') && !(await page.isVisible('#noteItems')));
  await page.fill('#noteText', 'Изменил с телефона'); await page.waitForTimeout(900);
  check('Изменения заметки с телефона сохраняются', rows.some(r => r.col === 'notes' && r.data.text === 'Изменил с телефона'));
  await page.click('[data-click="noteBack"]'); await page.waitForTimeout(100);
  check('«← Все заметки» возвращает к списку', await page.isVisible('#noteItems'));
  await page.setViewportSize({ width: 1280, height: 860 });
  // все разделы рендерятся без ошибок
  await page.click('[data-v="habits"]'); check('Плашки про уведомления больше нет', !(await page.textContent('#view')).includes('Напишите в чат'));
  for (const v of ['home','tasks','habits','cal','health','money','notes']) { await page.click(`[data-v="${v}"]`); }
  // настройка экрана (как на iPhone)
  const lay = () => (rows.find(r => r.col === 'meta' && r.id === 'layout' && r.user_id === rows.find(x => x.col === 'tasks').user_id) || { data: {} }).data;
  const order = () => page.$$eval('.blkgrid[data-page="home"] > .blk', bs => bs.map(b => b.dataset.blk));
  await page.click('[data-v="home"]'); await page.click('.rail .editbtn'); await page.waitForTimeout(150);
  check('Кнопка «Настроить» включает режим настройки: блоки и вкладки «дрожат»', await page.isVisible('.editpanel') && !!(await page.$('.blkgrid.editing')) && !!(await page.$('#nav.editing')) && await page.$eval('.blkgrid.editing > .blk', e => getComputedStyle(e).animationName === 'jiggle'));
  await page.click('.blk[data-blk="prod"] .jx', { force: true }); await page.waitForTimeout(150);
  check('«−» скрывает блок и запоминает это в кабинете', !(await page.$('.blk[data-blk="prod"]')) && (lay().pages.home.hidden || []).includes('prod') && (await page.textContent('.editpanel')).includes('Продуктивность'));
  await page.click('.editpanel [data-click="blkShow"]', { force: true }); await page.waitForTimeout(150);
  check('«+» возвращает скрытый блок', !!(await page.$('.blk[data-blk="prod"]')) && !(lay().pages.home.hidden || []).includes('prod'));
  await page.click('.blk[data-blk="score"] [data-click="blkMove"] >> nth=1', { force: true }); await page.waitForTimeout(150);
  check('Кнопка ↓ опускает блок', (await order())[1] === 'score' && lay().pages.home.order[1] === 'score');
  const dragTo = async (from, to, pos) => { const a = await page.$eval(from, e => { const r = e.querySelector('.blkname, .nl').getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2]; });
    await page.mouse.move(a[0], a[1]); await page.mouse.down(); for (let i = 1; i <= 12; i++) { const b = await page.$eval(to, (e, pos) => { const r = e.getBoundingClientRect(); return pos === 'top' ? [r.left + r.width / 2, r.top + 6] : [r.left + r.width / 2, r.bottom - 6]; }, pos); await page.mouse.move(a[0] + (b[0] - a[0]) * i / 12, a[1] + (b[1] - a[1]) * i / 12); await page.waitForTimeout(16); } await page.mouse.up(); await page.waitForTimeout(200); };
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(() => document.querySelector('.blk[data-blk="tiles"]').scrollIntoView({ block: 'start' }));
  await dragTo('.blk[data-blk="habits"]', '.blk[data-blk="tiles"]', 'top');
  check('Блок перетаскивается мышью на новое место', (await order()).indexOf('habits') < (await order()).indexOf('tiles') && lay().pages.home.order.indexOf('habits') < lay().pages.home.order.indexOf('tiles'));
  check('После перетаскивания не осталось «призрака» и висящего блока', !(await page.$('.dragph')) && !(await page.$('.lifted')));
  await page.click('.blk[data-blk="tasks"] .wbtn', { force: true }); await page.waitForTimeout(150);
  check('Ширина блока переключается (столбцы)', lay().pages.home.w.tasks === 2 && await page.$eval('.blk[data-blk="tasks"]', e => e.classList.contains('w2')));
  await page.click('.blk[data-blk="tasks"] [data-click="homeTab"] >> nth=1', { force: true }).catch(() => {}); await page.waitForTimeout(100);
  check('В режиме настройки кнопки внутри блоков не срабатывают случайно', (await page.textContent('.blk[data-blk="tasks"]')).includes('На сегодня'));
  await page.click('#nav [data-v="health"] .jx', { force: true }); await page.waitForTimeout(150);
  check('Вкладку меню можно скрыть', !(await page.$('#nav [data-v="health"]')) && lay().navHidden.includes('health') && (await page.textContent('.editpanel')).includes('Здоровье'));
  await page.click('.editpanel [data-click="navShow"]', { force: true }); await page.waitForTimeout(150);
  check('Скрытая вкладка возвращается', !!(await page.$('#nav [data-v="health"]')) && !lay().navHidden.includes('health'));
  await dragTo('#nav [data-v="notes"]', '#nav [data-v="home"]', 'top');
  const navKeys = await page.$$eval('#nav > button', bs => bs.map(b => b.dataset.v));
  check('Вкладки меню перетаскиваются, и порядок сохраняется', navKeys[0] === 'notes' && lay().nav[0] === 'notes' && (await page.textContent('h1')).includes('Добрый') || (await page.textContent('h1')).includes('Доброе') || (await page.textContent('h1')).includes('Доброй'));
  await page.click('.editpanel [data-click="toggleEdit"]', { force: true }); await page.waitForTimeout(150);
  check('«Готово» выключает режим настройки', !(await page.$('.blkgrid.editing')) && !(await page.$('.editpanel')));
  await page.reload(); await page.waitForSelector('.app:not([hidden])'); await page.waitForTimeout(300); await page.click('[data-v="home"]');
  const after = await order();
  check('Расположение сохраняется после перезагрузки', after.indexOf('habits') < after.indexOf('tiles') && (await page.$$eval('#nav > button', bs => bs[0].dataset.v)) === 'notes');
  // палец на телефоне: удержание + перетаскивание, и обычная прокрутка не двигает блоки
  await page.setViewportSize({ width: 390, height: 844 }); await page.click('.rail .editbtn'); await page.waitForTimeout(200);
  await page.evaluate(() => scrollTo(0, 0));
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const center = sel => page.$eval(sel, e => { const r = e.querySelector('.blkname').getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; });
  let o1 = await order(); const firstId = o1[0], secondId = o1[1];
  await page.evaluate(id => { document.querySelector(`.blk[data-blk="${id}"]`).scrollIntoView({ block: 'start' }); }, firstId);
  let [sx, sy] = await center(`.blk[data-blk="${firstId}"]`);
  await touch('touchStart', sx, sy); for (let i = 1; i <= 6; i++) { await touch('touchMove', sx, sy + i * 15); await page.waitForTimeout(10); } await touch('touchEnd');
  await page.waitForTimeout(200);
  check('Быстрый свайп пальцем не двигает блок (страница просто листается)', JSON.stringify(await order()) === JSON.stringify(o1));
  await page.evaluate(id => { document.querySelector(`.blk[data-blk="${id}"]`).scrollIntoView({ block: 'start' }); scrollBy(0, -20); }, firstId); await page.waitForTimeout(100); [sx, sy] = await center(`.blk[data-blk="${secondId}"]`);
  const target = await page.$eval(`.blk[data-blk="${firstId}"]`, e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 10]; });
  await touch('touchStart', sx, sy); await page.waitForTimeout(260);
  for (let i = 1; i <= 15; i++) { await touch('touchMove', sx + (target[0] - sx) * i / 15, sy + (target[1] - sy) * i / 15); await page.waitForTimeout(16); }
  await touch('touchEnd'); await page.waitForTimeout(250);
  const o2 = await order();
  check('Удержание пальцем и перетаскивание переставляет блок', o2[0] === secondId && o2[1] === firstId);
  await page.click('.editpanel [data-click="resetLayout"]', { force: true }); await page.click('.editpanel [data-click="resetLayout"]', { force: true }); await page.waitForTimeout(200);
  check('«Сбросить» возвращает стандартный вид', JSON.stringify(lay()) === '{}' && (await order())[0] === 'score' && (await page.$$eval('#nav > button', bs => bs[0].dataset.v)) === 'home');
  await page.click('.editpanel [data-click="toggleEdit"]', { force: true }); await page.waitForTimeout(100);
  await page.setViewportSize({ width: 1280, height: 860 });
  // темы оформления
  const meta = () => (rows.find(r => r.col === 'meta' && r.id === 'settings' && r.user_id === rows.find(x => x.col === 'tasks').user_id) || { data: {} }).data;
  await page.click('[data-v="home"]'); await page.click('.rail .editbtn', { force: true }); await page.waitForTimeout(150);
  check('В «Настроить» есть выбор из 6 тем', (await page.$$('.themes .thm')).length === 6 && (await page.textContent('.themes')).includes('Океан') && !(await page.textContent('.themes')).includes('Яркий'));
  for (const th of ['black', 'light', 'sunset', 'tropic', 'ocean']) {
    await page.click(`.thm[data-args='["${th}"]']`, { force: true }); await page.waitForTimeout(120);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(`Тема «${th}» включается и сохраняется в кабинете`, await page.evaluate(() => document.documentElement.dataset.theme) === th && meta().theme === th && bg !== 'rgb(13, 3, 3)');
  }
  await page.click(`.thm[data-args='["light"]']`, { force: true }); await page.waitForTimeout(150);
  await page.click('.editpanel [data-click="toggleEdit"]', { force: true }); await page.reload(); await page.waitForSelector('.app:not([hidden])'); await page.waitForTimeout(300);
  check('Выбранная тема остаётся после перезагрузки', await page.evaluate(() => document.documentElement.dataset.theme) === 'light' && await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(244, 245, 247)');
  await page.evaluate(() => localStorage.removeItem('pulse.theme')); await page.reload(); await page.waitForSelector('.app:not([hidden])'); await page.waitForTimeout(400);
  check('Тема подтягивается из кабинета на другом устройстве', await page.evaluate(() => document.documentElement.dataset.theme) === 'light');
  await page.click('.rail .editbtn', { force: true }); await page.click(`.thm[data-args='["neon"]']`, { force: true }); await page.waitForTimeout(150);
  check('Возврат к «Неону» убирает тему', !(await page.evaluate(() => document.documentElement.hasAttribute('data-theme'))) && meta().theme === 'neon');
  await page.click('.editpanel [data-click="toggleEdit"]', { force: true }); await page.waitForTimeout(100);
  // уведомления: подписка телефона (push-сервис браузера подменён — в тесте нет Apple/Google)
  await page.evaluate(() => {
    const fakeSub = { endpoint: 'https://web.push.apple.com/test-device', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } }; }, unsubscribe: async () => { window.__subbed = false; return true; } };
    window.__subbed = false; window.__perm = 'default';
    const pm = { getSubscription: async () => window.__subbed ? fakeSub : null, subscribe: async (o) => { window.__appKey = o.applicationServerKey.length; window.__subbed = true; return fakeSub; } };
    const reg = { pushManager: pm };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: async (u) => { window.__swUrl = u; return reg; }, ready: Promise.resolve(reg), getRegistration: async () => reg } });
    window.PushManager = window.PushManager || function () {};
    window.Notification = { get permission() { return window.__perm; }, requestPermission: async () => (window.__perm = 'granted') };
  });
  await page.click('[data-v="habits"]'); await page.evaluate(() => refreshPush()); await page.waitForTimeout(150);
  check('На странице привычек есть кнопка «Включить уведомления»', await page.isVisible('[data-click="pushEnable"]'));
  await page.click('[data-click="pushEnable"]'); await page.waitForTimeout(400);
  const me1 = rows.find(x => x.col === 'tasks').user_id;
  check('Телефон подписывается: разрешение, фоновый помощник sw.js, ключ сервера', await page.evaluate(() => window.__perm === 'granted' && window.__swUrl === 'sw.js' && window.__appKey === 65));
  check('Подписка сохранена в кабинете (с часовым поясом)', pushSubs.length === 1 && pushSubs[0].user_id === me1 && pushSubs[0].p_endpoint === 'https://web.push.apple.com/test-device' && typeof pushSubs[0].p_tz === 'string' && pushSubs[0].p_tz.length > 2);
  check('Сразу отправлено проверочное уведомление', pushTests.length === 1 && pushTests[0] === me1);
  check('После включения кнопка исчезает', !(await page.isVisible('[data-click="pushEnable"]')));
  await page.click('[data-v="home"]'); await page.click('.rail .editbtn', { force: true }); await page.waitForTimeout(150);
  check('В «Настроить» видно, что уведомления включены', (await page.textContent('.editpanel')).includes('Уведомления включены'));
  await page.click('.editpanel [data-click="pushDisable"]', { force: true }); await page.waitForTimeout(300);
  check('Уведомления выключаются и подписка удаляется из кабинета', pushSubs.length === 0 && await page.evaluate(() => window.__subbed === false));
  await page.click('.editpanel [data-click="toggleEdit"]', { force: true });
  await page.evaluate(() => { window.__perm = 'denied'; }); await page.click('[data-v="habits"]'); await page.evaluate(() => refreshPush()); await page.waitForTimeout(150);
  check('Если уведомления запрещены — подсказка, где их разрешить', (await page.textContent('#view')).includes('Настройки') && (await page.textContent('#view')).includes('Уведомления'));
  // автозагрузка из Apple Здоровье
  await page.click('#nav [data-v="health"]'); await page.waitForTimeout(250);
  check('Здоровье: есть карточка автозагрузки с кнопкой «Подключить»', (await page.textContent('.hscard')).includes('Apple Здоровье') && !!(await page.$('.hscard [data-click="hsOn"]')));
  await page.click('.hscard [data-click="hsOn"]'); await page.waitForTimeout(250);
  const hsv = await page.$eval('#hs_token', e => e.value).catch(() => '');
  const myHs = Object.values(hsTok)[0];
  check('Ключ выдаётся и показывается вместе с адресом и инструкцией', /^pulse_[0-9a-f]{48}$/.test(hsv) && myHs && myHs.t === hsv && (await page.$eval('#hs_url', e => e.value)).endsWith('/rest/v1/rpc/health_ingest') && await page.$eval('.hsguide', e => e.open));
  await page.click('.hscard [data-click="hsCopy"] >> nth=0'); await page.waitForTimeout(100);
  hsTok[Object.keys(hsTok)[0]].used = new Date().toISOString();
  await page.click('#nav [data-v="home"]'); await page.click('#nav [data-v="health"]'); await page.evaluate(() => loadAll()); await page.waitForTimeout(250);
  check('Видно время последней загрузки с iPhone', (await page.textContent('.hscard')).includes('последняя загрузка: сегодня в'));
  await page.click('.hscard [data-click="hsOff"]'); await page.waitForTimeout(250);
  check('Автозагрузку можно отключить — ключ удаляется', Object.keys(hsTok).length === 0 && !!(await page.$('.hscard [data-click="hsOn"]')));
  // телефон: разделы внизу экрана
  await page.setViewportSize({ width: 390, height: 844 }); await page.click('[data-v="home"]'); await page.waitForTimeout(150);
  const nb = await page.evaluate(() => { const r = document.querySelector('#nav').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, w: r.width }; });
  check('На телефоне вкладки разделов прижаты к низу экрана', Math.round(nb.bottom) === nb.h && nb.top > nb.h - 120 && Math.round(nb.w) === 390);
  check('На «Обзоре» видны ближайшие обязательные платежи (на месяц вперёд)', (await page.textContent('#view')).includes('Ближайшие обязательные платежи') && (await page.textContent('#view')).includes('Облако'));
  await page.click('[data-v="money"]'); await page.waitForTimeout(150);
  const pt = await page.$eval('.mtabs [data-args=\'["subs"]\']', e => { const r = e.getBoundingClientRect(); return { top: r.top, vis: r.width > 0 && getComputedStyle(e).visibility !== 'hidden' }; });
  check('На телефоне вкладка «Платежи» видна сразу, без прокрутки', pt.vis && pt.top > 0 && pt.top < 600);
  await page.click('.mtabs [data-args=\'["subs"]\']'); await page.waitForTimeout(150);
  check('Список платежей стоит выше формы добавления', await page.evaluate(() => { const l = [...document.querySelectorAll('#view .card h2')].find(h => /Подписки|Кредиты/.test(h.textContent)); const f = document.querySelector('form[data-submit="addSub"]'); return !!l && !!f && l.getBoundingClientRect().top < f.getBoundingClientRect().top; }));
  await page.click('.mtabs [data-args=\'["dash"]\']'); await page.waitForTimeout(100);
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

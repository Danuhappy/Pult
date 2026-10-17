/* Pulse — разбор банковских выписок (PDF, CSV, Excel).
   Файл читается только в браузере пользователя и никуда не отправляется:
   в базу уходят лишь найденные операции (дата, сумма, описание, категория). */
(function (root) {
  "use strict";

  const MON = { янв:1, фев:2, мар:3, апр:4, мая:5, май:5, июн:6, июл:7, авг:8, сен:9, окт:10, ноя:11, дек:12 };
  const pad = n => String(n).padStart(2, "0");
  const validYmd = (y, m, d) => { if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null; const dt = new Date(y, m - 1, d); return dt.getMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null; };

  /* ---- даты ---- */
  const DATE_NUM = /(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?!\d)/;
  const DATE_ISO = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;
  const DATE_WORD = /(?<!\d)(\d{1,2})\s+(янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*\.?\s+(\d{4})/i;
  function parseDate(s) {
    if (s == null) return null;
    s = String(s).trim();
    let m = s.match(DATE_ISO); if (m) return validYmd(+m[1], +m[2], +m[3]);
    m = s.match(DATE_NUM); if (m) { let y = +m[3]; if (m[3].length === 2) y += 2000; return validYmd(y, +m[2], +m[1]); }
    m = s.match(DATE_WORD); if (m) return validYmd(+m[3], MON[m[2].toLowerCase()], +m[1]);
    return null;
  }
  function excelSerial(n) { // дата из Excel: число дней с 30.12.1899
    if (typeof n !== "number" || n < 30000 || n > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
    return validYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const LEAD_DATE = new RegExp("^\\s*(?:" + DATE_NUM.source + "|" + DATE_ISO.source + "|" + DATE_WORD.source + ")", "i");

  /* ---- суммы ---- */
  const MINUS = /[-−–]/;
  // сумма с копейками: 1 234,56 / 1234.56 / -1 234,56 / +500,00
  const AMOUNT_G = /(?<![\d.,])([+\-−–]\s?)?(\d{1,3}(?:[   ]\d{3})+|\d+)([.,]\d{2})(?![\d])/g;
  function parseAmountStr(s) { // для ячеек таблиц: допускает и целые числа
    if (typeof s === "number") return isFinite(s) ? s : null;
    if (s == null) return null;
    let t = String(s).replace(/[   ]/g, "").replace(/(руб\.?|rub|rur|₽|р\.)/gi, "").trim();
    if (!t) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (/^[-−–]/.test(t)) { neg = true; t = t.slice(1); } else if (t[0] === "+") t = t.slice(1);
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");      // 1,234.56
    else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, ""); // 1.234,56
    t = t.replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const v = parseFloat(t);
    return neg ? -v : v;
  }

  /* ---- общее ---- */
  const INCOME_W = ["зачислен", "поступлен", "пополнен", "зарплат", "заработн", "возврат", "перевод от", "входящий перевод", "кэшбэк", "кешбэк", "cashback", "проценты на остаток", "выплата процентов", "refund"];
  const SKIP_LINE = /(остаток|итого|баланс|всего|оборот|сальдо|задолженност|расшифровка|продолжение|страница\s+\d|стр\.\s*\d|page\s+\d)/i;
  const HEADER_LINE = /(дата\s+(операции|проводки|списания|обработки)|описание\s+операции|сумма\s+(в\s+валюте|операции|платежа)|категория\s+сумма|наименование\s+операции)/i;
  const FAIL_STATUS = /(fail|отклон|отмен|declin|reject|ошибк)/i;
  // названия категорий, которые банки (Сбер, Т-Банк и др.) печатают рядом с операцией
  const BANK_CATS = ["Коммунальные платежи, связь, интернет", "Здоровье и красота", "Рестораны и кафе", "Одежда и аксессуары", "Отдых и развлечения", "Все для дома", "Всё для дома",
    "Перевод с карты", "Перевод на карту", "Перевод СБП", "Выдача наличных", "Внесение наличных", "Прочие операции", "Прочие расходы", "Супермаркеты", "Транспорт", "Автомобиль",
    "Фастфуд", "Рестораны", "Топливо", "Аптеки", "Связь", "Маркетплейсы", "Дом и ремонт", "Одежда и обувь", "Развлечения", "Медицина", "Автоуслуги", "Каршеринг", "Такси", "ЖКХ", "Переводы", "Наличные", "Зарплата", "Пополнения", "Пополнение", "Подписки", "Бонусы", "Кэшбэк", "Прочее", "Другое"];
  const clean = s => String(s || "").replace(/\s+/g, " ").trim();

  function tidyDesc(s) {
    return clean(String(s || "")
      .replace(new RegExp(DATE_NUM.source, "g"), " ")
      .replace(new RegExp(DATE_ISO.source, "g"), " ")
      .replace(/(?<!\d)\d{1,2}:\d{2}(:\d{2})?(?!\d)/g, " ")
      .replace(AMOUNT_G, " ")
      .replace(/операция по (карте|счету|счёту)\s*[*•·x]*\s*\d{0,4}/gi, " ")
      .replace(/^\s*(оплата товаров и услуг|оплата в|оплата|покупка в|покупка)\s+/i, " ")
      .replace(/\bCRD_[A-Z0-9]+\b/gi, " ")
      .replace(/(карта|card)?\s*[*•·]{2,}\s*\d{4}/gi, " ")
      .replace(/(?<![\wЀ-ӿ])(rub|rur|руб\.?|₽|р\.)(?![\wЀ-ӿ])/gi, " ")
      .replace(/(?<!\S)\d{6}(?!\S)/g, " ") // код авторизации
      .replace(/^[\s\-–—:;,.|]+|[\s\-–—:;,.|]+$/g, ""))
      .slice(0, 140);
  }

  function hash(s) { // короткий устойчивый ключ, чтобы повторная загрузка не создавала дублей
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 + c, 2246822519) >>> 0; }
    return h1.toString(36) + h2.toString(36);
  }
  function finalize(ops) {
    const seen = {};
    return ops.filter(o => o.date && o.amount > 0 && o.amount < 1e9).map(o => {
      o.amount = Math.round(o.amount * 100) / 100;
      o.desc = clean(o.desc).slice(0, 140);
      o.bankCat = clean(o.bankCat).slice(0, 60);
      const base = [o.date, o.type, o.amount.toFixed(2), o.desc.toLowerCase()].join("|");
      seen[base] = (seen[base] || 0) + 1;
      o.key = "b:" + hash(base + "#" + seen[base]);
      return o;
    });
  }

  /* ---- PDF: строки текста → операции ---- */
  // lines: массив строк страницы в порядке чтения (каждая строка — уже склеенный текст)
  function parseTextLines(lines) {
    const rows = []; let cur = null, cont = 0;
    for (const raw of lines) {
      const line = clean(raw);
      if (!line) continue;
      const starts = LEAD_DATE.test(line);
      if (HEADER_LINE.test(line)) { cur = null; continue; }
      if (SKIP_LINE.test(line)) { cur = null; continue; }
      const date = starts ? parseDate(line.match(LEAD_DATE)[0]) : null;
      const noDates = line.replace(new RegExp(DATE_NUM.source, "g"), " ").replace(new RegExp(DATE_ISO.source, "g"), " ");
      const amts = [...noDates.matchAll(AMOUNT_G)];
      if (date && amts.length) {
        const a = amts[0];
        const sign = a[1] ? (MINUS.test(a[1]) ? "-" : "+") : "";
        const value = parseFloat((a[2] + a[3]).replace(/[   ]/g, "").replace(",", "."));
        cur = { date, sign, amount: value, raw: [line], bankCat: "" };
        rows.push(cur); cont = 0;
      } else if (cur && cont < 3) {
        cur.raw.push(line);
        cont++;
      }
    }
    rows.forEach(r => {
      // склеиваем строки операции и убираем повторы (у Сбера описание идёт второй строкой)
      const parts = []; r.raw.map(tidyDesc).forEach(t => { if (t && !parts.some(x => x.toLowerCase().includes(t.toLowerCase()))) parts.push(t); });
      // у Сбера первая строка операции — только категория, описание во второй
      const bc = parts.length > 1 && BANK_CATS.find(c => c.toLowerCase() === parts[0].toLowerCase());
      if (bc) { r.bankCat = bc; parts.shift(); }
      r.desc = tidyDesc(parts.join(" "));
      delete r.raw;
    });
    // последние 4 цифры карты, которые банк печатает в каждой строке, — не часть описания
    if (rows.length >= 5) {
      const cnt = {}; rows.forEach(r => new Set(r.desc.match(/(?<!\S)\d{4}(?!\S)/g) || []).forEach(t => cnt[t] = (cnt[t] || 0) + 1));
      const card = Object.keys(cnt).filter(t => cnt[t] >= rows.length * 0.6);
      if (card.length) rows.forEach(r => { const d = clean(r.desc.replace(new RegExp("(?<!\\S)(" + card.join("|") + ")(?!\\S)", "g"), " ")); if (d) r.desc = d; });
    }
    return rows;
  }
  function decideTypes(rows) {
    const hasMinus = rows.some(r => r.sign === "-"), hasPlus = rows.some(r => r.sign === "+");
    return rows.map(r => {
      let type;
      if (r.sign === "-") type = "exp";
      else if (r.sign === "+") type = "inc";
      else if (hasMinus && !hasPlus) type = "inc";
      else if (hasPlus && !hasMinus) type = "exp";
      else type = INCOME_W.some(w => r.desc.toLowerCase().includes(w)) ? "inc" : "exp";
      return { date: r.date, type, amount: r.amount, desc: r.desc, bankCat: r.bankCat || "" };
    });
  }
  // items: [{str, x, y, w, page}] из pdf.js → строки
  function itemsToLines(items) {
    const byPage = {};
    items.forEach(it => { if (it.str && it.str.trim()) (byPage[it.page] = byPage[it.page] || []).push(it); });
    const lines = [];
    Object.keys(byPage).map(Number).sort((a, b) => a - b).forEach(p => {
      const arr = byPage[p].sort((a, b) => b.y - a.y || a.x - b.x);
      const groups = [];
      arr.forEach(it => {
        const g = groups.find(g => Math.abs(g.y - it.y) <= Math.max(2, (it.h || 8) * 0.35));
        if (g) g.items.push(it); else groups.push({ y: it.y, items: [it] });
      });
      groups.sort((a, b) => b.y - a.y).forEach(g => {
        g.items.sort((a, b) => a.x - b.x);
        let s = "", end = null;
        g.items.forEach(it => {
          const gap = end === null ? 0 : it.x - end;
          if (s && !/\s$/.test(s) && !/^\s/.test(it.str) && (gap > Math.max(1, (it.h || 8) * 0.15) || !(it.w > 0))) s += " ";
          s += it.str; end = it.x + (it.w || 0);
        });
        lines.push(s);
      });
    });
    return lines;
  }
  function fromPdfItems(items) { return finalize(decideTypes(parseTextLines(itemsToLines(items)))); }

  /* ---- таблицы (CSV, Excel) ---- */
  const H = {
    date: [/^дата\s+операции/, /^дата\s+и\s+время/, /^дата\s+совершения/, /^дата$/, /^дата\b/, /^date/, /operation\s*date/],
    amount: [/сумма\s+платежа/, /сумма\s+в\s+валюте\s+сч[её]та/, /сумма\s+по\s+сч[её]ту/, /сумма\s+в\s+рублях/, /сумма\s+операции/, /^сумма$/, /^сумма/, /amount/],
    inc: [/^приход/, /^поступлени/, /^зачислени/, /^пополнени/, /^кредит$/, /^кредит\s*\(/, /^credit/, /^доход/],
    exp: [/^расход/, /^списани/, /^дебет$/, /^дебет\s*\(/, /^debit/],
    desc: [/^описание/, /назначение/, /^детали/, /^наименование/, /контрагент/, /^получатель/, /^комментарий/, /^место/, /^description/, /^merchant/],
    cat: [/^категория/, /^category/, /^mcc\s*категор/],
    status: [/^статус/, /^status/],
    kind: [/^тип/, /^вид\s+операции/, /^type/, /^направление/]
  };
  function findCol(header, pats, used) {
    for (const p of pats) { const i = header.findIndex((h, j) => !used.has(j) && p.test(h)); if (i >= 0) { used.add(i); return i; } }
    return -1;
  }
  function headerScore(row) {
    const h = row.map(c => clean(c).toLowerCase());
    let s = 0;
    if (h.some(x => /^дата|^date/.test(x))) s += 2;
    if (h.some(x => /сумма|amount|приход|расход|списани|поступлени|дебет|кредит/.test(x))) s += 2;
    if (h.some(x => /описание|назначение|категор|контрагент|description/.test(x))) s += 1;
    return s;
  }
  function fromTable(table) {
    table = table.filter(r => r && r.some(c => clean(c)));
    let hi = -1, best = 0;
    for (let i = 0; i < Math.min(table.length, 40); i++) { const sc = headerScore(table[i]); if (sc > best) { best = sc; hi = i; } }
    if (hi < 0 || best < 4) return { ops: [], error: "Не нашёл в таблице колонки «Дата» и «Сумма»." };
    const header = table[hi].map(c => clean(c).toLowerCase());
    const used = new Set();
    const col = {};
    col.date = findCol(header, H.date, used);
    col.inc = findCol(header, H.inc, used);
    col.exp = findCol(header, H.exp, used);
    col.amount = findCol(header, H.amount, used);
    col.cat = findCol(header, H.cat, used);
    col.desc = findCol(header, H.desc, used);
    col.status = findCol(header, H.status, used);
    col.kind = findCol(header, H.kind, used);
    if (col.date < 0 || (col.amount < 0 && col.inc < 0 && col.exp < 0)) return { ops: [], error: "Не нашёл в таблице колонки «Дата» и «Сумма»." };
    const out = [];
    const anyNeg = col.amount >= 0 && table.slice(hi + 1).some(x => { const y = parseAmountStr(x[col.amount]); return y !== null && y < 0; });
    for (const r of table.slice(hi + 1)) {
      const dv = r[col.date];
      const date = typeof dv === "number" ? excelSerial(dv) : parseDate(dv);
      if (!date) continue;
      if (col.status >= 0 && FAIL_STATUS.test(String(r[col.status] || ""))) continue;
      let desc = col.desc >= 0 ? clean(r[col.desc]) : "";
      if (!desc) desc = r.filter((c, j) => j !== col.date && j !== col.amount && j !== col.status && typeof c === "string" && /[A-Za-zА-Яа-яЁё]{3}/.test(c) && !parseDate(c)).slice(0, 2).join(" ");
      const bankCat = col.cat >= 0 ? clean(r[col.cat]) : "";
      let type = null, amount = null;
      if (col.inc >= 0 || col.exp >= 0) {
        const vi = col.inc >= 0 ? parseAmountStr(r[col.inc]) : null, ve = col.exp >= 0 ? parseAmountStr(r[col.exp]) : null;
        if (vi) { type = "inc"; amount = Math.abs(vi); } else if (ve) { type = "exp"; amount = Math.abs(ve); }
      }
      if (amount === null && col.amount >= 0) {
        const v = parseAmountStr(r[col.amount]);
        if (v === null || v === 0) continue;
        amount = Math.abs(v);
        const kind = col.kind >= 0 ? String(r[col.kind] || "").toLowerCase() : "";
        if (/спис|расход|debit|оплат|покупк/.test(kind)) type = "exp";
        else if (/попол|приход|зачисл|поступ|credit|доход/.test(kind)) type = "inc";
        else type = v < 0 ? "exp" : anyNeg ? "inc"
          : INCOME_W.some(w => (desc + " " + bankCat).toLowerCase().includes(w)) ? "inc" : "exp";
      }
      if (!amount) continue;
      out.push({ date, type, amount, desc, bankCat });
    }
    return { ops: finalize(out) };
  }

  /* ---- CSV ---- */
  function decodeText(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8.subarray(2));
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8.subarray(2));
    let s;
    try { s = new TextDecoder("utf-8", { fatal: true }).decode(u8); }
    catch (_) { s = new TextDecoder("windows-1251").decode(u8); }
    return s.replace(/^﻿/, "");
  }
  function parseCSV(text) {
    const first = text.split(/\r?\n/).slice(0, 10).join("\n");
    const delims = [";", ",", "\t", "|"];
    const delim = delims.map(d => [d, (first.match(new RegExp("\\" + d, "g")) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === "") q = true;
      else if (ch === delim) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /* ---- XLSX (zip + xml, без библиотек) ---- */
  async function inflateRaw(u8) {
    const ds = new DecompressionStream("deflate-raw");
    const buf = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  async function unzip(u8, wanted) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("bad zip");
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
      if (!wanted(name)) continue;
      const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
      const data = u8.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
      if (csize > 50e6) throw new Error("too big");
      files[name] = new TextDecoder().decode(method === 0 ? data : await inflateRaw(data));
    }
    return files;
  }
  const xmlText = s => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
  const colIdx = ref => { const L = ref.replace(/\d+/g, ""); let n = 0; for (const ch of L) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  async function readXlsx(u8) {
    const files = await unzip(u8, n => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/styles.xml" || /^xl\/worksheets\/sheet\d*\.xml$/.test(n));
    const shared = [];
    (files["xl/sharedStrings.xml"] || "").replace(/<si>([\s\S]*?)<\/si>/g, (_, si) => { let t = ""; si.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (__, x) => { t += x; }); shared.push(xmlText(t)); });
    // какие стили — даты (чтобы числа-даты превратить в даты)
    const dateStyles = new Set();
    const st = files["xl/styles.xml"] || "";
    const customDate = new Set(); st.replace(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g, (_, id, code) => { if (/[dmy]/i.test(code.replace(/\[[^\]]*\]|"[^"]*"/g, ""))) customDate.add(+id); });
    const xfs = (st.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [, ""])[1];
    let xi = 0; xfs.replace(/<xf\b([^>]*)/g, (_, a) => { const id = +((a.match(/numFmtId="(\d+)"/) || [, 0])[1]); if ((id >= 14 && id <= 22) || customDate.has(id)) dateStyles.add(xi); xi++; });
    // первый лист по порядку в книге
    let sheetPath = Object.keys(files).filter(n => /^xl\/worksheets\//.test(n)).sort()[0];
    const wb = files["xl/workbook.xml"] || "", rels = files["xl/_rels/workbook.xml.rels"] || "";
    const firstRid = (wb.match(/<sheet\b[^>]*r:id="([^"]+)"/) || [])[1];
    if (firstRid) { const t = (rels.match(new RegExp('<Relationship[^>]*Id="' + firstRid + '"[^>]*Target="([^"]+)"')) || rels.match(new RegExp('<Relationship[^>]*Target="([^"]+)"[^>]*Id="' + firstRid + '"')) || [])[1]; if (t) { const pth = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""); if (files[pth]) sheetPath = pth; } }
    if (!sheetPath) throw new Error("no sheet");
    const rows = [];
    files[sheetPath].replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, (_, inner) => {
      const row = [];
      inner.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (__, attrs, body) => {
        const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
        const t = (attrs.match(/t="(\w+)"/) || [])[1];
        const s = +((attrs.match(/s="(\d+)"/) || [, -1])[1]);
        let v = null; body = body || "";
        if (t === "s") v = shared[+((body.match(/<v>([\s\S]*?)<\/v>/) || [])[1])] ?? "";
        else if (t === "inlineStr") { let x = ""; body.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (___, y) => { x += y; }); v = xmlText(x); }
        else { const raw = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; if (raw !== undefined) { if (t === "str" || t === "e") v = xmlText(raw); else if (t === "b") v = raw === "1"; else { const num = parseFloat(raw); v = isNaN(num) ? xmlText(raw) : (dateStyles.has(s) ? (excelSerial(num) || num) : num); } } }
        row[ref ? colIdx(ref) : row.length] = v;
      });
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
      rows.push(row);
    });
    return rows;
  }

  function kindOf(name, u8) {
    const n = (name || "").toLowerCase();
    const sig = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (sig === "%PDF" || n.endsWith(".pdf")) return "pdf";
    if (u8[0] === 0x50 && u8[1] === 0x4b) return "xlsx";
    if (u8[0] === 0xd0 && u8[1] === 0xcf) return "xls";
    return "csv";
  }

  const api = { parseDate, parseAmountStr, parseTextLines, decideTypes, itemsToLines, fromPdfItems, fromTable, decodeText, parseCSV, readXlsx, kindOf, tidyDesc, finalize };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BankImport = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis);

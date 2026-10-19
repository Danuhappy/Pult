// Какие напоминания пора отправить: чистая логика без сети (её проверяют тесты).
// местные дата и время пользователя
export function local(tz: string, now = new Date()) {
  let parts: Record<string, string>;
  try { parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now).map(p => [p.type, p.value])); }
  catch { return local("Europe/Moscow", now); }
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute), wd };
}
const tmin = (t: unknown) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null;
const WINDOW = 15; // если минута пропущена, напоминание догонит в течение 15 минут
const DIGEST_AT = 9 * 60; // утренняя сводка в 9:00

export function dueReminders(items: { col: string; id: string; data: any }[], L: { date: string; min: number; wd: number }) {
  const out: { key: string; msg: Record<string, unknown> }[] = [];
  const inWin = (m: number | null) => m !== null && m <= L.min && m > L.min - WINDOW;
  const tasks = items.filter(i => i.col === "tasks" && i.data && !i.data.done && i.data.date === L.date);
  for (const t of tasks) {
    const m = tmin(t.data.time); if (!inWin(m)) continue;
    const ev = t.data.kind === "event";
    out.push({ key: `task:${t.id}:${L.date}`, msg: { title: ev ? `Событие в ${t.data.time}` : `Задача на ${t.data.time}`, body: String(t.data.title || "Без названия").slice(0, 140), tag: `task-${t.id}`, url: "#tasks" } });
  }
  for (const h of items.filter(i => i.col === "habits" && i.data)) {
    const d = h.data, days = Array.isArray(d.days) && d.days.length ? d.days : [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(L.wd) || (d.start && d.start > L.date) || (d.log && d.log[L.date])) continue;
    const m = tmin(d.time); if (!inWin(m)) continue;
    out.push({ key: `habit:${h.id}:${L.date}`, msg: { title: "Привычка", body: `${String(d.name || "").slice(0, 120)} — пора отметить`, tag: `habit-${h.id}`, url: "#habits" } });
  }
  const untimed = tasks.filter(t => t.data.kind !== "event" && tmin(t.data.time) === null);
  if (untimed.length && L.min >= DIGEST_AT && L.min < DIGEST_AT + WINDOW) {
    const n = untimed.length, w = n % 10 === 1 && n % 100 !== 11 ? "задача" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "задачи" : "задач";
    out.push({ key: `digest:${L.date}`, msg: { title: `На сегодня ${n} ${w}`, body: untimed.slice(0, 3).map(t => "• " + String(t.data.title || "").slice(0, 60)).join("\n"), tag: "digest", url: "#tasks" } });
  }
  return out;
}


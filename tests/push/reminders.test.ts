import { dueReminders, local } from "../../supabase/functions/push/reminders.ts";
let f = 0; const ok = (c: boolean, n: string) => { console.log((c ? "OK   " : "FAIL ") + n); if (!c) f++; };
// понедельник 19.10.2026, Москва
const at = (hm: string) => local("Europe/Moscow", new Date(`2026-10-19T${hm}:00+03:00`));
ok(at("09:30").date === "2026-10-19" && at("09:30").min === 570 && at("09:30").wd === 1, "Местное время считается в часовом поясе пользователя (Москва)");
ok(local("Asia/Vladivostok", new Date("2026-10-19T20:30:00+03:00")).date === "2026-10-20", "Другой часовой пояс — другая дата");
const items = [
  { col: "tasks", id: "t1", data: { title: "Позвонить клиенту", date: "2026-10-19", time: "09:30", done: false } },
  { col: "tasks", id: "t2", data: { title: "Уже сделано", date: "2026-10-19", time: "09:30", done: true } },
  { col: "tasks", id: "t3", data: { title: "Завтра", date: "2026-10-20", time: "09:30", done: false } },
  { col: "tasks", id: "t4", data: { title: "Купить саморезы", date: "2026-10-19", time: "", done: false } },
  { col: "tasks", id: "e1", data: { title: "Встреча", date: "2026-10-19", time: "09:25", kind: "event" } },
  { col: "habits", id: "h1", data: { name: "Зарядка", time: "09:30", days: [1, 2, 3, 4, 5], log: {} } },
  { col: "habits", id: "h2", data: { name: "Отмечена", time: "09:30", days: [1, 2, 3, 4, 5], log: { "2026-10-19": true } } },
  { col: "habits", id: "h3", data: { name: "Только выходные", time: "09:30", days: [6, 0], log: {} } },
  { col: "habits", id: "h4", data: { name: "Ещё не началась", time: "09:30", days: [1], start: "2026-10-26" } },
];
const keys = (hm: string) => dueReminders(items, at(hm)).map(r => r.key).sort();
ok(JSON.stringify(keys("09:29")) === JSON.stringify(["task:e1:2026-10-19"]), "За минуту до срока — только событие на 09:25");
const k930 = keys("09:30");
ok(k930.includes("task:t1:2026-10-19") && k930.includes("habit:h1:2026-10-19"), "В 09:30 приходят задача и привычка");
ok(!k930.some(k => /t2|t3|h2|h3|h4/.test(k)), "Не приходят: выполненная задача, завтрашняя, уже отмеченная привычка, не тот день, ещё не начатая");
ok(keys("09:44").includes("task:t1:2026-10-19") && !keys("09:46").includes("task:t1:2026-10-19"), "Если минута пропущена, напоминание догоняет в течение 15 минут, потом нет");
ok(keys("09:00").includes("digest:2026-10-19") && !keys("10:00").includes("digest:2026-10-19"), "Утренняя сводка в 9:00 по задачам без времени");
const dg = dueReminders(items, at("09:01")).find(r => r.key.startsWith("digest"))!;
ok(dg.msg.title === "На сегодня 1 задача" && String(dg.msg.body).includes("Купить саморезы"), "Текст сводки по-русски с правильным окончанием");
const t = dueReminders(items, at("09:30")).find(r => r.key.startsWith("task:t1"))!;
ok(t.msg.title === "Задача на 09:30" && t.msg.body === "Позвонить клиенту" && t.msg.url === "#tasks", "Текст напоминания о задаче");
console.log(f ? `FAILED ${f}` : "ALL OK"); if (f) process.exit(1);

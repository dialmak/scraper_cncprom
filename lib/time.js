// Один годинник на весь проєкт — київський.
//
// Кожна дата, яку бачить людина (підпис у шапці мап, колонка «Дата та час»,
// ім'я XLSX, рядки логів), раніше форматувалась у часовому поясі машини,
// що робила збірку. На ноутбуці це Київ, а в GitHub Actions — UTC, тож на
// сайті стояв UTC без жодної позначки: нічний прогін, що закінчився о 05:50
// за Києвом, підписувався як 02:50. Користувач читав це як київський час —
// і мав рацію, бо магазин український.
//
// Дати ЗБЕРІГАЮТЬСЯ як ISO в UTC (catalog.scrapedAt) — це правильно й не
// міняється; київський пояс застосовується лише на виході, при показі.
const TZ = 'Europe/Kyiv';

// hourCycle: 'h23' — інакше опівночі деякі версії ICU дають «24:00».
const FIELDS = {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
};

function parts(date) {
  const d = date instanceof Date ? date : new Date(date);
  try {
    const out = {};
    for (const p of new Intl.DateTimeFormat('uk-UA', FIELDS).formatToParts(d)) out[p.type] = p.value;
    if (out.year && out.hour) return out;
  } catch (e) { /* складання без повної ICU — нижче запасний варіант */ }
  // Запасний варіант: локальний час машини. Гірше, ніж київський, але
  // краще, ніж впасти під час нічного прогону через відсутність tzdata.
  const p = n => String(n).padStart(2, '0');
  return {
    day: p(d.getDate()), month: p(d.getMonth() + 1), year: String(d.getFullYear()),
    hour: p(d.getHours()), minute: p(d.getMinutes()), second: p(d.getSeconds())
  };
}

// ДД.ММ.РРРР
const fmtDate = date => { const p = parts(date); return `${p.day}.${p.month}.${p.year}`; };
// ДД.ММ.РРРР ГГ:ХХ — підписи на сторінках
const fmtDateTime = date => { const p = parts(date); return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`; };
// ДД.ММ.РРРР ГГ:ХХ:СС — рядки логів
const fmtStamp = date => { const p = parts(date); return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}:${p.second}`; };

module.exports = { TZ, fmtDate, fmtDateTime, fmtStamp };

// Логи прогонів. Дві різні речі під одним дахом, бо це одна родина:
//
//   logLine  — текстовий рядок у map.log (збірка мап). Той лог — три рядки на
//              прогін, його читають як є, структурувати нема чого.
//   logEvent — подія в scrape.jsonl (скрапінг). Один самостійний JSON на рядок
//              (JSONL), бо цілісний JSON-документ дописувати не можна: його
//              треба закривати дужкою, а скрапер пише в лог по рядку протягом
//              трьох годин і може обірватись посеред ночі. JSONL дописується
//              так само, як текст, а читається як дані — з нього сторінка
//              будує таблицю прогону, і його можна порівнювати ніч до ночі.
//
// Час у JSONL зберігається в ISO UTC, а форматується вже при показі
// (lib/time.js, київський пояс). Раніше в лог писався готовий київський
// рядок — тобто формат був зашитий у дані; та сама помилка, що колись була
// з датою у назві XLSX.
//
// У консоль обидва пишуть однаково по-людськи: у GitHub Actions за прогоном
// стежать очима, і JSON там нічого не додав би.

const fs = require('fs');
const { fmtStamp } = require('./time');

// ДД.ММ.РРРР ГГ:ХХ:СС за київським часом (lib/time.js), а не в поясі
// машини: лог читають поруч із підписами на сторінках, а в GitHub Actions
// машина живе за UTC — два різні годинники в одному проєкті збивають з толку.
function nowStr() {
  return fmtStamp(new Date());
}

// Дописує рядок у лог і дублює його в консоль. Помилка запису (зайнятий файл,
// немає теки) не має валити прогін — лог це діагностика, а не результат.
function logLine(file, text) {
  const line = `[${nowStr()}] ${text}`;
  console.log(line);
  try { fs.appendFileSync(file, line + '\n', 'utf-8'); } catch (e) { /* лог не критичний */ }
}

// Людський рядок для консолі. Формулювання навмисно ті самі, що були в
// текстовому scrape.log: за прогоном у CI стежать по цих словах.
function eventText(rec) {
  const f = rec;
  switch (rec.ev) {
    case 'start': return `СТАРТ: категорія ${f.id}`;
    case 'category': return `Категорія: "${f.name}" (id ${f.id})`;
    case 'stage1': return `ЕТАП 1 завершено: унікальних товарів ${f.products}, сиріт ${f.orphans}.`;
    case 'stage2': return `ЕТАП 2 завершено: зібрано ${f.got}, "Готово до відправки" ${f.ready}, не вдалось обробити ${f.failed}.`;
    case 'retry': return `ЕТАП 2: ${f.msg}`;
    case 'finish': {
      if (f.aborted) return `ФІНІШ: ПЕРЕРВАНО через помилку після ${f.min} хв. Помилок за запуск: ${f.errors}.`;
      const rec2 = f.rec || {};
      const cr = f.crumbs || {};
      return `ФІНІШ: успішно за ${f.min} хв. Товарів: ${f.total} (в наявності: ${f.ready}). ` +
        `звірка ${rec2.diff === 0 ? '✅' : '⚠️'} ${rec2.yes}/${rec2.site}` +
        `${rec2.nodes ? `, вузлів з розбіжністю ${rec2.nodes}` : ''}. ` +
        `крихти: збіг ${cr.match}, вище ${cr.ancestor}, глибше ${cr.descendant}, інша гілка ${cr.other}, без категорії ${cr.unknown}. ` +
        `${f.errors ? `Помилок: ${f.errors}.` : 'Без помилок.'}`;
    }
    case 'warn': return `УВАГА: ${f.msg}`;
    case 'error': return `ПОМИЛКА: ${f.msg}`;
    default: return `${rec.ev}: ${JSON.stringify(f)}`;
  }
}

// Один JSON-об'єкт на рядок. Порядок ключів сталий (t, ev, id — далі своє),
// щоб файл було видно очима навіть без розбору.
function logEvent(file, ev, fields) {
  const rec = Object.assign({ t: new Date().toISOString(), ev }, fields || {});
  console.log(`[${nowStr()}] ${eventText(rec)}`);
  try { fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf-8'); } catch (e) { /* лог не критичний */ }
}

// Читає JSONL, мовчки пропускаючи те, що не розібралось: останній рядок може
// бути обірваний, якщо процес убили посеред запису, і через один зіпсований
// рядок не можна втрачати весь прогін.
function readEvents(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf-8'); } catch (e) { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch (e) { /* обірваний рядок */ }
  }
  return out;
}

module.exports = { nowStr, logLine, logEvent, readEvents, eventText };

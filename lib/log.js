// Спільні логери прогонів. scrape.log (скрапер) і map.log (збірка мап) —
// однакові за форматом, дописувані історії всіх прогонів, а не результат
// одного: START/FINISH-пара на виклик плюс рядок на кожне рішення.
// Раніше nowStr/logLine існували двома однаковими копіями (scrape-complete.js
// і build-maps.js) — вони мали лишатись однією родиною, тож тепер це один файл.

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

module.exports = { nowStr, logLine };

// Спільні логери прогонів. scrape.log (скрапер) і map.log (збірка мап) —
// однакові за форматом, дописувані історії всіх прогонів, а не результат
// одного: START/FINISH-пара на виклик плюс рядок на кожне рішення.
// Раніше nowStr/logLine існували двома однаковими копіями (scrape-complete.js
// і build-maps.js) — вони мали лишатись однією родиною, тож тепер це один файл.

const fs = require('fs');

// ДД.ММ.РРРР ГГ:ХХ:СС у локальному часі машини, що робить прогін.
function nowStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Дописує рядок у лог і дублює його в консоль. Помилка запису (зайнятий файл,
// немає теки) не має валити прогін — лог це діагностика, а не результат.
function logLine(file, text) {
  const line = `[${nowStr()}] ${text}`;
  console.log(line);
  try { fs.appendFileSync(file, line + '\n', 'utf-8'); } catch (e) { /* лог не критичний */ }
}

module.exports = { nowStr, logLine };

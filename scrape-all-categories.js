// scrape-all-categories.js — послідовно запускає scrape-complete.js для
// кожної категорії 1 рівня з output/categories-site.csv (готується
// discover-categories.js), у порядку черги, побудованому нижче.
//
// Порядок черги:
//   1. Категорія FALLBACK_ID ("1022837", Драйвери крокового двигуна) —
//      ЗАВЖДИ перша, незалежно від власного scrapingTime і незалежно від
//      того, скільки інших категорій мають/не мають scrapingTime.
//   2. Решта категорій, у яких scrapingTime відомий — за зростанням
//      scrapingTime (від найменшого до найбільшого).
//   3. Категорії без scrapingTime (порожнє значення в CSV) — наприкінці
//      черги, у тому порядку, в якому вони йдуть у CSV.
//
// Використання:
//   node scrape-all-categories.js

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = __dirname;
const OUTPUT_DIR = path.join(ROOT_DIR, 'output');
const CSV_FILE = path.join(OUTPUT_DIR, 'categories-site.csv');
const FALLBACK_ID = "1022837"; // Драйвери крокового двигуна — завжди перша в черзі

// ==================== ЧИТАННЯ categories-site.csv ====================
// Той самий парсер (роздільник ";", лапки подвоюються), що й у render-map.js —
// формат CSV в проєкті скрізь однаковий.
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ';') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

if (!fs.existsSync(CSV_FILE)) {
  console.error(`Файл не знайдено: ${CSV_FILE}`);
  console.error('Спершу запустіть: node discover-categories.js');
  process.exit(1);
}

const rows = parseCsv(fs.readFileSync(CSV_FILE, 'utf-8'));
if (rows.length === 0) {
  console.error('CSV порожній — нема категорій для скрапінгу.');
  process.exit(1);
}

// ==================== ПОБУДОВА ЧЕРГИ ====================
rows.forEach(r => {
  const t = parseFloat(r.scrapingTime);
  r._time = isNaN(t) ? null : t;
});

const fallbackRow = rows.find(r => r.ID === FALLBACK_ID);
const rest = rows.filter(r => r.ID !== FALLBACK_ID);
const restWithTime = rest.filter(r => r._time !== null).sort((a, b) => a._time - b._time);
const restWithoutTime = rest.filter(r => r._time === null);

if (!fallbackRow) {
  console.warn(`УВАГА: категорія ${FALLBACK_ID} відсутня в ${path.basename(CSV_FILE)} — черга без примусового першого місця.`);
}

const queue = [...(fallbackRow ? [fallbackRow] : []), ...restWithTime, ...restWithoutTime];

console.log(`Черга скрапінгу (${queue.length} категорій):`);
queue.forEach((r, i) => {
  const t = r._time !== null ? `${r._time} хв` : 'час невідомий';
  console.log(`  ${i + 1}. ${r['Назва категорії']} (${r.ID}) — ${t}`);
});

// ==================== ПОСЛІДОВНИЙ ЗАПУСК ====================
// spawnSync (не async/паралельно) — навмисно один прогін scrape-complete.js
// за раз, як і при ручному запуску: паралельні скрапінги того самого сайту
// небажані (навантаження на сайт, спільний scrape.log дописується з кожного
// прогону послідовно). Помилка однієї категорії (ненульовий код виходу) не
// зупиняє чергу — scrape-complete.js сам логує причину в scrape.log.
let ok = 0, failed = 0;
for (let i = 0; i < queue.length; i++) {
  const r = queue[i];
  console.log(`\n=== [${i + 1}/${queue.length}] ${r['Назва категорії']} (${r.ID}) ===`);
  const res = spawnSync('node', ['scrape-complete.js', r.URL], { cwd: ROOT_DIR, stdio: 'inherit' });
  if (res.status === 0) ok++;
  else {
    failed++;
    console.warn(`Категорія ${r.ID} завершилась з кодом ${res.status} — продовжуємо чергу далі.`);
  }
}

console.log(`\nГотово: ${ok} успішно, ${failed} з помилками, разом ${queue.length}.`);

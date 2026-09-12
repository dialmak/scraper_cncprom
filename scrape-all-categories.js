// scrape-all-categories.js — послідовно запускає scrape-complete.js для
// кожної категорії 1 рівня з output/categories-site.csv (готується
// discover-categories.js), СТРОГО за зростанням колонки number (1, 2, 3, ...).
//
// Ніякого власного сортування чи спецвипадків тут немає навмисно: чергу
// повністю визначає сам CSV. discover-categories.js вже пише його
// відсортованим за scrapingTime (від найменшого до найбільшого), а number —
// просто порядковий номер після того сортування. Якщо потрібно скрапити не
// все чи в іншому порядку — досить відредагувати categories-site.csv вручну
// (видалити рядки, перенумерувати number) до запуску цього скрипта.
//
// Використання:
//   node scrape-all-categories.js

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = __dirname;
const OUTPUT_DIR = path.join(ROOT_DIR, 'output');
const CSV_FILE = path.join(OUTPUT_DIR, 'categories-site.csv');

// ==================== ЧИТАННЯ categories-site.csv ====================
// Той самий парсер (роздільник ";", лапки подвоюються), що й у render-map.js /
// build-maps.js — формат CSV в проєкті скрізь однаковий.
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

// ==================== ЧЕРГА = ПОРЯДОК ЗА number ====================
const queue = [...rows].sort((a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0));

console.log(`Черга скрапінгу (${queue.length} категорій, за number з ${path.basename(CSV_FILE)}):`);
queue.forEach(r => {
  console.log(`  ${r.number}. ${r.categoryName} (${r.categoryId}) — ${r.scrapingTime || '?'} хв`);
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
  console.log(`\n=== [${i + 1}/${queue.length}] ${r.categoryName} (${r.categoryId}) ===`);
  const res = spawnSync('node', ['scrape-complete.js', r.categoryUrl], { cwd: ROOT_DIR, stdio: 'inherit' });
  if (res.status === 0) ok++;
  else {
    failed++;
    console.warn(`Категорія ${r.categoryId} завершилась з кодом ${res.status} — продовжуємо чергу далі.`);
  }
}

console.log(`\nГотово: ${ok} успішно, ${failed} з помилками, разом ${queue.length}.`);

// scrape-all-categories.js — послідовно запускає scrape-complete.js для
// кожної категорії 1 рівня з output/site/categories-site.csv (готується
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
const OUTPUT_DIR = path.join(ROOT_DIR, 'output', 'site');
const CSV_FILE = path.join(OUTPUT_DIR, 'categories-site.csv');

// Стеля на одну категорію. Найдовша реальна ("Передачі", 96553590) — 33.5 хв,
// тож 90 хв це ~2.7× запасу і водночас гарантія, що зависла категорія не
// з'їсть увесь timeout-minutes: 300 у deploy-pages.yml, лишивши чергу
// недокрученою. Перевищення приходить сюди як res.error від spawnSync.
const CATEGORY_TIMEOUT_MS = 90 * 60 * 1000;

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
const failures = [];
for (let i = 0; i < queue.length; i++) {
  const r = queue[i];
  console.log(`\n=== [${i + 1}/${queue.length}] ${r.categoryName} (${r.categoryId}) ===`);

  // Порожній categoryUrl раніше проходив мовчки й НАЙГІРШИМ чином: argv[2]
  // ставав порожнім рядком, scrape-complete.js брав свій DEFAULT_START_URL і
  // перескрапував зовсім іншу категорію, перезаписуючи її власні файли.
  if (!r.categoryUrl || !/^https?:\/\//i.test(r.categoryUrl)) {
    failed++;
    failures.push(`${r.categoryId} (${r.categoryName}): порожній або некоректний categoryUrl у CSV`);
    console.error(`Категорія ${r.categoryId}: некоректний URL "${r.categoryUrl}" — пропускаємо, щоб не скрапити чужу категорію.`);
    continue;
  }

  const res = spawnSync('node', ['scrape-complete.js', r.categoryUrl], {
    cwd: ROOT_DIR, stdio: 'inherit', timeout: CATEGORY_TIMEOUT_MS
  });

  // res.error — це "процес не вдалось запустити взагалі" (немає node в PATH)
  // або "вбито по timeout". Раніше перевірявся лише res.status, тому в
  // першому випадку status був null, лічильник помилок ріс на всю чергу, а
  // скрипт усе одно завершувався кодом 0.
  if (res.error) {
    failed++;
    failures.push(`${r.categoryId} (${r.categoryName}): ${res.error.message}`);
    console.error(`Категорія ${r.categoryId}: процес не завершився штатно — ${res.error.message}`);
  } else if (res.status === 0) {
    ok++;
  } else {
    failed++;
    failures.push(`${r.categoryId} (${r.categoryName}): код виходу ${res.status}${res.signal ? `, сигнал ${res.signal}` : ''}`);
    console.warn(`Категорія ${r.categoryId} завершилась з кодом ${res.status} — продовжуємо чергу далі.`);
  }
}

console.log(`\nГотово: ${ok} успішно, ${failed} з помилками, разом ${queue.length}.`);
if (failures.length > 0) {
  console.error('\nКатегорії з помилками:');
  failures.forEach(f => console.error(`  - ${f}`));
}

// Ненульовий код — ЛИШЕ для катастрофічного прогону (не вдалась жодна або
// впала більшість). Окрема невдала категорія свідомо лишає код 0: інакше
// крок "Етап 2" у deploy-pages.yml падає, і разом з ним зникає весь нічний
// результат — знімок, diff і деплой — через одну категорію з 23.
// А от коли впала більшість, продовжувати не можна: generate-snapshot.js
// запише вкорочений знімок, diff-map.js оформить це як "видалено ~4000
// товарів" і закомітить у гілку data, отруївши базу й на наступний день.
if (ok === 0 || failed > ok) {
  console.error(`\nКАТАСТРОФІЧНИЙ ПРОГІН: успішних ${ok} з ${queue.length}.`);
  console.error('Зупиняємо конвеєр, щоб зіпсовані дані не потрапили в гілку data.');
  process.exit(1);
}

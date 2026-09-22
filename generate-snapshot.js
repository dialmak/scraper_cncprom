// generate-snapshot.js — читає щойно зібрані output/site/<id>_category_map.json
// + <id>_cncprom_complete.csv для всіх категорій із output/site/categories-site.csv
// і пише один компактний JSON-знімок дня — сировину для diff-map.js (Фаза 3,
// щоденна diff-аналітика, гілка `data`, див. phase.md).
//
// Свідомо НЕ пише повний output/ (це вже робить scrape-complete.js) — лише
// те, що потрібно для виявлення змін день-до-дня:
// - дерево категорій: id, name, parentId, level (додано/видалено/перейменовано/
//   переміщено);
// - скорочений список товарів: id, name, sku, categoryId, availability, url
//   (finalUrl — потрібен diff-map.js для HTML-звіту, посилання "Товар" на
//   сайт; без breadcrumbs/baseCategoryPath — це й досі шум, не потрібен ні
//   для diff, ні для звіту).
//
// Знімок пишеться НЕ в output/ (те гітигнориться на main), а в окрему теку —
// у реальному нічному прогоні це робочий checkout гілки `data`
// (deploy-pages.yml готує його як git-worktree перед викликом цього скрипта).
//
// Використання:
//   node generate-snapshot.js [outDir]
//   outDir — куди писати snapshots/<YYYY-MM-DD>.json, за замовчуванням ./data-branch
//   SNAPSHOT_DATE=YYYY-MM-DD (опційно, для тестів/бекфілу) — інакше береться
//   поточна UTC-дата в момент запуску.

const fs = require('fs');
const path = require('path');

// ==================== НАЛАШТУВАННЯ ====================
const SITE_DIR = path.join(__dirname, 'output', 'site');
const CSV_FILE = path.join(SITE_DIR, 'categories-site.csv');
const OUT_DIR = path.resolve(process.argv[2] || path.join(__dirname, 'data-branch'));
const DATE = process.env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10); // UTC-дата запуску

// ==================== CSV (той самий парсер, що в build-maps.js/scrape-all-categories.js) ====================
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

function readCategoriesFromCsv() {
  if (!fs.existsSync(CSV_FILE)) {
    console.error(`Файл не знайдено: ${CSV_FILE}`);
    console.error('Спершу запустіть: node discover-categories.js');
    process.exit(1);
  }
  return parseCsv(fs.readFileSync(CSV_FILE, 'utf-8'));
}

// ==================== ДЕРЕВО КАТЕГОРІЙ ====================
// Рекурсивно розгортає <id>_category_map.json (той самий формат, що читає
// render-map.js) у плаский список {id, name, parentId, level}. level береться
// напряму з кожного вузла — його вже пише scrape-complete.js, рахувати заново
// не треба.
function flattenTree(node, parentId, out) {
  out.push({
    id: node.categoryId,
    name: node.categoryName,
    parentId,
    level: node.level,
    // Посилання на сторінку категорії — на нього веде назва категорії на
    // сторінці змін (build-reports.js). Лише числовий id для URL не годиться:
    // сайт віддає 404 на /ua/g<id> без slug.
    url: node.url || '',
  });
  (node.children || []).forEach(child => flattenTree(child, node.categoryId, out));
}

// ==================== ТОВАРИ ====================
function readProducts(categoryId) {
  const csvPath = path.join(SITE_DIR, `${categoryId}_cncprom_complete.csv`);
  if (!fs.existsSync(csvPath)) return [];
  return parseCsv(fs.readFileSync(csvPath, 'utf-8')).map(row => ({
    id: row.productId,
    name: row.productName,
    sku: row.sku,
    categoryId: row.categoryId,
    availability: row.availabilityStatus,
    url: row.finalUrl,
  }));
}

// ==================== ОСНОВНИЙ ПРОХІД ====================
const rows = readCategoriesFromCsv();
const categories = [];
const productsById = new Map(); // захист від дублів, якщо productId колись з'явиться у двох деревах

let missingTree = 0;
let missingCsv = 0;

rows.forEach(row => {
  const jsonPath = path.join(SITE_DIR, `${row.categoryId}_category_map.json`);
  if (!fs.existsSync(jsonPath)) {
    missingTree++;
    console.warn(`Пропущено (нема ${row.categoryId}_category_map.json): ${row.categoryName}`);
    return;
  }
  const tree = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  flattenTree(tree, null, categories);

  const products = readProducts(row.categoryId);
  if (products.length === 0) missingCsv++;
  products.forEach(p => {
    if (!productsById.has(p.id)) productsById.set(p.id, p);
  });
});

const snapshot = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  categories,
  products: [...productsById.values()],
};

// ==================== ЗАПИС ====================
const snapshotsDir = path.join(OUT_DIR, 'snapshots');
fs.mkdirSync(snapshotsDir, { recursive: true });
const outPath = path.join(snapshotsDir, `${DATE}.json`);
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf-8');

console.log(`Знімок записано: ${outPath}`);
console.log(`Категорій: ${categories.length}, товарів: ${snapshot.products.length}` +
  (missingTree ? `, без дерева: ${missingTree}` : '') +
  (missingCsv ? `, без товарів (csv): ${missingCsv}` : ''));

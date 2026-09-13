// build-custom-tree.js — Фаза 5 плану (phase.md): конвертує вручну курований
// custom/tree.json (ієрархія) + custom/product-overrides.json (productId →
// id кастомної категорії) + реальні скраплені товари з output/site/
// *_cncprom_complete.csv у ТОЧНІСІНЬКО той самий формат файлів, що вже
// виробляє scrape-complete.js (<id>_category_map.json / <id>_cncprom_complete.csv),
// плюс categories-site.csv (список "категорій 1 рівня" — тут: коренів
// custom/tree.json). Завдяки цьому render-map.js/build-maps.js (з
// MAP_SUBDIR=new) працюють з output/new/ БЕЗ ЖОДНИХ змін у самій логіці
// рендеру — інша, курована таксономія як джерело даних, той самий вигляд і
// той самий код.
//
// На відміну від scrape-complete.js тут немає стадій ЕТАП 1/ЕТАП 2 з
// розривом у часі — усе пишеться за один синхронний прохід, атомарно, без
// Playwright і без живого сайту. Саме тому в build-maps.js перевірка
// "застарілості" json/csv (REFERENCE_ID/STALE_THRESHOLD_HOURS) свідомо
// вимкнена для MAP_SUBDIR=new — цей розрив там структурно не може виникнути.
//
// Механізм КЛАСИФІКАЦІЇ товарів у product-overrides.json — окреме, ще НЕ
// вирішене питання (див. phase.md, розділ Фази 5: інтерактивно/API/гібрид,
// не вирішено). Цей скрипт нічого не класифікує сам — лише конвертує вже
// готовий product-overrides.json, яким би чином його не заповнили.
//
// Використання:
//   node build-custom-tree.js
//
// Вхід:
//   custom/tree.json              — [{ id, name, children: [...] }, ...] (масив коренів)
//   custom/product-overrides.json — { "<productId>": "<customCategoryId>", ... }
//   output/site/*_cncprom_complete.csv — реальні дані товарів (джерело
//     name/sku/availability/finalUrl для кожного productId з overrides)
//
// Вихід (у output/new/, той самий формат, що scrape-complete.js пише в output/site/):
//   <customId>_category_map.json  — на кожен корінь tree.json
//   <customId>_cncprom_complete.csv
//   categories-site.csv           — список коренів, читає build-maps.js/render-map.js

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const CUSTOM_DIR = path.join(ROOT_DIR, 'custom');
const TREE_FILE = path.join(CUSTOM_DIR, 'tree.json');
const OVERRIDES_FILE = path.join(CUSTOM_DIR, 'product-overrides.json');
const SITE_DIR = path.join(ROOT_DIR, 'output', 'site');
const OUT_DIR = path.join(ROOT_DIR, 'output', 'new');

// ==================== CSV (той самий формат, що scrape-complete.js/build-maps.js) ====================
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
// csvEscape/toCSV — побайтово той самий формат, що scrape-complete.js пише в
// <id>_cncprom_complete.csv, щоб build-maps.js/render-map.js читали його,
// нічого не підозрюючи про походження даних.
function csvEscape(val) {
  const s = String(val ?? '');
  if (s.includes(';') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCSV(rows) {
  const header = ['productId', 'productName', 'sku', 'categoryId', 'categoryName', 'foundAtLevel', 'isOrphan', 'availabilityStatus', 'finalUrl', 'baseCategoryPath', 'breadcrumbs'];
  const lines = [header.join(';')];
  for (const r of rows) lines.push(header.map(h => csvEscape(r[h])).join(';'));
  return lines.join('\n');
}

// ==================== ВХІДНІ ДАНІ ====================
if (!fs.existsSync(TREE_FILE)) {
  console.error(`Файл не знайдено: ${TREE_FILE}`);
  process.exit(1);
}
const roots = JSON.parse(fs.readFileSync(TREE_FILE, 'utf-8'));
const overrides = fs.existsSync(OVERRIDES_FILE) ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf-8')) : {};

// Реальні дані товарів — читаються з УСІХ *_cncprom_complete.csv в output/site/
// (не лише з categories-site.csv-списку, щоб не залежати від того, чи
// категорія-джерело досі в цьому списку) і зводяться в один Map<productId, row>.
const realProducts = new Map();
if (fs.existsSync(SITE_DIR)) {
  fs.readdirSync(SITE_DIR)
    .filter(f => f.endsWith('_cncprom_complete.csv'))
    .forEach(f => {
      parseCsv(fs.readFileSync(path.join(SITE_DIR, f), 'utf-8')).forEach(row => {
        realProducts.set(row.productId, row);
      });
    });
}
console.log(`Реальних товарів знайдено (output/site/*_cncprom_complete.csv): ${realProducts.size}`);

// productsByCustomCategory: id кастомної категорії → масив реальних рядків
// товарів, призначених туди через product-overrides.json.
const productsByCustomCategory = new Map();
let missingProducts = 0;
Object.entries(overrides).forEach(([productId, customCategoryId]) => {
  const row = realProducts.get(productId);
  if (!row) { missingProducts++; return; }
  if (!productsByCustomCategory.has(customCategoryId)) productsByCustomCategory.set(customCategoryId, []);
  productsByCustomCategory.get(customCategoryId).push(row);
});
if (missingProducts > 0) {
  console.warn(`⚠️ ${missingProducts} productId з product-overrides.json не знайдено серед реальних товарів (видалені/застарілі override'и?).`);
}

// ==================== ПОБУДОВА ДЕРЕВА (той самий формат, що scrape-complete.js) ====================
// level рахується так само, як у scrape-complete.js: корінь = 1, кожен рівень
// вкладеності +1. url/siteAvailableCounter — null: у кастомної категорії
// немає ні живої сторінки, ні лічильника сайту, null тут означає саме
// "неможливо застосувати", а не "0" (той самий принцип, що getSiteAvailableCounter
// в scrape-complete.js розрізняє null і 0).
const usedCategoryIds = new Set();
function buildNode(node, level, ancestorNames) {
  if (usedCategoryIds.has(node.id)) {
    console.error(`Дублікат id у custom/tree.json: "${node.id}" — id мають бути унікальні по всьому дереву.`);
    process.exit(1);
  }
  usedCategoryIds.add(node.id);

  const rawProducts = productsByCustomCategory.get(node.id) || [];
  const children = (node.children || []).map(child => buildNode(child, level + 1, [...ancestorNames, node.name]));
  const isLeaf = children.length === 0;

  return {
    categoryId: node.id,
    categoryName: node.name,
    url: null,
    level,
    isLeaf,
    siteAvailableCounter: null,
    directProductCount: rawProducts.length,
    children,
    // Не частина формату scrape-complete.js — службове поле для CSV-проходу
    // нижче, видаляється перед записом JSON.
    __ownRows: rawProducts,
    __ancestorNames: ancestorNames,
    __hasChildren: children.length > 0
  };
}

function stripInternal(node) {
  const { __ownRows, __ancestorNames, __hasChildren, ...clean } = node;
  clean.children = clean.children.map(stripInternal);
  return clean;
}

// Плоский список рядків для <rootId>_cncprom_complete.csv — той самий обхід,
// що scrape-complete.js робить по productAssignments: кожен товар потрапляє
// туди рівно один раз, з полями свого кастомного вузла.
function collectCsvRows(node, out) {
  const path_ = [...node.__ancestorNames, node.categoryName].join(' / ');
  node.__ownRows.forEach(r => {
    out.push({
      productId: r.productId,
      productName: r.productName,
      sku: r.sku,
      categoryId: node.categoryId,
      categoryName: node.categoryName,
      foundAtLevel: node.level,
      isOrphan: node.__hasChildren, // той самий сенс, що в scrape-complete.js: товар прямо на нелистковій категорії
      availabilityStatus: r.availabilityStatus,
      finalUrl: r.finalUrl,
      baseCategoryPath: path_,
      breadcrumbs: path_ + ' / ' + r.productName
    });
  });
  node.children.forEach(child => collectCsvRows(child, out));
}

// ==================== ЗАПИС ====================
fs.mkdirSync(OUT_DIR, { recursive: true });

const csvRows = [];
roots.forEach((rootDef, i) => {
  const root = buildNode(rootDef, 1, []);
  collectCsvRows(root, csvRows);

  fs.writeFileSync(path.join(OUT_DIR, `${root.categoryId}_category_map.json`), JSON.stringify(stripInternal(root), null, 2), 'utf-8');

  const ownCsvRows = [];
  collectCsvRows(root, ownCsvRows);
  fs.writeFileSync(path.join(OUT_DIR, `${root.categoryId}_cncprom_complete.csv`), '﻿' + toCSV(ownCsvRows), 'utf-8');

  console.log(`[${root.categoryId}] ${root.categoryName} — товарів: ${ownCsvRows.length}`);
});

// Override, що вказує на categoryId, якого нема в жодному дереві (typo,
// категорію перейменували/видалили з tree.json, а override не оновили) —
// інакше мовчки зникає без жодного сліду (productsByCustomCategory для
// нього побудувався, але жоден buildNode ніколи його не прочитав).
const unusedCategoryIds = new Set([...productsByCustomCategory.keys()].filter(id => !usedCategoryIds.has(id)));
if (unusedCategoryIds.size > 0) {
  console.warn(`⚠️ product-overrides.json посилається на categoryId, яких нема в custom/tree.json: ${[...unusedCategoryIds].join(', ')} — ці товари нікуди не потрапили.`);
}

// categories-site.csv — той самий формат, що discover-categories.js пише для
// output/site/, щоб readCategoriesFromCsv() у build-maps.js/render-map.js
// читав output/new/ так само, без жодних змін у тій функції. categoryUrl
// порожній (немає живої сторінки), scrapingTime — 0 (не має сенсу для
// атомарного білда без скрапінгу).
const categoriesCsvLines = ['number;categoryId;categoryName;categoryUrl;scrapingTime'];
roots.forEach((rootDef, i) => {
  categoriesCsvLines.push([i + 1, rootDef.id, csvEscape(rootDef.name), '', 0].join(';'));
});
fs.writeFileSync(path.join(OUT_DIR, 'categories-site.csv'), '﻿' + categoriesCsvLines.join('\n'), 'utf-8');

console.log(`Готово: ${roots.length} кореневих категорій, ${csvRows.length} товарів у output/new/.`);

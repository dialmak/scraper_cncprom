// render-map.js — генерує інтерактивну HTML-мапу дерева категорій з файлу
// <ID>_category_map.json (від scrape-complete.js), опційно збагачену
// товарами (назва/код/наявність) з <ID>_cncprom_complete.csv — обидва
// шукаються автоматично в output/ за ID категорії. Ім'я файлу починається з
// ID (не з типу файлу), щоб усі файли однієї категорії стояли поруч при
// сортуванні за іменем у провіднику — те саме, що й у scrape-complete.js.
//
// Дизайн — діловий "desktop"-стиль (сайдбар з деревом категорій зліва +
// таблиці товарів праворуч, світла/темна тема, живий пошук).
//
// Використання:
//   node render-map.js <ID>
//
// Результат (усе в output/, поруч зі скриптом, не в корені проєкту):
// <ID>_map.html + спільні map-common.css/map-common.js (стилі й клієнтський
// додаток, однакові для будь-якої категорії — пишуться/перезаписуються при
// кожному запуску) + <ID>_map.summary.json (короткий підсумок для індексної
// build-maps.js/map.html). Відкривається прямо з диска подвійним кліком у
// браузері, але вже НЕ одним самодостатнім файлом — map-common.css/.js
// мають лежати поруч у тій самій теці.

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output');

const categoryId = process.argv[2];
if (!categoryId) {
  console.error('Використання: node render-map.js <ID категорії>');
  console.error('Приклад: node render-map.js 1022485');
  process.exit(1);
}

const mapFile = path.join(OUTPUT_DIR, `${categoryId}_category_map.json`);
const csvFile = path.join(OUTPUT_DIR, `${categoryId}_cncprom_complete.csv`);

if (!fs.existsSync(mapFile)) {
  console.error(`Файл не знайдено: ${mapFile}`);
  console.error(`Спершу запустіть: node scrape-complete.js "<URL категорії ${categoryId}>"`);
  process.exit(1);
}

const OUTPUT_HTML = path.join(OUTPUT_DIR, `${categoryId}_map.html`);

const tree = JSON.parse(fs.readFileSync(mapFile, 'utf-8'));

// Час веб-скрапінгу — беремо час запису <ID>_category_map.json, бо саме
// цей файл scrape-complete.js зберігає одразу після обходу дерева категорій
// (до нього дата модифікації не має сенсу — файл щойно згенеровано).
const scrapedAtDate = fs.statSync(mapFile).mtime;
const scrapedAt = scrapedAtDate.toLocaleDateString('uk-UA') + ' ' +
  scrapedAtDate.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

// ==================== ОПЦІЙНЕ ЗБАГАЧЕННЯ ТОВАРАМИ З CSV ====================
// CSV: UTF-8 з BOM, роздільник ";". Рядки групуються за categoryId — тим самим
// полем, яке scrape-complete.js записує і у вузол дерева (канонічна,
// найглибша категорія товару), тому зіставлення товар -> вузол тут точне.
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

// csvFile — той самий ID, шукається поруч у output/ автоматично; якщо ще не
// готовий (ЕТАП 2 scrape-complete.js не завершився), мапа будується лише зі
// структури дерева, без товарів — так само, як і раніше при відсутньому
// другому аргументі.
const HAS_CSV = fs.existsSync(csvFile);
const productsByCategory = new Map();
if (HAS_CSV) {
  const rows = parseCsv(fs.readFileSync(csvFile, 'utf-8'));
  rows.forEach(r => {
    if (!productsByCategory.has(r.categoryId)) productsByCategory.set(r.categoryId, []);
    productsByCategory.get(r.categoryId).push(r);
  });
}

// "наявн" навмисно не використовується — воно є підрядком і в "Немає в наявності"
function isAvailableProduct(p) {
  return /готово/i.test(p.availability || '');
}

// ==================== ПОБУДОВА ДЕРЕВА ДЛЯ КЛІЄНТСЬКОГО ДОДАТКУ ====================
// Кожен вузол отримує власні товари (own_products) і рекурсивно накопичені
// підсумки (stats.total_*), включно зі звіркою проти лічильника сайту
// "В наявності N", зафіксованого scrape-complete.js на цьому вузлі.
function buildAppNode(node) {
  if (!node || !node.categoryId) return null;

  const rawProducts = productsByCategory.get(node.categoryId) || [];
  const products = rawProducts.map((r, i) => ({
    index: i + 1,
    code: r.sku || '',
    name: r.productName || r.productId || '',
    url: r.finalUrl || '',
    availability: r.availabilityStatus || ''
  }));
  const ownYes = products.filter(isAvailableProduct).length;
  const ownNo = products.length - ownYes;
  const ownCount = HAS_CSV ? products.length : (node.directProductCount || 0);

  const children = (node.children || []).map(buildAppNode).filter(Boolean);
  const childAgg = children.reduce((acc, c) => ({
    total: acc.total + c.stats.total_products,
    yes: acc.yes + c.stats.total_yes,
    no: acc.no + c.stats.total_no
  }), { total: 0, yes: 0, no: 0 });

  const totalProducts = ownCount + childAgg.total;
  const totalYes = ownYes + childAgg.yes;
  const totalNo = ownNo + childAgg.no;

  const hasCounter = node.siteAvailableCounter !== null && node.siteAvailableCounter !== undefined;
  const diff = hasCounter && HAS_CSV ? totalYes - node.siteAvailableCounter : null;

  return {
    id: `node-${node.categoryId}`,
    level: node.level,
    name: node.categoryName,
    url: node.url || null,
    own_products: products,
    children,
    stats: {
      own_products: ownCount,
      own_yes: ownYes,
      own_no: ownNo,
      total_products: totalProducts,
      total_yes: totalYes,
      total_no: totalNo,
      subcategories_count: children.length,
      site_counter: hasCounter ? node.siteAvailableCounter : null,
      diff
    }
  };
}

const appTree = buildAppNode(tree);
if (!appTree) {
  console.error('Дерево категорій порожнє або пошкоджене — нема кореневого categoryId.');
  process.exit(1);
}

let maxLevel = 1;
let categoriesCount = 0;
// Категорії, у яких є і підкатегорії, і власні товари, що не входять до жодної
// з них ("сироти" на рівні відображення) — та ж умова, що для бейджа (N) в
// сайдбарі; список іде в попередження над змістом, бо в дереві ці товари не
// видно, поки категорію не розгорнути.
const orphanCategories = [];
(function walk(n) {
  categoriesCount++;
  maxLevel = Math.max(maxLevel, n.level);
  if (n.children.length > 0 && n.stats.own_products > 0) {
    orphanCategories.push({ id: n.id, name: n.name, level: n.level, own: n.stats.own_products });
  }
  n.children.forEach(walk);
})(appTree);

const globalStats = {
  levels: maxLevel,
  categories_count: categoriesCount,
  has_products: HAS_CSV,
  total_products: appTree.stats.total_products,
  total_yes: appTree.stats.total_yes,
  total_no: appTree.stats.total_no,
  site_counter: appTree.stats.site_counter,
  diff: appTree.stats.diff,
  scraped_at: scrapedAt,
  source_map: path.basename(mapFile),
  source_csv: HAS_CSV ? path.basename(csvFile) : null
};

const CATALOG_DATA = { global_stats: globalStats, tree: appTree };

// ==================== СТИЛІ (діловий "desktop"-вигляд, світла/темна тема) ====================
const css = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: 'JetBrains Mono', Consolas, Monaco, monospace;

  --bg-page: #f8fafc;
  --bg-white: #ffffff;
  --bg-header: #ffffff;
  --bg-sidebar: #ffffff;
  --bg-subtle: #f8fafc;
  --bg-tag: #f1f5f9;
  --bg-row-alt: #fcfdfe;
  --bg-hover: #f1f5f9;
  --bg-active: #eff6ff;

  --border-color: #e2e8f0;
  --border-dark: #cbd5e1;
  --border-active: #2563eb;

  --text-main: #0f172a;
  --text-muted: #475569;
  --text-subtle: #94a3b8;
  --text-link: #1d4ed8;

  --status-yes: #15803d;
  --status-yes-bg: #f0fdf4;
  --status-yes-border: #bbf7d0;

  --status-no: #b91c1c;
  --status-no-bg: #fef2f2;
  --status-no-border: #fecaca;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg-page: #1f1f1f; --bg-white: #1f1f1f; --bg-header: #181818; --bg-sidebar: #181818;
    --bg-subtle: #252526; --bg-tag: #2d2d2d; --bg-row-alt: #242424; --bg-hover: #2a2d2e; --bg-active: #04395e;
    --border-color: #2b2b2b; --border-dark: #3c3c3c; --border-active: #007acc;
    --text-main: #cccccc; --text-muted: #969696; --text-subtle: #6e7681; --text-link: #3794ff;
    --status-yes: #89d185; --status-yes-bg: rgba(137, 209, 133, 0.12); --status-yes-border: rgba(137, 209, 133, 0.25);
    --status-no: #f14c4c; --status-no-bg: rgba(241, 76, 76, 0.12); --status-no-border: rgba(241, 76, 76, 0.25);
  }
}
:root[data-theme="dark"] {
  --bg-page: #1f1f1f; --bg-white: #1f1f1f; --bg-header: #181818; --bg-sidebar: #181818;
  --bg-subtle: #252526; --bg-tag: #2d2d2d; --bg-row-alt: #242424; --bg-hover: #2a2d2e; --bg-active: #04395e;
  --border-color: #2b2b2b; --border-dark: #3c3c3c; --border-active: #007acc;
  --text-main: #cccccc; --text-muted: #969696; --text-subtle: #6e7681; --text-link: #3794ff;
  --status-yes: #89d185; --status-yes-bg: rgba(137, 209, 133, 0.12); --status-yes-border: rgba(137, 209, 133, 0.25);
  --status-no: #f14c4c; --status-no-bg: rgba(241, 76, 76, 0.12); --status-no-border: rgba(241, 76, 76, 0.25);
}

html, body {
  height: 100%;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.45;
  color: var(--text-main);
  background-color: var(--bg-page);
  overflow: hidden;
}

a { color: var(--text-link); text-decoration: none; }
a:hover { text-decoration: underline; }

.app-header {
  height: 44px; background: var(--bg-header); border-bottom: 1px solid var(--border-color);
  display: flex; align-items: center; justify-content: space-between; padding: 0 16px; z-index: 10;
}
.header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.catalog-title { font-size: 0.95rem; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.catalog-subtitle-btn { font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; flex-shrink: 0; }

.header-center { flex: 1; max-width: 480px; margin: 0 16px 0 28px; }
.search-wrap { position: relative; display: flex; align-items: center; width: 100%; }
.search-icon { position: absolute; left: 10px; font-size: 0.8rem; opacity: 0.6; pointer-events: none; }
.header-search-input {
  width: 100%; padding: 5px 32px 5px 30px; font-size: 0.8rem; font-family: inherit;
  border-radius: 4px; border: 1px solid var(--border-dark); background: var(--bg-tag); color: var(--text-main); outline: none;
  transition: all 0.15s ease;
}
.header-search-input:focus { border-color: var(--border-active); box-shadow: 0 0 0 1px var(--border-active); background: var(--bg-white); }
.header-search-input::placeholder { color: var(--text-subtle); }
.btn-clear-search {
  position: absolute; right: 6px; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: 50%; font-size: 0.75rem;
  transition: background 0.12s;
}
.btn-clear-search:hover { background: var(--bg-hover); color: var(--text-main); }

mark.search-highlight { background: rgba(250, 204, 21, 0.4); color: inherit; padding: 0 2px; border-radius: 2px; }
[data-theme="dark"] mark.search-highlight { background: rgba(56, 189, 248, 0.28); color: #7dd3fc; }

.cat-found-badge {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; font-size: 0.74rem; font-weight: 500;
  border-radius: 4px; background: var(--bg-subtle); border: 1px solid var(--border-color); color: var(--text-link);
  cursor: pointer; text-decoration: none; transition: all 0.12s ease;
}
.cat-found-badge:hover { background: var(--bg-hover); border-color: var(--border-dark); text-decoration: underline; }

.link-site { font-size: 0.78rem; font-weight: 500; color: var(--text-link); }

.header-right { display: flex; align-items: center; gap: 12px; }
.btn-theme-toggle {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; font-size: 0.75rem; font-weight: 500;
  border: 1px solid var(--border-color); background: var(--bg-white); color: var(--text-main); border-radius: 4px;
  cursor: pointer; user-select: none; transition: all 0.15s ease;
}
.btn-theme-toggle:hover { background: var(--bg-hover); border-color: var(--border-dark); }
.theme-icon { font-size: 0.85rem; line-height: 1; }

/* --sidebar-width зберігається в localStorage (setupSidebarResize) — 380px тут лише
   дефолт для першого відкриття, поки JS ще не застосував збережене значення. */
.workspace { display: grid; grid-template-columns: var(--sidebar-width, 380px) 5px 1fr; height: calc(100vh - 44px); overflow: hidden; }

.sidebar { background: var(--bg-sidebar); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; overflow: hidden; min-width: 200px; }
.sidebar-resize-handle { cursor: col-resize; background: transparent; position: relative; }
.sidebar-resize-handle::after { content: ''; position: absolute; top: 0; bottom: 0; left: -3px; right: -3px; }
.sidebar-resize-handle:hover, .sidebar-resize-handle.dragging { background: var(--border-active); }
.sidebar-top { padding: 8px 12px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; background: var(--bg-subtle); }
.sidebar-label { font-size: 0.76rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
.sidebar-tools { display: flex; align-items: center; gap: 6px; }
.btn-link { background: none; border: none; color: var(--text-link); font-size: 0.74rem; font-weight: 500; cursor: pointer; padding: 0; }
.btn-link:hover { text-decoration: underline; }
.divider { color: var(--border-color); font-size: 0.7rem; }

.category-tree { flex: 1; overflow-y: auto; padding: 6px 4px; }
.nav-node { display: flex; flex-direction: column; }
.nav-row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 4px; cursor: pointer; user-select: none; font-size: 0.82rem; transition: background 0.1s; }
.nav-row:hover { background: var(--bg-hover); }
.nav-row.active { background: var(--bg-active); color: var(--text-link); font-weight: 600; }

.arrow { width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.58rem; color: var(--text-subtle); flex-shrink: 0; transition: transform 0.15s ease; }
.arrow.closed { transform: rotate(-90deg); }
.arrow.empty { visibility: hidden; }
.node-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.node-count { font-size: 0.72rem; color: var(--text-subtle); font-weight: 500; margin-left: 4px; flex-shrink: 0; }
.nav-children { display: flex; flex-direction: column; }
.nav-children.hidden { display: none; }

.main-content { background: var(--bg-page); display: flex; flex-direction: column; overflow-y: auto; }

.category-header {
  background: var(--bg-white); border-bottom: 1px solid var(--border-color); padding: 12px 20px;
  position: sticky; top: 0; z-index: 5; /* закріплено при скролі #content-body — однаково для будь-якого відкритого рівня, бо це один і той самий елемент */
}
.breadcrumbs { font-size: 0.74rem; color: var(--text-subtle); margin-bottom: 6px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.breadcrumbs .crumb-link { color: var(--text-muted); cursor: pointer; }
.breadcrumbs .crumb-link:hover { text-decoration: underline; }
.breadcrumbs .crumb-current { color: var(--text-main); font-weight: 600; }

/* Стовпці зі спільними шириними колонками (заголовок категорії + список підкатегорій під ним)
   мають лишатись вирівняними по вертикалі — фіксований layout читає ширини з першого рядка. */
.aligned-table { table-layout: fixed; }
.level-tag { font-size: 0.7rem; font-weight: 600; padding: 2px 6px; border-radius: 3px; background: var(--bg-tag); border: 1px solid var(--border-dark); color: var(--text-muted); white-space: nowrap; }
.btn-default {
  display: inline-flex; align-items: center; padding: 4px 10px; font-size: 0.76rem; font-weight: 500;
  border: 1px solid var(--border-color); background: var(--bg-white); border-radius: 4px; color: var(--text-main); cursor: pointer;
}
.btn-default:hover { background: var(--bg-hover); }

.content-body { padding: 16px 20px; display: flex; flex-direction: column; gap: 16px; }

.section-block { background: var(--bg-white); border: 1px solid var(--border-color); border-radius: 4px; overflow: hidden; }
.section-head { padding: 8px 12px; background: var(--bg-subtle); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; font-size: 0.82rem; font-weight: 600; color: var(--text-muted); gap: 8px; flex-wrap: wrap; }
/* Заголовок блоку (напр. "Підкатегорії (N)") вирівняно з текстом у стовпці "Назва
   категорії" таблиці над ним: 38px ширина .col-n + 10px горизонтальний padding
   комірок .simple-table — саме звідти цей текст там починається. */
.section-head-aligned { padding-left: 48px; }

/* Підсумкові рядки ("Товари в підкатегоріях" / "Разом в цій категорії") — трохи
   виділені (тонований фон + кольорова риска зліва), але без різкого контрасту,
   щоб виглядало як спокійний акцент, а не попередження. */
.summary-block { background: var(--bg-subtle); border-left: 3px solid var(--border-active); }
.table-subhead { padding: 6px 12px; font-size: 0.76rem; font-weight: 600; color: var(--text-muted); background: var(--bg-subtle); border-bottom: 1px solid var(--border-color); }

.table-wrap { width: 100%; overflow-x: auto; }
.simple-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: left; }
.simple-table th { background: var(--bg-subtle); color: var(--text-muted); font-weight: 600; padding: 6px 10px; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
.simple-table td { padding: 6px 10px; border-bottom: 1px solid var(--border-color); vertical-align: middle; }
.simple-table tbody tr:nth-child(even) { background: var(--bg-row-alt); }
.simple-table tbody tr:hover { background: var(--bg-hover); }
.simple-table tfoot td { padding: 8px 10px; border-top: 2px solid var(--border-color); border-bottom: none; background: var(--bg-subtle); vertical-align: middle; }

.col-n { width: 38px; text-align: center; color: var(--text-subtle); font-weight: 600; }
.col-code { width: 90px; }
.item-code { font-family: var(--font-mono); font-size: 0.74rem; color: var(--text-main); background: var(--bg-tag); padding: 1px 4px; border-radius: 3px; border: 1px solid var(--border-color); white-space: nowrap; }
.cat-jump-link { color: var(--text-main); text-decoration: none; cursor: pointer; transition: color 0.1s ease; }
.cat-jump-link:hover { color: var(--text-link); text-decoration: underline; }
.col-name a { color: var(--text-main); }
.col-name a:hover { color: var(--text-link); text-decoration: underline; }
.col-avail { width: 150px; text-align: center; }

.stock-badge { display: inline-block; padding: 1px 6px; font-size: 0.72rem; font-weight: 500; border-radius: 3px; white-space: nowrap; }
.stock-badge.yes { background: var(--status-yes-bg); color: var(--status-yes); border: 1px solid var(--status-yes-border); }
.stock-badge.no { background: var(--status-no-bg); color: var(--status-no); border: 1px solid var(--status-no-border); }
.stock-badge.neutral { background: var(--bg-tag); color: var(--text-subtle); border: 1px solid var(--border-color); }

.diff-zero { color: var(--status-yes); font-weight: 600; }
.diff-nonzero { color: var(--status-no); font-weight: 700; }

/* Один стиль для ВСІХ числових значень у таблицях (Товарів / В наявності / Немає в
   наявності скрізь — і в заголовку категорії, і в підкатегоріях, і в підсумкових
   рядках): просте кольорове число, без "пігулки"-бейджа з фоном і рамкою. Бейдж
   (.stock-badge) лишається тільки для текстового статусу товару ("Готово до
   відправки" тощо) в таблиці товарів — там це напис, а не число. */
.count-yes { color: var(--status-yes); font-weight: 600; }
.count-no  { color: var(--status-no); font-weight: 600; }

/* Товщина шрифту — окремий клас на кожен елемент, значення можна міняти тут незалежно одне від одного */
.fw-cat-link   { font-weight: 600; } /* назва (під)категорії-посилання в таблицях */
.fw-count-cell { font-weight: 600; } /* числові підсумкові комірки таблиць (товарів, «разом» по категорії) */
.fw-grand-row  { font-weight: 700; } /* рядок «Разом» підсумкової таблиці — підпис і числа */
.fw-grand-badge{ font-weight: 700; } /* числа «В наявності» / «Немає в наявності» саме в рядку «Разом» */
.fw-meta-label { font-weight: 600; } /* короткі службові підписи (лічильники, заголовки порожніх станів) */

.empty-note { padding: 16px; text-align: center; color: var(--text-subtle); font-style: italic; }

.info-banner {
  padding: 10px 14px; background: var(--bg-white); border: 1px solid var(--border-color); border-left: 4px solid var(--border-active);
  border-radius: 4px; font-size: 0.8rem; line-height: 1.45; color: var(--text-main); display: flex; align-items: flex-start; gap: 10px;
}
.info-banner.warning { border-left-color: #eab308; background: var(--bg-subtle); }

.orphan-cat-list { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }

/* Гарні підказки замість нативного title (той не переноситься й губиться на довгому тексті).
   Позиціонується через JS (setupTooltips) в координатах в'юпорта — саме тому fixed, а не
   absolute, щоб не обрізáлось контейнерами з overflow (.table-wrap, .main-content). */
[data-tip] { cursor: help; }
#custom-tooltip {
  position: fixed; z-index: 200; max-width: 300px;
  background: var(--text-main); color: var(--bg-white);
  padding: 8px 10px; border-radius: 6px;
  font-size: 0.74rem; font-weight: 400; line-height: 1.45; white-space: normal;
  box-shadow: 0 6px 18px rgba(0,0,0,0.28);
  opacity: 0; pointer-events: none; transition: opacity 0.12s ease;
}
#custom-tooltip.visible { opacity: 1; }

.help-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100;
  display: none; align-items: flex-start; justify-content: center; padding: 40px 16px; overflow-y: auto;
}
.help-overlay.open { display: flex; }
.help-panel {
  background: var(--bg-white); border: 1px solid var(--border-color); border-radius: 8px;
  max-width: 640px; width: 100%; box-shadow: 0 16px 40px rgba(0,0,0,0.3);
}
.help-panel-head {
  display: flex; align-items: center; justify-content: space-between; padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);
}
.help-panel-head h3 { font-size: 1rem; font-weight: 700; color: var(--text-main); }
.btn-help-close {
  background: none; border: none; font-size: 1.1rem; color: var(--text-muted); cursor: pointer;
  width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
}
.btn-help-close:hover { background: var(--bg-hover); color: var(--text-main); }
.help-panel-body { padding: 6px 18px 18px; max-height: 70vh; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.help-term { display: flex; flex-direction: column; gap: 3px; padding: 8px 0; border-bottom: 1px solid var(--border-color); }
.help-term:last-child { border-bottom: none; }
.help-term-label { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.85rem; color: var(--text-main); flex-wrap: wrap; }
.help-term-desc { font-size: 0.8rem; color: var(--text-muted); line-height: 1.5; }

@media (max-width: 800px) {
  .app-header { height: auto; padding: 8px 12px; flex-wrap: wrap; gap: 8px; }
  .header-left { order: 1; }
  .header-right { order: 2; }
  .header-center { order: 3; max-width: 100%; margin: 4px 0 0; width: 100%; }
  .workspace { grid-template-columns: 1fr; height: auto; overflow: visible; }
  html, body { overflow: visible; height: auto; }
  .sidebar { max-height: 300px; border-right: none; border-bottom: 1px solid var(--border-color); }
  .sidebar-resize-handle { display: none; }
}
`;

// ==================== ПЕРЕМИКАЧ ТЕМИ (спільний для map_<id>.html і map.html) ====================
// Винесено з initCatalogMap top-level, теж пишеться як звичайна функція і теж
// іде в map-common.js через .toString() — на відміну від решти клієнтського
// додатку, це потрібне і на індексній map.html (build-maps.js), яка не має
// дерева категорій CATALOG_DATA, тож не може викликати initCatalogMap.
// Самодостатня: шукає #btn-theme-toggle сама, застосовує збережену/системну
// тему одразу при виклику й одразу ж навішує обробник кліку.
function initThemeToggle() {
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('map-theme', theme); } catch (e) {}
    var btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;
    if (theme === 'dark') { btn.innerHTML = '<span class="theme-icon">☀️</span> <span class="theme-text">Світла</span>'; }
    else { btn.innerHTML = '<span class="theme-icon">🌙</span> <span class="theme-text">Темна</span>'; }
  }
  var saved = null;
  try { saved = localStorage.getItem('map-theme'); } catch (e) {}
  applyTheme(saved === 'light' ? 'light' : (saved === 'dark' ? 'dark' : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')));

  var btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.addEventListener('click', function () {
    var current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

// ==================== КЛІЄНТСЬКИЙ ДОДАТОК ====================
// Пишеться як звичайна функція (не рядок!) — при генерації сторінки
// перетворюється у текст через .toString(), тому шаблонні рядки й лапки
// всередині не потребують екранування.
function initCatalogMap(CATALOG_DATA) {
  var state = {
    selectedNodeId: CATALOG_DATA.tree.id,
    sidebarCollapsed: new Set(),
    nodeOverrides: new Map(),
    searchQuery: ''
  };

  var nodeMap = new Map();
  var parentMap = new Map();
  var allNodes = [];
  var allProductsList = [];

  function indexTree(node, parent) {
    nodeMap.set(node.id, node);
    allNodes.push(node);
    if (parent) parentMap.set(node.id, parent);
    (node.own_products || []).forEach(function (p) {
      allProductsList.push(Object.assign({}, p, { nodeId: node.id, nodeName: node.name, nodeLevel: node.level }));
    });
    (node.children || []).forEach(function (child) { indexTree(child, node); });
  }
  indexTree(CATALOG_DATA.tree, null);

  // За замовчуванням розгорнутий лише рівень 1 (корінь) — його прямі підкатегорії
  // видно одразу, а самі вони згорнуті, тож рівні 3+ не розгортаються каскадом.
  allNodes.forEach(function (n) {
    if (n.level >= 2 && n.children && n.children.length > 0) state.sidebarCollapsed.add(n.id);
  });

  function getPath(node) {
    var path = [];
    var curr = node;
    while (curr) { path.unshift(curr); curr = parentMap.get(curr.id); }
    return path;
  }

  function isAvailableProduct(p) { return /готово/i.test(p.availability || ''); }

  function isNodeProductsVisible(node) {
    if (state.nodeOverrides.has(node.id)) return state.nodeOverrides.get(node.id);
    return true;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function diffBadge(stats) {
    // stats.diff вже коректно враховує обидві причини неможливості звірки: сайт
    // не показав лічильник (hasCounter=false) АБО скрипт запущено без CSV
    // (HAS_CSV=false, тоді total_yes завжди 0 — порівнювати з ним не можна,
    // інакше майже кожна категорія хибно підсвітилась би червоним).
    if (stats.diff === null || stats.diff === undefined) {
      return '<span class="stock-badge neutral" data-tip="Сайт не показав лічильник «В наявності N», або товари не завантажені (запущено без CSV) — звірка неможлива.">н/д</span>';
    }
    var cls = stats.diff === 0 ? 'diff-zero' : 'diff-nonzero';
    // Без data-tip на кожному значенні — пояснення формату "X/Y" дає сам <th> колонки.
    return '<span class="' + cls + '">' + stats.total_yes + '/' + stats.site_counter + '</span>';
  }

  // ── ЛІВЕ МЕНЮ КАТЕГОРІЙ ──
  function renderSidebar() {
    var container = document.getElementById('category-tree');
    container.innerHTML = '';

    function createSidebarNode(node) {
      var hasChildren = node.children && node.children.length > 0;
      var isCollapsed = state.sidebarCollapsed.has(node.id);
      var isActive = state.selectedNodeId === node.id;

      var nodeEl = document.createElement('div');
      nodeEl.className = 'nav-node';

      var row = document.createElement('div');
      row.className = 'nav-row' + (isActive ? ' active' : '');
      row.style.paddingLeft = (6 + (node.level - 1) * 16) + 'px';
      if (node.level === 1) row.style.fontWeight = '600';
      if (node.level >= 3) row.style.fontSize = '0.8rem';

      var arrow = document.createElement('span');
      arrow.className = 'arrow ' + (hasChildren ? (isCollapsed ? 'closed' : 'open') : 'empty');
      arrow.textContent = hasChildren ? '▼' : '';
      if (hasChildren) {
        arrow.addEventListener('click', function (e) {
          e.stopPropagation();
          if (state.sidebarCollapsed.has(node.id)) state.sidebarCollapsed.delete(node.id);
          else state.sidebarCollapsed.add(node.id);
          renderSidebar();
        });
      }
      row.appendChild(arrow);

      var title = document.createElement('span');
      title.className = 'node-title';
      title.textContent = node.name;
      title.title = node.name;
      row.appendChild(title);

      var ownCount = node.stats.own_products || 0;
      if (hasChildren && ownCount > 0) {
        var count = document.createElement('span');
        count.className = 'node-count';
        count.textContent = '(' + ownCount + ')';
        count.setAttribute('data-tip', 'Кількість товарів, які не входять до підкатегорій');
        row.appendChild(count);
      }

      row.addEventListener('click', function () {
        state.selectedNodeId = node.id;
        renderSidebar();
        renderContent();
      });

      nodeEl.appendChild(row);

      if (hasChildren) {
        var childrenBox = document.createElement('div');
        childrenBox.className = 'nav-children' + (isCollapsed ? ' hidden' : '');
        node.children.forEach(function (child) { childrenBox.appendChild(createSidebarNode(child)); });
        nodeEl.appendChild(childrenBox);
      }
      return nodeEl;
    }

    container.appendChild(createSidebarNode(CATALOG_DATA.tree));
  }

  // ── ОСНОВНИЙ ВМІСТ ──
  function renderContent() {
    var body = document.getElementById('content-body');
    body.innerHTML = '';

    if (state.searchQuery) { renderSearchResultsView(body, state.searchQuery); return; }

    var selNode = nodeMap.get(state.selectedNodeId) || CATALOG_DATA.tree;
    updateHeader(selNode);
    renderSingleView(selNode, body);
  }

  function updateHeader(node) {
    var bc = document.getElementById('breadcrumbs');
    var badge = document.getElementById('cat-level-badge');
    var totalCell = document.getElementById('cat-total-products');
    var verdict = document.getElementById('cat-verdict-badge');
    var totalNoCell = document.getElementById('cat-total-no');
    var heading = document.getElementById('cat-heading');
    var siteLink = document.getElementById('cat-site-link');

    var path = getPath(node);
    bc.innerHTML = '<span class="crumb-link" data-id="root">Каталог</span>' +
      path.map(function (p, idx) {
        return '<span class="sep">/</span><span class="' + (idx === path.length - 1 ? 'crumb-current' : 'crumb-link') + '" data-id="' + p.id + '">' + escapeHtml(p.name) + '</span>';
      }).join('');

    Array.prototype.forEach.call(bc.querySelectorAll('.crumb-link'), function (el) {
      el.addEventListener('click', function () {
        var targetId = el.dataset.id === 'root' ? CATALOG_DATA.tree.id : el.dataset.id;
        state.selectedNodeId = targetId;
        // Те саме, що для .cat-jump-link — розкрити гілку до вибраної категорії.
        var curr = parentMap.get(targetId);
        while (curr) { state.sidebarCollapsed.delete(curr.id); curr = parentMap.get(curr.id); }
        renderSidebar(); renderContent();
      });
    });

    badge.textContent = 'Рівень ' + node.level;
    badge.setAttribute('data-tip', 'Глибина вкладеності цієї категорії в дереві каталогу (1 = коренева категорія цього прогону).');
    totalCell.textContent = node.stats.total_products;
    verdict.innerHTML = diffBadge(node.stats);
    totalNoCell.innerHTML = '<span class="count-no">' + node.stats.total_no + '</span>';
    heading.textContent = node.name;
    if (node.url) { siteLink.href = node.url; siteLink.style.display = ''; } else siteLink.style.display = 'none';
  }

  function renderTableHtml(products) {
    var rows = products.map(function (p, i) {
      var isYes = isAvailableProduct(p);
      return (
        '<tr>' +
        '<td class="col-n">' + (p.index || i + 1) + '</td>' +
        '<td class="col-code"><span class="item-code">' + escapeHtml(p.code || ' ') + '</span></td>' +
        '<td class="col-name">' + (p.url ? '<a href="' + p.url + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(p.name) + '</a>' : escapeHtml(p.name)) + '</td>' +
        '<td class="col-avail"><span class="stock-badge ' + (isYes ? 'yes' : 'no') + '">' + escapeHtml(p.availability || ' ') + '</span></td>' +
        '</tr>'
      );
    }).join('');
    return (
      '<table class="simple-table"><thead><tr>' +
      '<th class="col-n">№</th><th class="col-code">Код</th><th>Назва товару</th><th class="col-avail">Наявність</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>'
    );
  }

  function productsSectionHtml(node, hasChildren, prods) {
    if (prods.length === 0) {
      if (!CATALOG_DATA.global_stats.has_products) {
        return '<div class="empty-note">Товари не завантажено — запустіть render-map.js з CSV-файлом другим аргументом.</div>';
      }
      return hasChildren ? '' : '<div class="empty-note">У цій категорії немає товарів.</div>';
    }
    return renderTableHtml(prods);
  }

  // Розклад "своє / у підкатегоріях / разом" для проміжних рядків під
  // "Підкатегорії" (renderSingleView) — інваріант "не показувати дублікат
  // рядка" (grand-рядок лише коли є ОБИДВА складники) рахується тут в одному
  // місці, а не дублюється в кожному викликаючому місці.
  function ownSubBreakdown(stats) {
    var ownTotal = stats.own_products || 0;
    var ownYes = stats.own_yes || 0;
    var ownNo = stats.own_no || 0;
    var allTotal = stats.total_products || ownTotal;
    var allYes = stats.total_yes || ownYes;
    var allNo = stats.total_no || ownNo;
    var subTotal = allTotal - ownTotal;
    var subYes = allYes - ownYes;
    var subNo = allNo - ownNo;
    // "Своя" сума показується, якщо вона є, або якщо взагалі немає товарів (щоб
    // блок не лишився порожнім); "у підкатегоріях" — лише якщо там є товари;
    // "разом" — лише коли показані ОБИДВА складники (інакше дублював би один з них).
    var showOwnRow = ownTotal > 0 || allTotal === 0;
    var showSubRow = subTotal > 0;
    var showGrandRow = showOwnRow && showSubRow;
    return {
      ownTotal: ownTotal, ownYes: ownYes, ownNo: ownNo,
      allTotal: allTotal, allYes: allYes, allNo: allNo,
      subTotal: subTotal, subYes: subYes, subNo: subNo,
      showOwnRow: showOwnRow, showSubRow: showSubRow, showGrandRow: showGrandRow
    };
  }

  // Один рядок проміжної суми ("своє" / "у підкатегоріях" / "разом") — без власного
  // <thead>, стовпці й ширини ті самі, що в таблиці "Назва категорії"/"Підкатегорії"
  // над ним, через .aligned-table. Кілька таких рядків збираються в одну таблицю
  // (див. виклик у renderSingleView), а не в окремі таблиці одна за одною.
  function summaryRowTr(label, total, yes, no, isGrand) {
    var rowClass = isGrand ? ' class="fw-grand-row"' : '';
    var countClass = isGrand ? '' : ' class="fw-count-cell"';
    var badgeExtra = isGrand ? ' fw-grand-badge' : '';
    return (
      '<tr' + rowClass + '>' +
      '<td class="col-n"></td>' +
      '<td>' + escapeHtml(label) + '</td>' +
      '<td style="width:80px;text-align:center;"> </td>' +
      '<td style="width:90px;text-align:center;"' + countClass + '>' + total + '</td>' +
      '<td style="width:100px;text-align:center;"><span class="count-yes' + badgeExtra + '">' + yes + '</span></td>' +
      '<td style="width:150px;text-align:center;"><span class="count-no' + badgeExtra + '">' + no + '</span></td>' +
      '<td style="width:140px;text-align:right;"> </td>' +
      '</tr>'
    );
  }

  // ── РЕЖИМ: ОБРАНИЙ РОЗДІЛ ──
  function renderSingleView(node, container) {
    var hasChildren = node.children && node.children.length > 0;
    var prods = node.own_products || [];
    var stats = node.stats || {};
    var b = ownSubBreakdown(stats);
    var ownTotal = b.ownTotal, ownYes = b.ownYes, ownNo = b.ownNo;
    var allTotal = b.allTotal, allYes = b.allYes, allNo = b.allNo;
    var subTotal = b.subTotal, subYes = b.subYes, subNo = b.subNo;
    // hasChildren завжди true в блоці нижче (він і так лише всередині if (hasChildren)),
    // але лишаємо явно — ці рядки мають сенс тільки коли підкатегорії є.
    var showOwnRow = hasChildren && b.showOwnRow;
    var showSubRow = hasChildren && b.showSubRow;
    var showGrandRow = hasChildren && b.showGrandRow;

    if (hasChildren) {
      var subBlock = document.createElement('div');
      subBlock.className = 'section-block';
      subBlock.innerHTML =
        '<div class="section-head section-head-aligned"><span>Підкатегорії (' + node.children.length + ')</span></div>' +
        // Без власного <thead> — рядок заголовків над цим блоком уже дає його таблиця
        // категорії (title-row), стовпці вирівняні через .aligned-table + однакові ширини.
        '<div class="table-wrap"><table class="simple-table aligned-table"><tbody>' +
        node.children.map(function (ch, i) {
          return (
            '<tr>' +
            '<td class="col-n">' + (i + 1) + '</td>' +
            '<td><a href="#" class="cat-jump-link fw-cat-link" data-id="' + ch.id + '">' + escapeHtml(ch.name) + '</a></td>' +
            '<td style="width:80px;text-align:center;"><span class="level-tag" data-tip="Глибина вкладеності в дереві категорій (1 = коренева категорія цього прогону).">Рівень ' + ch.level + '</span></td>' +
            '<td style="width:90px;text-align:center;" class="fw-count-cell">' + ch.stats.total_products + '</td>' +
            '<td style="width:100px;text-align:center;">' + diffBadge(ch.stats) + '</td>' +
            '<td style="width:150px;text-align:center;"><span class="count-no">' + ch.stats.total_no + '</span></td>' +
            '<td style="width:140px;text-align:right;">' + (ch.url ? '<a href="' + ch.url + '" target="_blank" rel="noopener noreferrer" class="link-site">Перейти на сайт ↗</a>' : ' ') + '</td>' +
            '</tr>'
          );
        }).join('') +
        '</tbody></table></div>';

      Array.prototype.forEach.call(subBlock.querySelectorAll('.cat-jump-link'), function (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          state.selectedNodeId = link.dataset.id;
          // Розкрити гілку дерева до вибраної категорії — інакше вона може лишитись
          // невидимою в лівому меню, якщо цей рівень згорнутий (дефолт для рівня 2+).
          var curr = parentMap.get(link.dataset.id);
          while (curr) { state.sidebarCollapsed.delete(curr.id); curr = parentMap.get(curr.id); }
          renderSidebar(); renderContent();
        });
      });
      container.appendChild(subBlock);

      // Одна таблиця з проміжними сумами одразу під "Підкатегорії": своє (якщо є) /
      // у підкатегоріях / разом (якщо є "своє" — інакше він дублював би єдиний рядок).
      var summaryRows =
        (showOwnRow ? summaryRowTr('Товари категорії, які не входять до підкатегорій', ownTotal, ownYes, ownNo, false) : '') +
        (showSubRow ? summaryRowTr('Товари в підкатегоріях', subTotal, subYes, subNo, false) : '') +
        (showGrandRow ? summaryRowTr('Разом в цій категорії', allTotal, allYes, allNo, true) : '');

      var summaryBlock = document.createElement('div');
      summaryBlock.className = 'section-block summary-block';
      summaryBlock.innerHTML = '<div class="table-wrap"><table class="simple-table aligned-table"><tbody>' + summaryRows + '</tbody></table></div>';
      container.appendChild(summaryBlock);
    }

    if (prods.length === 0 && !hasChildren) {
      var emptyBlock = document.createElement('div');
      emptyBlock.className = 'section-block';
      emptyBlock.innerHTML = productsSectionHtml(node, hasChildren, prods);
      container.appendChild(emptyBlock);
    } else if (prods.length > 0) {
      var prodBlock = document.createElement('div');
      prodBlock.className = 'section-block';
      var isVisible = isNodeProductsVisible(node);
      var headerTitle = hasChildren
        ? 'Товари категорії, які не входять до підкатегорій (' + prods.length + ')'
        : 'Товари категорії (' + prods.length + ')';

      prodBlock.innerHTML =
        '<div class="section-head section-head-aligned"><span>' + headerTitle + '</span>' +
        '<button class="btn-default" id="btn-toggle-single-prods">' + (isVisible ? 'Приховати товари' : 'Показати товари') + '</button></div>' +
        '<div class="table-wrap" id="single-prods-table" style="display:' + (isVisible ? 'block' : 'none') + ';">' + renderTableHtml(prods) + '</div>';

      var toggleBtn = prodBlock.querySelector('#btn-toggle-single-prods');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', function () {
          state.nodeOverrides.set(node.id, !isNodeProductsVisible(node));
          renderContent();
        });
      }
      container.appendChild(prodBlock);
    }
  }

  // ── ПОШУК ──
  function highlight(text, q) {
    if (!q || !text) return text || '';
    var escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var regex = new RegExp('(' + escaped + ')', 'gi');
    return String(text).replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  function renderSearchResultsView(body, query) {
    var qLower = query.toLowerCase();
    var matches = allProductsList.filter(function (p) {
      return (p.name || '').toLowerCase().indexOf(qLower) !== -1 ||
        (p.code || '').toLowerCase().indexOf(qLower) !== -1 ||
        (p.nodeName || '').toLowerCase().indexOf(qLower) !== -1;
    });

    var bc = document.getElementById('breadcrumbs');
    var badge = document.getElementById('cat-level-badge');
    var totalCell = document.getElementById('cat-total-products');
    var verdict = document.getElementById('cat-verdict-badge');
    var totalNoCell = document.getElementById('cat-total-no');
    var heading = document.getElementById('cat-heading');
    var siteLink = document.getElementById('cat-site-link');

    bc.innerHTML = '<span>Каталог</span> <span class="sep">/</span> <span class="crumb-current">Результати пошуку</span>';
    badge.textContent = matches.length + ' знайдено';
    totalCell.textContent = ' ';
    verdict.innerHTML = '';
    totalNoCell.textContent = ' ';
    heading.textContent = 'Пошук за запитом «' + query + '»';
    siteLink.style.display = 'none';

    if (matches.length === 0) {
      body.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">🔍</div>' +
        '<div class="fw-meta-label" style="font-size:1.05rem;margin-bottom:8px;color:var(--text-main);">За запитом «' + escapeHtml(query) + '» нічого не знайдено</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted);max-width:480px;margin:0 auto;">Перевірте написання або спробуйте інше слово (назву, код товару чи категорію).</div>' +
        '</div>';
      return;
    }

    var section = document.createElement('div');
    section.className = 'section-block';
    var head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;"><span>Знайдені товари</span>' +
      '<span style="font-size:0.72rem;color:var(--text-muted);">(' + matches.length + ' позицій)</span></div>' +
      '<button class="btn-link" id="btn-reset-search-in-view" style="font-size:0.75rem;">✕ Скинути пошук</button>';
    section.appendChild(head);

    var tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    var rowsHtml = matches.map(function (p, idx) {
      var isYes = isAvailableProduct(p);
      return (
        '<tr><td class="col-n">' + (idx + 1) + '</td>' +
        '<td class="col-code"><span class="item-code">' + highlight(escapeHtml(p.code || ''), query) + '</span></td>' +
        '<td class="col-name"><a href="' + p.url + '" target="_blank" rel="noopener noreferrer">' + highlight(escapeHtml(p.name), query) + '</a></td>' +
        '<td style="width:220px;"><a href="#" class="cat-found-badge" data-node-id="' + p.nodeId + '" data-tip="Перейти до розділу в каталозі">📁 ' + highlight(escapeHtml(p.nodeName), query) + '</a></td>' +
        '<td class="col-avail"><span class="stock-badge ' + (isYes ? 'yes' : 'no') + '">' + escapeHtml(p.availability || ' ') + '</span></td>' +
        '</tr>'
      );
    }).join('');
    tableWrap.innerHTML =
      '<table class="simple-table"><thead><tr>' +
      '<th class="col-n">№</th><th class="col-code">Код</th><th>Назва товару</th><th style="width:220px;">Категорія</th><th class="col-avail">Наявність</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
    section.appendChild(tableWrap);
    body.appendChild(section);

    Array.prototype.forEach.call(section.querySelectorAll('.cat-found-badge'), function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var targetId = el.getAttribute('data-node-id');
        if (!targetId) return;
        var searchInput = document.getElementById('search-input');
        var btnClear = document.getElementById('btn-clear-search');
        if (searchInput) searchInput.value = '';
        if (btnClear) btnClear.style.display = 'none';
        state.searchQuery = '';
        state.selectedNodeId = targetId;
        var curr = parentMap.get(targetId);
        while (curr) { state.sidebarCollapsed.delete(curr.id); curr = parentMap.get(curr.id); }
        renderSidebar(); renderContent();
      });
    });

    var btnReset = section.querySelector('#btn-reset-search-in-view');
    if (btnReset) {
      btnReset.addEventListener('click', function () {
        var searchInput = document.getElementById('search-input');
        var btnClear = document.getElementById('btn-clear-search');
        if (searchInput) searchInput.value = '';
        if (btnClear) btnClear.style.display = 'none';
        state.searchQuery = '';
        renderContent();
      });
    }
  }

  // ── ІНІЦІАЛІЗАЦІЯ ПОДІЙ ──
  function setupEvents() {
    document.getElementById('btn-expand-all').addEventListener('click', function () { state.sidebarCollapsed.clear(); renderSidebar(); });
    document.getElementById('btn-collapse-all').addEventListener('click', function () {
      // Рівень 1 лишається розгорнутим — згортаються рівні 2+ (те саме, що й дефолтний стан).
      allNodes.forEach(function (n) { if (n.level >= 2 && n.children && n.children.length > 0) state.sidebarCollapsed.add(n.id); });
      renderSidebar();
    });

    // Посилання в панелі "Товари поза категоріями" — статичний список (рахується
    // один раз при генерації), тож слухачі теж достатньо навісити один раз тут,
    // а не при кожному renderContent.
    var orphanOverlayEl = document.getElementById('orphan-overlay');
    Array.prototype.forEach.call(document.querySelectorAll('.orphan-cat-link'), function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        state.selectedNodeId = link.dataset.id;
        var curr = parentMap.get(link.dataset.id);
        while (curr) { state.sidebarCollapsed.delete(curr.id); curr = parentMap.get(curr.id); }
        if (orphanOverlayEl) orphanOverlayEl.classList.remove('open');
        renderSidebar(); renderContent();
      });
    });

    // Спільна поведінка для будь-якої модальної панелі в стилі Довідки (відкрити/
    // закрити кнопкою, кліком поза панеллю, Esc) — Довідка й "Товари поза
    // категоріями" використовують один і той самий overlay/panel вигляд.
    function setupModalOverlay(overlayId, openBtnId, closeBtnId) {
      var overlay = document.getElementById(overlayId);
      if (!overlay) return;
      var openBtn = document.getElementById(openBtnId);
      var closeBtn = document.getElementById(closeBtnId);
      function open() { overlay.classList.add('open'); }
      function close() { overlay.classList.remove('open'); }
      if (openBtn) openBtn.addEventListener('click', open);
      if (closeBtn) closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });
    }
    setupModalOverlay('help-overlay', 'btn-help', 'btn-help-close');
    setupModalOverlay('orphan-overlay', 'btn-orphan-cats', 'btn-orphan-close');

    var searchInput = document.getElementById('search-input');
    var btnClear = document.getElementById('btn-clear-search');
    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        state.searchQuery = e.target.value.trim();
        if (btnClear) btnClear.style.display = state.searchQuery ? 'inline-flex' : 'none';
        renderContent();
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          searchInput.value = ''; state.searchQuery = '';
          if (btnClear) btnClear.style.display = 'none';
          renderContent();
        }
      });
    }
    if (btnClear) {
      btnClear.addEventListener('click', function () {
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        state.searchQuery = '';
        btnClear.style.display = 'none';
        renderContent();
      });
    }
  }

  // ── ГАРНІ ПІДКАЗКИ (замість нативного title, який погано читається на довгих текстах) ──
  // Один спільний елемент на всю сторінку, позиційований за координатами наведеного елемента —
  // це навмисно position:fixed + JS, а не CSS-::after, бо position:absolute всередині
  // .table-wrap/.main-content (обидва з overflow-y:auto) обрізав би підказку, що виходить
  // за межі таблиці чи в'юпорта скролу. Делеговані слухачі на document — підказки працюють
  // і для елементів, доданих пізніше через innerHTML (перерендер дерева/таблиць).
  function setupTooltips() {
    var tipEl = document.createElement('div');
    tipEl.id = 'custom-tooltip';
    document.body.appendChild(tipEl);

    function place(el) {
      var r = el.getBoundingClientRect();
      var margin = 8;
      tipEl.style.left = '0px';
      tipEl.style.top = '0px';
      var tr = tipEl.getBoundingClientRect();
      var left = r.left + r.width / 2 - tr.width / 2;
      left = Math.max(margin, Math.min(left, window.innerWidth - tr.width - margin));
      var top = r.bottom + margin;
      if (top + tr.height > window.innerHeight - margin) top = r.top - tr.height - margin;
      tipEl.style.left = Math.round(left) + 'px';
      tipEl.style.top = Math.round(top) + 'px';
    }
    function show(el) {
      var text = el.getAttribute('data-tip');
      if (!text) return;
      tipEl.textContent = text;
      tipEl.classList.add('visible');
      place(el);
    }
    function hide() { tipEl.classList.remove('visible'); }

    document.addEventListener('mouseover', function (e) {
      var el = e.target.closest('[data-tip]');
      if (el) show(el);
    });
    document.addEventListener('mouseout', function (e) {
      var el = e.target.closest('[data-tip]');
      if (el && !el.contains(e.relatedTarget)) hide();
    });
    document.addEventListener('focusin', function (e) {
      var el = e.target.closest('[data-tip]');
      if (el) show(el);
    });
    document.addEventListener('focusout', function (e) {
      var el = e.target.closest('[data-tip]');
      if (el) hide();
    });
    document.addEventListener('scroll', hide, true);
  }

  // ── ЗМІНЮВАНА ШИРИНА ЛІВОГО МЕНЮ (перетягування за #sidebar-resize-handle) ──
  function setupSidebarResize() {
    var MIN = 220, MAX = 640;
    var handle = document.getElementById('sidebar-resize-handle');
    if (!handle) return;

    var saved = null;
    try { saved = parseInt(localStorage.getItem('map-sidebar-width'), 10); } catch (e) {}
    if (saved && saved >= MIN && saved <= MAX) {
      document.documentElement.style.setProperty('--sidebar-width', saved + 'px');
    }

    var dragging = false;
    handle.addEventListener('pointerdown', function (e) {
      dragging = true;
      handle.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var width = Math.max(MIN, Math.min(MAX, window.innerWidth - 300, e.clientX));
      document.documentElement.style.setProperty('--sidebar-width', width + 'px');
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      var current = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10);
      if (current) { try { localStorage.setItem('map-sidebar-width', current); } catch (e) {} }
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  initThemeToggle();
  renderSidebar();
  renderContent();
  setupEvents();
  setupTooltips();
  setupSidebarResize();
}

// ==================== СПІЛЬНІ ФАЙЛИ (map-common.css / map-common.js) ====================
// css та initCatalogMap побайтово однакові для будь-якої категорії — раніше
// вбудовувались у кожен map_<id>.html окремо (роздуваючи однакову копію в
// кожному файлі), тепер пишуться один раз як спільні файли поруч з мапами.
// Перезаписуються при кожному запуску render-map.js (і, відповідно, кожному
// виклику з build-maps.js) — завжди відповідають поточній версії генератора.
// Плата за це: map_<id>.html більше не самодостатній один файл, потребує
// map-common.css/.js поруч (обидва — в тій самій, згенерованій, теці).
const COMMON_CSS_FILE = path.join(OUTPUT_DIR, 'map-common.css');
const COMMON_JS_FILE = path.join(OUTPUT_DIR, 'map-common.js');
fs.writeFileSync(COMMON_CSS_FILE, css.trim() + '\n', 'utf-8');
fs.writeFileSync(COMMON_JS_FILE, initThemeToggle.toString() + '\n\n' + initCatalogMap.toString() + '\n', 'utf-8');

// ==================== ЗБІРКА HTML ====================
const maxLevelSafe = CATALOG_DATA.global_stats.levels;

const infoBanner = HAS_CSV ? '' : `
    <div class="info-banner warning" style="margin: 12px 20px 0;">
      <span>⚠️</span>
      <span>Товари не завантажені — мапа показує лише структуру категорій і лічильники сайту. Це станеться само:
      запустіть <code>node render-map.js ${categoryId}</code> ще раз, коли в output/ з'явиться ${categoryId}_cncprom_complete.csv (ЕТАП 2 scrape-complete.js).</span>
    </div>`;

// Кнопка в шапці (поряд з "Мапа розділу") + модальна панель зі списком —
// замість банера прямо над змістом (той засмічував основну мапу постійно
// видимим блоком). Панель — не окрема сутність, а другий екземпляр того
// самого overlay/panel вигляду, що й Довідка (див. setupModalOverlay).
// Обидва рахуються один раз при генерації, тож коли orphanCategories порожній
// (немає жодної такої категорії), ні кнопки, ні панелі в розмітці нема.
const orphanMenuButtonHtml = orphanCategories.length === 0 ? '' : `
      <button id="btn-orphan-cats" class="btn-theme-toggle catalog-subtitle-btn" data-tip="Знайдені товари, які не входять до підкатегорій">⚠️ Товари поза категоріями</button>`;

const orphanPanelHtml = orphanCategories.length === 0 ? '' : `
  <div class="help-overlay" id="orphan-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Знайдені товари, які не входять до підкатегорій:</h3>
        <button class="btn-help-close" id="btn-orphan-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <div class="orphan-cat-list">${orphanCategories.map(c =>
          '<a href="#" class="cat-found-badge orphan-cat-link" data-id="' + c.id + '">📁 ' + escapeHtmlOuter(c.name) + ' <span class="node-count">(' + c.own + ')</span></a>'
        ).join('')}</div>
      </div>
    </div>
  </div>`;

const rootUrl = CATALOG_DATA.tree.url || '#';
const rootLevelsLabel = maxLevelSafe > 1 ? `1–${maxLevelSafe} рівні` : 'рівень 1';

const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Каталог: ${escapeHtmlOuter(CATALOG_DATA.tree.name)} (${rootLevelsLabel})</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="map-common.css">
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="catalog-title">${escapeHtmlOuter(CATALOG_DATA.tree.name)}</span>
      <button class="btn-theme-toggle catalog-subtitle-btn">🕒 Мапа розділу · ${escapeHtmlOuter(scrapedAt)}</button>${orphanMenuButtonHtml}
    </div>
    <div class="header-center">
      <div class="search-wrap">
        <span class="search-icon">\u{1F50D}</span>
        <input type="text" id="search-input" class="header-search-input" placeholder="Пошук товарів, кодів, категорій...">
        <button id="btn-clear-search" class="btn-clear-search" data-tip="Очистити пошук (Esc)" style="display:none;">✕</button>
      </div>
    </div>
    <div class="header-right">
      <button id="btn-help" class="btn-theme-toggle" data-tip="Пояснення до цифр і позначок на цій сторінці">❓ Довідка</button>
      <button id="btn-theme-toggle" class="btn-theme-toggle" data-tip="Перемкнути тему">
        <span class="theme-icon">\u{1F319}</span> <span class="theme-text">Темна</span>
      </button>
      <a href="${rootUrl}" target="_blank" rel="noopener noreferrer" class="link-site">cncprom.ua ↗</a>
    </div>
  </header>

  <div class="help-overlay" id="help-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Що означають ці цифри та позначки</h3>
        <button class="btn-help-close" id="btn-help-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <div class="help-term">
          <div class="help-term-label"><span class="level-tag">Рівень N</span></div>
          <div class="help-term-desc">Глибина вкладеності категорії в дереві каталогу сайту.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Число в дужках біля назви категорії в лівому меню</div>
          <div class="help-term-desc">Кількість товарів, які не входять до підкатегорій.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Товарів</div>
          <div class="help-term-desc">Кількість товарів у категорії разом з усіма підкатегоріями.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">В наявності</div>
          <div class="help-term-desc">Перше число: кількість товарів зі статусом «Готово до відправки», яке нарахував парсер. Друге число: кількість товарів з лічильника «В наявності» сайту.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Зелений/червоний колір в стовпчику «В наявності»</div>
          <div class="help-term-desc">Зелений — точний збіг. Червоний — будь-яка розбіжність.</div>
        </div>
      </div>
    </div>
  </div>
  ${orphanPanelHtml}

  <div class="workspace">
    <aside class="sidebar">
      <div class="sidebar-top">
        <span class="sidebar-label">Категорії</span>
        <div class="sidebar-tools">
          <button id="btn-expand-all" class="btn-link" data-tip="Розгорнути підкатегорії">Розгорнути</button>
          <span class="divider">|</span>
          <button id="btn-collapse-all" class="btn-link" data-tip="Згорнути підкатегорії (крім рівня 1)">Згорнути</button>
        </div>
      </div>
      <nav class="category-tree" id="category-tree"></nav>
    </aside>

    <div class="sidebar-resize-handle" id="sidebar-resize-handle" data-tip="Перетягніть, щоб змінити ширину меню"></div>

    <main class="main-content">
      <div class="category-header" id="category-header">
        <div class="breadcrumbs" id="breadcrumbs"><span>Каталог</span></div>
        <div class="title-row table-wrap">
          <table class="simple-table aligned-table"><thead><tr>
            <th class="col-n"></th>
            <th>Назва категорії</th>
            <th style="width:80px;text-align:center;" data-tip="Глибина вкладеності категорії в дереві каталогу.">Рівень</th>
            <th style="width:90px;text-align:center;" data-tip="Усього товарів у цій категорії разом з усіма її підкатегоріями.">Товарів</th>
            <th style="width:100px;text-align:center;" data-tip="Перше число — кількість товарів зі статусом «Готово до відправки», яке нарахував парсер. Друге число — кількість товарів з лічильника «В наявності» сайту.">В наявності</th>
            <th style="width:150px;text-align:center;" data-tip="Скільки товарів зі статусом «Немає в наявності» за даними парсера. Незалежного лічильника на сайті для цього нема.">Немає в наявності</th>
            <th style="width:140px;text-align:right;">Перейти на сайт</th>
          </tr></thead><tbody><tr>
            <td class="col-n"></td>
            <td id="cat-heading" class="fw-cat-link">${escapeHtmlOuter(CATALOG_DATA.tree.name)}</td>
            <td style="text-align:center;"><span id="cat-level-badge" class="level-tag">Рівень 1</span></td>
            <td style="text-align:center;" class="fw-count-cell" id="cat-total-products">${CATALOG_DATA.tree.stats.total_products}</td>
            <td style="text-align:center;" id="cat-verdict-badge"></td>
            <td style="text-align:center;" id="cat-total-no"><span class="count-no">${CATALOG_DATA.tree.stats.total_no}</span></td>
            <td style="text-align:right;"><a id="cat-site-link" href="#" target="_blank" rel="noopener noreferrer" class="link-site">Перейти на сайт ↗</a></td>
          </tr></tbody></table>
        </div>
      </div>
      ${infoBanner}
      <div class="content-body" id="content-body"></div>
    </main>
  </div>

<script src="map-common.js"></script>
<script>
const CATALOG_DATA = ${JSON.stringify(CATALOG_DATA)};
initCatalogMap(CATALOG_DATA);
</script>
</body>
</html>`;

function escapeHtmlOuter(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

fs.writeFileSync(OUTPUT_HTML, html, 'utf-8');

// Невеликий супутній файл з тими самими global_stats, що вбудовані в саму
// мапу — щоб build-maps.js міг зібрати зведену таблицю для map.html (індексу
// всіх категорій), не розпаковуючи CATALOG_DATA з готового HTML.
fs.writeFileSync(path.join(OUTPUT_DIR, `${categoryId}_map.summary.json`), JSON.stringify({ id: categoryId, ...globalStats }, null, 2), 'utf-8');

console.log(`Мапу збережено: ${OUTPUT_HTML}`);
console.log(`Категорій: ${categoriesCount}, рівнів: ${maxLevelSafe}, товарів: ${appTree.stats.total_products}${HAS_CSV ? ` (в наявності: ${appTree.stats.total_yes})` : ' (без CSV — лише структура)'}`);

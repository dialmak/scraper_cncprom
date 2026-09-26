// render-map.js — генерує інтерактивну HTML-мапу дерева категорій з файлу
// <ID>_catalog.json (його пише scrape-complete.js): дерево категорій плюс
// товари з назвою, кодом і наявністю в одному файлі. Файл шукається
// автоматично за ID категорії в output/site/. Ім'я файлу починається з ID (не
// з типу файлу), щоб усі файли однієї категорії стояли поруч при сортуванні
// за іменем у провіднику — те саме, що й у scrape-complete.js.
//
// Дизайн — діловий "desktop"-стиль (сайдбар з деревом категорій зліва +
// таблиці товарів праворуч, світла/темна тема, живий пошук).
//
// Використання:
//   node render-map.js <ID>
//
// Результат (усе в output/site/, поруч зі скриптом, не в корені
// проєкту): <ID>_map.html + спільні map-common.css/map-common.js (стилі й
// клієнтський додаток, однакові для будь-якої категорії — пишуться/
// перезаписуються при кожному запуску) + <ID>_map.summary.json (короткий
// підсумок для індексної build-maps.js/map.html). Відкривається прямо з
// диска подвійним кліком у браузері, але вже НЕ одним самодостатнім файлом —
// map-common.css/.js мають лежати поруч у тій самій теці.

const fs = require('fs');
const path = require('path');
const { escapeHtmlOuter } = require('./lib/html');
const { ICONS } = require('./lib/icons');
const { helpMenuHtml, aboutPanelHtml, creditsPanelHtml, searchHelpHtml, writeLogos } = require('./lib/help');
const { assetVer } = require('./lib/assets');
const { fmtDateTime } = require('./lib/time');
const { narrowGuardHtml } = require('./lib/notice');

const OUTPUT_DIR = path.join(__dirname, 'output', 'site');

const categoryId = process.argv[2];
if (!categoryId) {
  console.error('Використання: node render-map.js <ID категорії>');
  console.error('Приклад: node render-map.js 1022485');
  process.exit(1);
}

const catalogFile = path.join(OUTPUT_DIR, `${categoryId}_catalog.json`);

if (!fs.existsSync(catalogFile)) {
  console.error(`Файл не знайдено: ${catalogFile}`);
  console.error(`Спершу запустіть: node scrape-complete.js "<URL категорії ${categoryId}>"`);
  process.exit(1);
}

const OUTPUT_HTML = path.join(OUTPUT_DIR, `${categoryId}_map.html`);

// Один файл на категорію: дерево, товари і звірка, записані одним прогоном
// (див. scrape-complete.js). Тому "дерево з одного прогону + товари з іншого"
// тут структурно неможливе.
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf-8'));
const tree = catalog.tree;

// Час скрапінгу пишеться в самому файлі (`scrapedAt`), а не береться з mtime:
// mtime міняється від копіювання файлу, а зафіксований момент прогону — ні.
const scrapedAtDate = catalog.scrapedAt ? new Date(catalog.scrapedAt) : fs.statSync(catalogFile).mtime;
// Київський час, а не пояс машини: в GitHub Actions це UTC, і на сайті
// стояв час на три години раніше за справжній, без будь-якої позначки про це.
const scrapedAt = fmtDateTime(scrapedAtDate);

// Товари групуються за categoryId — тим самим полем, яке scrape-complete.js
// записує і у вузол дерева (канонічна, найглибша категорія товару), тож
// зіставлення товар -> вузол точне за побудовою.
const productsByCategory = new Map();
(catalog.products || []).forEach(r => {
  const key = String(r.categoryId);
  if (!productsByCategory.has(key)) productsByCategory.set(key, []);
  productsByCategory.get(key).push(r);
});
// Каталог без жодного товару (етап 2 не прочитав жодної сторінки товару)
// малюється лише структурою — з лічильниками сайту, без звірки.
const HAS_PRODUCTS = (catalog.products || []).length > 0;

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

  const rawProducts = productsByCategory.get(String(node.categoryId)) || [];
  const products = rawProducts.map((r, i) => ({
    index: i + 1,
    code: r.sku || '',
    name: r.productName || r.productId || '',
    url: r.finalUrl || '',
    availability: r.availabilityStatus || ''
  }));
  const ownYes = products.filter(isAvailableProduct).length;
  const ownNo = products.length - ownYes;
  const ownCount = HAS_PRODUCTS ? products.length : (node.directProductCount || 0);

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
  const diff = hasCounter && HAS_PRODUCTS ? totalYes - node.siteAvailableCounter : null;

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
// сайдбарі. З цього списку — кнопка «Товари поза категоріями» в шапці й панель
// за нею: у дереві ці товари не видно, поки категорію не розгорнути.
const orphanCategories = [];
// Плаский список вузлів у порядку обходу, з тими самими числами, що показує мапа.
// build-maps.js бере з нього дерево для XLSX і добудовані ланки панелей-дерев
// (там потрібні числа вузла). Рахувати їх там заново означало б другу реалізацію
// тієї ж арифметики, яка колись розійдеться з першою.
const flatNodes = [];
(function walk(n, parentId) {
  categoriesCount++;
  maxLevel = Math.max(maxLevel, n.level);
  if (n.children.length > 0 && n.stats.own_products > 0) {
    orphanCategories.push({ id: n.id, name: n.name, level: n.level, own: n.stats.own_products });
  }
  const rawId = String(n.id).replace(/^node-/, '');
  flatNodes.push({
    id: rawId,
    name: n.name,
    parentId,
    level: n.level,
    url: n.url || '',
    own: n.stats.own_products,
    products: n.stats.total_products,
    yes: n.stats.total_yes,
    no: n.stats.total_no,
    counter: n.stats.site_counter,
    diff: n.stats.diff
  });
  n.children.forEach(c => walk(c, rawId));
})(appTree, '');

const globalStats = {
  levels: maxLevel,
  categories_count: categoriesCount,
  has_products: HAS_PRODUCTS,
  total_products: appTree.stats.total_products,
  total_yes: appTree.stats.total_yes,
  total_no: appTree.stats.total_no,
  site_counter: appTree.stats.site_counter,
  diff: appTree.stats.diff,
  scraped_at: scrapedAt,
  source: path.basename(catalogFile),
  // Звірка й крихти беруться з каталогу як є — рахує їх скрапер, який єдиний
  // бачить і лічильник сайту, і сторінку кожного товару.
  mismatch_categories: (catalog.reconciliation && catalog.reconciliation.mismatchNodes) || [],
  crumb_summary: catalog.crumbSummary || null,
  crumb_other: (catalog.products || [])
    .filter(p => p.crumbVerdict === 'other')
    .map(p => ({ id: p.productId, name: p.productName, url: p.finalUrl, assigned: p.categoryName, crumbs: (p.crumbNames || []).join(' › ') })),
  // 'unknown' окремо від 'other' (25.09.2026): це не розбіжність, а відсутність
  // другої думки — у крихтах товару немає жодної категорії, лише «Товари та
  // послуги». Поля crumbs тут немає свідомо: показувати порожній ланцюг ніяк.
  crumb_unknown: (catalog.products || [])
    .filter(p => p.crumbVerdict === 'unknown')
    .map(p => ({ id: p.productId, name: p.productName, url: p.finalUrl, assigned: p.categoryName })),
  // Дублюється в summary.json (а не лише в самій сторінці нижче) так само, як
  // усе інше в globalStats, — щоб build-maps.js міг зібрати "Товари поза
  // категоріями" для ВСЬОГО сайту з самих summary.json, не перечитуючи заново
  // повне дерево кожної категорії 1 рівня.
  orphan_categories: orphanCategories
};

const CATALOG_DATA = { global_stats: globalStats, tree: appTree };
// flatNodes іде лише в summary.json, не в CATALOG_DATA: сторінці мапи цей
// список не потрібен (вона має саме дерево), а дублювання роздуло б кожен
// HTML. build-maps.js бере його звідти для XLSX і панелей-дерев.
const SUMMARY_DATA = { ...globalStats, nodes: flatNodes };

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
  /* sticky, не static — на <id>_map.html не помітно різниці (там сторінка сама
     не скролиться, лише .main-content всередині), але на map.html build-maps.js
     навмисно вмикає звичайний скрол усього документа (html, body { overflow: visible }),
     тож без sticky цей хедер їхав би разом з довгою таблицею категорій. */
  position: sticky; top: 0;
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

mark.search-highlight { background: rgba(250, 204, 21, 0.4); color: inherit; border-radius: 2px; }
[data-theme="dark"] mark.search-highlight { background: rgba(56, 189, 248, 0.28); color: #7dd3fc; }

.cat-found-badge {
  /* display: inline, НЕ inline-flex: текст бейджа (назва категорії в результатах
     пошуку) буває довгим і переноситься, а всередині може стояти <mark>. В
     inline-flex текст до <mark>, сам <mark> і текст після стають окремими
     flex-елементами й переносяться кожен сам по собі — підсвічене слово
     відривається на свій рядок. Відступ між іконкою й текстом — звичайний
     пробіл у розмітці ("📁 " + текст), а не gap. */
  display: inline; padding: 2px 8px; font-size: 0.74rem; font-weight: 500;
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
.search-header-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.search-header-row #search-heading { font-size: 0.92rem; }
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
/* top, а не middle — для всіх .simple-table: middle центрував короткі комірки
   (№, бейджі) по висоті сусідньої назви, що переноситься на кілька рядків, і
   рядок виглядав збитим. */
.simple-table td { padding: 6px 10px; border-bottom: 1px solid var(--border-color); vertical-align: top; }
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

/* Результати пошуку (initSiteSearch на map.html, buildResultsSection на мапі
   розділу): ширини у %, щоб пропорції трималися за будь-якої ширини вікна.
   Категорії — найбільше місця (довгі назви з бейджами інакше розтягувались на
   кілька рядків), № / Код / Наявність — вузькі, назва товару бере решту (~40%).
   Лише для .search-table: у звичайній таблиці товарів вузла (renderTableHtml)
   колонки «Категорія» немає. */
table.search-table { table-layout: fixed; }
table.search-table .col-n { width: 4%; }
table.search-table .col-code { width: 8%; }
table.search-table .col-cat { width: 32%; }
table.search-table .col-avail { width: 16%; }
/* Заголовок «Наявність» у результатах пошуку сортує (sortByAvailability).
   cursor: pointer перебиває [data-tip] { cursor: help } — це кнопка. */
.simple-table th.th-sort { cursor: pointer; user-select: none; }
.simple-table th.th-sort:hover { color: var(--text-main); }
.sort-arrow { margin-left: 5px; opacity: 0.55; }
th.th-sort.active .sort-arrow { opacity: 1; color: var(--text-link); }
/* Пошук не дослівно тим, що набрано (інша розкладка, схожі слова). */
.search-note { margin: 0 0 10px; padding: 7px 12px; font-size: 0.8rem; color: var(--text-muted); background: var(--bg-subtle); border-left: 3px solid var(--border-active); border-radius: 3px; }

.stock-badge { display: inline-block; padding: 1px 6px; font-size: 0.72rem; font-weight: 500; border-radius: 3px; white-space: nowrap; }
.stock-badge.yes { background: var(--status-yes-bg); color: var(--status-yes); border: 1px solid var(--status-yes-border); }
.stock-badge.no { background: var(--status-no-bg); color: var(--status-no); border: 1px solid var(--status-no-border); }
.stock-badge.neutral { background: var(--bg-tag); color: var(--text-subtle); border: 1px solid var(--border-color); }

.diff-zero { color: var(--status-yes); font-weight: 600; }
.diff-nonzero { color: var(--status-no); font-weight: 600; }

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

/* Панель-дерево ("Товари поза категоріями" тут і вона ж плюс розбіжності
   звірки на map.html): заголовок групи — категорія 1 рівня, під ним вузли з
   відступом за рівнем (margin-left ставиться інлайном при генерації).
   Приглушена ланка (.dim) — вузол без власних товарів, доданий лише щоб
   дерево не мало розривів; око має чіплятись за рядки, заради яких панель
   і відкривали. Ті самі класи використовує map.html (build-maps.js), яка лінкує
   цей же файл, — вигляд обох панелей описаний один раз. */
.orphan-group-list { display: flex; flex-direction: column; gap: 14px; }
.orphan-group-head { display: inline-flex; align-items: center; gap: 4px; font-size: 0.82rem; font-weight: 600; color: var(--text-link); text-decoration: none; }
.orphan-group-head:hover { text-decoration: underline; }
.orphan-group .orphan-cat-list { margin-top: 6px; padding-left: 20px; }
.tree-row { align-items: baseline; }
.tree-row.dim { opacity: 0.55; font-weight: 400; }
.failed-note { font-size: 0.8rem; color: var(--text-muted); line-height: 1.5; margin: 0 0 14px; }

/* Гарні підказки замість нативного title (той не переноситься й губиться на довгому тексті).
   Позиціонується через JS (setupTooltips) в координатах в'юпорта — саме тому fixed, а не
   absolute, щоб не обрізáлось контейнерами з overflow (.table-wrap, .main-content). */
[data-tip] { cursor: help; }
#custom-tooltip {
  position: fixed; z-index: 200; max-width: 300px;
  background: var(--text-main); color: var(--bg-white);
  padding: 8px 10px; border-radius: 6px;
  /* pre-line, не normal: дає звичайне перенесення по ширині (max-width вище) і
     водночас зберігає явні "\n" у тексті data-tip як переноси рядків — для
     підказок з кількома окремими реченнями/варіантами (кожен на своєму рядку). */
  font-size: 0.74rem; font-weight: 400; line-height: 1.45; white-space: pre-line;
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
  /* 800px (24.09.2026, на прохання користувача): у 640 панелі зі списками
     виглядали затісними, а кожен рівень вкладеності з'їдає ще 18px відступу.
     Лише max-width — на вузькому екрані панель займає все, що лишають
     відступи .help-overlay. Ширина однакова для всіх панелей, логів теж. */
  max-width: 800px; width: 100%; box-shadow: 0 16px 40px rgba(0,0,0,0.3);
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

/* Заставка для завузького екрана (lib/notice.js). На широкому екрані цього
   блока просто немає; нижче порога він накриває сторінку цілком: position: fixed
   разом із непрозорим тлом і overflow: hidden на body — нічого приховувати
   поелементно не треба. Чистий CSS свідомо: спрацьовує зразу, не чекаючи на JS,
   і ніякого миготіння верстки перед нею. */
.narrow-guard { display: none; }
@media (max-width: 1299px) {
  .narrow-guard {
    display: flex; position: fixed; inset: 0; z-index: 9999;
    align-items: center; justify-content: center; padding: 24px;
    background: var(--bg-page);
  }
  .narrow-guard-box { max-width: 440px; text-align: center; color: var(--text-muted);
    font-size: 0.88rem; line-height: 1.75; }
  .narrow-guard-icon { font-size: 2.4rem; margin-bottom: 10px; }
  .narrow-guard-box h2 { font-size: 1.1rem; font-weight: 700; color: var(--text-main); margin-bottom: 10px; }
  /* Без власного відступу: інакше між абзацами було б рядок плюс margin, а всередині
     останнього абзацу (там ручний перенос) — саме рядок. Чотири рядки
     читаються як один блок, тож крок задає лише line-height. */
  .narrow-guard-box p { margin-bottom: 0; }
  .narrow-guard-box b { color: var(--text-main); font-weight: 600; font-family: var(--font-mono); }
  /* html body, а не просто body: і map.html, і сторінка змін перевизначають
     «html, body { overflow: visible }» у своїх стилях після цього файла,
     а за рівної специфічності виграє той, хто нижче. */
  html body { overflow: hidden; }
}

/* Меню-дропдаун у шапці («Звіт скрапера», «Звірки», «Довідка»). Списку
   з трьох-чотирьох рядків модальне вікно із затемненням завелике — він висить під
   своєю кнопкою. Великі панелі зі списками (дерево розбіжностей, логи, сама
   Довідка) лишаються модальними: туди веде рядок дропдауна. Опис лежить тут,
   а не в build-maps.js, бо таке меню є на всіх трьох сторінках.
   position: absolute від обгортки працює, бо в .app-header немає overflow: hidden;
   z-index вищий за саму шапку (10), щоб список лягав поверх таблиці. */
.hdr-menu { position: relative; display: inline-flex; flex-shrink: 0; }
.hdr-dropdown {
  display: none; position: absolute; top: calc(100% + 7px); left: 0; z-index: 120;
  min-width: 380px; max-width: min(460px, calc(100vw - 32px));
  background: var(--bg-white); border: 1px solid var(--border-color); border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.28); padding: 2px 14px 8px;
}
/* Для кнопки в правій групі — вирівнювання по правому краю, інакше
   список виліз би за межі екрана. */
.hdr-dropdown.right { left: auto; right: 0; }
.hdr-dropdown.open { display: block; }
/* Шторка під відкритим меню — як у модальних панелей, але легша (0.28 проти 0.4):
   меню не блокує роботу, воно закривається будь-яким кліком. z-index 9, а не
   поверх усього: .app-header (10) — власний контекст накладання, тож сам список
   із z-index 120 лежить усередині шапки і шторка його не накриє: шапка лишається
   світлою, меню від неї й росте.
   Окремий елемент (його створює initHeaderMenus), а не body::before — щоб його можна
   було знайти з JS і перевірити смоук-тестом: у псевдоелемента немає ні вузла, ні
   геометрії. opacity, а не display — затемнення наростає плавно, а не стрибком. */
.menu-scrim {
  position: fixed; inset: 0; z-index: 9; background: rgba(0,0,0,0.28);
  opacity: 0; pointer-events: none; transition: opacity 0.12s ease;
}
.menu-scrim.open { opacity: 1; pointer-events: auto; }
.hdr-dropdown h3 { font-size: 0.82rem; font-weight: 700; color: var(--text-main); padding: 10px 2px 2px; }

/* Рядок меню: значок, назва, число, дія. Число стоїть окремою колонкою,
   а не в назві, як було в кнопках до 25.09.2026. */
.check-row { display: grid; grid-template-columns: 26px 1fr auto auto; align-items: center; gap: 12px;
  padding: 9px 4px; border-bottom: 1px solid var(--border-color); font-size: 0.85rem; }
.check-row:last-child { border-bottom: 0; }
/* Зелена версія синього значка (ℹ️). Шрифтовий color на emoji не діє —
   це кольорова гліфа, а не літера, тож крутимо відтінок фільтром. Значок синій
   на всіх основних платформах, тому скрізь вийде зелений.
   Кут підібраний вимірюванням кольору: CSS hue-rotate — не чесний поворот відтінку, а матричне
   наближення, і «математичні» +100° дають не зелений, а малиновий. */
.ico-green { filter: hue-rotate(-80deg) saturate(1.15); }
/* justify-self: start — щоб підказка спрацьовувала саме на словах, а не по всій
   довжині рядка: у grid комірка 1fr розтягнула б span до самого числа. */
.check-row .nm { color: var(--text-main); justify-self: start; }
/* Без font-weight: число не має бути товще за сусідні слова в тому ж рядку. */
.check-row .val { font-variant-numeric: tabular-nums; }
.check-row .val.bad { color: var(--status-no); }
.check-row .val.ok { color: var(--status-yes); }
/* Без свого font-size — число й дія стоять поруч і мають бути одного кегля. */
.check-row .act { font: inherit; color: var(--text-link); background: none;
  border: 0; padding: 0; cursor: pointer; }
.check-row .act:hover { text-decoration: underline; }
/* "немає" — стан, а не дія: без кольору посилання, без підкреслення й руки. */
.check-row .act.none { color: var(--text-subtle); cursor: default; }
.check-row .act.none:hover { text-decoration: none; }
/* Значок біля "Звірки": скільки звірок щось знайшли. */
.badge-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px;
  height: 18px; padding: 0 5px; margin-left: 2px; border-radius: 999px; font-size: 0.7rem;
  font-weight: 600; background: var(--status-no); color: #fff; }

/* Подяки: картка-посилання з логотипом. Логотипи — окремі файли в logos/,
   а не вбудовані SVG: панель однакова на двох десятках сторінок. */
.credit-list { display: grid; gap: 8px; margin: 10px 0 14px; }
.credit { display: flex; align-items: center; gap: 12px; padding: 9px 12px; text-decoration: none;
  border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-subtle); }
.credit:hover { border-color: var(--text-link); }
.credit-logo { flex-shrink: 0; width: 30px; height: 30px; object-fit: contain; }
.credit-text { display: flex; flex-direction: column; gap: 2px; font-size: 0.8rem; color: var(--text-muted); line-height: 1.4; }
.credit-text b { font-size: 0.86rem; font-weight: 600; color: var(--text-link); }
/* Логотип GitHub чорний — у темній темі його просто не видно. */
[data-theme="dark"] .credit-logo.invert { filter: invert(1); }
`;



// Поточна ширина вікна в заставці завузького екрана. Сама заставка показується
// через @media і без цього скрипта; він лише підказує тому, хто має широкий
// монітор, але вузьке вікно, наскільки саме його розширити.
function initNarrowGuard() {
  var el = document.getElementById('narrow-guard-width');
  if (!el) return;
  var show = function () { el.textContent = String(window.innerWidth); };
  show();
  window.addEventListener('resize', show);
}

// ==================== МЕНЮ В ШАПЦІ (спільне для трьох сторінок) ====================
// Дропдауни шапки: відкритий завжди один, закриваються кліком поза межами
// й Esc. Свідомо не через setupModalOverlay: той робить модальне вікно із
// затемненням на весь екран, а тут потрібен список під своєю кнопкою.
function initHeaderMenus() {
  var drops = [];
  // Шторка — окремий елемент .menu-scrim (CSS вище), клас open на ньому вмикає
  // затемнення. syncScrim — одна функція на всі шляхи закриття (кнопка, клік
  // поза списком, Esc, рядок із [data-open]), щоб шторка ніде не лишилась
  // висіти після закритого меню.
  var scrim = document.createElement('div');
  scrim.className = 'menu-scrim';
  document.body.appendChild(scrim);
  var syncScrim = function () {
    var any = false;
    drops.forEach(function (d) { if (d.classList.contains('open')) any = true; });
    scrim.classList.toggle('open', any);
  };
  Array.prototype.forEach.call(document.querySelectorAll('.hdr-menu'), function (m) {
    var btn = m.querySelector('.hdr-menu-btn'), drop = m.querySelector('.hdr-dropdown');
    if (!btn || !drop) return;
    drops.push(drop);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      // Підказка самої кнопки висить рівно там, куди розгортається список, і накриває
      // його заголовок: курсор після кліку лишається на кнопці, тож mouseleave не
      // сталось. Гасимо її вручну — вона з'явиться знову при наступному наведенні.
      var tip = document.getElementById('custom-tooltip');
      if (tip) tip.classList.remove('visible');
      var wasOpen = drop.classList.contains('open');
      drops.forEach(function (d) { d.classList.remove('open'); });
      if (!wasOpen) drop.classList.add('open');
      syncScrim();
    });
    // Клік усередині списку не має його закривати — крім кліку по [data-open],
    // який закриває його сам і відкриває потрібну панель (обробник нижче).
    drop.addEventListener('click', function (e) { e.stopPropagation(); });
  });
  document.addEventListener('click', function () {
    drops.forEach(function (d) { d.classList.remove('open'); });
    syncScrim();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { drops.forEach(function (d) { d.classList.remove('open'); }); syncScrim(); }
  });
  // Рядок меню відкриває свою панель і закриває саме меню: два відкритих
  // вікна одночасно виглядали б як помилка, а Esc закривав би обидва одразу.
  Array.prototype.forEach.call(document.querySelectorAll('[data-open]'), function (b) {
    b.addEventListener('click', function () {
      var hub = b.closest('.help-overlay, .hdr-dropdown');
      if (hub) hub.classList.remove('open');
      syncScrim();
      var o = document.getElementById(b.getAttribute('data-open'));
      if (o) o.classList.add('open');
    });
  });
}

// ==================== ПЕРЕМИКАЧ ТЕМИ (спільний для <id>_map.html і map.html) ====================
// Top-level, а не всередині initCatalogMap: потрібна й на map.html та сторінці
// змін, які не мають CATALOG_DATA і initCatalogMap не викликають. Самодостатня:
// шукає #btn-theme-toggle сама, застосовує збережену/системну тему одразу при
// виклику й навішує обробник кліку.
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

// ==================== МОДАЛЬНА ПАНЕЛЬ (спільна для <id>_map.html і map.html) ====================
// Відкриття/закриття кнопкою, кліком поза панеллю, Esc — для всіх модальних
// панелей: Довідка, «Товари поза категоріями», логи й панелі звірок на map.html.
// Кнопка-відкривач необов'язкова (null): панелі, які відкриває рядок меню
// (initHeaderMenus), реєструються лише заради закриття. Top-level з тієї ж
// причини, що й initThemeToggle.
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

// ==================== ПІДКАЗКИ (спільні для <id>_map.html і map.html) ====================
// Гарні підказки замість нативного title (той не переноситься й губиться на
// довгому тексті). Один спільний елемент на сторінку, position: fixed за
// координатами наведеного елемента, а не CSS ::after: absolute всередині
// .table-wrap/.main-content (overflow-y: auto) обрізало б підказку. Слухачі
// делеговані на document — працюють і для розмітки, доданої пізніше через
// innerHTML. Top-level, бо map.html має власні data-tip, але не викликає
// initCatalogMap: поки функція жила там, на map.html працював лише
// cursor: help, а самої підказки не було.
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

// ==================== ПОШУК (спільний алгоритм для <id>_map.html і map.html) ====================
// Один алгоритм збігу й підсвітки для обох пошуків: функції нижче не знають ні
// про категорії, ні про вузли — лише масиви записів і списки полів. Мапа розділу
// шукає по name/code/nodeName (allProductsList), map.html — по
// name/code/categoryName (search-index.json). Різниться лише те, що робить клік
// по категорії, і це свідомо лишається окремим на кожній сторінці. Top-level,
// бо map.html не викликає initCatalogMap.
//
// Що вміє (HISTORY.md, п. 29):
//   - слова запиту — у будь-якому порядку, кожне має знайтись хоч в одному полі;
//   - "*" — будь-які символи, зокрема пробіли (шків*19), "?" — рівно один;
//   - нормалізація: регістр, кирилиця-двійник латиниці (М8, СО2, 120х120), ×;
//   - коди й розміри без розділювачів: 05116 → 05-116, hgr 25 → HGR25H;
//   - коли точних збігів немає — той самий запит в іншій розкладці клавіатури,
//     далі схожі слова (1 помилка, для слів від 8 літер — 2);
//   - порядок — від кращого збігу (точний код, ціле слово, початок слова…).

// Текст → { t: нормалізований, тієї ж довжини, що вихідний (тому позиції
// підсвітки збігаються); c: лише літери й цифри; pos: позиція кожного символу
// c у вихідному тексті }. Кирилиця, схожа на латиницю, зводиться до латиниці
// СКРІЗЬ, і в запиті, і в тексті: на сайті «М8» набрано то кириличною М
// (190 назв), то латинською (421), «СО2» — кирилицею, розміри — через х/x/×.
// Кеш за самим рядком: назви категорій повторюються тисячами.
function searchPrep(text) {
  var cache = searchPrep.cache || (searchPrep.cache = new Map());
  var s = String(text == null ? '' : text);
  var hit = cache.get(s);
  if (hit) return hit;
  var FOLD = { 'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c',
    'т': 't', 'х': 'x', 'у': 'y', 'і': 'i', '×': 'x', '’': "'", 'ʼ': "'", '`': "'" };
  var t = '', c = '', pos = [];
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i), lo = ch.toLowerCase();
    if (lo.length !== 1) lo = ch;
    if (FOLD[lo]) lo = FOLD[lo];
    t += lo;
    if (/[0-9a-zа-яіїєґ]/.test(lo)) { c += lo; pos.push(i); }
  }
  hit = { t: t, c: c, pos: pos, s: s };
  cache.set(s, hit);
  return hit;
}

// Слова тексту для пошуку схожих: [нормалізоване, як написано на сайті].
// Рахується раз на текст і кешується поруч із searchPrep.
function searchWords(text) {
  var P = searchPrep(text);
  if (P.words) return P.words;
  var words = [], re = /[0-9a-zа-яіїєґ']+/g, m;
  while ((m = re.exec(P.t))) {
    if (m[0].length >= 3) words.push([m[0], P.s.substr(m.index, m[0].length).toLowerCase()]);
  }
  P.words = words;
  return words;
}

// Рядок запиту → { raw, terms }. Уже скомпільований запит повертається як є,
// тож усі функції нижче приймають і рядок, і результат compileSearch.
function compileSearch(query) {
  if (query && query.terms) return query;
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var raw = String(query || '').trim();
  var terms = [];
  raw.split(/\s+/).forEach(function (w) {
    if (!w) return;
    var p = searchPrep(w);
    if (!/[*?]/.test(p.t)) { terms.push({ n: p.t, c: p.c, raw: w.toLowerCase() }); return; }
    // Кожен шматок — окрема група, щоб підсвітити лише літерали, а не все між ними.
    var parts = p.t.split(/([*?])/).filter(Boolean);
    var lits = parts.filter(function (x) { return x !== '*' && x !== '?'; });
    if (!lits.length) return; // запит з одних масок нічого не звужує
    var src = '', srcC = '';
    parts.forEach(function (x) {
      if (x === '*') { src += '([\\s\\S]*?)'; srcC += '([\\s\\S]*?)'; }
      else if (x === '?') { src += '([\\s\\S])'; srcC += '([\\s\\S])'; }
      else { src += '(' + esc(x) + ')'; srcC += '(' + esc(searchPrep(x).c) + ')'; }
    });
    terms.push({ wild: true, parts: parts, re: new RegExp(src, 'g'), reC: new RegExp(srcC, 'g') });
  });
  return { raw: raw, terms: terms };
}

// Оцінка збігу одного слова запиту з одним полем; 0 — не знайдено.
// kind: 'code' — код товару, 'name' — назва, інше — назва категорії.
function searchTermScore(term, P, kind) {
  var word = searchTermScore.word || (searchTermScore.word = /[0-9a-zа-яіїєґ']/);
  var w = kind === 'name' ? 1 : kind === 'code' ? 1 : 0.3;
  if (term.wild) {
    term.re.lastIndex = 0; term.reC.lastIndex = 0;
    if (term.re.test(P.t) || term.reC.test(P.c)) return (kind === 'code' ? 50 : 10) * w;
    return 0;
  }
  var i = P.t.indexOf(term.n);
  if (i !== -1) {
    if (kind === 'code') return P.t === term.n ? 100 : i === 0 ? 60 : 40;
    var best = 10;
    for (; i !== -1 && best < 30; i = P.t.indexOf(term.n, i + 1)) {
      var start = i === 0 || !word.test(P.t.charAt(i - 1));
      var end = i + term.n.length >= P.t.length || !word.test(P.t.charAt(i + term.n.length));
      best = Math.max(best, start && end ? 30 : start ? 20 : 10);
    }
    return best * w;
  }
  if (term.c && P.c.indexOf(term.c) !== -1) return kind === 'code' ? (P.c === term.c ? 100 : 50) : 8 * w;
  if (term.fz) {
    for (var k = 0; k < term.fz.length; k++) if (P.t.indexOf(term.fz[k]) !== -1) return 2 * w;
  }
  return 0;
}

// Товари, де КОЖНЕ слово запиту знайшлось хоч в одному з полів, від кращого
// збігу до гіршого; за рівних балів — у вихідному порядку.
function filterProducts(products, query, fields) {
  var q = compileSearch(query);
  if (!q.terms.length) return [];
  var kinds = fields.map(function (f) { return f === 'code' || f === 'name' ? f : 'cat'; });
  var preps = searchPreps(products, fields);
  var scored = [];
  for (var idx = 0; idx < products.length; idx++) {
    var row = preps[idx], total = 0, i;
    for (i = 0; i < q.terms.length; i++) {
      var best = 0;
      for (var f = 0; f < fields.length; f++) {
        var s = searchTermScore(q.terms[i], row[f], kinds[f]);
        if (s > best) best = s;
      }
      if (!best) break;
      total += best;
    }
    if (i === q.terms.length) scored.push({ p: products[idx], s: total, i: idx });
  }
  scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
  return scored.map(function (x) { return x.p; });
}

// Підготовлені поля кожного товару — раз на масив товарів і набір полів, а не
// на кожен символ запиту. Масив має бути той самий об'єкт між пошуками, щоб
// кеш спрацьовував (мапа розділу тому тримає відфільтрований індекс сайту).
function searchPreps(products, fields) {
  var wm = searchPreps.cache || (searchPreps.cache = new WeakMap());
  var byFields = wm.get(products);
  if (!byFields) { byFields = {}; wm.set(products, byFields); }
  var key = fields.join('|');
  if (!byFields[key]) {
    byFields[key] = products.map(function (p) { return fields.map(function (f) { return searchPrep(p[f]); }); });
  }
  return byFields[key];
}

// Словник для пошуку схожих: нормалізоване слово → як написане на сайті.
// Кешується так само, як searchPreps.
function searchVocab(products, fields) {
  var wm = searchVocab.cache || (searchVocab.cache = new WeakMap());
  var byFields = wm.get(products);
  if (!byFields) { byFields = {}; wm.set(products, byFields); }
  var key = fields.join('|');
  if (!byFields[key]) {
    var vocab = new Map();
    products.forEach(function (p) {
      fields.forEach(function (f) {
        searchWords(p[f]).forEach(function (w) { if (!vocab.has(w[0])) vocab.set(w[0], w[1]); });
      });
    });
    byFields[key] = vocab;
  }
  return byFields[key];
}

// Той самий запит, набраний в іншій розкладці: ytrjlth → енкодер, рпк25 → hgr25.
// null, якщо міняти нічого або запит змішаний. Розділові знаки ([ ] ; ' , .)
// перекладаються в літери лише в запиті без цифр — інакше 0.75 став би 0ю75.
function searchLayoutSwap(raw) {
  var EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
  var UA = "йцукенгшщзхїфівапролджєячсмитьбю'";
  var s = String(raw || '').toLowerCase();
  var hasLat = /[a-z]/.test(s), hasCyr = /[а-яіїєґ]/.test(s), hasDigit = /\d/.test(s);
  var out = '', i, ch, k;
  if (hasLat && !hasCyr) {
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i); k = EN.indexOf(ch);
      out += k !== -1 && (/[a-z]/.test(ch) || !hasDigit) ? UA.charAt(k) : ch;
    }
  } else if (hasCyr && !hasLat) {
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i); k = UA.indexOf(ch);
      out += k !== -1 && /[a-z]/.test(EN.charAt(k)) ? EN.charAt(k) : ch;
    }
  } else return null;
  return out === s ? null : out;
}

// Схожі слова для опечаток: слово запиту лише з літер (без цифр, масок і
// розділових знаків), від 5 літер,
// порівнюється з кожним словом каталогу (і з його початком — «спирал» має
// знайти «спіральна»). Допуск — 1 помилка, від 8 літер — 2. Коди й числа
// свідомо не розмиваються: помилка в 12-365 дала б чужий товар.
// vocabs — масив словників (searchVocab); відстань — Дамерау-Левенштейн
// (перестановка сусідніх літер — одна помилка), з виходом, щойно рядок
// перевищив допуск. Три рядки матриці виділяються один раз на виклик.
function searchFuzzyWords(term, vocabs) {
  if (term.wild || /[^a-zа-яіїєґ']/.test(term.n) || term.n.length < 5) return null;
  var a = term.n, m = a.length, k = m >= 8 ? 2 : 1, W = m + k + 1, i, j;
  var ac = new Int32Array(m);
  for (i = 0; i < m; i++) ac[i] = a.charCodeAt(i);
  var r0 = new Int32Array(W), r1 = new Int32Array(W), r2 = new Int32Array(W);
  var seen = new Set(), found = [];
  vocabs.forEach(function (vocab) {
    vocab.forEach(function (shown, b) {
      if (b === a || b.length < m - k || seen.has(b)) return;
      seen.add(b);
      var n = Math.min(b.length, m + k), pp = r2, p = r0, c = r1, t;
      for (j = 0; j <= n; j++) p[j] = j;
      for (i = 1; i <= m; i++) {
        var ai = ac[i - 1], rowMin = i;
        c[0] = i;
        for (j = 1; j <= n; j++) {
          var bj = b.charCodeAt(j - 1);
          var v = p[j - 1] + (ai === bj ? 0 : 1);
          if (p[j] + 1 < v) v = p[j] + 1;
          if (c[j - 1] + 1 < v) v = c[j - 1] + 1;
          if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && ac[i - 2] === bj && pp[j - 2] + 1 < v) v = pp[j - 2] + 1;
          c[j] = v;
          if (v < rowMin) rowMin = v;
        }
        if (rowMin > k) return;
        t = pp; pp = p; p = c; c = t;
      }
      // Мінімум по довжинах префікса: «спирал» проти «спіральна» — це «спірал».
      var d = k + 1;
      for (j = Math.max(0, m - k); j <= n; j++) if (p[j] < d) d = p[j];
      if (d <= k) found.push({ w: b, d: d });
    });
  });
  found.sort(function (x, y) { return x.d - y.d; });
  return found.slice(0, 40).map(function (x) { return x.w; });
}

// Пошук по кількох наборах одразу (мапа розділу: свій розділ + решта сайту) —
// щоб запасні ходи вирішувались за сумою, а не для кожного набору окремо.
// sets: [{ products, fields }]. Повертає { q, lists, note }: q — запит, яким
// справді шукали (його ж передавати в highlightMatch), lists — збіги по наборах,
// note — null, { kind: 'layout', text } або { kind: 'fuzzy', pairs: [[слово, схоже]] }.
function searchProducts(sets, query) {
  function run(q) { return sets.map(function (s) { return filterProducts(s.products, q, s.fields); }); }
  function total(lists) { return lists.reduce(function (n, l) { return n + l.length; }, 0); }
  var q = compileSearch(query);
  var lists = run(q);
  if (!q.terms.length || total(lists)) return { q: q, lists: lists, note: null };

  var alt = searchLayoutSwap(q.raw);
  if (alt) {
    var qa = compileSearch(alt), la = run(qa);
    if (total(la)) return { q: qa, lists: la, note: { kind: 'layout', text: alt } };
  }

  var vocabs = sets.map(function (s) { return searchVocab(s.products, s.fields); });
  function shown(w) {
    for (var i = 0; i < vocabs.length; i++) if (vocabs[i].has(w)) return vocabs[i].get(w);
    return w;
  }
  function fuzzy(qq) {
    var pairs = [];
    var terms = qq.terms.map(function (t) {
      // Слово, яке саме по собі є в каталозі (частиною якогось слова), не
      // розмивається: запит не знайшовся через ІНШЕ слово, а «двигун → двигуна,
      // двигуни» в підказці — шум. Слова з опечатками розділових знаків не мають
      // (searchFuzzyWords бере лише їх), тож перевірки по словнику досить.
      if (t.wild) return t;
      var exists = vocabs.some(function (v) {
        for (var it = v.keys(), w = it.next(); !w.done; w = it.next()) if (w.value.indexOf(t.n) !== -1) return true;
        return false;
      });
      if (exists) return t;
      var fz = searchFuzzyWords(t, vocabs);
      if (!fz || !fz.length) return t;
      fz.slice(0, 3).forEach(function (w) { pairs.push([t.raw, shown(w)]); });
      return Object.assign({}, t, { fz: fz });
    });
    if (!pairs.length) return null;
    var qf = { raw: qq.raw, terms: terms }, lf = run(qf);
    return total(lf) ? { q: qf, lists: lf, note: { kind: 'fuzzy', pairs: pairs } } : null;
  }
  // Опечатки — спершу в набраному, потім у переведеному з іншої розкладки.
  return fuzzy(q) || (alt && fuzzy(compileSearch(alt))) || { q: q, lists: lists, note: null };
}

// Рядок над результатами, коли шукали не дослівно тим, що набрано; '' — якщо дослівно.
function searchNoteHtml(note) {
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  if (!note) return '';
  var text = note.kind === 'layout'
    ? 'Схоже, запит набрано в іншій розкладці клавіатури. Показано результати для «' + esc(note.text) + '».'
    : 'Точних збігів немає. Показано схожі за написанням: ' +
      note.pairs.map(function (p) { return esc(p[0]) + ' → ' + esc(p[1]); }).join(', ') + '.';
  return '<div class="search-note">' + text + '</div>';
}

// Приймає СИРИЙ текст і екранує сам — ПІСЛЯ розбиття на збіг/не-збіг. Якщо
// екранувати до виклику, запит "amp" знаходився б усередині "&amp;" і розрізав
// би сутність: "&<mark>amp</mark>;" замість символу "&". Шукає по
// нормалізованому тексту (та сама довжина, що в оригіналу) і по «стиснутому»
// через pos, тож підсвічується саме те місце, що знайшлось.
function highlightMatch(text, query) {
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var str = String(text == null ? '' : text);
  var q = compileSearch(query);
  if (!q.terms.length || !str) return esc(str);
  var P = searchPrep(str), marks = [];
  function addAll(needle) {
    if (!needle) return false;
    var any = false;
    for (var i = P.t.indexOf(needle); i !== -1; i = P.t.indexOf(needle, i + needle.length)) {
      marks.push([i, i + needle.length]); any = true;
    }
    return any;
  }
  // Групи регулярки йдуть одна за одною без проміжків, тож початок кожної —
  // сума довжин попередніх; підсвічуються лише групи-літерали, не маски.
  function addGroups(re, parts, hay, map) {
    re.lastIndex = 0;
    var m, any = false;
    while ((m = re.exec(hay))) {
      var at = m.index;
      for (var g = 1; g < m.length; g++) {
        var len = m[g].length, lit = parts[g - 1] !== '*' && parts[g - 1] !== '?';
        if (lit && len) marks.push(map ? [map[at], map[at + len - 1] + 1] : [at, at + len]);
        at += len;
      }
      any = true;
      if (m[0].length === 0) re.lastIndex++;
    }
    return any;
  }
  q.terms.forEach(function (t) {
    if (t.wild) {
      if (!addGroups(t.re, t.parts, P.t, null)) addGroups(t.reC, t.parts, P.c, P.pos);
      return;
    }
    if (addAll(t.n)) return;
    if (t.c) {
      for (var i = P.c.indexOf(t.c); i !== -1; i = P.c.indexOf(t.c, i + t.c.length)) {
        marks.push([P.pos[i], P.pos[i + t.c.length - 1] + 1]);
      }
    }
    (t.fz || []).forEach(addAll);
  });
  if (!marks.length) return esc(str);
  marks.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
  var out = '', last = 0;
  marks.forEach(function (r) {
    var s = Math.max(r[0], last);
    if (r[1] <= s) return;
    out += esc(str.slice(last, s)) + '<mark class="search-highlight">' + esc(str.slice(s, r[1])) + '</mark>';
    last = r[1];
  });
  return out + esc(str.slice(last));
}

// Сортування результатів за стовпцем «Наявність»: клік перемикає по колу
// 0 → 1 → 2 → 0. 0 — як знайдено (від кращого збігу), 1 — спершу «Готово до
// відправки», 2 — спершу відсутні. Усередині групи порядок збігу зберігається.
function sortByAvailability(list, mode) {
  if (!mode) return list;
  var yes = [], no = [];
  list.forEach(function (p) { (/готово/i.test(p.availability || '') ? yes : no).push(p); });
  return mode === 1 ? yes.concat(no) : no.concat(yes);
}
function availSortTh(mode) {
  var tips = [
    'Порядок: від кращого збігу із запитом. Клік: спершу «Готово до відправки».',
    'Порядок: спершу «Готово до відправки». Клік: спершу «Немає в наявності».',
    'Порядок: спершу «Немає в наявності». Клік: від кращого збігу із запитом.'
  ];
  var arrows = ['⇅', '▼', '▲'];
  return '<th class="col-avail th-sort' + (mode ? ' active' : '') + '" data-sort-avail data-tip="' + tips[mode] + '">' +
    'Наявність<span class="sort-arrow">' + arrows[mode] + '</span></th>';
}

// ==================== САЙТОВИЙ ПОШУК (лише map.html) ====================
// Екранування значення, що йде в АТРИБУТ (href). Окрема функція, а не
// escapeHtml: у initSiteSearch власний escapeHtml зроблений через
// textContent → innerHTML, а він НЕ екранує подвійні лапки, тобто для href
// не годиться. Усі атрибути в шаблонах проєкту в подвійних лапках, тож
// мінімально достатньо & < > ", але екрануємо і ' — щоб заміна лапок у
// розмітці колись не відкрила діру мовчки.
function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Самодостатня: сама шукає #search-input/#btn-clear-search/#index-content/
// #search-results. search-index.json (пише build-maps.js) підвантажується
// fetch-ем лише при першому реальному пошуку, а не вбудовується в сторінку, щоб
// map.html лишалась легкою. Шукаються лише товари: назва, код, категорія як текст.
function initSiteSearch() {
  var input = document.getElementById('search-input');
  var btnClear = document.getElementById('btn-clear-search');
  var indexContent = document.getElementById('index-content');
  var resultsEl = document.getElementById('search-results');
  if (!input || !indexContent || !resultsEl) return;

  var indexData = null;
  var indexFailed = false; // окремо від indexData=[] — той означає "завантажили, порожньо",
  // це — "не вдалося завантажити взагалі" (search-index.json відсутній,
  // напр. запуск render-map.js напряму без build-maps.js, або сторінка
  // відкрита подвійним кліком з диска — fetch() локальних файлів блокує
  // браузер). Без цього прапорця збій мовчки виглядав як "чесно перевірили,
  // нічого немає" — оманливо, коли пошук насправді жодного разу не відбувся.
  var indexPromise = null;
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch('search-index.json')
        .then(function (r) { return r.json(); })
        .then(function (data) { indexData = data; return data; })
        .catch(function () { indexData = []; indexFailed = true; return indexData; });
    }
    return indexPromise;
  }

  var sortMode = 0; // стовпець «Наявність», див. sortByAvailability
  var lastQuery = '';
  // Слухач один на контейнер: таблиця перемальовується на кожен символ.
  resultsEl.addEventListener('click', function (e) {
    if (!e.target.closest('[data-sort-avail]')) return;
    sortMode = (sortMode + 1) % 3;
    var tip = document.getElementById('custom-tooltip');
    if (tip) tip.classList.remove('visible');
    renderResults(lastQuery);
  });

  function renderResults(query) {
    function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
    lastQuery = query;
    var found = searchProducts([{ products: indexData || [], fields: ['name', 'code', 'categoryName'] }], query);
    var hq = found.q;
    var matches = sortByAvailability(found.lists[0], sortMode);
    if (indexFailed) {
      resultsEl.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">⚠️</div>' +
        '<div class="fw-meta-label" style="font-size:1.05rem;margin-bottom:8px;color:var(--text-main);">Не вдалося завантажити пошуковий індекс (search-index.json)</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted);max-width:480px;margin:0 auto;">Якщо сторінка відкрита подвійним кліком з диска — браузер блокує fetch() локальних файлів; відкрий через сервер (напр. Live Server). Якщо через сервер — переконайся, що search-index.json взагалі існує поруч (пишеться build-maps.js).</div>' +
        '</div>';
      return;
    }
    if (matches.length === 0) {
      resultsEl.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">🔍</div>' +
        '<div class="fw-meta-label" style="font-size:1.05rem;margin-bottom:8px;color:var(--text-main);">За запитом «' + escapeHtml(query) + '» нічого не знайдено</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted);max-width:480px;margin:0 auto;">Перевірте написання або спробуйте інше слово (назву, код товару чи категорію).</div>' +
        '</div>';
      return;
    }
    var rowsHtml = matches.map(function (p, idx) {
      var isYes = /готово/i.test(p.availability || '');
      return (
        '<tr><td class="col-n">' + (idx + 1) + '</td>' +
        '<td class="col-code"><span class="item-code">' + highlightMatch(p.code || '', hq) + '</span></td>' +
        '<td class="col-name"><a href="' + escapeAttr(p.url) + '" target="_blank" rel="noopener">' + highlightMatch(p.name, hq) + '</a></td>' +
        '<td class="col-cat"><a href="' + escapeAttr(p.topId) + '_map.html" class="cat-found-badge" data-tip="Відкрити мапу цієї категорії">📁 ' + highlightMatch(p.categoryName, hq) + '</a></td>' +
        '<td class="col-avail"><span class="stock-badge ' + (isYes ? 'yes' : 'no') + '">' + escapeHtml(p.availability || ' ') + '</span></td>' +
        '</tr>'
      );
    }).join('');
    resultsEl.innerHTML = searchNoteHtml(found.note) +
      '<div class="section-block"><div class="section-head"><div style="display:flex;align-items:center;gap:8px;"><span>Знайдені товари</span>' +
      '<span style="font-size:0.72rem;color:var(--text-muted);">(' + matches.length + ' позицій)</span></div></div>' +
      '<div class="table-wrap"><table class="simple-table search-table"><thead><tr>' +
      '<th class="col-n">№</th><th class="col-code">Код</th><th>Назва товару</th><th class="col-cat">Категорія</th>' + availSortTh(sortMode) +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function showIndex() { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; indexContent.style.display = ''; }
  function showSearch(query) {
    indexContent.style.display = 'none';
    resultsEl.style.display = '';
    loadIndex().then(function () { renderResults(query); });
  }

  input.addEventListener('input', function (e) {
    var q = e.target.value.trim();
    if (btnClear) btnClear.style.display = q ? 'inline-flex' : 'none';
    if (q) showSearch(q); else showIndex();
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; if (btnClear) btnClear.style.display = 'none'; showIndex(); }
  });
  if (btnClear) btnClear.addEventListener('click', function () {
    input.value = ''; btnClear.style.display = 'none'; input.focus(); showIndex();
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
    searchQuery: '',
    searchSort: 0 // стовпець «Наявність» у результатах пошуку, див. sortByAvailability
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
    // stats.diff вже враховує обидві причини, чому звірка неможлива: сайт не
    // показав лічильник (hasCounter=false) АБО в каталозі немає товарів
    // (HAS_PRODUCTS=false, тоді total_yes завжди 0 — порівнювати з ним не можна,
    // інакше майже кожна категорія хибно підсвітилась би червоним).
    if (stats.diff === null || stats.diff === undefined) {
      return '<span class="stock-badge neutral" data-tip="Сайт не показав лічильник «В наявності N», або товари не завантажені — звірка неможлива.">н/д</span>';
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
    bc.innerHTML = '<a href="map.html" class="crumb-link">Мапа</a>' +
      path.map(function (p, idx) {
        return '<span class="sep">/</span><span class="' + (idx === path.length - 1 ? 'crumb-current' : 'crumb-link') + '" data-id="' + p.id + '">' + escapeHtml(p.name) + '</span>';
      }).join('');

    Array.prototype.forEach.call(bc.querySelectorAll('span.crumb-link'), function (el) {
      el.addEventListener('click', function () {
        var targetId = el.dataset.id;
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

    document.getElementById('node-header-row').style.display = '';
    document.getElementById('search-header-row').style.display = 'none';
  }

  function renderTableHtml(products) {
    var rows = products.map(function (p, i) {
      var isYes = isAvailableProduct(p);
      return (
        '<tr>' +
        '<td class="col-n">' + (p.index || i + 1) + '</td>' +
        '<td class="col-code"><span class="item-code">' + escapeHtml(p.code || ' ') + '</span></td>' +
        '<td class="col-name">' + (p.url ? '<a href="' + escapeAttr(p.url) + '" target="_blank" rel="noopener">' + escapeHtml(p.name) + '</a>' : escapeHtml(p.name)) + '</td>' +
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
        return '<div class="empty-note">Товари не завантажено — запустіть скрапер для цієї категорії ще раз.</div>';
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
      '<td style="width:78px;text-align:center;"><span class="count-no' + badgeExtra + '">' + no + '</span></td>' +
      '<td style="width:72px;text-align:center;"> </td>' +
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
            '<td style="width:78px;text-align:center;"><span class="count-no">' + ch.stats.total_no + '</span></td>' +
            '<td style="width:72px;text-align:center;">' + (ch.url ? '<a href="' + escapeAttr(ch.url) + '" class="link-site" target="_blank" rel="noopener">↗</a>' : ' ') + '</td>' +
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

  // ── ПОШУК (filterProducts/highlightMatch — спільні з map.html, див. їх власний
  // блок вище в цьому файлі) ──
  // Пошук у категорії свідомо охоплює й увесь сайт, не лише цю категорію
  // (за проханням користувача, 2026-09-14 — раніше кожна <id>_map.html знала
  // лише про власні товари). Локальні збіги (allProductsList, вже вбудовані
  // в CATALOG_DATA) рендеряться одразу, синхронно — як і раніше, без затримки
  // на мережу. search-index.json (той самий файл, що на map.html) підвантажується
  // ЛЕНИВО й ОДИН РАЗ при першому пошуку (siteIndexData кешується в цьому ж
  // замиканні), топ-категорія query фільтрується з нього, щоб не дублювати
  // локальні результати (вони й так уже свої). Коли індекс завантажиться,
  // сторінка перемальовується (renderContent()) — але лише якщо запит з того
  // часу не змінився (інакше застаріла відповідь просто відкидається).
  var siteIndexData = null;
  var siteIndexOthers = null; // siteIndexData без товарів цього розділу
  var siteIndexFailed = false; // окремо від siteIndexData=[] — див. те саме
  // розрізнення в initSiteSearch/loadIndex вище: без цього прапорця збій
  // fetch() виглядав би як "решту сайту перевірили, там нуль", хоча
  // насправді перевірка не відбулась узагалі.
  var siteIndexPromise = null;
  function loadSiteIndex() {
    if (!siteIndexPromise) {
      siteIndexPromise = fetch('search-index.json')
        .then(function (r) { return r.json(); })
        .then(function (data) { siteIndexData = data; return data; })
        .catch(function () { siteIndexData = []; siteIndexFailed = true; return siteIndexData; });
    }
    return siteIndexPromise;
  }

  // isLocal=true — товар цієї категорії (allProductsList): клік по категорії
  // робить jump у межах цієї самої сторінки, як і раніше. isLocal=false —
  // товар з іншої категорії 1 рівня (search-index.json): клік відкриває
  // <topId>_map.html, як на map.html — переходу до вузла на
  // чужій сторінці мапа не підтримує.
  function buildResultsSection(title, matches, query, isLocal) {
    var section = document.createElement('div');
    section.className = 'section-block';
    var head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span>' + title + '</span>' +
      '<span style="font-size:0.72rem;color:var(--text-muted);">(' + matches.length + ' позицій)</span></div>';
    section.appendChild(head);

    var tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    var rowsHtml = matches.map(function (p, idx) {
      var isYes = isAvailableProduct(p);
      var categoryCell = isLocal
        ? '<a href="#" class="cat-found-badge" data-node-id="' + escapeAttr(p.nodeId) + '" data-tip="Перейти до розділу в каталозі">📁 ' + highlightMatch(p.nodeName, query) + '</a>'
        : '<a href="' + escapeAttr(p.topId) + '_map.html" class="cat-found-badge" data-tip="Відкрити мапу цієї категорії">📁 ' + highlightMatch(p.categoryName, query) + '</a>';
      return (
        '<tr><td class="col-n">' + (idx + 1) + '</td>' +
        '<td class="col-code"><span class="item-code">' + highlightMatch(p.code || '', query) + '</span></td>' +
        '<td class="col-name"><a href="' + escapeAttr(p.url) + '" target="_blank" rel="noopener">' + highlightMatch(p.name, query) + '</a></td>' +
        '<td class="col-cat">' + categoryCell + '</td>' +
        '<td class="col-avail"><span class="stock-badge ' + (isYes ? 'yes' : 'no') + '">' + escapeHtml(p.availability || ' ') + '</span></td>' +
        '</tr>'
      );
    }).join('');
    tableWrap.innerHTML =
      '<table class="simple-table search-table"><thead><tr>' +
      '<th class="col-n">№</th><th class="col-code">Код</th><th>Назва товару</th><th class="col-cat">Категорія</th>' + availSortTh(state.searchSort) +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
    section.appendChild(tableWrap);

    // Один стан на обидва блоки (цей розділ / інші): клік по будь-якому
    // заголовку перемикає порядок в обох.
    tableWrap.querySelector('[data-sort-avail]').addEventListener('click', function () {
      state.searchSort = (state.searchSort + 1) % 3;
      var tip = document.getElementById('custom-tooltip');
      if (tip) tip.classList.remove('visible');
      renderContent();
    });

    if (isLocal) {
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
    }
    return section;
  }

  function renderSearchResultsView(body, query) {
    var currentTopId = CATALOG_DATA.tree.id.replace(/^node-/, '');
    var localSet = { products: allProductsList, fields: ['name', 'code', 'nodeName'] };
    // Поки індекс сайту не підвантажено, шукаємо лише тут і без запасних ходів
    // (розкладка, опечатки): вирішувати, що точних збігів немає, можна лише
    // за обома наборами разом, а другий ще в дорозі.
    // Відфільтрований індекс — один масив на сторінку, а не новий на кожен
    // символ: на ньому тримаються кеші searchPreps/searchVocab.
    if (siteIndexData && !siteIndexOthers) {
      siteIndexOthers = siteIndexData.filter(function (e) { return e.topId !== currentTopId; });
    }
    var found = siteIndexData
      ? searchProducts([localSet, { products: siteIndexOthers, fields: ['name', 'code', 'categoryName'] }], query)
      : { q: compileSearch(query), lists: [filterProducts(localSet.products, query, localSet.fields)], note: null };
    var hq = found.q;
    var localMatches = sortByAvailability(found.lists[0], state.searchSort);
    // null = ще не підвантажено (запит іде нижче) — відрізняється від "уже
    // перевірили, там нуль", щоб не показати "нічого не знайдено" завчасно.
    var remoteMatches = siteIndexData ? sortByAvailability(found.lists[1], state.searchSort) : null;

    var bc = document.getElementById('breadcrumbs');
    document.getElementById('node-header-row').style.display = 'none';
    document.getElementById('search-header-row').style.display = '';
    var heading = document.getElementById('search-heading');
    var badge = document.getElementById('search-found-badge');

    var totalKnown = localMatches.length + (remoteMatches ? remoteMatches.length : 0);
    bc.innerHTML = '<a href="map.html" class="crumb-link">Мапа</a> <span class="sep">/</span> <span class="crumb-current">Результати пошуку</span>';
    heading.textContent = 'Пошук за запитом «' + query + '»';
    badge.textContent = totalKnown + ' знайдено' + (
      siteIndexFailed ? ' (у цій категорії; решту сайту перевірити не вдалося)' :
      remoteMatches === null ? ' (ще шукаємо по сайту…)' : ''
    );

    if (localMatches.length === 0 && remoteMatches !== null && remoteMatches.length === 0) {
      body.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">🔍</div>' +
        '<div class="fw-meta-label" style="font-size:1.05rem;margin-bottom:8px;color:var(--text-main);">За запитом «' + escapeHtml(query) + '» нічого не знайдено</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted);max-width:480px;margin:0 auto;">Перевірте написання або спробуйте інше слово (назву, код товару чи категорію).</div>' +
        '</div>';
    } else if (localMatches.length === 0 && remoteMatches === null) {
      body.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:1.6rem;margin-bottom:10px;">🔍</div>' +
        '<div class="fw-meta-label" style="font-size:0.9rem;color:var(--text-muted);">У цій категорії нічого немає — перевіряємо решту сайту…</div>' +
        '</div>';
    } else {
      body.innerHTML = '';
      var resetHead = document.createElement('div');
      resetHead.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:8px;';
      resetHead.innerHTML = '<button class="btn-link" id="btn-reset-search-in-view" style="font-size:0.75rem;">✕ Скинути пошук</button>';
      body.appendChild(resetHead);
      resetHead.querySelector('#btn-reset-search-in-view').addEventListener('click', function () {
        var searchInput = document.getElementById('search-input');
        var btnClear = document.getElementById('btn-clear-search');
        if (searchInput) searchInput.value = '';
        if (btnClear) btnClear.style.display = 'none';
        state.searchQuery = '';
        renderContent();
      });

      if (found.note) body.insertAdjacentHTML('beforeend', searchNoteHtml(found.note));
      if (localMatches.length > 0) {
        body.appendChild(buildResultsSection('Знайдені товари (у цій категорії)', localMatches, hq, true));
      }
      if (remoteMatches && remoteMatches.length > 0) {
        body.appendChild(buildResultsSection('Знайдені в інших категоріях', remoteMatches, hq, false));
      }
    }

    if (remoteMatches === null) {
      loadSiteIndex().then(function () {
        if (state.searchQuery === query) renderContent();
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

    // Відкривача-кнопки в панелей більше немає — їх відкриває рядок меню «Довідка»
    // (initHeaderMenus), тож setupModalOverlay потрібен лише заради закриття.
    setupModalOverlay('help-overlay', null, 'btn-help-close');
    setupModalOverlay('about-overlay', null, 'btn-about-close');
    setupModalOverlay('credits-overlay', null, 'btn-credits-close');
    initHeaderMenus();
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

  // Посилання ззовні на конкретну категорію: <id>_map.html#cat=<categoryId>
  // (без префікса "node-"). Використовує сторінка змін (build-reports.js) —
  // шлях категорії там веде на мапу саме цього вузла, а не на корінь розділу.
  // Невідомий id (категорії вже нема в дереві) просто лишає корінь.
  function selectFromHash() {
    var m = /^#cat=([^&]+)$/.exec(location.hash);
    if (!m) return false;
    var targetId = 'node-' + decodeURIComponent(m[1]);
    if (!nodeMap.has(targetId)) return false;
    state.selectedNodeId = targetId;
    var curr = parentMap.get(targetId);
    while (curr) { state.sidebarCollapsed.delete(curr.id); curr = parentMap.get(curr.id); }
    return true;
  }
  selectFromHash();
  window.addEventListener('hashchange', function () {
    if (selectFromHash()) { renderSidebar(); renderContent(); }
  });

  initThemeToggle();
  renderSidebar();
  renderContent();
  setupEvents();
  setupTooltips();
  setupSidebarResize();
}

// ==================== СПІЛЬНІ ФАЙЛИ (map-common.css / map-common.js) ====================
// Стилі й клієнтський код однакові для будь-якої категорії, тож пишуться один
// раз спільними файлами поруч із мапами, а не вбудовуються в кожну
// <id>_map.html. Перезаписуються при кожному запуску render-map.js — завжди
// відповідають поточному коду. Плата: <id>_map.html не самодостатня, їй
// потрібні map-common.css/.js у тій самій теці.
const COMMON_CSS_FILE = path.join(OUTPUT_DIR, 'map-common.css');
const COMMON_JS_FILE = path.join(OUTPUT_DIR, 'map-common.js');
fs.writeFileSync(COMMON_CSS_FILE, css.trim() + '\n', 'utf-8');
fs.writeFileSync(COMMON_JS_FILE, [initThemeToggle, setupModalOverlay, setupTooltips, initHeaderMenus, initNarrowGuard, searchPrep, searchWords, compileSearch, searchTermScore, filterProducts, searchPreps, searchVocab, searchLayoutSwap, searchFuzzyWords, searchProducts, searchNoteHtml, highlightMatch, sortByAvailability, availSortTh, escapeAttr, initSiteSearch, initCatalogMap]
  .map(fn => fn.toString()).join('\n\n') + '\n', 'utf-8');
writeLogos(OUTPUT_DIR);
// Версію рахуємо ПІСЛЯ запису обох файлів: посилання має відповідати щойно
// записаному вмісту, а не тому, що лишився від попереднього запуску.
const COMMON_CSS_V = assetVer(COMMON_CSS_FILE);
const COMMON_JS_V = assetVer(COMMON_JS_FILE);

// ==================== ЗБІРКА HTML ====================
const maxLevelSafe = CATALOG_DATA.global_stats.levels;

const infoBanner = HAS_PRODUCTS ? '' : `
    <div class="info-banner warning" style="margin: 12px 20px 0;">
      <span>⚠️</span>
      <span>Товари не завантажені — мапа показує лише структуру категорій і лічильники сайту.
      Щоб їх зібрати, запустіть скрапер для цієї категорії ще раз: <code>node scrape-complete.js "${escapeHtmlOuter(catalog.url || '')}"</code></span>
    </div>`;

// Кнопка в шапці (поряд з датою оновлення) + модальна панель зі списком —
// замість банера прямо над змістом (той засмічував основну мапу постійно
// видимим блоком). Панель — не окрема сутність, а другий екземпляр того
// самого overlay/panel вигляду, що й Довідка (див. setupModalOverlay).
// Обидва рахуються один раз при генерації, тож коли orphanCategories порожній
// (немає жодної такої категорії), ні кнопки, ні панелі в розмітці нема.
// Число в заголовку панелі — сума ТОВАРІВ (c.own у кожній категорії), а не
// кількість самих орфан-категорій у списку: заголовок каже "Знайдені
// товари...", тож і число має рахувати товари, а не категорії, які їх містять.
const orphanTotalProducts = orphanCategories.reduce((sum, c) => sum + c.own, 0);

// Вигляд панелі — точно такий самий, як у зведеної "Товари поза
// категоріями" на map.html (build-maps.js, treeRows/treeRowHtml): заголовок
// групи = категорія 1 рівня із сумою товарів, під ним дерево вузлів з
// відступом 18px на рівень. До 24.09.2026 тут був плоский список без
// відступів, і дві однакові за змістом панелі виглядали по-різному.
//
// Добудовані ланки (предки, яких самих у списку немає) — не прикраса:
// сироти розкидані по дереву, і без них відступ натякав би на рівень,
// якого на екрані немає. Звертатись до build-maps.js тут ніяк: це окремий
// процес, який запускає саме цей скрипт, — спільний тут лише CSS.
const orphanRows = (() => {
  const parentOf = new Map();
  (function walk(n, parent) {
    parentOf.set(String(n.id), parent);
    n.children.forEach(c => walk(c, n));
  })(appTree, null);
  const flagged = new Map(orphanCategories.map(c => [String(c.id), c]));
  const keep = new Set();
  flagged.forEach((c, id) => {
    let cur = id;
    let guard = 0;
    while (cur && guard++ < 20) {
      keep.add(cur);
      const p = parentOf.get(cur);
      cur = p ? String(p.id) : null;
    }
  });
  const rows = [];
  (function walk(n) {
    if (keep.has(String(n.id))) rows.push({ node: n, item: flagged.get(String(n.id)) || null });
    n.children.forEach(walk);
  })(appTree);
  // Добудована ланка 1 рівня не показується: заголовок групи — це вона й є.
  return rows.filter(r => r.item || r.node.level > 1);
})();

const orphanRowsHtml = orphanRows.map(r => {
  // Категорія 1 рівня може бути сиротою сама для себе (товари лежать
  // прямо в ній). Повторювати тут її назву не можна — вона вже в
  // заголовку групи, і рядок виглядав би як помилка. Фраза та сама,
  // що й у рядках зведення нижче в цьому ж файлі.
  const name = r.item && r.node.level === 1
    ? 'Товари категорії, які не входять до підкатегорій'
    : escapeHtmlOuter(r.node.name);
  return '<a href="#" class="cat-found-badge tree-row orphan-cat-link' + (r.item ? '' : ' dim') +
    '" data-id="' + escapeHtmlOuter(r.node.id) +
    '" style="margin-left:' + ((r.node.level - 1) * 18) + 'px;">' +
    name + ' <span class="node-count">(' + r.node.stats.own_products + ')</span></a>';
}).join('');
const orphanMenuButtonHtml = orphanCategories.length === 0 ? '' : `
      <button id="btn-orphan-cats" class="btn-theme-toggle catalog-subtitle-btn" data-tip="Знайдені товари, які не входять до підкатегорій">${ICONS.orphans} Товари поза категоріями</button>`;

const orphanPanelHtml = orphanCategories.length === 0 ? '' : `
  <div class="help-overlay" id="orphan-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Знайдені товари, які не входять до підкатегорій (${orphanTotalProducts})</h3>
        <button class="btn-help-close" id="btn-orphan-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">У дужках — скільки товарів лежить прямо в цій категорії, повз її підкатегорії. Блідим ідуть проміжні категорії без таких товарів: вони тут лише щоб дерево не мало розривів.<br>Натисніть назву, щоб перейти до цього вузла мапи.</p>
        <div class="orphan-group-list">
          <div class="orphan-group">
            <a href="#" class="orphan-group-head orphan-cat-link" data-id="${escapeHtmlOuter(appTree.id)}">${ICONS.folder} ${escapeHtmlOuter(appTree.name)} <span class="node-count">(${orphanTotalProducts})</span></a>
            <div class="orphan-cat-list">${orphanRowsHtml}</div>
          </div>
        </div>
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
<title>Мапа: ${escapeHtmlOuter(CATALOG_DATA.tree.name)} (${rootLevelsLabel})</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="map-common.css${COMMON_CSS_V}">
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="catalog-title">${escapeHtmlOuter(CATALOG_DATA.tree.name)}</span>
      <button class="btn-theme-toggle catalog-subtitle-btn" data-tip="Дата та час скрапінгу">${ICONS.updated} ${escapeHtmlOuter(scrapedAt)}</button>${orphanMenuButtonHtml}
    </div>
    <div class="header-center">
      <div class="search-wrap">
        <span class="search-icon">${ICONS.search}</span>
        <input type="text" id="search-input" class="header-search-input" placeholder="Пошук товарів, кодів, категорій...">
        <button id="btn-clear-search" class="btn-clear-search" data-tip="Очистити пошук (Esc)" style="display:none;">✕</button>
      </div>
    </div>
    <div class="header-right">
      <a href="map.html" class="btn-theme-toggle" data-tip="Мапа всіх категорій сайту">${ICONS.map} Мапа сайту</a>
      <a href="reports/index.html" class="btn-theme-toggle" data-tip="Зміни каталогу за будь-який період: наявність, нові й видалені товари, категорії">${ICONS.history} Історія змін</a>
${helpMenuHtml('Пояснення до цифр і позначок на цій сторінці')}
      <button id="btn-theme-toggle" class="btn-theme-toggle" data-tip="Перемкнути тему">
        <span class="theme-icon">\u{1F319}</span> <span class="theme-text">Темна</span>
      </button>
      <a href="${escapeHtmlOuter(rootUrl)}" class="link-site" target="_blank" rel="noopener">cncprom.ua ↗</a>
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
          <div class="help-term-desc">Перше число: кількість товарів зі статусом «Готово до відправки», яке нарахував скрапер. Друге число: кількість товарів з лічильника «В наявності» сайту.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Зелений/червоний колір в стовпчику «В наявності»</div>
          <div class="help-term-desc">Зелений — точний збіг. Червоний — будь-яка розбіжність.</div>
        </div>${searchHelpHtml(' Спершу показує товари цього розділу, під ними — знайдені в інших розділах сайту.')}
      </div>
    </div>
  </div>
${narrowGuardHtml()}
  ${orphanPanelHtml}
${aboutPanelHtml()}${creditsPanelHtml()}

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
        <div class="breadcrumbs" id="breadcrumbs"><a href="map.html" class="crumb-link">Мапа</a></div>
        <div class="title-row table-wrap" id="node-header-row">
          <table class="simple-table aligned-table"><thead><tr>
            <th class="col-n"></th>
            <th>Назва категорії</th>
            <th style="width:80px;text-align:center;" data-tip="Глибина вкладеності категорії в дереві каталогу.">Рівень</th>
            <th style="width:90px;text-align:center;" data-tip="Усього товарів у цій категорії разом з усіма її підкатегоріями.">Товарів</th>
            <th style="width:100px;text-align:center;" data-tip="Перше число — кількість товарів зі статусом «Готово до відправки», яке нарахував скрапер. Друге число — кількість товарів з лічильника «В наявності» сайту.">В наявності</th>
            <th style="width:78px;white-space:normal;text-align:center;vertical-align:middle;" data-tip="Скільки товарів зі статусом «Немає в наявності» за даними скрапера. Незалежного лічильника на сайті для цього нема.">Немає в наявності</th>
            <th style="width:72px;white-space:normal;text-align:center;vertical-align:middle;">Перейти на сайт</th>
          </tr></thead><tbody><tr>
            <td class="col-n"></td>
            <td id="cat-heading" class="fw-cat-link">${escapeHtmlOuter(CATALOG_DATA.tree.name)}</td>
            <td style="text-align:center;"><span id="cat-level-badge" class="level-tag">Рівень 1</span></td>
            <td style="text-align:center;" class="fw-count-cell" id="cat-total-products">${CATALOG_DATA.tree.stats.total_products}</td>
            <td style="text-align:center;" id="cat-verdict-badge"></td>
            <td style="text-align:center;" id="cat-total-no"><span class="count-no">${CATALOG_DATA.tree.stats.total_no}</span></td>
            <td style="text-align:center;vertical-align:middle;"><a id="cat-site-link" href="#" class="link-site" target="_blank" rel="noopener">↗</a></td>
          </tr></tbody></table>
        </div>
        <!-- Окремий заголовок для режиму пошуку: колонки й підказки таблиці вище
             (Рівень/Товарів/В наявності/…) мають сенс лише для вибраного вузла.
             Коли пошук писав прямо в #cat-heading/#cat-level-badge, бейдж
             кількості знахідок успадковував підказку колонки «Рівень». Видимість
             #node-header-row і #search-header-row перемикають updateHeader() і
             renderSearchResultsView() — так само, як #index-content/#search-results
             на map.html. -->
        <div class="search-header-row" id="search-header-row" style="display:none;">
          <span id="search-heading" class="fw-cat-link"></span>
          <span id="search-found-badge" class="level-tag"></span>
        </div>
      </div>
      ${infoBanner}
      <div class="content-body" id="content-body"></div>
    </main>
  </div>

<script src="map-common.js${COMMON_JS_V}"></script>
<script>
const CATALOG_DATA = ${JSON.stringify(CATALOG_DATA)};
initCatalogMap(CATALOG_DATA);
initNarrowGuard();
</script>
</body>
</html>`;

fs.writeFileSync(OUTPUT_HTML, html, 'utf-8');

// Невеликий супутній файл з тими самими global_stats, що вбудовані в саму
// мапу — щоб build-maps.js міг зібрати зведену таблицю для map.html (індексу
// всіх категорій), не розпаковуючи CATALOG_DATA з готового HTML.
fs.writeFileSync(path.join(OUTPUT_DIR, `${categoryId}_map.summary.json`), JSON.stringify({ id: categoryId, ...SUMMARY_DATA }, null, 2), 'utf-8');

console.log(`Мапу збережено: ${OUTPUT_HTML}`);
console.log(`Категорій: ${categoriesCount}, рівнів: ${maxLevelSafe}, товарів: ${appTree.stats.total_products}${HAS_PRODUCTS ? ` (в наявності: ${appTree.stats.total_yes})` : ' (лише структура, без товарів)'}`);

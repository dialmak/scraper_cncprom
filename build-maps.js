
// build-maps.js — сайт із того, що зібрав скрапер: мапа кожної категорії
// (render-map.js), індекс map.html зі звірками й логами, search-index.json для
// пошуку по сайту, XLSX з мапою категорій і переадресації зі старих адрес.
// Список категорій — output/site/categories.json; хід збірки — map.jsonl.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { logEvent, readEvents } = require('./lib/log');
const { runLogHtml, buildLogHtml } = require('./lib/runlog');
const { plural } = require('./lib/plural');
const { signed } = require('./lib/num');
const { escapeHtmlOuter } = require('./lib/html');
const { ICONS } = require('./lib/icons');
const { helpButtonHtml, searchHelpButtonHtml, writeHelpPage, writeLogos } = require('./lib/help');
const { assetVer } = require('./lib/assets');
const { fmtDate, fmtDateTime } = require('./lib/time');
const { hasDescription, hasCategoryDescription, descriptionJson, categoryJson, descIndex, descSearchIndex } = require('./lib/desc');
const { collectMedia, collectLinks, knownIds, hostOf, isPromHost } = require('./lib/media');
const { parseMany } = require('./lib/desc-parse');
const { narrowGuardHtml } = require('./lib/notice');
const { readCategories, filePath: categoriesFile } = require('./lib/categories');

// ==================== НАЛАШТУВАННЯ ====================
// ROOT_DIR — де лежать самі скрипти (render-map.js викликається звідси);
// DIR — де лежать усі згенеровані файли, включно з тими, що пише цей скрипт
// (map.html, map.jsonl). Розділені навмисно: render-map.js запускається з
// ROOT_DIR, а всі шляхи до даних будуються від DIR.
const ROOT_DIR = __dirname;
const DIR = path.join(ROOT_DIR, 'output', 'site');
const DESC_DIR = path.join(DIR, 'desc');
// Лог збірки — map.jsonl, лог скрапінгу — scrape.jsonl (з 26.09.2026, до того —
// текстові map.log і scrape.log): панелі «Лог збірки» й «Лог скрапінгу» будують
// з них таблиці.
const LOG_FILE = path.join(DIR, "map.jsonl");
const SCRAPE_LOG_FILE = path.join(DIR, "scrape.jsonl");
// Ім'я файла експорту несе дату ДАНИХ — найсвіжішого скрапінгу серед
// категорій, тобто ту саму, що стоїть у шапці map.html. До 26.09.2026 це була
// дата ЗБІРКИ за годинником машини, а в GitHub Actions це UTC: після опівночі
// за Києвом і до опівночі за UTC файл на сайті був підписаний вчорашнім числом,
// а ручна перебудова взагалі давала ім'я з датою, до якої дані не мають стосунку.
// Формат зібраний вручну (lib/time.js): тут потрібна гарантовано DD.MM.YYYY,
// бо це ім'я файла, а не підпис на сторінці.
const XLSX_PREFIX = "map_cncprom";
let XLSX_DATE = fmtDate(new Date());   // запасний варіант: жодної скрапленої категорії
let XLSX_FILE = `${XLSX_PREFIX}_${XLSX_DATE}.xlsx`;

// ==================== ЛОГ (map.jsonl — доповнюється, як scrape.jsonl) ====================
// Одна збірка = build-start, за потреби error, build-finish; усі з одним build.
// BUILD_KIND ставить workflow (nightly / rebuild / manual); локально його немає.
// У map.jsonl пишеться ЛИШЕ нічна збірка (рішення користувача 28.09.2026): перебудови
// після кожної правки дописували десятки записів на день і засмічували «Лог збірки».
// Решта збірок пише ті самі рядки лише в консоль (видно в журналі GitHub Actions).
const BUILD_ID = new Date().toISOString();
const BUILD_KIND = process.env.BUILD_KIND || 'local';
const LOG_TO_FILE = BUILD_KIND === 'nightly';
const BUILD_T0 = Date.now();
const logEvt = (ev, fields) => logEvent(LOG_TO_FILE ? LOG_FILE : null, ev, Object.assign({ build: BUILD_ID, kind: BUILD_KIND }, fields));
let buildErrors = 0;
const logError = msg => { buildErrors++; logEvt('error', { msg }); };

// ==================== СПИСОК КАТЕГОРІЙ 1 РІВНЯ ====================
// output/site/categories.json — джерело істини щодо ПОВНОГО списку категорій
// 1 рівня (а не сканування output/ на вже наявні <id>_catalog.json: той спосіб
// бачив лише категорії, які вже хоч раз скрапились, і "губив" усі решта).
function readCategoryList() {
  try {
    return readCategories(DIR).map(r => ({ id: r.categoryId, name: r.categoryName, url: r.categoryUrl }));
  } catch (e) {
    return null;
  }
}

// ==================== ВКЛАДЕНІСТЬ ВУЗЛІВ У ПАНЕЛЯХ ====================
// Панель розбіжностей показує вузли різних рівнів одним списком, і без
// вкладеності числа читаються як помилка арифметики: у «Шпинделях» корінь −2,
// а під ним −2 і −1, бо третій рядок лежить усередині другого.
//
// Вкладеність показує сам відступ. Щоб на нього можна було покладатись, дерево
// не має мати розривів: якщо в дочірньої категорії розбіжність є, а в її
// батька звірка зійшлась, батько все одно потрапляє в список — блідим рядком
// зі своїми числами. Інакше відступ дитини виглядав би як загублений рівень.
// (Раніше замість цього перед назвою друкувався шлях; він майже завжди просто
// повторював рядок прямо над собою — у реальних даних розривів немає, бо
// недобір дитини автоматично дає недобір у підсумку батька.)
const nodeMaps = new Map();
function nodeById(entry) {
  if (!nodeMaps.has(entry.id)) {
    nodeMaps.set(entry.id, new Map((entry.nodes || []).map(n => [String(n.id), n])));
  }
  return nodeMaps.get(entry.id);
}

// Рядки панелі-дерева для однієї категорії 1 рівня: позначені вузли плюс їхні
// предки, у порядку обходу дерева. entry.nodes уже лежить у порядку обходу
// (його так пише render-map.js), тож достатньо відфільтрувати.
//
// Використовують дві панелі — розбіжності звірки й товари поза категоріями.
// getId дістає id вузла з елемента списку: у розбіжностей це categoryId, а в
// орфанів — id клієнтського вузла з префіксом "node-".
function treeRows(entry, items, getId) {
  const list = items || [];
  const byId = nodeById(entry);
  if (byId.size === 0) return list.map(it => ({ item: it, node: null })); // старий summary без nodes
  const flagged = new Map(list.map(it => [String(getId(it)), it]));
  const keep = new Set();
  flagged.forEach((it, id) => {
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 20) { keep.add(String(cur.id)); cur = byId.get(String(cur.parentId)); }
  });
  return (entry.nodes || [])
    .filter(n => keep.has(String(n.id)))
    .map(n => ({ node: n, item: flagged.get(String(n.id)) || null }));
}

const rawNodeId = v => String(v).replace(/^node-/, '');

// Спільна розмітка рядка дерева: відступ за рівнем, приглушення для
// добудованої ланки, посилання на цей самий вузол мапи.
function treeRowHtml(topId, id, level, inner, dim) {
  return '<a href="' + escapeHtmlOuter(topId) + '_map.html#cat=' + escapeHtmlOuter(id) +
    '" class="cat-found-badge tree-row' + (dim ? ' dim' : '') +
    '" style="margin-left:' + ((level - 1) * 18) + 'px;">' + inner + '</a>';
}

// Підпис із числами для звірки. Для вузла без розбіжності беремо його власні
// числа з дерева — вони показують, що там усе зійшлось, і саме тому рядок
// блідий.
function mismatchFigures(row) {
  const collected = row.item ? row.item.collected : row.node.yes;
  const counter = row.item ? row.item.siteCounter : row.node.counter;
  const diff = row.item ? row.item.diff : row.node.diff;
  if (counter === null || counter === undefined || diff === null || diff === undefined) {
    return 'зібрано ' + collected + ', лічильник сайту не зчитано';
  }
  return 'зібрано ' + collected + ', сайт ' + counter + ', різниця ' + signed(diff);
}

// ==================== ЕКСПОРТ МАПИ КАТЕГОРІЙ У XLSX ====================
// Один аркуш на весь сайт: саме МАПА категорій і більше нічого — без товарів,
// без ID, без лічильників і без звірки (так просив користувач 24.09.2026). До того
// тут було 12 колонок із всією арифметикою; це дублювало сторінки і не давало
// головного — огляду самої структури.
//
// Форма — дерево колонками: рівень 1 у стовпці A, рівень 2 в B і так далі; у рядку
// заповнена рівно ОДНА клітинка.
//
// Порядок: розділи 1 рівня — за абеткою, тим самим localeCompare('uk'), що й список
// на map.html (sorted), щоб таблиця й сторінка йшли однаково. ВСЕРЕДИНІ розділу
// порядок не чіпаємо — nodes у <id>_map.summary.json лежать у порядку обходу
// дерева (так їх пише render-map.js), і будь-яке пересортування відірвало б гілки
// від їхніх батьків. Автофільтра немає з тієї ж причини: його сортування
// розірвало б дерево.
//
// Гілки згортаються: кожен рядок має outlineLevel = level - 1, тож Excel малює
// зліва групування з [+]/[−] на кожному рівні. ОБОВ'ЯЗКОВО summaryBelow: false —
// типово Excel вважає підсумковим рядок ПІД групою, і тоді кнопка згортання
// опиняється не на батькові, а на наступному розділі.
//
// Аркуш захищений БЕЗ пароля — саме щоб заборонити сортування: будь-яке
// переставляння рядків відриває гілки від їхніх батьків і робить файл
// безглуздим. Без пароля — бо це захист від випадкового кліку, а не від
// користувача: «Рецензування → Зняти захист аркуша» знімає його одним кліком.
//
// formatRows/formatColumns МАЮТЬ лишатись дозволеними (у XML це formatRows="0"):
// згортання гілки — це приховування рядків, і на захищеному аркуші без цього
// дозволу кнопки [+]/[−] перестають працювати. Створити чи зняти групування
// все одно не вийде — але воно вже побудоване тут.
//
// Увага на семантику OOXML: атрибути sheetProtection — це ЗАБОРОНИ, а не
// дозволи: formatRows="1" означає "форматувати рядки не можна". exceljs приймає
// пряму логіку ({formatRows: true} = можна) і сам інвертує її при записі.
// Все, що не передане явно, лишається забороненим — зокрема sort і autoFilter.
//
// Запис загорнутий у try/catch і НЕ валить прогін: xlsx — зручність, а не
// результат, і нічний конвеєр не має падати через неї.
async function buildCatalogXlsx(entries) {
  const rows = [];
  entries.filter(e => e.status === 'ok')
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk'))
    .forEach(e => {
      (e.nodes || []).forEach(n => rows.push({ name: n.name, level: n.level || 1 }));
    });
  if (rows.length === 0) {
    console.warn('XLSX: нема жодного вузла — файл не створено.');
    return null;
  }
  const maxLevel = rows.reduce((m, r) => Math.max(m, r.level), 1);

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'build-maps.js';
  wb.created = new Date();
  const ws = wb.addWorksheet('Категорії');
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  // Колонки звужуються з глибиною: назва глибшого рівня починається правіше,
  // тож місця до краю екрана є менше; остання колонка широка, бо за нею вже
  // нічого немає і текст може вільно виступати.
  ws.columns = Array.from({ length: maxLevel }, (_, i) => ({
    header: 'Рівень ' + (i + 1),
    width: i === maxLevel - 1 ? 60 : Math.max(24, 44 - i * 6)
  }));
  rows.forEach(r => {
    const cells = new Array(maxLevel).fill(null);
    cells[r.level - 1] = r.name;
    const row = ws.addRow(cells);
    row.outlineLevel = r.level - 1;
    // Розділ 1 рівня — жирним: у списку на сотні рядків це єдине, що
    // дозволяє вхопити межу між розділами, прокручуючи аркуш.
    if (r.level === 1) row.font = { bold: true };
  });
  ws.properties.outlineLevelRow = maxLevel - 1;
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  // Закріплений рядок 1 видно завжди, тож нотатка на A1 — єдине місце, де
  // попередження не займає жодного рядка дерева і не з'їжджає з екрана.
  ws.getCell('A1').note = 'Аркуш захищений від сортування та редагування: порядок рядків і є деревом категорій.\n' +
    'Зняти: Рецензування → Зняти захист аркуша (пароля немає).\n' +
    'Докладно на аркуші «Про файл».';
  await ws.protect(undefined, {
    selectLockedCells: true, selectUnlockedCells: true,
    formatRows: true, formatColumns: true
  });

  // Окремий аркуш замість рядків нагорі основного: там мають бути лише
  // назви категорій, і будь-який текст перед шапкою зсунув би дерево
  // й потрапив у групування. Цей аркуш НЕ захищений — його нічого
  // ламати сортуванням.
  const info = wb.addWorksheet('Про файл');
  info.columns = [{ width: 108 }];
  const infoLines = [
    ['Мапа категорій cncprom.ua', true],
    ['', false],
    ['Аркуш «Категорії» захищений від сортування та редагування.', true],
    ['Категорії розміщені деревом: рівень 1 у стовпці A, рівень 2 в B і так далі.', false],
    ['Порядок рядків і є структурою: сортування відриває гілки від їхніх батьків,', false],
    ['і файл стає беззмістовним.', false],
    ['', false],
    ['Як зняти захист: Рецензування → Зняти захист аркуша. Пароля немає.', true],
    ['Це застереження від випадкового кліку, а не замок.', false],
    ['', false],
    ['Із захистом працює згортання гілок: кнопки [+] і [−] зліва від номерів рядків,', false],
    ['а цифри над ними показують усе дерево до потрібного рівня.', false],
    ['', false],
    ['Дані станом на ' + XLSX_DATE + ' (за київським часом). Файл згенеровано автоматично.', false],
    ['Актуальна версія й інтерактивна мапа: https://map.cncprom.pp.ua/', false]
  ];
  infoLines.forEach(([text, bold]) => {
    const row = info.addRow([text]);
    if (bold) row.font = { bold: true };
  });

  return { wb, count: rows.length };
}

// ==================== ІНШІ ДОПОМІЖНІ ФУНКЦІЇ ====================
function writeStub(id, name, reason) {
  const htmlPath = path.join(DIR, `${id}_map.html`);
  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<title>Категорія ${id}${name ? " (" + escapeHtmlOuter(name) + ")" : ""}: немає актуальних даних</title>
<style>
  body { font-family: system-ui, sans-serif; background:#f5f5f5; color:#333; display:flex;
         align-items:center; justify-content:center; height:100vh; margin:0; text-align:center; }
  .box { background:#fff; border:1px solid #ddd; border-radius:8px; padding:32px 48px; max-width:560px; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { color:#777; margin:4px 0; line-height:1.4; }
</style>
</head>
<body>
  <div class="box">
    <h1>⚠️ Немає актуальних даних</h1>
    <p>Категорія ${id}${name ? " (" + escapeHtmlOuter(name) + ")" : ""}: мапу не згенеровано.</p>
    <p>${escapeHtmlOuter(reason)}</p>
  </div>
</body>
</html>
`;
  fs.writeFileSync(htmlPath, html, "utf-8");
}

function buildRealMap(id) {
  // render-map.js приймає лише ID — сам шукає <id>_catalog.json у тому самому
  // output/site/ (шлях рахується від його __dirname, а скрипти лежать поруч).
  const res = spawnSync("node", ["render-map.js", id], { cwd: ROOT_DIR, stdio: "inherit" });
  return res.status === 0;
}

function readSummary(id) {
  const p = path.join(DIR, `${id}_map.summary.json`);
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (e) { return null; }
}

// Записи для сайтового пошуку будуються прямо з <id>_catalog.json: обхід
// дерева + товари цього вузла. Раніше render-map.js писав ще й проміжний
// <id>_search.json (1.9 МБ на всі категорії), який build-maps лише
// конкатенував — тобто ті самі дані лежали на диску двічі.
function readSearchEntries(id) {
  const p = path.join(DIR, `${id}_catalog.json`);
  let catalog;
  try { catalog = JSON.parse(fs.readFileSync(p, "utf-8")); } catch (e) { return []; }

  const byCategory = new Map();
  (catalog.products || []).forEach(r => {
    const key = String(r.categoryId);
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(r);
  });

  const out = [];
  const topId = String(catalog.categoryId || id);
  const topName = (catalog.tree && catalog.tree.categoryName) || catalog.categoryName || '';
  (function walk(node) {
    if (!node || !node.categoryId) return;
    (byCategory.get(String(node.categoryId)) || []).forEach(r => {
      out.push({
        code: r.sku || '',
        name: r.productName || r.productId || '',
        url: r.finalUrl || '',
        availability: r.availabilityStatus || '',
        categoryId: node.categoryId,
        categoryName: node.categoryName,
        topId,
        topName,
        // id файлу desc/<id>.json (кнопка «Опис»); без опису поля немає
        desc: hasDescription(r) ? String(r.productId) : undefined,
      });
    });
    (node.children || []).forEach(walk);
  })(catalog.tree);
  return out;
}

// Медіа для меню «Доступність медіа» на map.html (14.10.2026, → HISTORY п. 53, 55, 56).
// Результат перевірки check-media.js (media-check.json: адреса → стан) зводиться з
// каталогами: де стоїть кожен файл. Списки великі (одних сторонніх картинок ~2,4 тис.
// у ~2,6 тис. товарів), тож у map.html іде лише число, а самі списки — окремим
// media-report.json, який сторінка завантажує, коли відкривають пункт меню:
//   { checkedAt, owners: { p<id>|c<id>: [назва, код, адреса, topId, categoryId] },
//     broken: { image|file|video|link: [[адреса, код, з якої дати, [[власник, [місця]]]]] },
//     hosts | fileHosts | siteHosts: [[хостинг, [[адреса, [[власник, [місця]]]]]]],
//     videos: [[платформа, [[адреса, назва, [[власник, [місця]]]]]]],
//     heavy: [[адреса, розмір у байтах, [[власник, [місця]]]]] }
// Місця — для кожного власника окремо: у списку «Де на сторінці» стоїть після
// «Сторінки» (15.10.2026), і файл буває в описі одного товару, а в іншого мініатюрою.
// Недоступний — той, що не відкривається другу перевірку поспіль (n ≥ 2, див.
// check-media.js). Биті посилання: помилка в самій адресі (подвоєне https://, номер чи
// слово замість адреси) — одразу, без запиту; сторінка, якої немає, — як файли, з n ≥ 2.
// Важкі зображення (20.10.2026): ті, що відкриваються, але важать понад HEAVY_IMAGE_BYTES
// (розмір з Content-Range у check-media.js); спершу найважчі. Сервери Prom не беруться:
// фото галереї покупцю показується зменшеною копією.
// Немає media-check.json — повертає null, пункти меню кажуть «немає даних».
const HEAVY_IMAGE_BYTES = 1e6;
function writeMediaReport(ids) {
  let check;
  try { check = JSON.parse(fs.readFileSync(path.join(DIR, 'media-check.json'), 'utf-8')); } catch (e) { return null; }
  const results = check.results || {};
  const owners = {};
  const catalogs = [];
  ids.forEach(id => {
    try { catalogs.push([id, JSON.parse(fs.readFileSync(path.join(DIR, `${id}_catalog.json`), 'utf-8'))]); } catch (e) { /* немає каталогу */ }
  });
  const known = knownIds(catalogs.map(x => x[1]));
  const where = new Map();  // адреса → Map власник → Set місць (gallery, desc, xsell…, див. lib/media.js)
  const links = new Map();  // ключ посилання → { url, problem, check, ext, at: Map власник → Set місць }
  const put = (map, key, o, place) => {
    if (!map.has(key)) map.set(key, new Map());
    const byOwner = map.get(key);
    if (!byOwner.has(o)) byOwner.set(o, new Set());
    byOwner.get(o).add(place);
  };
  catalogs.forEach(([id, c]) => {
    const topId = String(c.categoryId || id);
    (function walk(n) {
      owners['c' + n.categoryId] = [n.categoryName || '', '', n.url || '', topId, String(n.categoryId)];
      (n.children || []).forEach(walk);
    })(c.tree);
    (c.products || []).forEach(p => {
      owners['p' + p.productId] = [p.productName || '', p.sku || '', p.finalUrl || '', topId, String(p.categoryId)];
    });
    collectMedia(c).forEach(m => put(where, m.url, m.productId ? 'p' + m.productId : 'c' + m.categoryId, m.place));
    collectLinks(c, known).forEach(l => {
      // Помилкова адреса — сама собою; сторінка — за адресою запиту (той самий товар під
      // різними слагами й доменами — одне посилання).
      const key = l.problem ? 'bad:' + l.url : l.check;
      if (!links.has(key)) links.set(key, { url: l.url, problem: l.problem, check: l.check, ext: l.ext, at: new Map() });
      const at = links.get(key).at, o = l.productId ? 'p' + l.productId : 'c' + l.categoryId;
      if (!at.has(o)) at.set(o, new Set());
      at.get(o).add(l.place);
    });
  });
  const used = new Set();
  const list = byOwner => [...(byOwner || [])].map(([o, at]) => { used.add(o); return [o, [...at]]; });
  const own = url => list(where.get(url));
  const since = r => r.since ? fmtDate(new Date(r.since)) : '';
  const broken = { image: [], file: [], video: [], link: [] };
  const hostsMap = { image: new Map(), file: new Map() };
  const videoMap = new Map();
  const heavy = [];
  for (const [url, r] of Object.entries(results)) {
    if (!where.has(url)) continue;  // адреса з категорії, якої вже немає в каталогах, або посилання
    if (r.s !== 'ok' && r.n >= 2 && broken[r.k]) broken[r.k].push([url, String(r.c), since(r), own(url)]);
    const host = hostOf(url);
    if (r.k === 'image' && r.s === 'ok' && r.size > HEAVY_IMAGE_BYTES && !isPromHost(host)) heavy.push([url, r.size, own(url)]);
    const hm = hostsMap[r.k];
    if (hm && !isPromHost(host)) {
      if (!hm.has(host)) hm.set(host, []);
      hm.get(host).push([url, own(url)]);
    }
    if (r.k === 'video') {
      const platform = /youtube\.com|youtu\.be/.test(host) ? 'YouTube' : host;
      if (!videoMap.has(platform)) videoMap.set(platform, []);
      videoMap.get(platform).push([url, r.t || '', own(url)]);
    }
  }
  const siteMap = new Map();
  links.forEach(l => {
    if (l.problem) { broken.link.push([l.url, l.problem, '', list(l.at)]); return; }
    const r = results[l.check];
    if (r && r.s !== 'ok' && r.n >= 2) broken.link.push([l.url, String(r.c), since(r), list(l.at)]);
    if (l.ext) {
      const h = l.ext.replace(/^www\./, '');
      if (!siteMap.has(h)) siteMap.set(h, []);
      siteMap.get(h).push([l.check, list(l.at)]);
    }
  });
  // Спершу файли, що стоять у найбільшій кількості товарів: їх виправлення дає найбільше.
  Object.values(broken).forEach(l => l.sort((a, b) => b[3].length - a[3].length));
  heavy.sort((a, b) => b[1] - a[1]);
  const byHost = (m, i) => [...m].map(([h, files]) => [h, files.sort((a, b) => b[i].length - a[i].length)])
    .sort((a, b) => b[1].length - a[1].length);
  const hosts = byHost(hostsMap.image, 1), fileHosts = byHost(hostsMap.file, 1), siteHosts = byHost(siteMap, 1), videos = byHost(videoMap, 2);
  const report = { checkedAt: check.checkedAt, owners: {}, broken, hosts, fileHosts, siteHosts, videos, heavy };
  used.forEach(o => { report.owners[o] = owners[o] || ['', '', '', '', '']; });
  fs.writeFileSync(path.join(DIR, 'media-report.json'), JSON.stringify(report), 'utf-8');
  const ownersOf = (lists, i) => new Set(lists.flatMap(x => x[i].map(o => o[0]))).size;
  const grouped = (g, i) => ({ files: g.reduce((n, h) => n + h[1].length, 0), owners: ownersOf(g.flatMap(h => h[1]), i) });
  return {
    checkedAt: check.checkedAt,
    image: { files: broken.image.length, owners: ownersOf(broken.image, 3) },
    file: { files: broken.file.length, owners: ownersOf(broken.file, 3) },
    video: { files: broken.video.length, owners: ownersOf(broken.video, 3) },
    link: { files: broken.link.length, owners: ownersOf(broken.link, 3) },
    heavy: { files: heavy.length, owners: ownersOf(heavy, 2) },
    hosts: grouped(hosts, 1),
    fileHosts: grouped(fileHosts, 1),
    siteHosts: grouped(siteHosts, 1),
    videos: grouped(videos, 2),
  };
}

// Опис кожного товару — окремим файлом desc/<productId>.json, опис категорії —
// desc/c<categoryId>.json: кнопка «Опис» завантажує файл лише при кліку. Разом описи
// десятки МБ, тож ні в сторінку, ні в search-index.json вони не йдуть (lib/desc.js).
// Каталог несе опис таким, як його віддав сайт (descriptionRaw); текст, HTML для
// вікна, комплект і супутні товари виводяться тут (lib/desc-parse.js: кілька потоків
// і кеш на диску). Пишуться після всіх мап: супутні товари посилаються на інші
// розділи, тож спершу потрібен покажчик усіх каталогів (descIndex).
// Повертає кількість записаних файлів.
async function writeDescriptions(ids) {
  const catalogs = ids.map(id => {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, `${id}_catalog.json`), 'utf-8')); } catch (e) { return null; }
  }).filter(Boolean);
  const products = [], nodes = [];
  catalogs.forEach(c => {
    (c.products || []).filter(hasDescription).forEach(p => products.push(p));
    (function walk(n) { if (!n) return; if (hasCategoryDescription(n)) nodes.push(n); (n.children || []).forEach(walk); })(c.tree);
  });
  if (!products.length && !nodes.length) return 0;
  const parsed = await parseMany([
    ...products.map(p => ({ key: 'p' + p.productId, raw: p.descriptionRaw, url: p.finalUrl })),
    ...nodes.map(n => ({ key: 'c' + n.categoryId, raw: n.descriptionRaw, url: n.url }))
  ]);
  const idx = descIndex(catalogs);
  fs.mkdirSync(DESC_DIR, { recursive: true });
  products.forEach(p => fs.writeFileSync(path.join(DESC_DIR, `${p.productId}.json`), descriptionJson(p, idx, parsed.get('p' + p.productId)), 'utf-8'));
  nodes.forEach(n => fs.writeFileSync(path.join(DESC_DIR, `c${n.categoryId}.json`), categoryJson(n, parsed.get('c' + n.categoryId)), 'utf-8'));
  // Індекс пошуку за описом — окремим файлом, завантажується лише при пошуку (lib/desc.js).
  fs.writeFileSync(path.join(DIR, 'desc-index.json'), JSON.stringify(descSearchIndex(
    products.map(p => ({ p, parsed: parsed.get('p' + p.productId) })),
    nodes.map(n => ({ n, parsed: parsed.get('c' + n.categoryId) })), idx)), 'utf-8');
  return products.length + nodes.length;
}

// <id>_failed_urls.json пише scrape-complete.js лише коли після повторного
// проходу етапу 2 лишились товари без даних (і видаляє, коли таких нема), тож
// файл завжди відповідає поточному каталогу. Читаємо лише для 'ok' — як readSummary.
function readFailedUrls(id) {
  const p = path.join(DIR, `${id}_failed_urls.json`);
  try { const list = JSON.parse(fs.readFileSync(p, "utf-8")); return Array.isArray(list) ? list : []; } catch (e) { return []; }
}

// <id>_errors.json пише scrape-complete.js (ті самі помилки, що й записи error у
// scrape.jsonl, але по категорії й повним текстом; чистий прогін файл видаляє).
// Читається для БУДЬ-ЯКОГО статусу, не лише 'ok': помилки потрібні й там, де
// мапу не збудовано.
function readRunErrors(id) {
  const p = path.join(DIR, `${id}_errors.json`);
  try { const list = JSON.parse(fs.readFileSync(p, "utf-8")); return Array.isArray(list) ? list : []; } catch (e) { return []; }
}

// ==================== ІНДЕКС УСІХ КАТЕГОРІЙ (map.html) ====================
// Той самий "діловий" вигляд, що й в окремих <id>_map.html (map-common.css
// підключено так само), але без сайдбару/дерева — просто таблиця-список з
// посиланнями. Немає власного JS-додатку (initCatalogMap чекає CATALOG_DATA з
// повним деревом, якого тут нема) — лише top-level функції з того самого
// map-common.js: тема, панелі, підказки, меню, заставка й пошук по сайту.
function diffBadgeHtml(e) {
  if (e.status !== 'ok' || e.diff === null || e.diff === undefined) {
    // Тире, як у сусідніх колонках рядка без даних; «н/д» прибрано на прохання
    // користувача 27.09.2026 разом із його поясненням у підказці заголовка.
    return '—';
  }
  const cls = e.diff === 0 ? 'diff-zero' : 'diff-nonzero';
  return `<span class="${cls}">${e.total_yes}/${e.site_counter ?? '—'}</span>`;
}

// Лише іконка, без слова поруч (Актуально/Застаріло/Немає даних) — сам напис
// живе тепер у Довідці й у data-tip на кожній іконці, а не дублюється в
// кожному рядку таблиці вдруге.
// Помилки прогону — окремий значок ПОРЯД зі статусом, а не замість нього:
// статус каже про актуальність даних, цей — що під час скрапінгу щось пішло не
// так. Клік відкриває спільну панель "Помилки прогону" (обробник — унизу
// сторінки, бо setupModalOverlay вміє лише одну кнопку-відкривач).
function runErrorBadgeHtml(e) {
  const n = (e.run_errors || []).length;
  if (n === 0) return '';
  return ` <button class="run-error-badge" data-tip="${n} ${plural(n, 'помилка', 'помилки', 'помилок')} під час останнього скрапінгу цієї категорії: клік для списку">${ICONS.errors}</button>`;
}

function statusBadgeHtml(e) {
  if (e.status === 'ok') return '<span class="count-yes" data-tip="Актуально: мапа побудована на базі свіжих даних.">' + ICONS.ok + '</span>';
  if (e.status === 'not_scraped') return '<a href="' + e.id + '_map.html" class="stock-badge neutral" data-tip="Немає даних: скрапер ще жодного разу не обробляв цю категорію.">' + ICONS.nodata + '</a>';
  return '<a href="' + e.id + '_map.html" class="count-no" data-tip="Застаріло: мапа побудована на базі застарілих даних.">' + ICONS.stale + '</a>';
}

// Найсвіжіший скрапінг серед категорій — ним підписана шапка map.html і від
// нього ж ім'я XLSX, щоб дата на сторінці й дата в назві файла не розходились.
// scraped_at — готовий рядок "ДД.ММ.РРРР ГГ:ХХ" (його ж показує колонка
// "Дата та час"), а лексикографічно такі рядки не сортуються, тож розбираємо.
function newestScrapedAt(entries) {
  let best = null, bestDate = null;
  for (const e of entries) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(e.scraped_at || '');
    if (!m) continue;
    const d = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
    if (!bestDate || d > bestDate) { bestDate = d; best = e.scraped_at; }
  }
  return best;
}

// ==================== ВЕРТИКАЛЬНЕ МЕНЮ map.html (клієнт) ====================
// Серіалізується в сторінку через .toString(), тож самодостатня (без замикань на Node).
// Робить чотири речі: згортання меню до смужки іконок (стан у localStorage), списки на
// місці таблиці (відкритий — один, його пункт підсвічено), числа «Історії каталогу» з
// reports/data/index.json і вміст списків медіа з media-report.json.
function initSideMenu() {
  var nav = document.getElementById('vnav');
  if (!nav) return;
  var body = document.body;
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var items = Array.prototype.slice.call(nav.querySelectorAll('.vn-item'));
  var hideTip = function () { var t = document.getElementById('custom-tooltip'); if (t) t.classList.remove('visible'); };

  // ---- Згортання до смужки іконок. Підказка на смужці — назва й число пункту. ----
  var rail = document.getElementById('vn-rail-btn');
  function railVal(x) { var v = x.querySelector('.vn-val'); var t = v ? v.textContent.trim() : ''; return t && t !== '…' ? ': ' + t : ''; }
  function setRail(on, save) {
    body.classList.toggle('vn-rail', on);
    rail.textContent = on ? '»' : '«';
    rail.setAttribute('data-tip', on ? 'Розгорнути меню' : 'Згорнути меню');
    items.forEach(function (x) {
      if (!x.hasAttribute('data-full-tip')) x.setAttribute('data-full-tip', x.getAttribute('data-tip') || '');
      var t = on ? x.getAttribute('data-rail-tip') + railVal(x) : x.getAttribute('data-full-tip');
      if (t) x.setAttribute('data-tip', t); else x.removeAttribute('data-tip');
    });
    if (save) { try { localStorage.setItem('vnav-rail', on ? '1' : '0'); } catch (e) {} }
  }
  rail.addEventListener('click', function () { hideTip(); setRail(!body.classList.contains('vn-rail'), true); });
  var savedRail = null;
  try { savedRail = localStorage.getItem('vnav-rail'); } catch (e) {}

  // ---- Списки на місці таблиці: відкритий завжди один. ----
  var overlays = Array.prototype.slice.call(document.querySelectorAll('.list-overlay'));
  Array.prototype.forEach.call(document.querySelectorAll('[data-open]'), function (b) {
    b.addEventListener('click', function () {
      var id = b.getAttribute('data-open');
      overlays.forEach(function (o) { if (o.id !== id) o.classList.remove('open'); });
      var o = document.getElementById(id);
      if (!o) return;
      o.classList.add('open');
      o.scrollTop = 0;
      hideTip();
      fillMedia(o);
    });
  });
  function syncActive() {
    var open = overlays.filter(function (o) { return o.classList.contains('open'); })[0];
    items.forEach(function (x) { x.classList.toggle('active', !!open && x.getAttribute('data-open') === open.id); });
  }
  overlays.forEach(function (o) { new MutationObserver(syncActive).observe(o, { attributes: true, attributeFilter: ['class'] }); });
  // Пошук показує результати на місці таблиці — відкритий список їх би закрив.
  var si = document.getElementById('search-input');
  if (si) si.addEventListener('input', function () { overlays.forEach(function (o) { o.classList.remove('open'); }); });

  // ---- Числа «Історії каталогу»: останній знімок проти попереднього. ----
  var histEls = Array.prototype.slice.call(nav.querySelectorAll('[data-hist]'));
  var setGroupCount = function (group, n) {
    var c = nav.querySelector('[data-group="' + group + '"] .vn-count');
    if (!c) return;
    c.textContent = n || '';
    if (n) c.removeAttribute('hidden'); else c.setAttribute('hidden', '');
  };
  if (histEls.length) {
    fetch('reports/data/index.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (idx) {
      var last = idx.daily[idx.daily.length - 1] || {}, t = last.t || {};
      var v = { content: t.content || 0 };
      v.all = ['in', 'out', 'added', 'removed', 'moved', 'price', 'content', 'cats'].reduce(function (n, k) { return n + (t[k] || 0); }, 0);
      var d = String(last.date || '').split('-');
      var when = d.length === 3 ? d[2] + '.' + d[1] + '.' + d[0] : '';
      var found = 0;
      histEls.forEach(function (x) {
        var n = v[x.getAttribute('data-hist')] || 0, el = x.querySelector('[data-hist-val]');
        el.textContent = n > 0 ? n : 'немає';
        el.className = 'vn-val ' + (n > 0 ? 'chg' : 'none');
        if (n > 0) found++;
        if (when) {
          var tip = (x.getAttribute('data-full-tip') || x.getAttribute('data-tip') || '') + '\nЗнімок ' + when + ' порівняно з попереднім.';
          x.setAttribute('data-full-tip', tip);
          if (!body.classList.contains('vn-rail')) x.setAttribute('data-tip', tip);
        }
      });
      setGroupCount('history', found);
      setRail(body.classList.contains('vn-rail'), false);
    }).catch(function () {
      histEls.forEach(function (x) { var el = x.querySelector('[data-hist-val]'); el.textContent = 'немає даних'; });
    });
  }
  setRail(savedRail === '1', false);

  // ---- Списки медіа: media-report.json завантажується раз, при першому відкритті. ----
  var loading = null;
  // «Що з ним» — словами; код відповіді лишається в media-check.json.
  // 429 — хостинг відмовляє («забагато запитів»): так відповідає захист від ботів, і браузер
  // покупця картинку теж не показує (перевірено 15.10.2026 на intelelectron.ru).
  var reasons = { '404': 'файлу немає', '410': 'файлу немає', '401': 'доступ закрито', '403': 'доступ закрито',
    '429': 'хостинг відмовляє', ENOTFOUND: 'хостингу не існує', timeout: 'не відповідає',
    login: 'доступ закрито' /* закритий файл Google Drive: сторінка входу */,
    // Помилка в самій адресі посилання (linkProblem у lib/media.js).
    double: 'подвоєна адреса', number: 'номер замість адреси', word: 'слово замість адреси' };
  var reason = function (c, kind) {
    c = String(c);
    if (kind === 'link' && (c === '404' || c === '410')) return 'сторінки немає';
    if (kind === 'link' && c === 'ENOTFOUND') return 'сайту не існує';
    return reasons[c] || (/CERT|TLS/.test(c) ? 'недійсний сертифікат' : /TIMEOUT/.test(c) ? 'не відповідає' :
      /^5\d\d$/.test(c) ? 'помилка хостингу' : c);
  };
  var decode = function (u) { try { return decodeURI(u); } catch (e) { return u; } };
  // Бите посилання: адреса з помилкою — як є, текстом (вона нікуди не веде, а саму
  // помилку треба бачити: «https://https://…»); сторінка, якої немає, — посиланням.
  function linkHtml(url, code) {
    if (reasons[code] && /^(double|number|word)$/.test(code)) return '<code class="md-bad">' + esc(decode(url)) + '</code>';
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener" class="md-file">' + esc(decode(url).replace(/^https?:\/\//, '')) + '</a>';
  }
  // Посилання на інший сайт: сайт уже в заголовку групи, тож шлях разом з параметрами
  // (на store.mesanet.com усі сторінки — «index.php?…», різняться лише параметрами).
  function siteHtml(url) {
    var rest = decode(url).replace(/^https?:\/\/[^/]+\/?/, '');
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener" class="md-file">' + esc(rest || 'головна сторінка') + '</a>';
  }
  // Відео: назва з YouTube (oEmbed у check-media.js), під нею платформа й id.
  function videoHtml(url, title) {
    var yt = url.match(/youtube\.com\/embed\/([\w-]{11})/), id = yt ? yt[1] : '';
    var href = id ? 'https://www.youtube.com/watch?v=' + id : url;
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener" class="md-file">' + esc(title || (id ? 'відео ' + id : url)) + '</a>' +
      '<div class="md-sub">' + (id ? 'YouTube · ' + esc(id) : esc(url)) + '</div>';
  }
  function fileHtml(url) {
    var yt = url.match(/youtube\.com\/embed\/([\w-]{11})/);
    var href = yt ? 'https://www.youtube.com/watch?v=' + yt[1] : url;
    var host = url.replace(/^https?:\/\//, '').split('/')[0];
    // Шлях без хостингу, а не лише ім'я: на ImgBB «5.png» — десятки різних файлів,
    // відрізняє їх тека перед іменем.
    // Google Drive: у шляху лише службове «open» чи «file/d/…/view», розрізняє їх id.
    var gd = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=|drive\/(?:u\/\d+\/)?(folders)\/)([\w-]+)/);
    var name = yt ? 'відео ' + yt[1] : gd ? (gd[1] ? 'тека ' : 'файл ') + gd[2] :
      url.split(/[?#]/)[0].replace(/^https?:\/\/[^/]+\//, '') || url;
    try { name = decodeURIComponent(name); } catch (e) {}
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener" class="md-file">' + esc(name) + '</a><div class="md-sub">' + esc(host) + '</div>';
  }
  // Де на сторінці стоїть файл (місця з lib/media.js) — для кожної сторінки окремо.
  var PLACE = { gallery: 'Фото товару', desc: 'Опис', xsell: 'Мініатюра в списку супутніх', link: 'Посилання в описі',
    spec: 'Специфікація', tile: 'Плитка категорії', video: 'Відео в описі',
    listing: 'Список розділів магазину' /* шаблон «Дивіться всі наші оголошення» */ };
  var placeHtml = function (list) { return (list || []).map(function (p) { return '<div>' + esc(PLACE[p] || p) + '</div>'; }).join(''); };
  // Сторінка на сайті, де стоїть файл: товар або категорія, посилання на cncprom.ua
  // у новій вкладці (рішення користувача 15.10.2026: коду товару й окремого ↗ немає).
  function ownerCells(rep, pair) {
    var key = pair[0], o = rep.owners[key] || ['', '', '', '', ''], isCat = key.charAt(0) === 'c';
    var name = esc(o[0] || key.slice(1));
    return '<td class="md-page">' + (o[2] ? '<a href="' + esc(o[2]) + '" target="_blank" rel="noopener">' + name + '</a>' : name) +
      (isCat ? ' <span class="md-sub">категорія</span>' : '') + '</td>' +
      '<td class="md-place">' + placeHtml(pair[1]) + '</td>';
  }
  // Файл — свій tbody: №, посилання (і «Що з ним») на всю групу, під ними рядок на
  // кожну сторінку, щоб місце стояло навпроти своєї назви. Видно одну сторінку, решта
  // схована (.md-hid), «ще N» розгортає групу (клас md-open на tbody).
  var SHOW = 1;
  function groupHtml(rep, n, url, why, owners, cell) {
    var more = owners.length > SHOW ? owners.length - SHOW : 0;
    var span = ' rowspan="' + (owners.length + (more ? 1 : 0)) + '"';
    var head = '<td class="md-n"' + span + '>' + n + '</td><td' + span + '>' + (cell || fileHtml(url)) + '</td>' +
      (why === null ? '' : '<td class="md-why"' + span + '>' + esc(why) + '</td>');
    var rows = owners.map(function (pair, i) {
      return '<tr' + (i >= SHOW ? ' class="md-hid"' : '') + '>' + (i === 0 ? head : '') + ownerCells(rep, pair) + '</tr>';
    }).join('');
    if (more) rows += '<tr class="md-more-row"><td colspan="2"><button type="button" class="md-more" data-more="' + more + '">ще ' + more + '</button></td></tr>';
    return '<tbody class="md-grp">' + rows + '</tbody>';
  }
  var LINK_HEAD = { image: 'Посилання на зображення', heavy: 'Посилання на зображення', hosts: 'Посилання на зображення', file: 'Посилання на файл',
    'file-hosts': 'Посилання на файл', video: 'Посилання на відео', link: 'Посилання', 'site-hosts': 'Посилання', videos: 'Відео' };
  // Списки групами: зображення й файли на сторонніх хостингах і посилання на інші сайти — за
  // хостингом, відео — за платформою (у відео в записі ще назва: власники третім елементом).
  var GROUPS = { hosts: ['hosts', 'файлів'], 'file-hosts': ['fileHosts', 'файлів'], 'site-hosts': ['siteHosts', 'посилань'], videos: ['videos', 'відео'] };
  var hostList = function (kind, rep) { return GROUPS[kind] ? rep[GROUPS[kind][0]] || [] : null; };
  var ownersOf = function (kind, f) { return kind === 'videos' ? f[2] : f[1]; };
  var SORT_ARROWS = ['⇅', '▼', '▲'];
  // sort: null — колонка «Що з ним» не показується (сторонні хостинги); 0/1/2 — порядок.
  // У важких зображень на її місці «Розмір», без сортування: список і так від найважчих.
  function tableHtml(kind, groups, sort) {
    return '<table class="md-tab"><thead><tr><th class="md-n">№</th><th class="md-link">' + LINK_HEAD[kind] + '</th>' +
      (kind === 'heavy' ? '<th class="md-why">Розмір</th>' :
        sort === null ? '' : '<th class="md-why md-sort' + (sort ? ' active' : '') + '" data-md-sort>Що з ним<span class="sort-arrow">' + SORT_ARROWS[sort] + '</span></th>') +
      '<th>Сторінка на сайті</th><th class="md-place">Де на сторінці</th></tr></thead>' + groups + '</table>';
  }
  // Сортування за «Що з ним» — клік по заголовку по колу: як у списку (спершу файли
  // в найбільшій кількості сторінок) → за причиною А–Я → Я–А. Номер лишається за файлом.
  function renderMedia(kind, rep, sort) {
    var hl = hostList(kind, rep);
    if (hl) {
      if (!hl.length) return '<p class="failed-note">Немає.</p>';
      return hl.map(function (h, hi) {
        var own = {};
        h[1].forEach(function (f) { ownersOf(kind, f).forEach(function (o) { own[o[0]] = 1; }); });
        return '<details class="md-host" data-host="' + hi + '"' + (hi === 0 ? ' open' : '') + '><summary><b>' + esc(h[0]) + '</b> · ' + GROUPS[kind][1] + ' ' + h[1].length +
          ', товарів і категорій ' + Object.keys(own).length + '</summary><div class="md-host-body"></div></details>';
      }).join('');
    }
    if (kind === 'heavy') {
      var hv = rep.heavy || [];
      if (!hv.length) return '<p class="failed-note">Немає.</p>';
      return tableHtml(kind, hv.map(function (f, i) {
        return groupHtml(rep, i + 1, f[0], (f[1] / 1e6).toFixed(1).replace('.', ',') + ' МБ', f[2]);
      }).join(''), null);
    }
    var list = (rep.broken[kind] || []).map(function (f, i) { return { f: f, n: i + 1, why: reason(f[1], kind) }; });
    if (!list.length) return '<p class="failed-note">Немає.</p>';
    sort = sort || 0;
    if (sort) list.sort(function (a, b) { return (sort === 1 ? 1 : -1) * a.why.localeCompare(b.why, 'uk') || a.n - b.n; });
    return tableHtml(kind, list.map(function (x) { return groupHtml(rep, x.n, x.f[0], x.why, x.f[3], kind === 'link' ? linkHtml(x.f[0], x.f[1]) : null); }).join(''), sort);
  }
  function fillHost(det, rep, kind) {
    var box = det.querySelector('.md-host-body');
    if (!box || box.getAttribute('data-filled')) return;
    var files = hostList(kind, rep)[+det.getAttribute('data-host')][1];
    box.innerHTML = tableHtml(kind, files.map(function (f, i) {
      return groupHtml(rep, i + 1, f[0], null, ownersOf(kind, f),
        kind === 'videos' ? videoHtml(f[0], f[1]) : kind === 'site-hosts' ? siteHtml(f[0]) : null);
    }).join(''), null);
    box.setAttribute('data-filled', '1');
  }
  function fillMedia(o) {
    var box = o.querySelector('[data-media-body]');
    if (!box || box.getAttribute('data-filled')) return;
    box.innerHTML = '<p class="failed-note">Завантаження…</p>';
    loading = loading || fetch('media-report.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    loading.then(function (rep) {
      var kind = box.getAttribute('data-media-body'), sort = 0;
      box.innerHTML = renderMedia(kind, rep, sort);
      box.addEventListener('click', function (e) {
        if (!e.target.closest) return;
        if (e.target.closest('[data-md-sort]')) {
          sort = (sort + 1) % 3;
          box.innerHTML = renderMedia(kind, rep, sort);
          return;
        }
        var b = e.target.closest('.md-more');
        if (!b) return;
        var open = b.closest('tbody').classList.toggle('md-open');
        b.textContent = open ? 'згорнути' : 'ще ' + b.getAttribute('data-more');
      });
      box.setAttribute('data-filled', '1');
      Array.prototype.forEach.call(box.querySelectorAll('.md-host'), function (det) {
        if (det.open) fillHost(det, rep, kind);
        det.addEventListener('toggle', function () { if (det.open) fillHost(det, rep, kind); });
      });
    }).catch(function (e) {
      loading = null;
      box.innerHTML = '<p class="failed-note">Список не завантажився (' + esc(e && e.message) + '). Сторінку треба відкривати через сервер, не з диска.</p>';
    });
  }
}

function buildIndexPage(entries, scrapeLogContent, mapLogContent, xlsxReady, mediaStats) {
  // Логотипи для розділу «Подяки» в Довідці: зазвичай їх кладе render-map.js разом із
  // map-common.*, але коли жодна категорія ще не скраплена, він не запускається жодного разу.
  writeLogos(DIR);
  // Довідка — одна сторінка на весь сайт; її відкриває кнопка «Довідка» кожної
  // сторінки (initHelpWindow). Після рендерів: посилається на map-common.* з версією.
  writeHelpPage(DIR);
  const sorted = [...entries].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk'));
  const rows = sorted.map((e, i) => `
            <tr>
              <td class="col-n">${i + 1}</td>
              <td><a href="${e.id}_map.html" class="fw-cat-link">${escapeHtmlOuter(e.name || e.id)}</a></td>
              <td style="text-align:center;">${e.levels ?? '—'}</td>
              <td style="text-align:center;" class="fw-count-cell">${e.total_products ?? '—'}</td>
              <td style="text-align:center;">${diffBadgeHtml(e)}</td>
              <td style="text-align:center;">${e.total_no !== undefined && e.total_no !== null ? `<span class="count-no">${e.total_no}</span>` : '—'}</td>
              <td style="text-align:center;">${escapeHtmlOuter(e.scraped_at || '—')}</td>
              <td style="text-align:center;">${statusBadgeHtml(e)}${runErrorBadgeHtml(e)}</td>
              <td style="text-align:center;vertical-align:middle;">${e.url ? `<a href="${escapeHtmlOuter(e.url)}" class="link-site" target="_blank" rel="noopener">↗</a>` : '—'}</td>
            </tr>`).join('');

  // "Товари поза категоріями" для ВСЬОГО сайту — той самий список, що й панель
  // на кожній <id>_map.html (render-map.js), зібраний по всіх категоріях 1 рівня
  // з поля orphan_categories у <id>_map.summary.json (є лише для 'ok' категорій).
  //
  // Вигляд — те саме дерево, що й у панелі розбіжностей звірки (спільні
  // treeRows/treeRowHtml): категорія 1 рівня в заголовку групи, під нею вузли з
  // відступом за рівнем, пропущені ланки добудовуються блідим — сироти розкидані
  // по дереву, і без них відступ натякав би на рівень, якого на екрані немає.
  // Плоский список «Категорія › Підкатегорія» свідомо відкинуто: повторення
  // назви батька в 30+ рядках читалось як простирадло.
  //
  // Сиротою може бути й сама категорія 1 рівня (own_products > 0 на корені).
  // Назву тоді не повторюємо (вона вже в заголовку групи), а пишемо "Товари
  // категорії, які не входять до підкатегорій" — та сама фраза, що в render-map.js.
  // Добудована ланка 1 рівня не показується зовсім: заголовок групи її вже
  // представляє. Число в заголовку — сума ТОВАРІВ (oc.own), а не кількість
  // категорій: заголовок каже "Знайдені товари...".
  const orphanGroups = sorted.filter(e => (e.orphan_categories || []).length > 0);
  const orphanTotal = orphanGroups.reduce((n, e) => n + e.orphan_categories.reduce((k, oc) => k + oc.own, 0), 0);
  const orphanPanelHtml = orphanTotal === 0 ? '' : `
  <div class="help-overlay" id="orphan-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Знайдені товари, які не входять до підкатегорій (${orphanTotal})</h3>
        <button class="btn-help-close" id="btn-orphan-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">У дужках вказано, скільки товарів лежить прямо в цій категорії, повз її підкатегорії. Блідим ідуть проміжні категорії без таких товарів: вони тут лише щоб дерево не мало розривів.<br>Натисніть назву, щоб відкрити цей вузол на мапі.</p>
        <div class="orphan-group-list">${orphanGroups.map(e => `
          <div class="orphan-group">
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">${ICONS.folder} ${escapeHtmlOuter(e.name)} <span class="node-count">(${e.orphan_categories.reduce((k, oc) => k + oc.own, 0)})</span></a>
            <div class="orphan-cat-list">${treeRows(e, e.orphan_categories, oc => rawNodeId(oc.id))
              .filter(row => row.item || !row.node || row.node.level > 1)
              .map(row => {
                const id = row.node ? row.node.id : rawNodeId(row.item.id);
                const level = row.node ? row.node.level : (row.item.level || 1);
                const own = row.item ? row.item.own : (row.node.own || 0);
                // Топ-категорія може бути сиротою сама для себе (товари лежать
                // прямо в ній). Повторювати тут її назву не можна — вона вже в
                // заголовку групи, і рядок виглядав би як помилка.
                const name = row.item && level === 1
                  ? 'Товари категорії, які не входять до підкатегорій'
                  : escapeHtmlOuter(row.item ? row.item.name : row.node.name);
                return treeRowHtml(e.id, id, level, name + ' <span class="node-count">(' + own + ')</span>', !row.item);
              }).join('')}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;

  // "Не оброблено" — товари, сторінку яких скрапер не зміг прочитати навіть
  // після повторного проходу (<id>_failed_urls.json). Такого товару немає в
  // каталозі, тож на мапі й у звірці його не видно — ця панель єдине місце, де
  // він помітний. Коли невдач нема (звичайний стан), панелі в розмітці немає,
  // а рядок меню каже «немає».
  const failedGroups = sorted.filter(e => (e.failed_urls || []).length > 0);
  const failedTotal = failedGroups.reduce((n, e) => n + e.failed_urls.length, 0);
  const failedLabel = u => { try { return decodeURIComponent(new URL(u).pathname); } catch (e) { return u; } };
  const failedPanelHtml = failedTotal === 0 ? '' : `
  <div class="help-overlay" id="failed-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Товари, які не вдалося обробити (${failedTotal})</h3>
        <button class="btn-help-close" id="btn-failed-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Скрапер не зміг прочитати сторінку цих товарів навіть після повторного проходу, тому їх немає на мапі, у пошуку й у звірці з лічильником сайту. Зазвичай це короткий збій сайту: наступний нічний скрапінг їх підхопить.</p>
        <div class="orphan-group-list">${failedGroups.map(e => `
          <div class="orphan-group">
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">${ICONS.folder} ${escapeHtmlOuter(e.name)} <span class="node-count">(${e.failed_urls.length})</span></a>
            <div class="failed-url-list">${e.failed_urls.map(u =>
              '<a href="' + escapeHtmlOuter(u) + '" class="failed-url" target="_blank" rel="noopener">↗ ' + escapeHtmlOuter(failedLabel(u)) + '</a>'
            ).join('')}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;

  // "Помилки" — помилки останнього скрапінгу кожної категорії (<id>_errors.json).
  // До 23.09.2026 їх не було видно ніде, крім лога: нічний прогін мовчки
  // завершувався "успішно", а збій помітив лише користувач, читаючи лог вручну.
  // Тому, крім рядка меню, категорія з помилками має ще й значок ICONS.errors
  // поруч зі статусом у своєму рядку таблиці (statusBadgeHtml — про актуальність
  // даних, це різні речі).
  const errorGroups = sorted.filter(e => (e.run_errors || []).length > 0);
  const errorTotal = errorGroups.reduce((n, e) => n + e.run_errors.length, 0);
  const errorsPanelHtml = errorTotal === 0 ? '' : `
  <div class="help-overlay" id="errors-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Помилки останнього скрапінгу (${errorTotal})</h3>
        <button class="btn-help-close" id="btn-errors-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Що саме пішло не так під час останнього скрапінгу кожної категорії. Ті самі помилки, що й у «Лог скрапінгу», але зібрані разом. Дані категорії при цьому могли зібратись частково: звіряйте з колонкою «В наявності».</p>
        <div class="orphan-group-list">${errorGroups.map(e => `
          <div class="orphan-group">
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">${ICONS.folder} ${escapeHtmlOuter(e.name)} <span class="node-count">(${e.run_errors.length})</span></a>
            <div class="run-error-list">${e.run_errors.map(err =>
              '<div class="run-error"><span class="run-error-time">' + escapeHtmlOuter(err.time || '') + '</span>' +
              escapeHtmlOuter(err.text || err) + '</div>'
            ).join('')}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;

  // "Розбіжності звірки" — вузли, де зібране скрапером не збіглося з
  // лічильником сайту "В наявності N" (reconciliation.mismatchNodes). Рівно
  // нуль або нічого: толерантності немає свідомо (прогін нічний, руху замовлень
  // нема — будь-яка різниця це справжня розбіжність, див. buildCategoryStats у
  // scrape-complete.js).
  // До 23.09.2026 таку розбіжність було видно лише в колонці "В наявності"
  // окремої категорії, і то без списку конкретних вузлів.
  const mismatchGroups = sorted.filter(e => (e.mismatch_categories || []).length > 0);
  const mismatchTotal = mismatchGroups.reduce((n, e) => n + e.mismatch_categories.length, 0);
  // Число в рядку — це вже НЕ вузли, а сама розбіжність у товарах: на скільки зібране
  // «Готово до відправки» розійшлося з лічильником сайту «В наявності». Саме через таку
  // плутанину звідси свого часу зняли кількість вузлів (24.09.2026): вона читалась як розмір
  // розбіжності. Знак зберігається: «-17» каже, що сайт нарахував більше, ніж вдалось
  // зібрати, а не навпаки. Сума по категоріях 1 рівня, а не по вузлах зі списку: лічильник
  // сайту рахує всю гілку, тож розбіжність у підкатегорії повторюється в усіх її батьків
  // і сума по вузлах помножила б її на глибину (дало б 42 замість 17).
  const mismatchDiff = sorted.reduce((n, e) => n + (Number.isFinite(e.diff) ? e.diff : 0), 0);
  const mismatchDiffText = signed(mismatchDiff);
  const mismatchPanelHtml = mismatchTotal === 0 ? '' : `
  <div class="help-overlay" id="mismatch-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Розбіжності звірки «Готово до відправки» з лічильником сайту «В наявності» (${mismatchDiffText})</h3>
        <button class="btn-help-close" id="btn-mismatch-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Скрапер рахує товари зі статусом «Готово до відправки» і порівнює з власним лічильником сайту «В наявності» для того ж рівня категорії. Збіг має бути точним: скрапінг нічний, замовлень тоді немає, тож навіть різниця в одиницю означає, що щось не співпало. Причину шукайте в найглибшому рівні. Якщо ж розбіжність є лише в самої категорії, а підкатегорії в нормі, бракує саме її власних товарів.<br>Натисніть назву, щоб відкрити цей вузол на мапі.</p>
        <div class="orphan-group-list">${mismatchGroups.map(e => `
          <div class="orphan-group">
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">${ICONS.folder} ${escapeHtmlOuter(e.name)}</a>
            <div class="orphan-cat-list">${treeRows(e, e.mismatch_categories, m => m.categoryId).map(row => {
              const id = row.node ? row.node.id : row.item.categoryId;
              const level = row.node ? row.node.level : 1;
              const name = row.item ? row.item.name : row.node.name;
              return treeRowHtml(e.id, id, level,
                escapeHtmlOuter(name) + ' <span class="node-count">(' + mismatchFigures(row) + ')</span>',
                !row.item);
            }).join('')}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;

  // "Не збігається з крихтами N" — товари, у яких хлібні крихти сайту ведуть
  // в ІНШУ гілку дерева, ніж та, де скрапер знайшов товар (crumbVerdict
  // 'other'). Це головний сигнал звірки: ancestor/descendant нормальні (товар
  // може бути в кількох категоріях, крихти показують лише головну), а 'other'
  // означає, що обхід і сайт розійшлись по-справжньому — саме так виглядав би
  // збій 19.09.2026 з "Гальмівними резисторами".
  const crumbGroups = sorted.filter(e => (e.crumb_other || []).length > 0);
  const crumbTotal = crumbGroups.reduce((n, e) => n + e.crumb_other.length, 0);
  const crumbPanelHtml = crumbTotal === 0 ? '' : `
  <div class="help-overlay" id="crumbs-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Товари, де крихти сайту ведуть в іншу гілку (${crumbTotal})</h3>
        <button class="btn-help-close" id="btn-crumbs-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Для кожного товару скрапер читає хлібні крихти з його сторінки на сайті й порівнює з категорією, до якої відніс товар обхід дерева. Тут лише випадок «зовсім інша гілка»: якщо крихти вказують на батьківську чи дочірню категорію тієї самої гілки, це нормально: товар може стояти в кількох категоріях, а крихти показують лише головну.</p>
        <div class="orphan-group-list">${crumbGroups.map(e => `
          <div class="orphan-group">
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">${ICONS.folder} ${escapeHtmlOuter(e.name)} <span class="node-count">(${e.crumb_other.length})</span></a>
            <div class="run-error-list">${e.crumb_other.map(c =>
              '<div class="run-error"><a href="' + escapeHtmlOuter(c.url) + '" class="failed-url" target="_blank" rel="noopener">↗ ' + escapeHtmlOuter(c.name) + '</a>' +
              '<div class="crumb-lines"><span class="path-label">Скрапер:</span> ' + escapeHtmlOuter(c.assigned) + '</div>' +
              '<div class="crumb-lines"><span class="path-label">Крихти:</span> ' + escapeHtmlOuter(c.crumbs) + '</div></div>'
            ).join('')}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;

  // "Крихти без категорії N" (25.09.2026) — товари з вердиктом 'unknown'.
  // Це НЕ розбіжність: крихти на сторінці є й вони серверні, просто у їхньому
  // ланцюгу немає жодного /ua/g<id>, лише «Товари та послуги» — підтвердити
  // призначення скрапера нема чим. Доки цього рядка не було, такі товари
  // не було видно ніде: панель крихт показує саме 'other'.
  const crumbUnknownGroups = sorted.filter(e => (e.crumb_unknown || []).length > 0);
  const crumbUnknownTotal = crumbUnknownGroups.reduce((n, e) => n + e.crumb_unknown.length, 0);
  const crumbUnknownPanelHtml = crumbUnknownTotal === 0 ? '' : `
  <div class="help-overlay" id="crumbs-unknown-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Товари, у крихтах яких немає категорії (${crumbUnknownTotal})</h3>
        <button class="btn-help-close" id="btn-crumbs-unknown-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Хлібні крихти на сторінці цих товарів не мають жодної категорії. Лише «Товари та послуги» і сам товар. Скрапер відніс їх за сторінкою категорії, де знайшов, але з боку сайту хлібних крихт немає.</p>
        <div class="orphan-group-list">${crumbUnknownGroups.map(e => `
          <div class="orphan-group">
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">${ICONS.folder} ${escapeHtmlOuter(e.name)} <span class="node-count">(${e.crumb_unknown.length})</span></a>
            <div class="run-error-list">${e.crumb_unknown.map(c =>
              '<div class="run-error"><a href="' + escapeHtmlOuter(c.url) + '" class="failed-url" target="_blank" rel="noopener">↗ ' + escapeHtmlOuter(c.name) + '</a>' +
              '<div class="crumb-lines"><span class="path-label">Скрапер:</span> ' + escapeHtmlOuter(c.assigned) + '</div></div>'
            ).join('')}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;

  // ---- Вертикальне меню (14.10.2026; макет із варіантами погодив користувач) ----
  // Замість двох випадних меню («Звірки», «Звіт скрапера») і кнопок шапки. Групи
  // згори донизу: що змінилось у каталозі → що не відкривається → звірка з сайтом →
  // Prom → робота скрапера → Експорт. Кожна перевірка — пункт і при чистому
  // результаті («немає»): так видно «перевірили, все добре», а не «не перевіряли»
  // (правило ще з меню 25.09.2026). Число в заголовку групи — скільки пунктів щось
  // знайшли, а не сума: сума змішала б вузли з товарами й файли з товарами. Фон — лише
  // в цього числа, у пунктах числа кольорові без фону (вибір користувача з макета).
  // Числа «Історії каталогу» вписує initSideMenu з reports/data/index.json: сторінку
  // змін у нічному прогоні збирають ПІСЛЯ map.html, і число, вписане тут, відставало б
  // на день. kind — колір числа й крапки на згорнутій смужці: chg (зміни), bad
  // (поломка), chk (звірка), host (сторонні хостинги), info (не проблема); plain — без
  // числа (логи, Експорт); nodata — перевірки ще не було.
  const menuItem = ({ icon, name, tip, val, kind, open, href, download, hist, tag }) => {
    const n = val === undefined || val === null || val === '' ? null : String(val);
    let valHtml;
    if (hist) valHtml = `<span class="vn-val none" data-hist-val>…</span>`;
    else if (n !== null) valHtml = `<span class="vn-val ${kind}">${escapeHtmlOuter(n)}</span>`;
    else if (kind === 'plain') valHtml = '';
    else valHtml = `<span class="vn-val none">${kind === 'nodata' ? 'немає даних' : 'немає'}</span>`;
    const found = n !== null && ['bad', 'chk', 'host'].includes(kind);
    const inner = `<span class="vn-ic">${icon}${found ? `<i class="vn-dot ${kind}"></i>` : ''}</span>` +
      `<span class="vn-nm">${escapeHtmlOuter(name)}${tag ? ` <em class="vn-tag">${tag}</em>` : ''}</span>${valHtml}`;
    const attrs = `${tip ? ` data-tip="${escapeHtmlOuter(tip)}"` : ''} data-rail-tip="${escapeHtmlOuter(name)}"` +
      `${found ? ' data-found="1"' : ''}${hist ? ` data-hist="${hist}"` : ''}`;
    // Пункт без знахідок нікуди не веде (як «немає» в старому меню): відкривати порожній список нема чого.
    if (open && (n !== null || kind === 'plain')) return `<button type="button" class="vn-item" data-open="${open}"${attrs}>${inner}</button>`;
    if (href) return `<a class="vn-item" href="${href}"${download ? ' download' : ''}${attrs}>${inner}</a>`;
    return `<div class="vn-item static"${attrs}>${inner}</div>`;
  };
  const menuGroup = (id, title, badge, items) => {
    const found = items.filter(x => x.includes('data-found="1"')).length;
    return `
    <section class="vn-group" data-group="${id}">
      <div class="vn-head"><span class="vn-title">${title}</span><span class="vn-count ${badge}"${found ? '' : ' hidden'}>${found || ''}</span></div>
      <div class="vn-body">${items.join('')}</div>
    </section>`;
  };
  const mediaItem = (icon, name, tip, stat, open, kind, tag) => menuItem({
    icon, name, tip, tag, open,
    kind: mediaStats ? kind : 'nodata',
    val: mediaStats && stat && stat.files > 0 ? stat.files : null,
  });
  const ms = mediaStats || {};
  const sideMenuHtml = `
  <nav class="vnav" id="vnav" aria-label="Меню">
    <div class="vn-top"><button type="button" class="vn-rail-btn" id="vn-rail-btn" data-tip="Згорнути меню">«</button></div>${menuGroup('history', 'Історія каталогу', 'chg', [
      menuItem({ icon: ICONS.history, name: 'Усі зміни', hist: 'all', href: 'reports/index.html', tip: 'Зміни каталогу за останню ніч. Період можна змінити на сторінці.' }),
      menuItem({ icon: ICONS.content, name: 'Змінений контент', hist: 'content', href: 'reports/index.html?type=content', tip: 'Опис, фото, характеристики, файли й відео, які змінив магазин' }),
    ])}${menuGroup('media', 'Доступність медіа', 'bad', [
      mediaItem(ICONS.image, 'Недоступні зображення', 'Фото, картинки в описах і плитки категорій, що не відкриваються', ms.image, 'media-image-overlay', 'bad'),
      mediaItem(ICONS.heavy, 'Важкі зображення', 'Зображення понад 1 МБ: сторінка з ними повільно відкривається', ms.heavy, 'media-heavy-overlay', 'bad'),
      mediaItem(ICONS.file, 'Недоступні файли', 'PDF і файли з описів, що не відкриваються', ms.file, 'media-file-overlay', 'bad'),
      mediaItem(ICONS.video, 'Недоступні відео', 'Відео YouTube з описів, що не відкриваються', ms.video, 'media-video-overlay', 'bad'),
      mediaItem(ICONS.brokenLink, 'Биті посилання', 'Посилання в описах, що нікуди не ведуть', ms.link, 'media-link-overlay', 'bad'),
      mediaItem(ICONS.videos, 'Відео', 'Відео в описах за платформою', ms.videos, 'media-videos-overlay', 'info'),
      mediaItem(ICONS.hosts, 'Зображення на сторонніх хостингах', 'Картинки в описах не на серверах Prom', ms.hosts, 'media-hosts-overlay', 'host'),
      mediaItem(ICONS.hosts, 'Файли на сторонніх хостингах', 'PDF і файли з описів не на серверах Prom', ms.fileHosts, 'media-file-hosts-overlay', 'host'),
      mediaItem(ICONS.sites, 'Посилання на інші сайти', 'Посилання з описів на сторонні сайти', ms.siteHosts, 'media-sites-overlay', 'host'),
    ])}${menuGroup('checks', 'Звірка з сайтом', 'chk', [
      menuItem({ icon: ICONS.mismatch, name: 'Розбіжності звірки', tip: 'Розбіжності звірки «Готово до відправки» з лічильником сайту «В наявності», у товарах', kind: 'chk', val: mismatchTotal > 0 ? mismatchDiffText : null, open: 'mismatch-overlay' }),
      menuItem({ icon: ICONS.crumbs, name: 'Не збігається з крихтами', tip: 'Хлібні крихти товару ведуть в іншу гілку, ніж та, де його знайшов скрапер', kind: 'chk', val: crumbTotal || null, open: 'crumbs-overlay' }),
      menuItem({ icon: ICONS.crumbs, name: 'Крихти без категорії', tip: 'У хлібних крихтах товару немає жодної категорії', kind: 'chk', val: crumbUnknownTotal || null, open: 'crumbs-unknown-overlay' }),
      menuItem({ icon: ICONS.orphans, name: 'Товари поза категоріями', tip: 'Знайдені товари, які не входять до підкатегорій', kind: 'chk', val: orphanTotal || null, open: 'orphan-overlay' }),
    ])}${menuGroup('prom', 'Аудит prom.ua', '', [
      // Окрема сторінка, не список: посилання, а не [data-open]. У лічильник не входить.
      menuItem({ icon: ICONS.platform, name: 'Тест платформи', tip: 'Пробний тест: категорії платформи Prom, комісії й службові дані товарів однієї категорії («Контролери для ЧПК»)', kind: 'info', val: 'пробний', href: 'platform-test.html' }),
    ])}${menuGroup('report', 'Звіт скрапера', 'bad', [
      menuItem({ icon: ICONS.errors, name: 'Помилки', tip: 'Помилки скрапінгу', kind: 'bad', val: errorTotal || null, open: 'errors-overlay' }),
      menuItem({ icon: ICONS.failed, name: 'Не оброблено', tip: 'Товари, сторінку яких скрапер не зміг прочитати', kind: 'bad', val: failedTotal || null, open: 'failed-overlay' }),
      menuItem({ icon: ICONS.log, name: 'Лог скрапінгу', kind: 'plain', open: 'scrape-log-overlay' }),
      menuItem({ icon: ICONS.log, name: 'Лог збірки', kind: 'plain', open: 'map-log-overlay' }),
    ])}${xlsxReady ? `
    <div class="vn-links">${menuItem({ icon: ICONS.export, name: 'Експорт', kind: 'plain', href: XLSX_FILE, download: true, tip: 'Завантажити мапу категорій у форматі XLSX' })}</div>` : ''}
  </nav>`;

  // Списки медіа: оболонка тут, вміст малює initSideMenu з media-report.json при
  // першому відкритті (списки великі, у map.html їм не місце). advice — другий рядок
  // пояснення «Рекомендація: …» у списках проблем (користувач 20.10.2026).
  const mediaPanelHtml = (id, title, note, kind, advice) => `
  <div class="help-overlay" id="${id}">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>${title}</h3>
        <button class="btn-help-close" id="${id}-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">${note}${advice ? `<br><b>Рекомендація:</b> ${advice}` : ''}</p>
        <div data-media-body="${kind}"></div>
      </div>
    </div>
  </div>`;
  const brokenNote = 'Не відкриваються другу перевірку поспіль (перевірка щоночі після скрапінгу).';
  // Текст користувача (15.10.2026) — про зображення, тож лише в їхньому списку.
  const brokenImageNote = 'Не відкриваються другу перевірку поспіль (перевірка щоночі після скрапінгу). Сторінки сайту повільно завантажуються, якщо зображення на них недоступні.';
  const mediaPanelsHtml = !mediaStats ? '' :
    mediaPanelHtml('media-image-overlay', `${ICONS.image} Недоступні зображення (${ms.image.files})`, brokenImageNote, 'image',
      'завантажте зображення заново, краще на Prom, або приберіть його з опису.') +
    mediaPanelHtml('media-heavy-overlay', `${ICONS.heavy} Важкі зображення (${(ms.heavy || {}).files || 0})`,
      'Зображення понад 1 МБ. Сторінка з ними повільно відкривається, особливо з телефона. Спершу найважчі.', 'heavy',
      'зменште зображення (для опису досить 1200 px по ширині) і завантажте заново; велику анімацію GIF краще замінити відео.') +
    mediaPanelHtml('media-file-overlay', `${ICONS.file} Недоступні файли (${ms.file.files})`, brokenNote, 'file',
      'завантажте файл заново й замініть посилання в описі чи у вкладці «Специфікація».') +
    mediaPanelHtml('media-video-overlay', `${ICONS.video} Недоступні відео (${ms.video.files})`, brokenNote, 'video',
      'замініть відео в описі на доступне або приберіть його.') +
    mediaPanelHtml('media-link-overlay', `${ICONS.brokenLink} Биті посилання (${(ms.link || {}).files || 0})`,
      'Посилання в описах, що нікуди не ведуть: сторінки товару, розділу чи сайту вже немає, або адресу записано з помилкою. Помилку в адресі видно одразу, сторінку, якої немає, з другої перевірки поспіль.', 'link',
      'виправте адресу чи замініть посилання на живу сторінку, або приберіть його.') +
    mediaPanelHtml('media-videos-overlay', `${ICONS.videos} Відео (${(ms.videos || {}).files || 0})`,
      'Відео, вбудовані в описи, групами за платформою.', 'videos') +
    mediaPanelHtml('media-hosts-overlay', `${ICONS.hosts} Зображення на сторонніх хостингах (${ms.hosts.files})`,
      'Картинки в описах, які лежать не на серверах Prom. Групи за хостингом, у кожній спершу файли, що стоять у найбільшій кількості товарів.', 'hosts') +
    mediaPanelHtml('media-file-hosts-overlay', `${ICONS.hosts} Файли на сторонніх хостингах (${(ms.fileHosts || {}).files || 0})`,
      'PDF у вкладці «Специфікація» і файли за посиланнями в описах, які лежать не на серверах Prom. Групи за хостингом, у кожній спершу файли, що стоять у найбільшій кількості товарів.', 'file-hosts') +
    mediaPanelHtml('media-sites-overlay', `${ICONS.sites} Посилання на інші сайти (${(ms.siteHosts || {}).files || 0})`,
      'Посилання з описів на сторонні сайти, групами за сайтом.', 'site-hosts');

  // Логи вбудовуються в сторінку готовими таблицями (lib/runlog.js): map.html
  // статична, підвантажити файл за запитом нема звідки. Свіжий прогін зверху й
  // розгорнутий, старі — згорнуті <details>. scrape.jsonl і map.jsonl ростуть з
  // кожним прогоном; поки це десятки КБ, але якщо дійдуть до сотень — варто
  // показувати лише останні прогони.
  const tablePanelHtml = (overlayId, closeBtnId, title, inner) => `
  <div class="help-overlay" id="${overlayId}">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>${title}</h3>
        <button class="btn-help-close" id="${closeBtnId}" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">${inner}
      </div>
    </div>
  </div>`;


  // Підпис у шапці — годинник і дата, без слів. Що це за дата — каже підказка
  // "Дата та час скрапінгу". Це саме скрапінг: найсвіжіший scraped_at як є,
  // без переформатування — рядок уже за київським часом (lib/time.js),
  // і друге перетворення лише додало б шансів збити його назад у пояс машини.
  const generatedAt = newestScrapedAt(sorted) || fmtDateTime(new Date());

  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Мапа сайту cncprom.ua</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="map-common.css${assetVer(path.join(DIR, 'map-common.css'))}">
<script src="map-common.js${assetVer(path.join(DIR, 'map-common.js'))}"></script>
<style>
  /* map-common.css розрахований на .workspace з фіксованою висотою вікна
     (сайдбар + скрол свого вмісту); індексна сторінка його не має, тож
     повертаємо звичайний скрол документа. Без max-width — як і мапи розділів,
     сторінка тягнеться на всю ширину вікна.
     overflow: visible, НЕ auto: .app-header — position: sticky, а sticky
     прив'язується до найближчого скрол-контейнера. auto на html і body разом
     робить body окремим скрол-боксом, і шапка їхала б разом зі сторінкою
     (перевірено скріншотом). */
  html, body { height: auto; overflow: visible; }
  .index-wrap { padding: 20px; }
  .index-wrap h1 { font-size: 1.05rem; margin-bottom: 4px; }
  .index-wrap .sub { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 16px; line-height: 1.5; }
  /* Самі панелі-дерева (.orphan-group-*, .tree-row, .failed-note) описані в
     map-common.css: така сама панель "Товари поза категоріями" є й у кожній
     <id>_map.html, тож вигляд має бути один на дві сторінки, а не дві копії,
     які розійдуться. Ця сторінка теж лінкує map-common.css (вище). */
  .failed-url-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; padding-left: 20px; }
  .failed-url { font-family: var(--font-mono); font-size: 0.76rem; color: var(--text-link); text-decoration: none; overflow-wrap: anywhere; }
  .failed-url:hover { text-decoration: underline; }
  .run-error-list { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding-left: 20px; }
  .run-error { font-size: 0.78rem; line-height: 1.45; color: var(--text-main); overflow-wrap: anywhere; }
  .run-error-time { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); margin-right: 8px; }
  .run-error-badge { background: none; border: none; padding: 0; margin-left: 4px; font: inherit; line-height: 1; cursor: pointer; }
  /* ---- Вертикальне меню (14.10.2026, макет погоджено) ----
     Шапка тепер коротка (назва, дата, пошук, Довідка, Тема, cncprom.ua ↗) і не
     переноситься: висота 44px з map-common.css, від неї рахується верх меню й списків.
     Ширина меню 326px (на 15% ширше першого макета, на прохання користувача);
     згорнуте — смужка іконок 52px. --vnav-cur — поточна ширина, від неї зсув таблиці
     й списків. */
  :root { --vnav-w: 326px; --vnav-rail: 52px;
    --vn-bad: #b91c1c; --vn-chk: #c2410c; --vn-host: #a21caf; --vn-chg: #1d4ed8; }
  /* Числа в пунктах — кольоровий текст без фону: у темній темі світліші відтінки, у
     світлій темніші, обидва ≥ 4.5:1 до тла меню (заміряно 14.10.2026). */
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --vn-bad: #f87171; --vn-chk: #fb923c; --vn-host: #e879f9; --vn-chg: #60a5fa; } }
  :root[data-theme="dark"] { --vn-bad: #f87171; --vn-chk: #fb923c; --vn-host: #e879f9; --vn-chg: #60a5fa; }
  body { --vnav-cur: var(--vnav-w); }
  body.vn-rail { --vnav-cur: var(--vnav-rail); }
  .vnav { position: fixed; left: 0; top: 44px; bottom: 0; width: var(--vnav-cur); z-index: 9; overflow-y: auto; overflow-x: hidden;
    background: var(--bg-sidebar); border-right: 1px solid var(--border-color); padding: 6px 0 24px; font-size: 0.8rem; }
  .index-wrap { margin-left: var(--vnav-cur); }
  .vn-top { display: flex; justify-content: flex-end; padding: 0 8px 2px; }
  .vn-rail-btn { width: 28px; height: 24px; border: 1px solid var(--border-color); border-radius: 4px;
    background: var(--bg-white); color: var(--text-muted); cursor: pointer; }
  .vn-rail-btn:hover { background: var(--bg-hover); color: var(--text-main); }
  .vn-group { padding: 2px 6px 6px; }
  .vn-head { display: flex; align-items: center; gap: 6px; padding: 8px 6px 4px; color: var(--text-subtle);
    font: 700 0.68rem var(--font-sans); letter-spacing: 0.06em; text-transform: uppercase; }
  .vn-count { margin-left: auto; min-width: 18px; padding: 0 5px; border-radius: 9px; color: #fff; text-align: center;
    font: 700 0.66rem/16px var(--font-sans); letter-spacing: 0; background: var(--badge-bg); }
  .vn-count[hidden] { display: none; }
  .vn-count.chk { background: #c2410c; }
  .vn-count.chg { background: #2563eb; }
  .vn-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 6px; border: 0; border-radius: 5px;
    background: none; color: var(--text-main); font: 500 0.8rem/1.25 var(--font-sans); text-align: left; text-decoration: none; cursor: pointer; }
  a.vn-item:hover, button.vn-item:hover { background: var(--bg-hover); text-decoration: none; }
  /* Пункт без дії («немає») — не клікабельний, але з підказкою: знак питання, як усе таке на сайті. */
  .vn-item.static { cursor: help; }
  .vn-item.active { background: var(--bg-active); box-shadow: inset 3px 0 0 var(--border-active); }
  .vn-ic { position: relative; flex: none; width: 22px; text-align: center; font-size: 0.95rem; }
  .vn-dot { position: absolute; right: -1px; top: -1px; width: 7px; height: 7px; border-radius: 50%; display: none; }
  .vn-dot.bad { background: var(--status-no); } .vn-dot.chk { background: #ea580c; } .vn-dot.host { background: #c000c0; }
  .vn-nm { flex: 1; min-width: 0; }
  .vn-tag { font-style: normal; font-size: 0.62rem; font-weight: 600; color: var(--text-subtle); white-space: nowrap;
    border: 1px dashed var(--border-dark); border-radius: 3px; padding: 0 3px; }
  .vn-val { flex: none; font-weight: 600; font-size: 0.78rem; }
  .vn-val.bad { color: var(--vn-bad); } .vn-val.chk { color: var(--vn-chk); } .vn-val.host { color: var(--vn-host); }
  .vn-val.chg { color: var(--vn-chg); } .vn-val.none { color: var(--text-subtle); }
  /* Число без оцінки (усі відео): звичайним приглушеним текстом, на виділеному рядку теж ≥ 4.5:1. */
  .vn-val.info { color: var(--text-muted); }
  .vn-links { padding: 6px; border-top: 1px solid var(--border-color); margin-top: 4px; }
  body.vn-rail .vn-nm, body.vn-rail .vn-val, body.vn-rail .vn-title, body.vn-rail .vn-count { display: none; }
  body.vn-rail .vn-head { padding: 4px 0; border-top: 1px solid var(--border-color); margin-top: 4px; }
  body.vn-rail .vn-group, body.vn-rail .vn-links { padding-left: 4px; padding-right: 4px; }
  body.vn-rail .vn-item { justify-content: center; padding: 6px 0; }
  body.vn-rail .vn-dot { display: block; }
  body.vn-rail .vn-top { justify-content: center; padding: 0; }
  /* Списки (логи, звірки, медіа) — на місці таблиці праворуч від меню, а не вікном
     поверх сторінки: меню лишається видимим і робочим (варіант 4 з макета). */
  .list-overlay { top: 44px; left: var(--vnav-cur); padding: 20px; z-index: 8; background: var(--bg-page);
    align-items: stretch; justify-content: stretch; }
  .list-overlay .help-panel { max-width: none; width: 100%; height: 100%; box-shadow: none; display: flex; flex-direction: column; }
  .list-overlay .help-panel-body { max-height: none; flex: 1; min-height: 0; }
  /* Таблиці списків медіа. */
  /* Ширини — частками й table-layout: fixed, щоб колонки стояли однаково в усіх
     таблицях (групи хостингів — окремі таблиці; за вмістом вони роз'їжджались). */
  .md-tab { width: 100%; border-collapse: collapse; font-size: 0.8rem; table-layout: fixed; }
  .md-tab th { text-align: left; font-weight: 600; color: var(--text-muted); padding: 4px 8px; border-bottom: 1px solid var(--border-dark); }
  .md-tab td { padding: 3px 8px; vertical-align: top; }
  /* Файл — свій tbody; межа між файлами, а не між сторінками одного файлу. */
  .md-tab .md-grp { border-bottom: 1px solid var(--border-color); }
  .md-tab .md-grp > tr:first-child > td { padding-top: 7px; }
  .md-tab .md-grp > tr:last-child > td { padding-bottom: 7px; }
  .md-tab tbody:not(.md-open) .md-hid { display: none; }
  .md-tab .md-n { width: 40px; color: var(--text-subtle); }
  .md-tab th.md-n { color: var(--text-muted); }
  .md-tab .md-link { width: 24%; }
  .md-tab th.md-why { width: 14%; }
  .md-tab th.md-place { width: 20%; }
  .md-tab .md-why, .md-tab .md-place { color: var(--text-muted); }
  .md-tab th.md-sort { cursor: pointer; user-select: none; }
  .md-tab th.md-sort:hover { color: var(--text-main); }
  .md-tab th.md-sort.active .sort-arrow { opacity: 1; color: var(--text-link); }
  .md-file { overflow-wrap: anywhere; }
  /* Адреса з помилкою (подвоєне https://, номер чи слово замість адреси) — текстом, не посиланням. */
  .md-bad { font-family: var(--font-mono); font-size: 0.74rem; color: var(--status-no); overflow-wrap: anywhere; }
  .md-sub { color: var(--text-subtle); font-size: 0.72rem; }
  .md-more { background: none; border: 0; padding: 4px 2px; min-width: 24px; font: inherit; font-size: 0.76rem; color: var(--text-link); cursor: pointer; }
  .md-more:hover { text-decoration: underline; }
  .md-host { border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 8px; background: var(--bg-white); }
  .md-host > summary { cursor: pointer; padding: 8px 12px; font-size: 0.82rem; }
  .md-host > summary:hover { background: var(--bg-hover); }
  .md-host-body { padding: 0 8px 8px; }
  /* Два рядки під товаром у панелі крихт: куди його відніс обхід і що каже
     сайт. Підпис ліворуч — того ж тону, що й .path-label на сторінці змін,
     де такі ж пари "Було:/Стало:" стоять під зміною категорії. */
  .crumb-lines { font-size: 0.76rem; color: var(--text-muted); line-height: 1.45; margin-top: 2px; }
  .crumb-lines .path-label { display: inline-block; min-width: 68px; font-weight: 600; color: var(--text-main); }

  /* Таблиця прогонів у панелі «Лог скрапінгу» (lib/runlog.js). Стилі тут, а не
     в map-common.css: ця панель є лише на map.html. */
  .rl-wrap { display: flex; flex-direction: column; gap: 10px; }
  .rl-run { border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-white); overflow: hidden; }
  .rl-run > summary { cursor: pointer; padding: 8px 12px; font-size: 0.78rem; color: var(--text-main);
    background: var(--bg-subtle); font-family: var(--font-mono); list-style: none; }
  .rl-run > summary::-webkit-details-marker { display: none; }
  /* Стрілка малюється сама: рідний маркер <details> у різних браузерах різний,
     а рядок моноширинний, і зсув помітний. Шрифт стрілки — sans: у JetBrains Mono
     цього знака немає, і замість нього малювався порожній прямокутник. */
  .rl-run > summary::before { content: '▸'; display: inline-block; width: 14px;
    color: var(--text-subtle); font-family: var(--font-sans); }
  .rl-run[open] > summary::before { content: '▾'; }
  .rl-run[open] > summary { border-bottom: 1px solid var(--border-color); }
  /* Заголовок прогону клікабельний (розгортає й згортає таблицю), тож реагує на
     наведення, як усе клікабельне на сайті (зауваження користувача 27.09.2026). */
  .rl-run > summary:hover { background: var(--bg-hover); color: var(--text-link); }
  .rl-run > summary:hover::before { color: var(--text-link); }
  /* table-layout: fixed — ширини беруться з шапки, а не з вмісту. «Категорію» звужено
     вдвічі (було 325px, 26.09.2026, на прохання користувача) з умовою «не більше двох
     рядків»: заміряно, до 172px «Пульти ручного управління…» і «Датчики, кнопки…»
     лягають у три, з 176px усе вміщається у два; 180 — з запасом на інший шрифт.
     Шість числових колонок ділять решту порівну, замість тиснутись біля правого краю. */
  .rl-tab { width: 100%; border-collapse: collapse; font-size: 0.76rem; table-layout: fixed; }
  .rl-tab th:nth-child(1) { width: 50px; }
  .rl-tab th:nth-child(2) { width: 180px; }
  /* white-space: nowrap — рядки шапки задано вручну через <br> (формулювання користувача),
     і жоден з них не має розпадатись усередині. Найдовший — «Не збігається»; те, що він
     вміщається у свою колонку, стереже смоук-тест. Розмір шапки — як у комірок
     (28.09.2026, користувач: «чому шрифт у назві стовпчика менше»); до того 0.68rem,
     заміряно, що в 0.76rem усі назви все одно влазять. Колір лишається приглушеним,
     як у всіх таблицях сайту (користувач: «не міняти»). */
  .rl-tab th { text-align: left; font-weight: 600; font-size: 0.76rem; color: var(--text-muted);
    padding: 5px 8px; border-bottom: 1px solid var(--border-dark); vertical-align: bottom; white-space: nowrap; }
  .rl-tab td { padding: 3px 8px; border-bottom: 1px solid var(--border-color); color: var(--text-main); vertical-align: top; }
  /* Числові колонки і «Статус» — по центру в обох напрямках (26.09.2026, на прохання
     користувача): назва категорії буває у два рядки, і число має стояти навпроти її
     середини, а не верхнього рядка. Відступи заголовків — симетричні й вузькі: «Не
     збігається» в Inter (найширший із шрифтів стека) займає 69px, і з відступами по 8px
     запасу в 88-піксельній колонці лишалось 2px. */
  .rl-tab th.rl-n, .rl-tab td.rl-n, .rl-tab th.rl-st, .rl-tab td.rl-st {
    text-align: center; font-variant-numeric: tabular-nums; }
  .rl-tab td.rl-n, .rl-tab td.rl-st { vertical-align: middle; }
  .rl-tab th.rl-n, .rl-tab th.rl-st { padding-left: 2px; padding-right: 2px; }
  .rl-tab td.rl-t { font-family: var(--font-mono); color: var(--text-subtle); white-space: nowrap; }
  .rl-tab td.rl-name { overflow-wrap: anywhere; }
  .rl-tab tr.rl-dirty td.rl-name { font-weight: 500; }
  .rl-tab tr.rl-det td { border-bottom: 0; padding-top: 0; padding-bottom: 5px;
    color: var(--text-muted); font-size: 0.72rem; }
  /* Рядок «Фініш скрапінгу» — підсумок прогону, не категорія: без зебри й рамки. */
  /* Час — як у решті рядків (не жирний, --text-subtle з td.rl-t): до 28.09.2026 правило
     чіпляло й його, і час «Фінішу» виділявся (зауваження користувача). */
  .rl-tab tbody.rl-end td:not(.rl-t) { color: var(--text-muted); font-weight: 600; }
  .rl-tab tfoot td { border-bottom: 0; border-top: 1px solid var(--border-dark); padding-top: 6px; }
  /* «Лог скрапінгу»: щоб аномалії було видно, числа в рядках категорій синім, а
     «Разом» — червоним (вибір користувача 28.09.2026 зі сторінки «до / після», варіант
     «а»; 27.09 усі були одного кольору, до того «проблеми» червоні). Лише ця панель:
     у «Лозі збірки» числа («23 з 23», «2 сек») не аномалії. Числа не клікабельні,
     курсор звичайний, хоч синій на сайті зазвичай означає посилання. */
  #scrape-log-overlay .rl-tab tbody.rl-grp td.rl-n { color: var(--text-link); }
  #scrape-log-overlay .rl-tab tfoot td.rl-n { color: var(--status-no); }
  /* Напівжирні (28.09.2026, варіант «в»): тонкі дрібні кольорові цифри здавались
     блідими, хоч контраст ≥ 5:1. Crimson замість синього користувач відхилив: він
     зливався з червоним «Разом». 600, як інші числа сайту (не 700). */
  #scrape-log-overlay .rl-tab tbody.rl-grp td.rl-n, #scrape-log-overlay .rl-tab tfoot td.rl-n { font-weight: 600; }
  .rl-br { font-family: var(--font-mono); color: var(--text-faint); }
  .rl-note + .rl-note { margin-top: 3px; }
  /* Товари під приміткою — на рівні її тексту, після «└─». */
  .rl-item { padding-left: 22px; }
  .rl-item a { color: var(--text-link); }
  .rl-loose { padding: 6px 8px; color: var(--text-muted); font-size: 0.72rem; }
  /* Підсвітка категорії під курсором — рамкою, а не фоном (як в інших таблицях),
     за словами користувача 26.09.2026. Рамка обхоплює весь <tbody> категорії — рядок
     разом із примітками під ним. outline, а не border: у border-collapse рамка рядка
     ділиться з сусіднім, і таблиця стрибала б на піксель. */
  .rl-grp:hover { outline: 1px solid var(--border-active); outline-offset: -1px; }
  /* Зебра — по категоріях (<tbody>), а не по рядках: примітка має бути того ж кольору,
     що й її рядок. Колір — як у таблицях сайту (--bg-row-alt, .simple-table): --bg-tag
     користувач назвав занадто яскравим (26.09.2026). */
  .rl-grp:nth-of-type(even) > tr > td { background: var(--bg-row-alt); }
  /* Назва категорії — посилання на її мапу, але в спокої виглядає звичайним текстом:
     таблиця з 23 синіх назв читалась би як список посилань, а не як журнал. */
  .rl-cat { color: inherit; text-decoration: none; }
  .rl-cat:hover { color: var(--text-link); text-decoration: underline; }
</style>
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="catalog-title">cncprom.ua</span>
      <button class="btn-theme-toggle catalog-subtitle-btn hdr-stamp" data-tip="Дата та час скрапінгу">${ICONS.updated} ${generatedAt}</button>
    </div>
    <div class="header-center">
      <div class="search-wrap">
        <span class="search-icon">${ICONS.search}</span>
        <input type="text" id="search-input" class="header-search-input" placeholder="Пошук товарів, кодів, категорій...">
        <button id="btn-clear-search" class="btn-clear-search" data-tip="Очистити пошук (Esc)" style="display:none;">✕</button>${searchHelpButtonHtml()}
      </div>
    </div>
    <div class="header-right">
${helpButtonHtml('map')}
      <button id="btn-theme-toggle" class="btn-theme-toggle">
        <span class="theme-icon">🌙</span> <span class="theme-text">Темна</span>
      </button>
      <a href="https://cncprom.ua/ua/" class="link-site" target="_blank" rel="noopener">cncprom.ua ↗</a>
    </div>
  </header>
${sideMenuHtml}
${/* Списки меню відкриваються на місці таблиці (клас list-overlay, стилі вище), а не
   вікном поверх сторінки: варіант 4 з макета, вибір користувача 14.10.2026. */
  [tablePanelHtml('scrape-log-overlay', 'btn-scrape-log-close', `Лог скрапінгу`, scrapeLogContent),
   tablePanelHtml('map-log-overlay', 'btn-map-log-close', `Лог збірки`, mapLogContent),
   orphanPanelHtml, mismatchPanelHtml, crumbPanelHtml, crumbUnknownPanelHtml, failedPanelHtml, errorsPanelHtml, mediaPanelsHtml]
    .join('\n').replace(/<div class="help-overlay" id="/g, '<div class="help-overlay list-overlay" id="')}
${narrowGuardHtml()}
  <div class="index-wrap">
    <div id="index-content">
      <h1>Категорії (${entries.length})</h1>
      <div class="section-block">
        <div class="table-wrap">
          <table class="simple-table">
            <thead>
              <tr>
                <th class="col-n">№</th>
                <th>Назва категорії</th>
                <th style="text-align:center;" data-tip="Кількість рівнів підкатегорій">Рівнів</th>
                <th style="text-align:center;" data-tip="Усього товарів у категорії разом з усіма підкатегоріями.">Товарів</th>
                <th style="text-align:center;" data-tip="Перше число: кількість товарів зі статусом «Готово до відправки» за даними скрапера.\nДруге число: лічильник «В наявності» сайту.">В наявності</th>
                <th style="width:78px;white-space:normal;text-align:center;vertical-align:middle;" data-tip="Скільки товарів зі статусом «Немає в наявності» за даними скрапера.\nНезалежного лічильника на сайті для цього нема.">Немає в наявності</th>
                <th style="text-align:center;" data-tip="Дата та час скрапінгу">Дата та час</th>
                <th style="text-align:center;" data-tip="${ICONS.ok} Актуально\n${ICONS.stale} Застаріло\n${ICONS.nodata} Немає даних">Статус</th>
                <th style="width:72px;white-space:normal;text-align:center;vertical-align:middle;">Перейти на сайт</th>
              </tr>
            </thead>
            <tbody>${rows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div id="search-results" style="display:none;"></div>
  </div>
<script>
initThemeToggle();
// Списки відкриває пункт меню (initSideMenu нижче). setupModalOverlay все одно
// потрібен: він вішає хрестик, Esc і клік поза панеллю, а відсутню кнопку-відкривач
// терпить (if (openBtn)).
setupModalOverlay('orphan-overlay', null, 'btn-orphan-close');
['media-image-overlay', 'media-heavy-overlay', 'media-file-overlay', 'media-video-overlay', 'media-link-overlay', 'media-videos-overlay', 'media-hosts-overlay', 'media-file-hosts-overlay', 'media-sites-overlay'].forEach(function (id) {
  setupModalOverlay(id, null, id + '-close');
});
setupModalOverlay('scrape-log-overlay', null, 'btn-scrape-log-close');
setupModalOverlay('map-log-overlay', null, 'btn-map-log-close');
setupModalOverlay('mismatch-overlay', null, 'btn-mismatch-close');
setupModalOverlay('crumbs-overlay', null, 'btn-crumbs-close');
setupModalOverlay('crumbs-unknown-overlay', null, 'btn-crumbs-unknown-close');
setupModalOverlay('failed-overlay', null, 'btn-failed-close');
setupModalOverlay('errors-overlay', null, 'btn-errors-close');
${initSideMenu.toString()}
initSideMenu();
initHelpWindow();
initNarrowGuard();
// Значки помилок у рядках таблиці відкривають ту саму панель, що й рядок
// «Помилки» у «Звіті скрапера».
Array.prototype.forEach.call(document.querySelectorAll('.run-error-badge'), function (b) {
  b.addEventListener('click', function () {
    var item = document.querySelector('#vnav [data-open="errors-overlay"]');
    if (item) item.click();
  });
});
setupTooltips();
initSiteSearch();
initDescriptions();
</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(DIR, "map.html"), html, "utf-8");

  // На GitHub Pages публікується сама тека output/site/, тож index.html поруч із
  // map.html потрібен, щоб корінь https://map.cncprom.pp.ua/ вів на мапу, а не
  // давав 404. Переадресації зі старих адрес з /site/ (до 22.09.2026) прибрано
  // 26.09.2026 на прохання користувача.
  writeRedirect(path.join(DIR, 'index.html'), 'map.html');

  // Готові сторінки й файли, які не будуються з даних скрапера (тека static/ в
  // репозиторії: банери CNCPROM_bot, користувач 02.10.2026), — у корінь сайту як є.
  // Збій копіювання сайт не зупиняє.
  try {
    const STATIC_DIR = path.join(ROOT_DIR, 'static');
    if (fs.existsSync(STATIC_DIR)) fs.cpSync(STATIC_DIR, DIR, { recursive: true });
  } catch (e) { console.warn(`Теку static/ не скопійовано: ${e.message}`); }
}

// JS переносить ?query і #hash (meta-refresh їх губить), meta лишається запасним
// варіантом без JS.
function writeRedirect(file, target) {
  const t = escapeHtmlOuter(target);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `<!DOCTYPE html>
<html lang="uk"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0; url=${t}">
<script>location.replace('${target}' + location.search + location.hash);</script>
<title>Мапа сайту cncprom.ua</title></head>
<body><p><a href="${t}">Мапа сайту cncprom.ua</a></p></body></html>
`, "utf-8");
}

// ==================== ГОЛОВНА ЛОГІКА ====================
// async лише заради запису xlsx: exceljs пише через Promise, а кнопка на
// map.html не має з'являтись раніше за файл, на який вона веде.
(async () => {
  const categories = readCategoryList();

  if (!categories || categories.length === 0) {
    console.error(`Файл не знайдено або порожній: ${categoriesFile(DIR)}`);
    console.error('Спершу запустіть: node scrape-site.js --discover-only');
    process.exit(1);
  }

  console.log(`Категорій 1 рівня в ${path.basename(categoriesFile(DIR))}: ${categories.length}`);
  logEvt('build-start', { total: categories.length });

  const entries = [];
  const searchEntries = [];
  let renderFailures = 0;
  // desc/ збирається заново щоразу: файл товару, що зник з каталогу, не лишається.
  fs.rmSync(DESC_DIR, { recursive: true, force: true });
  const builtIds = [];

  // Результат buildRealMap() перевіряється: інакше впалий render-map.js давав
  // категорію 'ok' із зеленою ✅, а readSummary() підтягував цифри з
  // ПОПЕРЕДНЬОГО прогону як свіжі. Невдалий рендер — заглушка й ⚠️: стан,
  // якого не видно, гірший за стан, який видно.
  function pushBuilt(id, name, url) {
    if (buildRealMap(id)) {
      entries.push({ id, name, url, status: 'ok', ...readSummary(id), failed_urls: readFailedUrls(id) });
      searchEntries.push(...readSearchEntries(id));
      builtIds.push(id);
      return;
    }
    renderFailures++;
    const reason = `render-map.js завершився з помилкою для категорії ${id}: мапу не згенеровано.`;
    console.error(`[${id}] ${name} — ПОМИЛКА РЕНДЕРУ. Заглушка замість мапи.`);
    logError(`Мапу «${name}» не збудовано, замість неї заглушка`);
    writeStub(id, name, reason);
    entries.push({ id, name, url, status: 'stale', reason });
  }

  // scrape-complete.js пише <id>_catalog.json одним записом у кінці прогону,
  // тож станів два: файл є (будуємо мапу) або немає (заглушка з командою для
  // скрапінгу).
  categories.forEach(cat => {
    const { id, name, url } = cat;

    if (!fs.existsSync(path.join(DIR, `${id}_catalog.json`))) {
      const reason = `Категорію ще не скрапили. Запустіть: node scrape-complete.js "${url}"`;
      console.log(`[${id}] ${name} — ще не скрапилось. Заглушка замість мапи.`);
      writeStub(id, name, reason);
      entries.push({ id, name, url, status: 'not_scraped', reason });
      return;
    }

    console.log(`[${id}] ${name} — будуємо мапу.`);
    pushBuilt(id, name, url);
  });

  // Компактно (без відступів) — цей файл лише fetch-иться клієнтським JS,
  // людям його не читати; ~1.8 МБ на весь сайт.
  fs.writeFileSync(path.join(DIR, "search-index.json"), JSON.stringify(searchEntries), "utf-8");
  const descT0 = Date.now();
  const descFiles = await writeDescriptions(builtIds);
  if (descFiles) console.log(`Описів товарів і категорій (desc/): ${descFiles}, ${((Date.now() - descT0) / 1000).toFixed(1)} с`);
  let mediaStats = null;
  try {
    mediaStats = writeMediaReport(builtIds);
    if (mediaStats) console.log(`Медіа: недоступних зображень ${mediaStats.image.files}, файлів ${mediaStats.file.files}, відео ${mediaStats.video.files}, битих посилань ${mediaStats.link.files}; важких зображень ${mediaStats.heavy.files}; на сторонніх хостингах ${mediaStats.hosts.files} зображень і ${mediaStats.fileHosts.files} файлів; відео ${mediaStats.videos.files}; посилань на інші сайти ${mediaStats.siteHosts.files}.`);
    else console.log('Медіа: media-check.json немає — пункти «Доступність медіа» без даних.');
  } catch (err) {
    // Як і XLSX: зручність, а не результат — збірку не валить.
    console.error(`УВАГА: звіт медіа не записано — ${err.message}`);
    logError(`media-report.json не записано: ${err.message}`);
  }

  // Експорт мапи категорій (без товарів) — кнопка "Експорт" на map.html.
  // Помилка тут не валить прогін: xlsx це зручність, а не результат, і нічний
  // конвеєр не має падати через неї. Кнопка з'являється лише коли файл
  // справді записався — інакше вона вела б у 404.
  let xlsxReady = false;
  // Дата в імені файла — дата ДАНИХ, та сама, що в шапці map.html.
  const dataStamp = newestScrapedAt(entries);
  if (dataStamp) {
    XLSX_DATE = dataStamp.slice(0, 10);
    XLSX_FILE = `${XLSX_PREFIX}_${XLSX_DATE}.xlsx`;
  }
  try {
    const built = await buildCatalogXlsx(entries);
    if (built) {
      // Старі експорти прибираємо: ім'я змінне, тож інакше в output/site
      // накопичувалась би купа файлів за різні дні, а кнопка веде лише
      // на один з них. (У нічному прогоні тека й так чиста — це для
      // локальних перезапусків.)
      fs.readdirSync(DIR)
        .filter(f => f === 'catalog.xlsx' ||
          ((f.startsWith(XLSX_PREFIX + '_') || f.startsWith('mapa_cncprom_')) && f.endsWith('.xlsx')))
        .filter(f => f !== XLSX_FILE)
        .forEach(f => { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) { /* не критично */ } });
      await built.wb.xlsx.writeFile(path.join(DIR, XLSX_FILE));
      console.log(`Експорт збережено: ${XLSX_FILE} (${built.count} категорій).`);
      xlsxReady = true;
    }
  } catch (err) {
    console.error(`УВАГА: експорт XLSX пропущено — ${err.message}`);
    logError(`Експорт XLSX не записано: ${err.message}`);
  }

  entries.forEach(e => { e.run_errors = readRunErrors(e.id); });

  const notOk = entries.filter(e => e.status !== 'ok').length;
  if (renderFailures > 0) {
    console.error(`УВАГА: категорій із помилкою рендеру: ${renderFailures} — у map.html вони позначені ⚠️.`);
  }
  // build-finish пишеться ДО того, як map.jsonl читається у сторінку: інакше
  // «Лог збірки» показував би цю збірку незавершеною — завершення з'являлось аж
  // після наступної (користувач це помітив 26.09.2026). Усе, про що звітує запис,
  // на цей момент уже відоме; лишається тільки запис самої сторінки, а якщо він
  // впаде — нижче дописується запис error, тож лог не бреше.
  logEvt('build-finish', {
    total: categories.length, ok: categories.length - notOk, errors: buildErrors,
    // Склад недобудованих — для колонки «Статус», ті самі три стани, що в таблиці map.html.
    stale: entries.filter(e => e.status === 'stale').length,
    noData: entries.filter(e => e.status === 'not_scraped').length,
    sec: Math.max(1, Math.round((Date.now() - BUILD_T0) / 1000))
  });

  const scrapeLogContent = runLogHtml(readEvents(SCRAPE_LOG_FILE), { mapIds: new Set(entries.map(e => String(e.id))) });
  const mapLogContent = buildLogHtml(readEvents(LOG_FILE));
  try {
    buildIndexPage(entries, scrapeLogContent, mapLogContent, xlsxReady, mediaStats);
  } catch (err) {
    console.error(`ПОМИЛКА: map.html не збережено — ${err.message}`);
    logError(`map.html не збережено: ${err.message}`);
    throw err;
  }
  console.log(`\nІндекс збережено: map.html (${entries.length} категорій).`);
  // Свідомо БЕЗ ненульового коду виходу: часткова невдача не має валити крок
  // «Етап 2 — згенерувати мапи + індекс» у deploy-pages.yml, бо разом з ним
  // зник би весь нічний результат (знімок, сторінка змін, деплой) через одну
  // категорію з 23. Сигналом лишається ⚠️ в самому індексі й помилка в «Лозі
  // збірки», які видно там, де дивляться.
  console.log("Готово. Деталі в «Лог збірки» (map.jsonl).");
})();

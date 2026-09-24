
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { logLine: appendLog } = require('./lib/log');
const { escapeHtmlOuter } = require('./lib/html');
const { readCategories, filePath: categoriesFile } = require('./lib/categories');

// ==================== НАЛАШТУВАННЯ ====================
// ROOT_DIR — де лежать самі скрипти (render-map.js викликається звідси);
// DIR — де лежать усі згенеровані файли, включно з тими, що пише цей скрипт
// (map.html, map.log). Розділені навмисно: колись усе писалось прямо в
// ROOT_DIR, тепер лише в output/site/.
const ROOT_DIR = __dirname;
const DIR = path.join(ROOT_DIR, 'output', 'site');
const LOG_FILE = path.join(DIR, "map.log");
const SCRAPE_LOG_FILE = path.join(DIR, "scrape.log");
const XLSX_FILE = "catalog.xlsx";

// ==================== ЛОГ (map.log — доповнюється, як scrape.log) ====================
// Формат і поведінка — спільні зі scrape.log (lib/log.js): це одна родина
// логів прогонів, їм не можна розходитись.
const logLine = text => appendLog(LOG_FILE, text);

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

// Рядки панелі для однієї категорії 1 рівня: усі вузли з розбіжністю плюс їхні
// предки, у порядку обходу дерева. entry.nodes уже лежить у порядку обходу
// (його так пише render-map.js), тож достатньо відфільтрувати.
function mismatchRows(entry) {
  const list = entry.mismatch_categories || [];
  const byId = nodeById(entry);
  if (byId.size === 0) return list.map(m => ({ m, node: null })); // старий summary без nodes
  const flagged = new Map(list.map(m => [String(m.categoryId), m]));
  const keep = new Set();
  flagged.forEach((m, id) => {
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 20) { keep.add(String(cur.id)); cur = byId.get(String(cur.parentId)); }
  });
  return (entry.nodes || [])
    .filter(n => keep.has(String(n.id)))
    .map(n => ({ node: n, m: flagged.get(String(n.id)) || null }));
}

// Підпис із числами. Для вузла без розбіжності беремо його власні числа з
// дерева — вони показують, що там усе зійшлось, і саме тому рядок блідий.
function mismatchFigures(row) {
  const collected = row.m ? row.m.collected : row.node.yes;
  const counter = row.m ? row.m.siteCounter : row.node.counter;
  const diff = row.m ? row.m.diff : row.node.diff;
  if (counter === null || counter === undefined || diff === null || diff === undefined) {
    return 'зібрано ' + collected + ', лічильник сайту не зчитано';
  }
  return 'зібрано ' + collected + ', сайт ' + counter + ', різниця ' + (diff > 0 ? '+' : '') + diff;
}

// ==================== ЕКСПОРТ МАПИ КАТЕГОРІЙ У XLSX ====================
// Один аркуш на весь сайт: усі категорії всіх рівнів, БЕЗ товарів (так просив
// користувач). Числа беруться з nodes у <id>_map.summary.json — того самого
// плаского списку, який пише render-map.js із уже порахованого дерева. Рахувати
// їх тут заново означало б другу реалізацію тієї ж арифметики.
//
// Запис загорнутий у try/catch і НЕ валить прогін: xlsx — зручність, а не
// результат, і нічний конвеєр не має падати через неї.
function buildCatalogXlsx(entries) {
  const rows = [];
  entries.filter(e => e.status === 'ok').forEach(e => {
    (e.nodes || []).forEach(n => rows.push({ top: e.name, ...n }));
  });
  if (rows.length === 0) {
    console.warn('XLSX: нема жодного вузла — файл не створено.');
    return null;
  }

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'build-maps.js';
  wb.created = new Date();
  const ws = wb.addWorksheet('Категорії');
  ws.columns = [
    { header: 'Розділ 1 рівня', key: 'top', width: 34 },
    { header: 'ID', key: 'id', width: 12 },
    { header: 'Категорія', key: 'name', width: 46 },
    { header: 'ID батька', key: 'parentId', width: 12 },
    { header: 'Рівень', key: 'level', width: 8 },
    { header: 'Товарів', key: 'products', width: 10 },
    { header: 'Власних товарів', key: 'own', width: 16 },
    { header: 'В наявності', key: 'yes', width: 12 },
    { header: 'Немає в наявності', key: 'no', width: 18 },
    { header: 'Лічильник сайту', key: 'counter', width: 16 },
    { header: 'Різниця', key: 'diff', width: 10 },
    { header: 'Посилання', key: 'url', width: 60 }
  ];
  rows.forEach(r => ws.addRow(r));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };
  // Ненульова різниця — те, заради чого таблицю й відкривають; підсвічуємо її
  // тим самим червоним, що й на сторінках.
  ws.getColumn('diff').eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1 && typeof cell.value === 'number' && cell.value !== 0) {
      cell.font = { color: { argb: 'FFB3261E' }, bold: true };
    }
  });
  return { wb, count: rows.length };
}

// ==================== ІНШІ ДОПОМІЖНІ ФУНКЦІЇ ====================
function readLogSafe(filePath) {
  try { return fs.readFileSync(filePath, "utf-8"); } catch (e) { return "(файл відсутній або порожній)"; }
}

function writeStub(id, name, reason) {
  const htmlPath = path.join(DIR, `${id}_map.html`);
  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<title>Категорія ${id}${name ? " — " + escapeHtmlOuter(name) : ""} — немає актуальних даних</title>
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
    <p>Категорія ${id}${name ? " (" + escapeHtmlOuter(name) + ")" : ""} — мапу не згенеровано.</p>
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
      });
    });
    (node.children || []).forEach(walk);
  })(catalog.tree);
  return out;
}

// <id>_failed_urls.json пише scrape-complete.js лише коли після повторного
// проходу етапу 2 лишились товари без даних (і видаляє, коли таких нема), тож
// файл завжди відповідає поточному CSV. Читаємо лише для 'ok' — як readSummary.
function readFailedUrls(id) {
  const p = path.join(DIR, `${id}_failed_urls.json`);
  try { const list = JSON.parse(fs.readFileSync(p, "utf-8")); return Array.isArray(list) ? list : []; } catch (e) { return []; }
}

// <id>_errors.json пише scrape-complete.js (ті самі рядки ПОМИЛКА, що й у
// scrape.log, але по категорії; порожній прогін файл видаляє). Читається для
// БУДЬ-ЯКОГО статусу, не лише 'ok': категорія, яка впала, найчастіше і є
// stale — саме там помилки найпотрібніші.
function readRunErrors(id) {
  const p = path.join(DIR, `${id}_errors.json`);
  try { const list = JSON.parse(fs.readFileSync(p, "utf-8")); return Array.isArray(list) ? list : []; } catch (e) { return []; }
}

// ==================== ІНДЕКС УСІХ КАТЕГОРІЙ (map.html) ====================
// Той самий "діловий" вигляд, що й в окремих map_<id>.html (map-common.css
// підключено так само), але без сайдбару/дерева — просто таблиця-список з
// посиланнями. Немає власного JS-додатку (initCatalogMap чекає CATALOG_DATA з
// повним деревом, якого тут нема) — лише initThemeToggle, setupModalOverlay й
// setupTooltips з map-common.js, того самого спільного файлу.
function diffBadgeHtml(e) {
  if (e.status !== 'ok' || e.diff === null || e.diff === undefined) {
    return '<span class="stock-badge neutral">н/д</span>';
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
  return ` <button class="run-error-badge" data-tip="${n} ${n === 1 ? 'помилка' : 'помилок'} під час останнього скрапінгу цієї категорії — клік для списку">⚠️</button>`;
}

function statusBadgeHtml(e) {
  if (e.status === 'ok') return '<span class="count-yes" data-tip="Актуально: мапа побудована на базі свіжих даних.">✅</span>';
  if (e.status === 'not_scraped') return '<a href="' + e.id + '_map.html" class="stock-badge neutral" data-tip="Немає даних: скрапер ще жодного разу не обробляв цю категорію.">⏳</a>';
  return '<a href="' + e.id + '_map.html" class="count-no" data-tip="Застаріло: мапа побудована на базі застарілих даних.">⚠️</a>';
}

function buildIndexPage(entries, scrapeLogContent, mapLogContent, xlsxReady) {
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
              <td style="text-align:center;vertical-align:middle;">${e.url ? `<a href="${escapeHtmlOuter(e.url)}" class="link-site">↗</a>` : '—'}</td>
            </tr>`).join('');

  // "Товари поза категоріями" для ВСЬОГО сайту — той самий орфан-список, що й
  // кнопка/панель у кожній <id>_map.html (render-map.js), але зібраний по всіх
  // категоріях 1 рівня одразу і згрупований по них (псевдо-tree: категорія 1
  // рівня — заголовок групи, її орфан-підкатегорії — пункти під ним), а не
  // пласким списком із назвою "Категорія › Підкатегорія" в кожному рядку —
  // при 20-30+ записах на 23 категорії це самé повторення назви батька в
  // кожному рядку й читалось як простирадло. Джерело — поле orphan_categories,
  // яке кожен <id>_map.summary.json тепер несе поряд з рештою globalStats (щоб
  // не перечитувати заново повне дерево кожної категорії тут). Є лише для 'ok'
  // категорій (readSummary дає дані тільки їм) — те саме обмеження, що й у
  // Товарів/В наявності/Оновлено вище для stale/not_scraped рядків.
  // Групи ведуть на map.html ВЛАСНЕ ТІЄЇ категорії 1 рівня (не одразу на
  // конкретний вкладений розділ — переходу до окремого вузла на чужій
  // сторінці мапа поки не підтримує).
  //
  // ВАЖЛИВО: сирота може бути й самою категорією 1 рівня (own_products > 0
  // прямо на кореневому вузлі — те саме, що orphanCategories в render-map.js
  // рахує для будь-якого вузла дерева, корінь не виняток). Наївне групування
  // "заголовок = назва топ-категорії, пункти під ним = назви орфан-вузлів"
  // тоді дає пункт із тим самим текстом, що й заголовок групи (стаття
  // "Категорія X" під заголовком "Категорія X"), що виглядає як помилка. Такий
  // запис (oc.level === 1, тобто орфан-вузол — сама топ-категорія) підписується
  // окремо — "Товари категорії, які не входять до підкатегорій" (та сама фраза,
  // що й у власному/сирітському рядку зведення в render-map.js), а не назвою
  // категорії вдруге.
  const orphanGroups = [];
  const orphanGroupById = new Map();
  // Сума ТОВАРІВ (oc.own у кожному записі), а не кількість записів/категорій
  // у списку нижче — заголовок каже "Знайдені товари...", тож і число поруч
  // має бути кількістю товарів, а не кількістю орфан-категорій, які їх містять.
  let orphanTotal = 0;
  sorted.forEach(e => {
    (e.orphan_categories || []).forEach(oc => {
      orphanTotal += oc.own;
      if (!orphanGroupById.has(e.id)) {
        const group = { topId: e.id, topName: e.name, items: [] };
        orphanGroupById.set(e.id, group);
        orphanGroups.push(group);
      }
      orphanGroupById.get(e.id).items.push(oc);
    });
  });
  const orphanMenuButtonHtml = orphanTotal === 0 ? '' : `
      <button id="btn-orphan-cats" class="btn-theme-toggle catalog-subtitle-btn" data-tip="Знайдені товари, які не входять до підкатегорій">⚠️ Товари поза категоріями</button>`;
  const orphanPanelHtml = orphanTotal === 0 ? '' : `
  <div class="help-overlay" id="orphan-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Знайдені товари, які не входять до підкатегорій (${orphanTotal}):</h3>
        <button class="btn-help-close" id="btn-orphan-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <div class="orphan-group-list">${orphanGroups.map(g => `
          <div class="orphan-group">
            <a href="${escapeHtmlOuter(g.topId)}_map.html" class="orphan-group-head">📁 ${escapeHtmlOuter(g.topName)}</a>
            <div class="orphan-cat-list">${g.items.map(oc =>
              '<a href="' + escapeHtmlOuter(g.topId) + '_map.html" class="cat-found-badge">' +
              (oc.level === 1 ? 'Товари категорії, які не входять до підкатегорій' : escapeHtmlOuter(oc.name)) +
              ' <span class="node-count">(' + oc.own + ')</span></a>'
            ).join('')}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;

  // "Не оброблено N" — товари, сторінку яких скрапер не зміг прочитати навіть
  // після повторного проходу (<id>_failed_urls.json). Такий товар відсутній у
  // CSV, тож на мапі й у звірці його просто не видно — ця кнопка єдине місце,
  // де він помітний. Та сама схема, що й "Товари поза категоріями": кнопка й
  // панель не рендеряться зовсім, коли невдач нема (звичайний стан).
  const failedGroups = sorted.filter(e => (e.failed_urls || []).length > 0);
  const failedTotal = failedGroups.reduce((n, e) => n + e.failed_urls.length, 0);
  const failedLabel = u => { try { return decodeURIComponent(new URL(u).pathname); } catch (e) { return u; } };
  const failedMenuButtonHtml = failedTotal === 0 ? '' : `
      <button id="btn-failed-urls" class="btn-theme-toggle catalog-subtitle-btn" data-tip="Товари, сторінку яких скрапер не зміг прочитати навіть із повторної спроби. Їх немає на мапі й у звірці.">⛔ Не оброблено ${failedTotal}</button>`;
  const failedPanelHtml = failedTotal === 0 ? '' : `
  <div class="help-overlay" id="failed-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Товари, які не вдалося обробити (${failedTotal}):</h3>
        <button class="btn-help-close" id="btn-failed-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Скрапер не зміг прочитати сторінку цих товарів навіть після повторного проходу, тому їх немає на мапі, у пошуку й у звірці з лічильником сайту. Зазвичай це короткий збій сайту — наступний нічний прогін їх підхопить.</p>
        <div class="orphan-group-list">${failedGroups.map(e => `
          <div class="orphan-group">
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">📁 ${escapeHtmlOuter(e.name)} <span class="node-count">(${e.failed_urls.length})</span></a>
            <div class="failed-url-list">${e.failed_urls.map(u =>
              '<a href="' + escapeHtmlOuter(u) + '" class="failed-url">↗ ' + escapeHtmlOuter(failedLabel(u)) + '</a>'
            ).join('')}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;

  // "Помилки прогону N" — рядки ПОМИЛКА останнього скрапінгу кожної категорії
  // (<id>_errors.json). До 23.09.2026 їх не було видно ніде, крім scrape.log:
  // нічний прогін мовчки завершувався "успішно", а збій (порожня сітка в
  // категорії "Зубчасті шківи і натягувачі") помітив лише користувач, читаючи
  // лог вручну. Тому, крім кнопки, категорія з помилками має ще й значок ⚠️
  // поруч зі статусом у своєму рядку таблиці (statusBadgeHtml лишається про
  // актуальність даних — це різні речі).
  const errorGroups = sorted.filter(e => (e.run_errors || []).length > 0);
  const errorTotal = errorGroups.reduce((n, e) => n + e.run_errors.length, 0);
  const errorsMenuButtonHtml = errorTotal === 0 ? '' : `
      <button id="btn-run-errors" class="btn-theme-toggle catalog-subtitle-btn" data-tip="Помилки останнього скрапінгу цих категорій. Ті самі рядки ПОМИЛКА, що й у scrape.log.">⚠️ Помилки прогону ${errorTotal}</button>`;
  const errorsPanelHtml = errorTotal === 0 ? '' : `
  <div class="help-overlay" id="errors-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Помилки останнього прогону (${errorTotal}):</h3>
        <button class="btn-help-close" id="btn-errors-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Що саме пішло не так під час останнього скрапінгу кожної категорії. Ті самі рядки, що й у scrape.log, але зібрані разом. Дані категорії при цьому могли зібратись частково — звіряйте з колонкою «В наявності».</p>
        <div class="orphan-group-list">${errorGroups.map(e => `
          <div class="orphan-group">
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">📁 ${escapeHtmlOuter(e.name)} <span class="node-count">(${e.run_errors.length})</span></a>
            <div class="run-error-list">${e.run_errors.map(err =>
              '<div class="run-error"><span class="run-error-time">' + escapeHtmlOuter(err.time || '') + '</span>' +
              escapeHtmlOuter(err.text || err) + '</div>'
            ).join('')}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;

  // "Розбіжності звірки N" — вузли, де зібране скрапером не збіглося з
  // лічильником сайту "В наявності N" (reconciliation.mismatchNodes). Рівно
  // нуль або нічого: толерантності немає свідомо (прогін нічний, руху
  // замовлень нема — будь-яка різниця це справжня розбіжність, див. README).
  // До 23.09.2026 таку розбіжність було видно лише в колонці "В наявності"
  // окремої категорії, і то без списку конкретних вузлів.
  const mismatchGroups = sorted.filter(e => (e.mismatch_categories || []).length > 0);
  const mismatchTotal = mismatchGroups.reduce((n, e) => n + e.mismatch_categories.length, 0);
  const mismatchMenuButtonHtml = mismatchTotal === 0 ? '' : `
      <button id="btn-mismatch" class="btn-theme-toggle catalog-subtitle-btn" data-tip="Категорії, де кількість зібраних товарів у наявності не збіглася з лічильником сайту.">⚠️ Розбіжності звірки</button>`;
  const mismatchPanelHtml = mismatchTotal === 0 ? '' : `
  <div class="help-overlay" id="mismatch-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Розбіжності звірки «Готово до відправки» з лічильником сайту «В наявності»</h3>
        <button class="btn-help-close" id="btn-mismatch-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Скрапер рахує товари зі статусом «Готово до відправки» і порівнює з власним лічильником сайту «В наявності» для того ж рівня категорії. Збіг має бути точним: прогін нічний, замовлень тоді немає, тож навіть різниця в одиницю означає, що щось не співпало. Причину шукайте в найглибшому рівні. Якщо ж розбіжність є лише в самої категорії, а підкатегорії в нормі, бракує саме її власних товарів.<br>Натисніть назву, щоб відкрити цей вузол на мапі.</p>
        <div class="orphan-group-list">${mismatchGroups.map(e => `
          <div class="orphan-group">
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">📁 ${escapeHtmlOuter(e.name)}</a>
            <div class="orphan-cat-list">${mismatchRows(e).map(row => {
              const id = row.node ? row.node.id : row.m.categoryId;
              const level = row.node ? row.node.level : 1;
              const name = row.m ? row.m.name : row.node.name;
              return '<a href="' + escapeHtmlOuter(e.id) + '_map.html#cat=' + escapeHtmlOuter(id) + '" class="cat-found-badge mismatch-item' + (row.m ? '' : ' node-ok') + '" style="margin-left:' + ((level - 1) * 18) + 'px;">' +
              escapeHtmlOuter(name) +
              ' <span class="node-count">(' + mismatchFigures(row) + ')</span></a>';
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
  const crumbMenuButtonHtml = crumbTotal === 0 ? '' : `
      <button id="btn-crumbs" class="btn-theme-toggle catalog-subtitle-btn" data-tip="Товари, у яких хлібні крихти сайту ведуть в іншу гілку, ніж та, де їх знайшов скрапер.">🧭 Не збігається з крихтами ${crumbTotal}</button>`;
  const crumbPanelHtml = crumbTotal === 0 ? '' : `
  <div class="help-overlay" id="crumbs-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Товари, де крихти сайту ведуть в іншу гілку (${crumbTotal}):</h3>
        <button class="btn-help-close" id="btn-crumbs-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Для кожного товару скрапер читає хлібні крихти з його сторінки на сайті й порівнює з категорією, до якої відніс товар обхід дерева. Тут лише випадок «зовсім інша гілка»: якщо крихти вказують на батьківську чи дочірню категорію тієї самої гілки, це нормально — товар може стояти в кількох категоріях, а крихти показують лише головну.</p>
        <div class="orphan-group-list">${crumbGroups.map(e => `
          <div class="orphan-group">
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">📁 ${escapeHtmlOuter(e.name)} <span class="node-count">(${e.crumb_other.length})</span></a>
            <div class="run-error-list">${e.crumb_other.map(c =>
              '<div class="run-error"><a href="' + escapeHtmlOuter(c.url) + '" class="failed-url">↗ ' + escapeHtmlOuter(c.name) + '</a>' +
              '<div class="crumb-lines"><span class="path-label">Скрапер:</span> ' + escapeHtmlOuter(c.assigned) + '</div>' +
              '<div class="crumb-lines"><span class="path-label">Крихти:</span> ' + escapeHtmlOuter(c.crumbs) + '</div></div>'
            ).join('')}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;

  // Посилання на експорт — звичайний <a download>, а не панель: тут нема чого
  // показувати, є що завантажити. Не рендериться, якщо файл не записався.
  const xlsxButtonHtml = xlsxReady ? `
      <a href="${XLSX_FILE}" download class="btn-theme-toggle catalog-subtitle-btn" data-tip="Завантажити мапу категорій таблицею (XLSX, без товарів): ID, назва, рівень, кількість товарів, звірка з лічильником сайту.">📊 Експорт XLSX</a>` : '';

  // Повний вміст логів вбудовується прямо в сторінку (як CATALOG_DATA в
  // map_<id>.html) — map.html статична, живого сервера, з якого можна було б
  // підвантажити файл за запитом, тут нема. scrape.log/map.log — append-only
  // і ростуть необмежено з кожним прогоном; поки що це не проблема (кілька
  // КБ), але якщо колись виростуть до сотень КБ — варто буде показувати лише
  // хвіст, а не вміст цілком.
  const logPanelHtml = (overlayId, closeBtnId, title, content) => `
  <div class="help-overlay" id="${overlayId}">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>${title}</h3>
        <button class="btn-help-close" id="${closeBtnId}" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <pre style="white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono);font-size:0.76rem;line-height:1.5;max-height:65vh;overflow-y:auto;margin:0;">${escapeHtmlOuter(content)}</pre>
      </div>
    </div>
  </div>`;

  // "Мапа сайту · <дата й час>" поряд з назвою — той самий підпис-годинник,
  // що й "Мапа розділу · <scrapedAt>" в кожній <id>_map.html, але для map.html
  // немає єдиного category_map.json, чиє mtime можна було б узяти (як робить
  // scrapedAt там) — тут це просто момент генерації самого map.html.
  const generatedAtDate = new Date();
  const generatedAt = generatedAtDate.toLocaleDateString('uk-UA') + ' ' +
    generatedAtDate.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Мапа сайту cncprom.ua</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="map-common.css">
<script src="map-common.js"></script>
<style>
  /* map-common.css розрахований на .workspace з фіксованою висотою вікна
     (сайдбар + скрол свого контенту) — індексна сторінка цього не має, тож
     повертаємо звичайний скрол сторінки. Без max-width/margin:auto — свідомо
     (2026-09-15): раніше .index-wrap затискав ВЕСЬ вміст (і таблицю категорій,
     і результати пошуку) у центральну колонку 1100px, хоча <id>_map.html
     розтягуються на всю ширину вікна без такого обмеження. Тепер уніфіковано
     з ними. На дуже широких моніторах таблиця категорій (мало колонок) може
     виглядати розрідженою — прийнятний компроміс, обраний свідомо.

     overflow: visible, НЕ auto — навмисно (2026-09-15). .app-header тепер
     position: sticky (щоб не їхав разом з довгою таблицею), а sticky working
     тільки якщо body фактично не є ВЛАСНИМ скрол-контейнером. auto на html
     І body одночасно змушує body стати окремим (хоч і не переповненим —
     висота:auto якраз під контент) скрол-боксом, і sticky прив'язується до
     НЬОГО замість справжнього скролу сторінки — заголовок тоді все одно їде.
     Перевірено Playwright-скріншотом до і після виправлення. */
  html, body { height: auto; overflow: visible; }
  .index-wrap { padding: 20px; }
  .index-wrap h1 { font-size: 1.05rem; margin-bottom: 4px; }
  .index-wrap .sub { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 16px; line-height: 1.5; }
  /* Псевдо-tree для "Товари поза категоріями": категорія 1 рівня — заголовок
     групи (.orphan-group-head), її орфан-підкатегорії — індентований
     .orphan-cat-list під ним (той самий спільний клас/вигляд пунктів, що й у
     плоскому списку render-map.js — лише контейнер тепер один на групу). */
  .orphan-group-list { display: flex; flex-direction: column; gap: 14px; }
  .orphan-group-head { display: inline-flex; align-items: center; gap: 4px; font-size: 0.82rem; font-weight: 600; color: var(--text-link); text-decoration: none; }
  .orphan-group-head:hover { text-decoration: underline; }
  .orphan-group .orphan-cat-list { margin-top: 6px; padding-left: 20px; }
  .failed-note { font-size: 0.8rem; color: var(--text-muted); line-height: 1.5; margin: 0 0 14px; }
  .failed-url-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; padding-left: 20px; }
  .failed-url { font-family: var(--font-mono); font-size: 0.76rem; color: var(--text-link); text-decoration: none; overflow-wrap: anywhere; }
  .failed-url:hover { text-decoration: underline; }
  .run-error-list { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding-left: 20px; }
  .run-error { font-size: 0.78rem; line-height: 1.45; color: var(--text-main); overflow-wrap: anywhere; }
  .run-error-time { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); margin-right: 8px; }
  .run-error-badge { background: none; border: none; padding: 0; margin-left: 4px; font: inherit; line-height: 1; cursor: pointer; }
  /* Два рядки під товаром у панелі крихт: куди його відніс обхід і що каже
     сайт. Підпис ліворуч — того ж тону, що й .path-label на сторінці змін,
     де такі ж пари "Було:/Стало:" стоять під зміною категорії. */
  /* Шапка map.html має до восьми кнопок — помітно більше, ніж у мапи розділу,
     звідки взято map-common.css. Там .app-header має фіксовану висоту 44px
     (від неї рахується .workspace: calc(100vh - 44px)), а .header-left не
     переноситься, тож на ~900-1000px ліва група вилазила за свою коробку і
     накривала поле пошуку: кнопки «Розбіжності звірки» й «Експорт XLSX»
     ставали неклікабельними, хоч і були видимі.
     Тут висоту можна відпустити: map.html скролить увесь документ, жодна
     інша величина від неї не рахується. */
  .app-header { height: auto; min-height: 44px; flex-wrap: wrap; padding-top: 5px; padding-bottom: 5px; row-gap: 6px; }
  .header-left { flex-wrap: wrap; row-gap: 6px; }
  .mismatch-item { align-items: baseline; }
  /* Проміжна категорія без розбіжності: потрібна лише як ланка дерева, тож
     приглушена — око має чіплятись за справжні розбіжності. */
  .mismatch-item.node-ok { opacity: 0.55; font-weight: 400; }
  .crumb-lines { font-size: 0.76rem; color: var(--text-muted); line-height: 1.45; margin-top: 2px; }
  .crumb-lines .path-label { display: inline-block; min-width: 68px; font-weight: 600; color: var(--text-main); }
</style>
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="catalog-title">cncprom.ua</span>
      <button class="btn-theme-toggle catalog-subtitle-btn">🕒 Мапа сайту · ${generatedAt}</button>${orphanMenuButtonHtml}${mismatchMenuButtonHtml}${crumbMenuButtonHtml}${failedMenuButtonHtml}${errorsMenuButtonHtml}${xlsxButtonHtml}
    </div>
    <div class="header-center">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input type="text" id="search-input" class="header-search-input" placeholder="Пошук товарів, кодів, категорій...">
        <button id="btn-clear-search" class="btn-clear-search" data-tip="Очистити пошук (Esc)" style="display:none;">✕</button>
      </div>
    </div>
    <div class="header-right">
      <a href="reports/index.html" class="btn-theme-toggle" data-tip="Зміни каталогу за будь-який період: наявність, нові й видалені товари, категорії">📄 Diff-звіт</a>
      <button id="btn-scrape-log" class="btn-theme-toggle" data-tip="Переглянути output/site/scrape.log">📄 scrape.log</button>
      <button id="btn-map-log" class="btn-theme-toggle" data-tip="Переглянути output/site/map.log">📄 map.log</button>
      <button id="btn-help" class="btn-theme-toggle" data-tip="Пояснення до цифр і позначок на цій сторінці">❓ Довідка</button>
      <button id="btn-theme-toggle" class="btn-theme-toggle">
        <span class="theme-icon">🌙</span> <span class="theme-text">Темна</span>
      </button>
      <a href="https://cncprom.ua/ua/" class="link-site">cncprom.ua ↗</a>
    </div>
  </header>
${logPanelHtml('scrape-log-overlay', 'btn-scrape-log-close', `output/site/scrape.log`, scrapeLogContent)}
${logPanelHtml('map-log-overlay', 'btn-map-log-close', `output/site/map.log`, mapLogContent)}
${orphanPanelHtml}
${mismatchPanelHtml}
${crumbPanelHtml}
${failedPanelHtml}
${errorsPanelHtml}
  <div class="help-overlay" id="help-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Що означають ці цифри та позначки</h3>
        <button class="btn-help-close" id="btn-help-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <div class="help-term">
          <div class="help-term-label">Рівнів</div>
          <div class="help-term-desc">Кількість рівнів підкатегорій.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Товарів</div>
          <div class="help-term-desc">Усього товарів у категорії разом з усіма підкатегоріями.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">В наявності</div>
          <div class="help-term-desc">Перше число: кількість товарів зі статусом «Готово до відправки» за даними скрапера. Друге число: лічильник «В наявності» сайту. н/д: категорію ще не скраплено або дані застаріли.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Немає в наявності</div>
          <div class="help-term-desc">Скільки товарів зі статусом «Немає в наявності» за даними скрапера. Незалежного лічильника на сайті для цього нема.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Час оновлення</div>
          <div class="help-term-desc">Дата та час скрапінгу.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">✅ Актуально</div>
          <div class="help-term-desc">Мапа побудована на базі свіжих даних.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">⚠️ Застаріло</div>
          <div class="help-term-desc">Мапа побудована на базі застарілих даних.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">⏳ Немає даних</div>
          <div class="help-term-desc">Скрапер ще жодного разу не обробляв цю категорію.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">⚠️ Помилки прогону N</div>
          <div class="help-term-desc">Кнопка в шапці й значок ⚠️ у рядку категорії з'являються, коли під час останнього скрапінгу цієї категорії сталася помилка (наприклад, сторінка не завантажилась). Показують ті самі рядки, що й scrape.log. Дані могли зібратись частково — звіряйте з колонкою «В наявності».</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">⛔ Не оброблено N</div>
          <div class="help-term-desc">Кнопка в шапці з'являється лише тоді, коли скрапер не зміг прочитати сторінку якихось товарів навіть після повторної спроби. Відкриває їхній список за категоріями. Таких товарів немає на мапі й у звірці.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">⚠️ Розбіжності звірки</div>
          <div class="help-term-desc">Категорії, де кількість зібраних товарів «у наявності» не збіглася з власним лічильником сайту. Збіг має бути точним: прогін нічний, замовлень тоді немає. Лічильник сайту рахує всю гілку разом, тож розбіжність у підкатегорії повторюється і в її батьків — рядки зсунуті за рівнем вкладеності, причина в найглибшому. Блідим ідуть проміжні категорії без розбіжності, щоб дерево не мало розривів. Назва відкриває саме цей вузол на мапі.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">🧭 Не збігається з крихтами N</div>
          <div class="help-term-desc">Товари, у яких хлібні крихти на сторінці сайту ведуть в іншу гілку дерева, ніж та, де товар знайшов обхід. Якщо крихти вказують на батьківську чи дочірню категорію тієї самої гілки — це нормально (товар може стояти в кількох категоріях) і сюди не потрапляє.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">📊 Експорт XLSX</div>
          <div class="help-term-desc">Уся мапа категорій таблицею, без товарів: розділ, ID, назва, батько, рівень, кількість товарів, звірка з лічильником сайту. Рядки з ненульовою різницею підсвічені червоним.</div>
        </div>
      </div>
    </div>
  </div>
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
                <th style="text-align:center;" data-tip="Перше число: кількість товарів зі статусом «Готово до відправки» за даними скрапера.\nДруге число: лічильник «В наявності» сайту.\nн/д: категорію ще не скраплено або дані застаріли.">В наявності</th>
                <th style="width:78px;white-space:normal;text-align:center;vertical-align:middle;" data-tip="Скільки товарів зі статусом «Немає в наявності» за даними скрапера.\nНезалежного лічильника на сайті для цього нема.">Немає в наявності</th>
                <th style="text-align:center;" data-tip="Дата та час скрапінгу">Час оновлення</th>
                <th style="text-align:center;" data-tip="✅ Актуально\n⚠️ Застаріло\n⏳ Немає даних">Статус</th>
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
setupModalOverlay('scrape-log-overlay', 'btn-scrape-log', 'btn-scrape-log-close');
setupModalOverlay('map-log-overlay', 'btn-map-log', 'btn-map-log-close');
setupModalOverlay('help-overlay', 'btn-help', 'btn-help-close');
setupModalOverlay('orphan-overlay', 'btn-orphan-cats', 'btn-orphan-close');
setupModalOverlay('mismatch-overlay', 'btn-mismatch', 'btn-mismatch-close');
setupModalOverlay('crumbs-overlay', 'btn-crumbs', 'btn-crumbs-close');
setupModalOverlay('failed-overlay', 'btn-failed-urls', 'btn-failed-close');
setupModalOverlay('errors-overlay', 'btn-run-errors', 'btn-errors-close');
// Значки ⚠️ в рядках таблиці відкривають ту саму панель, що й кнопка в шапці.
Array.prototype.forEach.call(document.querySelectorAll('.run-error-badge'), function (b) {
  b.addEventListener('click', function () {
    var o = document.getElementById('errors-overlay');
    if (o) o.classList.add('open');
  });
});
setupTooltips();
initSiteSearch();
</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(DIR, "map.html"), html, "utf-8");

  // На GitHub Pages публікується САМА тека output/site/ (з 22.09.2026, раніше —
  // уся output/, і адреси мали зайве /site/). Тому:
  //   - index.html поруч із map.html: корінь https://map.cncprom.pp.ua/ веде на
  //     мапу, а не дає 404;
  //   - site/… — заглушки на місці старих адрес (…/site/map.html,
  //     …/site/<id>_map.html, …/site/reports/…), щоб збережені посилання не
  //     ламались. JS переносить ?from=&to= і #cat=<id> (meta-refresh їх губить),
  //     meta лишається запасним варіантом без JS.
  writeRedirect(path.join(DIR, 'index.html'), 'map.html');
  writeRedirect(path.join(DIR, 'site', 'map.html'), '../map.html');
  entries.forEach(e => writeRedirect(path.join(DIR, 'site', `${e.id}_map.html`), `../${e.id}_map.html`));
  writeRedirect(path.join(DIR, 'site', 'reports', 'index.html'), '../../reports/index.html');
  writeRedirect(path.join(DIR, 'site', 'reports', 'latest.html'), '../../reports/index.html');
}

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
  logLine(`СТАРТ build-maps: категорій ${categories.length}.`);

  const entries = [];
  const searchEntries = [];
  let renderFailures = 0;

  // Раніше результат buildRealMap() відкидався у всіх трьох місцях виклику:
  // якщо render-map.js падав, категорія все одно потрапляла в індекс як 'ok'
  // із зеленою ✅, а readSummary() підтягував цифри з ПОПЕРЕДНЬОГО прогону й
  // показував їх як свіжі. Тепер невдалий рендер дає ту саму заглушку й той
  // самий ⚠️, що й застарілі дані: стан, якого не видно, гірший за стан,
  // який видно.
  function pushBuilt(id, name, url) {
    if (buildRealMap(id)) {
      entries.push({ id, name, url, status: 'ok', ...readSummary(id), failed_urls: readFailedUrls(id) });
      searchEntries.push(...readSearchEntries(id));
      return;
    }
    renderFailures++;
    const reason = `render-map.js завершився з помилкою для категорії ${id} — мапу не згенеровано.`;
    console.error(`[${id}] ${name} — ПОМИЛКА РЕНДЕРУ. Заглушка замість мапи.`);
    logLine(`ПОМИЛКА: категорія ${id} (${name}) — render-map.js завершився з ненульовим кодом, заглушка замість мапи.`);
    writeStub(id, name, reason);
    entries.push({ id, name, url, status: 'stale', reason });
  }

  // Раніше тут була ціла система перевірки застарілості: дерево писалось у
  // кінці етапу 1, товари — у кінці етапу 2, і мапу можна було зібрати з
  // дерева одного прогону й товарів іншого. Звідси бралися еталонна категорія,
  // поріг у годинах і статус "застаріло". Тепер scrape-complete.js пише один
  // <id>_catalog.json одним записом у кінці прогону, тож лишилось два стани:
  // файл є (будуємо) або немає (заглушка).
  categories.forEach(cat => {
    const { id, name, url } = cat;

    if (!fs.existsSync(path.join(DIR, `${id}_catalog.json`))) {
      const reason = `Категорію ще не скрапили — запустіть: node scrape-complete.js "${url}"`;
      console.log(`[${id}] ${name} — ще не скрапилось. Заглушка замість мапи.`);
      writeStub(id, name, reason);
      entries.push({ id, name, url, status: 'not_scraped', reason });
      return;
    }

    console.log(`[${id}] ${name} — будуємо мапу.`);
    pushBuilt(id, name, url);
  });

  // Компактно (без відступів) — цей файл лише fetch-иться клієнтським JS,
  // людям його не читати; орієнтовний розмір — див. phase.md.
  fs.writeFileSync(path.join(DIR, "search-index.json"), JSON.stringify(searchEntries), "utf-8");

  // Експорт мапи категорій (без товарів) — кнопка "Експорт XLSX" на map.html.
  // Помилка тут не валить прогін: xlsx це зручність, а не результат, і нічний
  // конвеєр не має падати через неї. Кнопка з'являється лише коли файл
  // справді записався — інакше вона вела б у 404.
  let xlsxReady = false;
  try {
    const built = buildCatalogXlsx(entries);
    if (built) {
      await built.wb.xlsx.writeFile(path.join(DIR, XLSX_FILE));
      console.log(`Експорт збережено: ${XLSX_FILE} (${built.count} категорій).`);
      xlsxReady = true;
    }
  } catch (err) {
    console.error(`УВАГА: експорт XLSX пропущено — ${err.message}`);
    logLine(`ПОМИЛКА: експорт XLSX пропущено — ${err.message}`);
  }

  // map.log читається до фінального logLine нижче — тож знімок, вбудований у
  // цей map.html, не міститиме власного рядка "ФІНІШ" цього ж прогону
  // (з'явиться лише в наступному запуску build-maps.js). Це неминучий
  // порядок дій, а не недогляд: побудувати сторінку з рядком про завершення
  // до фактичного завершення неможливо.
  entries.forEach(e => { e.run_errors = readRunErrors(e.id); });

  const scrapeLogContent = readLogSafe(SCRAPE_LOG_FILE);
  const mapLogContent = readLogSafe(LOG_FILE);
  buildIndexPage(entries, scrapeLogContent, mapLogContent, xlsxReady);

  const notOk = entries.filter(e => e.status !== 'ok').length;
  console.log(`\nІндекс збережено: map.html (${entries.length} категорій).`);
  if (renderFailures > 0) {
    console.error(`УВАГА: категорій із помилкою рендеру: ${renderFailures} — у map.html вони позначені ⚠️.`);
  }
  console.log("Готово. Деталі рішень — у map.log.");
  // Свідомо БЕЗ ненульового коду виходу: часткова невдача не має валити крок
  // "Етап 3" у deploy-pages.yml, бо разом з ним зник би весь нічний результат
  // (знімок, diff, деплой) через одну категорію з 23. Сигналом лишається ⚠️
  // в самому індексі + рядок ПОМИЛКА в map.log, які видно там, де дивляться.
  logLine(`ФІНІШ build-maps: оброблено категорій ${categories.length}, без актуальної мапи ${notOk}` +
    (renderFailures > 0 ? `, з них помилок рендеру ${renderFailures}.` : `.`));
})();

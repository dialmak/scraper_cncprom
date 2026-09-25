
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { logLine: appendLog } = require('./lib/log');
const { escapeHtmlOuter } = require('./lib/html');
const { ICONS } = require('./lib/icons');
const { menuRow, helpMenuHtml, aboutPanelHtml, creditsPanelHtml, writeLogos } = require('./lib/help');
const { assetVer } = require('./lib/assets');
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
// Ім'я файла експорту несе дату збірки: його зберігають до себе, і без
// дати в назві вчорашня копія нічим не відрізняється від сьогоднішньої.
// Формат дати зібраний вручну, а не через toLocaleDateString: тут потрібна
// гарантовано DD.MM.YYYY, а локаль на раннері й на машині розробника
// може відрізнятись — а це вже ім'я файла, не підпис на сторінці.
const XLSX_PREFIX = "map_cncprom";
const BUILD_DATE = (d => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`)(new Date());
const XLSX_FILE = `${XLSX_PREFIX}_${BUILD_DATE}.xlsx`;

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
  return 'зібрано ' + collected + ', сайт ' + counter + ', різниця ' + (diff > 0 ? '+' : '') + diff;
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
  ws.getCell('A1').note = 'Аркуш захищений від сортування: порядок рядків і є деревом категорій.\n' +
    'Зняти: Рецензування → Зняти захист аркуша (пароля немає).\n' +
    'Докладно — на аркуші «Про файл».';
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
    ['Аркуш «Категорії» захищений від сортування.', true],
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
    ['Файл згенеровано автоматично: ' + BUILD_DATE, false],
    ['Актуальна версія й інтерактивна мапа: https://map.cncprom.pp.ua/', false]
  ];
  infoLines.forEach(([text, bold]) => {
    const row = info.addRow([text]);
    if (bold) row.font = { bold: true };
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
  return ` <button class="run-error-badge" data-tip="${n} ${n === 1 ? 'помилка' : 'помилок'} під час останнього скрапінгу цієї категорії — клік для списку">${ICONS.errors}</button>`;
}

function statusBadgeHtml(e) {
  if (e.status === 'ok') return '<span class="count-yes" data-tip="Актуально: мапа побудована на базі свіжих даних.">' + ICONS.ok + '</span>';
  if (e.status === 'not_scraped') return '<a href="' + e.id + '_map.html" class="stock-badge neutral" data-tip="Немає даних: скрапер ще жодного разу не обробляв цю категорію.">' + ICONS.nodata + '</a>';
  return '<a href="' + e.id + '_map.html" class="count-no" data-tip="Застаріло: мапа побудована на базі застарілих даних.">' + ICONS.stale + '</a>';
}

function buildIndexPage(entries, scrapeLogContent, mapLogContent, xlsxReady) {
  // Логотипи для панелі «Подяки»: зазвичай їх кладе render-map.js разом із
  // map-common.*, але коли жодна категорія ще не скраплена, він не запускається жодного разу.
  writeLogos(DIR);
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

  // "Товари поза категоріями" для ВСЬОГО сайту — той самий орфан-список, що й
  // кнопка/панель у кожній <id>_map.html (render-map.js), але зібраний по всіх
  // категоріях 1 рівня одразу. Джерело — поле orphan_categories, яке кожен
  // <id>_map.summary.json несе поряд з рештою globalStats (щоб не перечитувати
  // тут заново повне дерево кожної категорії). Є лише для 'ok' категорій
  // (readSummary дає дані тільки їм) — те саме обмеження, що й у колонок
  // Товарів/В наявності/Оновлено вище.
  //
  // Вигляд — те саме дерево, що й у панелі розбіжностей звірки (спільні
  // treeRows/treeRowHtml): категорія 1 рівня в заголовку групи, під нею вузли
  // з відступом за рівнем, пропущені ланки добудовуються блідим. Тут вони
  // справді потрібні: сироти розкидані по дереву, і на теперішніх даних п'ять
  // записів мають батька, якого в списку немає.
  //
  // Плоского списку з назвою "Категорія › Підкатегорія" в кожному рядку тут
  // свідомо немає: при 30+ записах на 23 категорії повторення назви батька
  // читалось як простирадло.
  //
  // ВАЖЛИВО: сирота може бути й самою категорією 1 рівня (own_products > 0
  // прямо на кореневому вузлі — те саме, що orphanCategories в render-map.js
  // рахує для будь-якого вузла дерева, корінь не виняток). Назву тоді не
  // повторюємо (вона вже в заголовку групи), а пишемо "Товари категорії, які
  // не входять до підкатегорій" — та сама фраза, що й у рядках зведення
  // render-map.js. Добудована ланка 1 рівня (без власних товарів) не
  // показується зовсім: заголовок групи її вже представляє.
  // Сума ТОВАРІВ (oc.own у кожному записі), а не кількість записів/категорій
  // у списку нижче — заголовок каже "Знайдені товари...", тож і число поруч
  // має бути кількістю товарів, а не кількістю орфан-категорій, які їх містять.
  const orphanGroups = sorted.filter(e => (e.orphan_categories || []).length > 0);
  const orphanTotal = orphanGroups.reduce((n, e) => n + e.orphan_categories.reduce((k, oc) => k + oc.own, 0), 0);
  const orphanMenuButtonHtml = orphanTotal === 0 ? '' : `
      <button id="btn-orphan-cats" class="btn-theme-toggle catalog-subtitle-btn" data-tip="Знайдені товари, які не входять до підкатегорій">${ICONS.orphans} Товари поза категоріями</button>`;
  const orphanPanelHtml = orphanTotal === 0 ? '' : `
  <div class="help-overlay" id="orphan-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Знайдені товари, які не входять до підкатегорій (${orphanTotal}):</h3>
        <button class="btn-help-close" id="btn-orphan-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">У дужках — скільки товарів лежить прямо в цій категорії, повз її підкатегорії. Блідим ідуть проміжні категорії без таких товарів: вони тут лише щоб дерево не мало розривів.<br>Натисніть назву, щоб відкрити цей вузол на мапі.</p>
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

  // "Не оброблено N" — товари, сторінку яких скрапер не зміг прочитати навіть
  // після повторного проходу (<id>_failed_urls.json). Такий товар відсутній у
  // CSV, тож на мапі й у звірці його просто не видно — ця кнопка єдине місце,
  // де він помітний. Та сама схема, що й "Товари поза категоріями": кнопка й
  // панель не рендеряться зовсім, коли невдач нема (звичайний стан).
  const failedGroups = sorted.filter(e => (e.failed_urls || []).length > 0);
  const failedTotal = failedGroups.reduce((n, e) => n + e.failed_urls.length, 0);
  const failedLabel = u => { try { return decodeURIComponent(new URL(u).pathname); } catch (e) { return u; } };
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
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">${ICONS.folder} ${escapeHtmlOuter(e.name)} <span class="node-count">(${e.failed_urls.length})</span></a>
            <div class="failed-url-list">${e.failed_urls.map(u =>
              '<a href="' + escapeHtmlOuter(u) + '" class="failed-url" target="_blank" rel="noopener">↗ ' + escapeHtmlOuter(failedLabel(u)) + '</a>'
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
            <a href="${escapeHtmlOuter(e.id)}_map.html" class="orphan-group-head">${ICONS.folder} ${escapeHtmlOuter(e.name)} <span class="node-count">(${e.run_errors.length})</span></a>
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
        <h3>Товари, де крихти сайту ведуть в іншу гілку (${crumbTotal}):</h3>
        <button class="btn-help-close" id="btn-crumbs-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Для кожного товару скрапер читає хлібні крихти з його сторінки на сайті й порівнює з категорією, до якої відніс товар обхід дерева. Тут лише випадок «зовсім інша гілка»: якщо крихти вказують на батьківську чи дочірню категорію тієї самої гілки, це нормально — товар може стояти в кількох категоріях, а крихти показують лише головну.</p>
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
        <h3>Товари, у крихтах яких немає категорії (${crumbUnknownTotal}):</h3>
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

  // ---- Дві панелі-хаби замість шести кнопок у шапці (25.09.2026) ----
  // До того кожна діагностика мала власну кнопку, яка з'являлась лише при
  // ненульовому значенні: шапка росла до 14 елементів у погану ніч, а в тиху
  // не можна було 0432ідрізнити "перевірили, все добре" від "не перевіряли".
  // Тепер це два рядкових списки, де нуль — це результат ("0 · чисто"), а не
  // порожнеча. Самі панелі зі списками лишились як були — рядок лише веде до них.
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  // Коли перевірка нічого не знайшла, рядок каже "немає" у колонці дії,
  // а колонка числа лишається порожньою: нуль поруч із "немає" сказав би те саме
  // двічі (так само до 25.09.2026 було зі словом "чисто").
  // tip може бути порожнім: для логів підказка лише повторювала б назву
  // рядка, а шляхи до файлів тепер у Довідці.
  // unit: '' — число без одиниці, null — числа не показувати взагалі. Так
  // зроблено для розбіжностей звірки: там це кількість ВУЗЛІВ, а не розмір
  // розбіжності, і читається не тим, чим є — саме тому ці числа вже
  // прибирали з самої панелі 24.09.2026.
  const checkRow = (icon, name, tip, count, unit, overlayId) => `
          <div class="check-row">
            <span>${icon}</span><span class="nm"${tip ? ` data-tip="${escapeHtmlOuter(tip)}"` : ''}>${escapeHtmlOuter(name)}</span>
            <span class="val ${count > 0 ? 'bad' : 'ok'}">${count > 0 && unit !== null ? count + (unit ? ' ' + unit : '') : ''}</span>
            ${count > 0
              ? `<button class="act" data-open="${overlayId}">відкрити</button>`
              : '<span class="act none">немає</span>'}
          </div>`;
  // Розмітка рядка без числа — спільна з меню «Довідка» (lib/help.js).
  const logRow = (name, tip, overlayId) => menuRow(ICONS.log, name, overlayId, tip);

  const reportMenuButtonHtml = `
      <div class="hdr-menu">
        <button id="btn-report" class="btn-theme-toggle hdr-menu-btn" data-tip="Результат роботи скрапера">${ICONS.report} Звіт скрапера</button>
        <div class="hdr-dropdown right" id="report-dropdown">
          <h3>Звіт про роботу скрапера:</h3>
          <div>${checkRow(ICONS.errors, 'Помилки', 'Помилки скрапінгу', errorTotal, '', 'errors-overlay')}${checkRow(ICONS.failed, 'Не оброблено', 'Товари, сторінку яких скрапер не зміг прочитати', failedTotal, '', 'failed-overlay')}${logRow('Лог скрапінгу', '', 'scrape-log-overlay')}${logRow('Лог збірки', '', 'map-log-overlay')}
          </div>
        </div>
      </div>`;

  // Лічильник на кнопці — скільки ЗВІРОК із трьох щось знайшли, а не
  // сума знайденого: сума змішувала б вузли з товарами. Коли все чисто,
  // значка немає зовсім — червоний «0» читався б як проблема.
  const checksProblems = [mismatchTotal, crumbTotal, crumbUnknownTotal].filter(n => n > 0).length;
  const checksMenuButtonHtml = `
      <div class="hdr-menu">
        <button id="btn-checks" class="btn-theme-toggle catalog-subtitle-btn hdr-menu-btn" data-tip="Звірка того, що зібрав скрапер, із тим, що є на сайті">${ICONS.checks} Звірки${checksProblems > 0 ? ` <span class="badge-count">${checksProblems}</span>` : ''}</button>
        <div class="hdr-dropdown" id="checks-dropdown">
          <h3>Звірка скрапера з даними сайту:</h3>
          <div>${checkRow(ICONS.mismatch, 'Розбіжності звірки', 'Розбіжності звірки «Готово до відправки» з лічильником сайту «В наявності»', mismatchTotal, null, 'mismatch-overlay')}${checkRow(ICONS.crumbs, 'Не збігається з крихтами', 'Хлібні крихти товару ведуть в іншу гілку, ніж та, де його знайшов скрапер', crumbTotal, plural(crumbTotal, 'товар', 'товари', 'товарів'), 'crumbs-overlay')}${checkRow(ICONS.crumbs, 'Крихти без категорії', 'У хлібних крихтах товару немає жодної категорії', crumbUnknownTotal, plural(crumbUnknownTotal, 'товар', 'товари', 'товарів'), 'crumbs-unknown-overlay')}
          </div>
        </div>
      </div>`;

  // Посилання на експорт — звичайний <a download>, а не панель: тут нема чого
  // показувати, є що завантажити. Не рендериться, якщо файл не записався.
  const xlsxButtonHtml = xlsxReady ? `
      <a href="${XLSX_FILE}" download class="btn-theme-toggle catalog-subtitle-btn" data-tip="Завантажити мапу категорій у форматі XLSX">${ICONS.export} Експорт</a>` : '';

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

  // Підпис у шапці — годинник і дата, без слів ("🕒 Мапа сайту · ..." до
  // 25.09.2026): що це за дата, каже підказка "Дата та час скрапінгу".
  // Це саме скрапінг — найсвіжіший scraped_at серед категорій, а не момент
  // збірки сторінки, як було до 25.09.2026: після нічного прогону ці два часи
  // розходяться на хвилини, але після ручної перебудови (rebuild_only) різниця
  // — ціла доба, і підпис брехав би про свіжість даних. Формат scraped_at готовий
  // рядок "ДД.ММ.РРРР ГГ:ХХ" (його ж показує колонка "Дата та час"), тож для
  // порівняння його треба розібрати — лексикографічно такі рядки не сортуються.
  const parseStamp = t => {
    const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(t || '');
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : null;
  };
  const stamps = sorted.map(e => parseStamp(e.scraped_at)).filter(Boolean);
  const latestDate = stamps.length ? new Date(Math.max(...stamps)) : new Date();
  const generatedAt = latestDate.toLocaleDateString('uk-UA') + ' ' +
    latestDate.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

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
  /* Два рядки під товаром у панелі крихт: куди його відніс обхід і що каже
     сайт. Підпис ліворуч — того ж тону, що й .path-label на сторінці змін,
     де такі ж пари "Було:/Стало:" стоять під зміною категорії. */
  /* Шапка map.html має до восьми кнопок — помітно більше, ніж у мапи розділу,
     звідки взято map-common.css. Там .app-header має фіксовану висоту 44px
     (від неї рахується .workspace: calc(100vh - 44px)), а .header-left не
     переноситься, тож на ~900-1000px ліва група вилазила за свою коробку і
     накривала поле пошуку: кнопки «Розбіжності звірки» й «Експорт»
     ставали неклікабельними, хоч і були видимі.
     Тут висоту можна відпустити: map.html скролить увесь документ, жодна
     інша величина від неї не рахується. */
  .app-header { height: auto; min-height: 44px; flex-wrap: wrap; padding-top: 5px; padding-bottom: 5px; row-gap: 6px; }
  .header-left { flex-wrap: wrap; row-gap: 6px; }
  /* Стилі меню-дропдаунів (.hdr-menu, .hdr-dropdown, .check-row, .badge-count)
     лежать у map-common.css: таке саме меню є й на мапі розділу, і на
     сторінці історії змін, тож вигляд має бути один на три сторінки. */
  .crumb-lines { font-size: 0.76rem; color: var(--text-muted); line-height: 1.45; margin-top: 2px; }
  .crumb-lines .path-label { display: inline-block; min-width: 68px; font-weight: 600; color: var(--text-main); }
</style>
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="catalog-title">cncprom.ua</span>
      <button class="btn-theme-toggle catalog-subtitle-btn" data-tip="Дата та час скрапінгу">${ICONS.updated} ${generatedAt}</button>${checksMenuButtonHtml}${orphanMenuButtonHtml}${xlsxButtonHtml}
    </div>
    <div class="header-center">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input type="text" id="search-input" class="header-search-input" placeholder="Пошук товарів, кодів, категорій...">
        <button id="btn-clear-search" class="btn-clear-search" data-tip="Очистити пошук (Esc)" style="display:none;">✕</button>
      </div>
    </div>
    <div class="header-right">
      <a href="reports/index.html" class="btn-theme-toggle" data-tip="Зміни каталогу за будь-який період: наявність, нові й видалені товари, категорії">${ICONS.history} Історія змін</a>
${reportMenuButtonHtml}
${helpMenuHtml('Пояснення до цифр і позначок на цій сторінці')}
      <button id="btn-theme-toggle" class="btn-theme-toggle">
        <span class="theme-icon">🌙</span> <span class="theme-text">Темна</span>
      </button>
      <a href="https://cncprom.ua/ua/" class="link-site" target="_blank" rel="noopener">cncprom.ua ↗</a>
    </div>
  </header>
${logPanelHtml('scrape-log-overlay', 'btn-scrape-log-close', `output/site/scrape.log`, scrapeLogContent)}
${logPanelHtml('map-log-overlay', 'btn-map-log-close', `output/site/map.log`, mapLogContent)}
${orphanPanelHtml}
${mismatchPanelHtml}
${crumbPanelHtml}
${crumbUnknownPanelHtml}
${failedPanelHtml}
${errorsPanelHtml}
${aboutPanelHtml()}${creditsPanelHtml()}
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
          <div class="help-term-label">Дата та час</div>
          <div class="help-term-desc">Коли скрапер обійшов цю категорію. Годинник у шапці показує найсвіжіший із цих часів — категорії скрапляться чергою, тож між першою й останньою — кілька годин.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.ok} Актуально</div>
          <div class="help-term-desc">Мапа побудована на базі свіжих даних.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.stale} Застаріло</div>
          <div class="help-term-desc">Мапа побудована на базі застарілих даних.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.nodata} Немає даних</div>
          <div class="help-term-desc">Скрапер ще жодного разу не обробляв цю категорію.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.report} Звіт скрапера</div>
          <div class="help-term-desc">Як відпрацював останній прогін: помилки, товари, які не вдалося обробити, і повні логи скрапінгу й збірки мап. Нуль поруч із рядком не порожнеча, а результат: перевірка відпрацювала й нічого не знайшла. Категорія з помилками має ще й значок ${ICONS.errors} у своєму рядку таблиці.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.errors} Помилки</div>
          <div class="help-term-desc">Рядок у «Звіті скрапера»: скільки разів під час останнього скрапінгу щось пішло не так (наприклад, сторінка не завантажилась). Ті самі рядки ПОМИЛКА, що й у лозі скрапінгу. Дані категорії при цьому могли зібратись частково — звіряйте з колонкою «В наявності». Така категорія має ще й значок ${ICONS.errors} у своєму рядку таблиці.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.failed} Не оброблено</div>
          <div class="help-term-desc">Рядок у «Звіті скрапера»: товари, сторінку яких скрапер не зміг прочитати навіть після повторної спроби. Їх немає на мапі, у пошуку й у звірці з лічильником сайту. Зазвичай це короткий збій сайту — наступний нічний прогін їх підхопить.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.log} Лог скрапінгу · ${ICONS.log} Лог збірки</div>
          <div class="help-term-desc">Два рядки в кінці «Звіту скрапера»: повний вміст файлів output/site/scrape.log і output/site/map.log як є. Перший пише скрапер під час обходу сайту, другий — збірка самих цих сторінок.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.checks} Звірки</div>
          <div class="help-term-desc">Звірка того, що зібрав скрапер, із тим, що є на сайті: розбіжності з лічильником «В наявності» і два випадки з хлібними крихтами. Значок на кнопці каже, скільки звірок із трьох щось знайшли, а не скільки всього знайдено.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.mismatch} Розбіжності звірки</div>
          <div class="help-term-desc">Категорії, де кількість зібраних товарів «у наявності» не збіглася з власним лічильником сайту. Збіг має бути точним: прогін нічний, замовлень тоді немає. Лічильник сайту рахує всю гілку разом, тож розбіжність у підкатегорії повторюється і в її батьків — рядки зсунуті за рівнем вкладеності, причина в найглибшому. Блідим ідуть проміжні категорії без розбіжності, щоб дерево не мало розривів. Назва відкриває саме цей вузол на мапі.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.crumbs} Не збігається з крихтами</div>
          <div class="help-term-desc">Товари, у яких хлібні крихти на сторінці сайту ведуть в іншу гілку дерева, ніж та, де товар знайшов обхід. Якщо крихти вказують на батьківську чи дочірню категорію тієї самої гілки — це нормально (товар може стояти в кількох категоріях) і сюди не потрапляє.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.crumbs} Крихти без категорії</div>
          <div class="help-term-desc">Товари, у крихтах яких сайт не називає жодної категорії: у ланцюгу лише «Товари та послуги» і сам товар. Скрапер відніс їх за сторінкою категорії, де знайшов, але підтвердити це з боку сайту нема чим. Це не помилка й не розбіжність: просто другої думки немає.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">${ICONS.export} Експорт</div>
          <div class="help-term-desc">Уся мапа категорій таблицею XLSX — лише назви, без товарів. Дерево зібране стовпцями: рівень 1 у A, рівень 2 в B і так далі; гілки згортаються кнопками [+]/[−] зліва. Аркуш захищений від сортування та редагування — перестановка рядків розірвала б дерево; як зняти, написано на аркуші «Про файл» у самому файлі.</div>
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
setupModalOverlay('orphan-overlay', 'btn-orphan-cats', 'btn-orphan-close');
// У цих панелей більше немає власної кнопки в шапці — їх відкриває рядок
// хаба (обробник нижче). setupModalOverlay все одно потрібен: він вішає хрестик,
// Esc і клік поза панеллю, а відсутню кнопку-відкривач терпить (if (openBtn)).
setupModalOverlay('scrape-log-overlay', null, 'btn-scrape-log-close');
setupModalOverlay('map-log-overlay', null, 'btn-map-log-close');
setupModalOverlay('mismatch-overlay', null, 'btn-mismatch-close');
setupModalOverlay('crumbs-overlay', null, 'btn-crumbs-close');
setupModalOverlay('crumbs-unknown-overlay', null, 'btn-crumbs-unknown-close');
setupModalOverlay('failed-overlay', null, 'btn-failed-close');
setupModalOverlay('errors-overlay', null, 'btn-errors-close');
setupModalOverlay('help-overlay', null, 'btn-help-close');
setupModalOverlay('about-overlay', null, 'btn-about-close');
setupModalOverlay('credits-overlay', null, 'btn-credits-close');
// Дропдауни шапки й обробник [data-open] — спільні для трьох сторінок,
// живуть у map-common.js (див. initHeaderMenus у render-map.js).
initHeaderMenus();
// Значки помилок в рядках таблиці відкривають ту саму панель, що й кнопка в шапці.
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

  // Експорт мапи категорій (без товарів) — кнопка "Експорт" на map.html.
  // Помилка тут не валить прогін: xlsx це зручність, а не результат, і нічний
  // конвеєр не має падати через неї. Кнопка з'являється лише коли файл
  // справді записався — інакше вона вела б у 404.
  let xlsxReady = false;
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

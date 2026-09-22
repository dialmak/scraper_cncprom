// build-maps.js — пакетно генерує мапи (render-map.js) для всіх категорій
// 1 рівня одразу, замість того щоб запускати render-map.js вручну по одній.
// Повний список категорій береться з output/site/categories-site.csv (пише
// discover-categories.js), а не зі сканування output/site/ на вже наявні
// <ID>_category_map.json — інакше категорія, яку ще жодного разу не
// скрапили, просто не з'явилась би в результаті.
//
// ПРИМІТКА про MAP_SUBDIR/output/new/: шлях DIR нижче параметризований так
// само, як у render-map.js (щоб обидва скрипти дивились в один і той самий
// output/<site|new>/ без розсинхрону), але сама логіка нижче — читання
// categories-site.csv, звірка REFERENCE_ID на "застарілість" json/csv — існує
// ТІЛЬКИ для реального сайту (це про часовий розрив між ЕТАП 1/ЕТАП 2
// scrape-complete.js, якого в майбутньому output/new/ просто не буде — там
// json+csv писатиме один атомарний скрипт, build-custom-tree.js, за один
// прохід). Тобто MAP_SUBDIR=new build-maps.js поки НЕ запрацює сам собою —
// це свідомо відкладено до появи build-custom-tree.js й вирішення, звідки
// для output/new/ брати аналог "списку категорій 1 рівня".
//
// Перед побудовою мапи кожна категорія звіряється на "застарілість" —
// розрив у часі між її <ID>_category_map.json (пише ЕТАП 1 scrape-complete.js)
// і <ID>_cncprom_complete.csv (пише ЕТАП 2) відносно такого самого розриву в
// еталонній категорії (REFERENCE_ID нижче). Занадто великий розрив означає,
// що json і csv, найімовірніше, належать різним прогонам — така категорія
// отримує заглушку (<ID>_map.html з поясненням причини й готовою командою
// для повторного скрапінгу), а не мапу з завідомо неузгодженими даними.
// Категорія, яку взагалі ще не скрапили, отримує таку саму заглушку.
//
// Використання:
//   node build-maps.js
//
// Результат (усе в output/<site|new>/, поруч зі скриптами):
// - <ID>_map.html для кожної категорії — реальна мапа (render-map.js) або
//   заглушка, залежно від стану вище;
// - map.html — індексна сторінка зі списком усіх категорій 1 рівня,
//   посиланнями на кожну мапу, кількостями товарів/реконсиляцією і
//   статусом (✅ збігається / ⚠️ розбіжність / "⏳ Немає даних");
// - map.log — доповнюється (як scrape.log) рішенням по кожній категорії.
//
// Передумова: категорія REFERENCE_ID має бути вже хоч раз проскрапена
// (інакше нема з чим звіряти розрив json/csv для решти) — інакше скрипт
// одразу завершується з помилкою.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ==================== НАЛАШТУВАННЯ ====================
// Еталонна категорія — з неї починається побудова мап; її розрив між
// <ID>_category_map.json і <ID>_cncprom_complete.csv (нормально — секунди/
// хвилини, стільки триває сама ЕТАП 2 всередині одного прогону) є базою
// порівняння для решти категорій.
const REFERENCE_ID = "1022837"; // Драйвери крокового двигуна
const STALE_THRESHOLD_HOURS = 5;
// ROOT_DIR — де лежать самі скрипти (render-map.js викликається звідси);
// DIR — де лежать усі згенеровані файли (output/<site|new>/), включно з тими,
// що пише цей скрипт (map.html, map.log). Розділені навмисно: колись усе
// писалось прямо в ROOT_DIR, тепер лише в output/ — не плутати одне з одним.
// MAP_SUBDIR — той самий перемикач, що й у render-map.js (див. примітку про
// output/new/ на початку файлу); дефолт "site" зберігає поточну поведінку.
const ROOT_DIR = __dirname;
const MAP_SUBDIR = process.env.MAP_SUBDIR || 'site';
// IS_SITE_MODE вимикає весь блок "еталон + розрив json/csv" нижче для
// MAP_SUBDIR=new (Фаза 5, build-custom-tree.js) — там json і csv завжди
// пишуться одним атомарним синхронним проходом, тож розриву, який ця логіка
// виявляє, там структурно не може виникнути; звірятись немає з чим і не
// проти чого.
const IS_SITE_MODE = MAP_SUBDIR === 'site';
const DIR = path.join(ROOT_DIR, 'output', MAP_SUBDIR);
const LOG_FILE = path.join(DIR, "map.log");
const SCRAPE_LOG_FILE = path.join(DIR, "scrape.log");
const CSV_FILE = path.join(DIR, "categories-site.csv");

// ==================== ЛОГ (map.log — доповнюється, як scrape.log) ====================
function nowStr() {
  const d = new Date();
  return d.toLocaleDateString('uk-UA') + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function logLine(text) {
  try { fs.appendFileSync(LOG_FILE, `[${nowStr()}] ${text}\n`, "utf-8"); } catch (e) { /* лог не критичний */ }
}

// ==================== ЧИТАННЯ categories-site.csv ====================
// Той самий парсер (роздільник ";", лапки подвоюються), що й у render-map.js /
// scrape-all-categories.js — формат CSV в проєкті скрізь однаковий. Це
// джерело істини щодо ПОВНОГО списку категорій 1 рівня (а не сканування
// output/ на вже наявні <id>_category_map.json — той спосіб бачив лише
// категорії, які вже хоч раз скрапились, і "губив" усі решта).
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
  if (!fs.existsSync(CSV_FILE)) return null;
  const rows = parseCsv(fs.readFileSync(CSV_FILE, "utf-8"));
  return rows.map(r => ({ id: r.categoryId, name: r.categoryName, url: r.categoryUrl }));
}

// ==================== ІНШІ ДОПОМІЖНІ ФУНКЦІЇ ====================
function mtimeHours(filePath) {
  return fs.statSync(filePath).mtimeMs / 3600000; // мс -> год
}

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
  // render-map.js тепер приймає лише ID — сам шукає <id>_category_map.json /
  // <id>_cncprom_complete.csv в своєму output/<MAP_SUBDIR>/ (той самий DIR,
  // обчислений від __dirname render-map.js, який лежить у ROOT_DIR поруч з
  // цим скриптом) — MAP_SUBDIR передається через env, щоб обидва скрипти
  // дивились в одну й ту саму підпапку, а не розсинхронізувались.
  const res = spawnSync("node", ["render-map.js", id], { cwd: ROOT_DIR, stdio: "inherit", env: { ...process.env, MAP_SUBDIR } });
  return res.status === 0;
}

function readSummary(id) {
  const p = path.join(DIR, `${id}_map.summary.json`);
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (e) { return null; }
}

// Фаза 4 (search-index.json): кожен <id>_search.json (пише render-map.js,
// лише для 'ok' категорій — той самий виняток, що й у readSummary/
// orphan_categories вище, бо тільки вони реально отримали buildRealMap) просто
// конкатенується в один файл — сама структура запису (code/name/url/
// availability/categoryId/categoryName/topId/topName) уже самодостатня, тут
// нема чого агрегувати чи перераховувати.
function readSearchEntries(id) {
  const p = path.join(DIR, `${id}_search.json`);
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (e) { return []; }
}

// <id>_failed_urls.json пише scrape-complete.js лише коли після повторного
// проходу етапу 2 лишились товари без даних (і видаляє, коли таких нема), тож
// файл завжди відповідає поточному CSV. Читаємо лише для 'ok' — як readSummary.
function readFailedUrls(id) {
  const p = path.join(DIR, `${id}_failed_urls.json`);
  try { const list = JSON.parse(fs.readFileSync(p, "utf-8")); return Array.isArray(list) ? list : []; } catch (e) { return []; }
}

function escapeHtmlOuter(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
function statusBadgeHtml(e) {
  if (e.status === 'ok') return '<span class="count-yes" data-tip="Актуально: мапа побудована на базі свіжих даних.">✅</span>';
  if (e.status === 'not_scraped') return '<a href="' + e.id + '_map.html" class="stock-badge neutral" data-tip="Немає даних: скрапер ще жодного разу не обробляв цю категорію.">⏳</a>';
  return '<a href="' + e.id + '_map.html" class="count-no" data-tip="Застаріло: мапа побудована на базі застарілих даних.">⚠️</a>';
}

function buildIndexPage(entries, scrapeLogContent, mapLogContent) {
  const sorted = [...entries].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk'));
  const rows = sorted.map((e, i) => `
            <tr>
              <td class="col-n">${i + 1}</td>
              <td><a href="${e.id}_map.html" target="_blank" rel="noopener noreferrer" class="fw-cat-link">${escapeHtmlOuter(e.name || e.id)}</a></td>
              <td style="text-align:center;">${e.levels ?? '—'}</td>
              <td style="text-align:center;" class="fw-count-cell">${e.total_products ?? '—'}</td>
              <td style="text-align:center;">${diffBadgeHtml(e)}</td>
              <td style="text-align:center;">${e.total_no !== undefined && e.total_no !== null ? `<span class="count-no">${e.total_no}</span>` : '—'}</td>
              <td style="text-align:center;">${escapeHtmlOuter(e.scraped_at || '—')}</td>
              <td style="text-align:center;">${statusBadgeHtml(e)}</td>
              <td style="text-align:center;vertical-align:middle;">${e.url ? `<a href="${escapeHtmlOuter(e.url)}" target="_blank" rel="noopener noreferrer" class="link-site">↗</a>` : '—'}</td>
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
            <a href="${escapeHtmlOuter(g.topId)}_map.html" target="_blank" rel="noopener noreferrer" class="orphan-group-head">📁 ${escapeHtmlOuter(g.topName)}</a>
            <div class="orphan-cat-list">${g.items.map(oc =>
              '<a href="' + escapeHtmlOuter(g.topId) + '_map.html" target="_blank" rel="noopener noreferrer" class="cat-found-badge">' +
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
            <a href="${escapeHtmlOuter(e.id)}_map.html" target="_blank" rel="noopener noreferrer" class="orphan-group-head">📁 ${escapeHtmlOuter(e.name)} <span class="node-count">(${e.failed_urls.length})</span></a>
            <div class="failed-url-list">${e.failed_urls.map(u =>
              '<a href="' + escapeHtmlOuter(u) + '" target="_blank" rel="noopener noreferrer" class="failed-url">↗ ' + escapeHtmlOuter(failedLabel(u)) + '</a>'
            ).join('')}</div>
          </div>`).join('')}</div>
      </div>
    </div>
  </div>`;

  // Повний вміст логів вбудовується прямо в сторінку (як CATALOG_DATA в
  // map_<id>.html) — map.html статична, живого сервера, з якого можна було б
  // підвантажити файл за запитом, тут нема. scrape.log/map.log — append-only
  // і ростуть необмежено з кожним прогоном; поки що це не проблема (кілька
  // КБ), але якщо колись виростуть до сотень КБ — варто буде показувати лише
  // хвіст, а не вміст цілком.
  const logPanelHtml = (overlayId, closeBtnId, title, content) => `
  <div class="help-overlay" id="${overlayId}">
    <div class="help-panel" style="max-width:900px;">
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
</style>
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="catalog-title">cncprom.ua</span>
      <button class="btn-theme-toggle catalog-subtitle-btn">🕒 Мапа сайту · ${generatedAt}</button>${orphanMenuButtonHtml}${failedMenuButtonHtml}
    </div>
    <div class="header-center">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input type="text" id="search-input" class="header-search-input" placeholder="Пошук товарів, кодів, категорій...">
        <button id="btn-clear-search" class="btn-clear-search" data-tip="Очистити пошук (Esc)" style="display:none;">✕</button>
      </div>
    </div>
    <div class="header-right">${IS_SITE_MODE ? `
      <a href="reports/index.html" target="_blank" rel="noopener noreferrer" class="btn-theme-toggle" data-tip="Зміни каталогу за будь-який період: наявність, нові й видалені товари, категорії">📄 Diff-звіт</a>` : ''}
      <button id="btn-scrape-log" class="btn-theme-toggle" data-tip="Переглянути output/${MAP_SUBDIR}/scrape.log">📄 scrape.log</button>
      <button id="btn-map-log" class="btn-theme-toggle" data-tip="Переглянути output/${MAP_SUBDIR}/map.log">📄 map.log</button>
      <button id="btn-help" class="btn-theme-toggle" data-tip="Пояснення до цифр і позначок на цій сторінці">❓ Довідка</button>
      <button id="btn-theme-toggle" class="btn-theme-toggle">
        <span class="theme-icon">🌙</span> <span class="theme-text">Темна</span>
      </button>
      <a href="https://cncprom.ua/ua/" target="_blank" rel="noopener noreferrer" class="link-site">cncprom.ua ↗</a>
    </div>
  </header>
${logPanelHtml('scrape-log-overlay', 'btn-scrape-log-close', `output/${MAP_SUBDIR}/scrape.log`, scrapeLogContent)}
${logPanelHtml('map-log-overlay', 'btn-map-log-close', `output/${MAP_SUBDIR}/map.log`, mapLogContent)}
${orphanPanelHtml}
${failedPanelHtml}
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
          <div class="help-term-label">⛔ Не оброблено N</div>
          <div class="help-term-desc">Кнопка в шапці з'являється лише тоді, коли скрапер не зміг прочитати сторінку якихось товарів навіть після повторної спроби. Відкриває їхній список за категоріями. Таких товарів немає на мапі й у звірці.</div>
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
setupModalOverlay('failed-overlay', 'btn-failed-urls', 'btn-failed-close');
setupTooltips();
initSiteSearch();
</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(DIR, "map.html"), html, "utf-8");
}

// ==================== ГОЛОВНА ЛОГІКА ====================
(() => {
  const categories = readCategoriesFromCsv();

  if (!categories || categories.length === 0) {
    console.error(`Файл не знайдено або порожній: ${CSV_FILE}`);
    console.error('Спершу запустіть: node discover-categories.js');
    process.exit(1);
  }

  let refGapHours = 0;
  if (IS_SITE_MODE) {
    const refJsonPath = path.join(DIR, `${REFERENCE_ID}_category_map.json`);
    if (!fs.existsSync(refJsonPath)) {
      console.error(`Еталонна категорія ${REFERENCE_ID} ще не відскрапована (немає ${REFERENCE_ID}_category_map.json) — зупинка.`);
      console.error(`Запустіть: node scrape-complete.js "https://cncprom.ua/ua/g${REFERENCE_ID}-drajvery-shagovogo-dvigatelya"`);
      logLine(`ПОМИЛКА: еталонна категорія ${REFERENCE_ID} ще не відскрапована, побудова мап скасована.`);
      process.exit(1);
    }

    // Гарантуємо, що еталон обробляється першим
    categories.sort((a, b) => (a.id === REFERENCE_ID ? -1 : b.id === REFERENCE_ID ? 1 : 0));

    const refCsvPath = path.join(DIR, `${REFERENCE_ID}_cncprom_complete.csv`);
    refGapHours = fs.existsSync(refCsvPath)
      ? Math.abs(mtimeHours(refCsvPath) - mtimeHours(refJsonPath))
      : 0;

    console.log(`Категорій 1 рівня в ${path.basename(CSV_FILE)}: ${categories.length}`);
    console.log(`Еталон: ${REFERENCE_ID} (розрив json/csv: ${refGapHours.toFixed(2)} год)`);
    logLine(`СТАРТ build-maps: категорій ${categories.length}, еталон ${REFERENCE_ID}, розрив ${refGapHours.toFixed(2)} год, поріг ${STALE_THRESHOLD_HOURS} год.`);
  } else {
    console.log(`Категорій 1 рівня в ${path.basename(CSV_FILE)}: ${categories.length} (MAP_SUBDIR=${MAP_SUBDIR}, без перевірки застарілості — див. IS_SITE_MODE).`);
    logLine(`СТАРТ build-maps (${MAP_SUBDIR}): категорій ${categories.length}.`);
  }

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

  categories.forEach(cat => {
    const { id, name, url } = cat;
    const jsonPath = path.join(DIR, `${id}_category_map.json`);
    const csvPath = path.join(DIR, `${id}_cncprom_complete.csv`);

    if (IS_SITE_MODE && id === REFERENCE_ID) {
      console.log(`[${id}] ${name} — еталон, будуємо повну мапу.`);
      pushBuilt(id, name, url);
      return;
    }

    if (!fs.existsSync(jsonPath)) {
      const reason = IS_SITE_MODE
        ? `Категорію ще не скрапили — запустіть: node scrape-complete.js "${url}"`
        : `Категорії нема в output/${MAP_SUBDIR}/ — запустіть: node build-custom-tree.js`;
      console.log(`[${id}] ${name} — ще не скрапилось. Заглушка замість мапи.`);
      writeStub(id, name, reason);
      entries.push({ id, name, url, status: 'not_scraped', reason });
      return;
    }

    // Поза MAP_SUBDIR=site (Фаза 5, build-custom-tree.js) json+csv завжди
    // пишуться разом, атомарно — жодної перевірки розриву/застарілості не
    // потрібно, наявність json уже означає "готово, будуємо мапу".
    if (!IS_SITE_MODE) {
      console.log(`[${id}] ${name} — будуємо повну мапу.`);
      pushBuilt(id, name, url);
      return;
    }

    if (!fs.existsSync(csvPath)) {
      const reason = `${id}_cncprom_complete.csv відсутній (збір товарів ще не завершено) — дані неповні.`;
      console.warn(`[${id}] ${name} — ${reason} Заглушка замість мапи.`);
      logLine(`Категорія ${id} (${name}) пропущена: ${reason}`);
      writeStub(id, name, reason);
      entries.push({ id, name, url, status: 'stale', reason });
      return;
    }

    const gapHours = Math.abs(mtimeHours(csvPath) - mtimeHours(jsonPath));
    const diffFromRef = gapHours - refGapHours;

    if (diffFromRef > STALE_THRESHOLD_HOURS) {
      const reason = `розрив між ${id}_category_map.json і ${id}_cncprom_complete.csv = ${gapHours.toFixed(2)} год — ` +
        `на ${diffFromRef.toFixed(2)} год більше, ніж у еталона ${REFERENCE_ID} (${refGapHours.toFixed(2)} год).`;
      console.warn(`[${id}] ${name} — ЗАСТАРІЛІ ДАНІ: ${reason}`);
      logLine(`Категорія ${id} (${name}) пропущена: ${reason}`);
      writeStub(id, name, reason);
      entries.push({ id, name, url, status: 'stale', reason });
    } else {
      console.log(`[${id}] ${name} — свіжі дані (розрив ${gapHours.toFixed(2)} год), будуємо повну мапу.`);
      pushBuilt(id, name, url);
    }
  });

  // Компактно (без відступів) — цей файл лише fetch-иться клієнтським JS,
  // людям його не читати; орієнтовний розмір — див. phase.md.
  fs.writeFileSync(path.join(DIR, "search-index.json"), JSON.stringify(searchEntries), "utf-8");

  // map.log читається до фінального logLine нижче — тож знімок, вбудований у
  // цей map.html, не міститиме власного рядка "ФІНІШ" цього ж прогону
  // (з'явиться лише в наступному запуску build-maps.js). Це неминучий
  // порядок дій, а не недогляд: побудувати сторінку з рядком про завершення
  // до фактичного завершення неможливо.
  const scrapeLogContent = readLogSafe(SCRAPE_LOG_FILE);
  const mapLogContent = readLogSafe(LOG_FILE);
  buildIndexPage(entries, scrapeLogContent, mapLogContent);

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

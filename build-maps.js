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
// DIR — де лежать усі згенеровані файли (output/), включно з тими, що пише
// цей скрипт (map.html, map.log). Розділені навмисно: колись усе писалось
// прямо в ROOT_DIR, тепер лише в output/ — не плутати одне з одним.
const ROOT_DIR = __dirname;
const DIR = path.join(ROOT_DIR, 'output');
const LOG_FILE = path.join(DIR, "map.log");

// ==================== ЛОГ (map.log — доповнюється, як scrape.log) ====================
function nowStr() {
  const d = new Date();
  return d.toLocaleDateString('uk-UA') + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function logLine(text) {
  try { fs.appendFileSync(LOG_FILE, `[${nowStr()}] ${text}\n`, "utf-8"); } catch (e) { /* лог не критичний */ }
}

// ==================== ДОПОМІЖНІ ФУНКЦІЇ ====================
function findCategoryIds() {
  return fs.readdirSync(DIR)
    .map(f => (f.match(/^(\d+)_category_map\.json$/) || [])[1])
    .filter(Boolean);
}

function mtimeHours(filePath) {
  return fs.statSync(filePath).mtimeMs / 3600000; // мс -> год
}

function readCategoryName(jsonPath) {
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    return data.categoryName || "";
  } catch (e) {
    return "";
  }
}

function writeStub(id, name, reason) {
  const htmlPath = path.join(DIR, `${id}_map.html`);
  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<title>Категорія ${id}${name ? " — " + name : ""} — немає актуальних даних</title>
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
    <p>Категорія ${id}${name ? " (" + name + ")" : ""} — мапу не згенеровано.</p>
    <p>${reason}</p>
  </div>
</body>
</html>
`;
  fs.writeFileSync(htmlPath, html, "utf-8");
}

function buildRealMap(id) {
  // render-map.js тепер приймає лише ID — сам шукає <id>_category_map.json /
  // <id>_cncprom_complete.csv в своєму output/ (те саме DIR, обчислене від
  // __dirname render-map.js, який лежить у ROOT_DIR поруч з цим скриптом).
  const res = spawnSync("node", ["render-map.js", id], { cwd: ROOT_DIR, stdio: "inherit" });
  return res.status === 0;
}

function readSummary(id) {
  const p = path.join(DIR, `${id}_map.summary.json`);
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (e) { return null; }
}

function escapeHtmlOuter(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==================== ІНДЕКС УСІХ КАТЕГОРІЙ (map.html) ====================
// Той самий "діловий" вигляд, що й в окремих map_<id>.html (map-common.css
// підключено так само), але без сайдбару/дерева — просто таблиця-список з
// посиланнями. Немає власного JS-додатку (initCatalogMap чекає CATALOG_DATA з
// повним деревом, якого тут нема) — лише initThemeToggle з map-common.js,
// того самого спільного файлу.
function diffBadgeHtml(e) {
  if (e.status !== 'ok' || e.diff === null || e.diff === undefined) {
    return '<span class="stock-badge neutral">н/д</span>';
  }
  const cls = e.diff === 0 ? 'diff-zero' : 'diff-nonzero';
  return `<span class="${cls}">${e.total_yes}/${e.site_counter ?? '—'}</span>`;
}

function statusBadgeHtml(e) {
  return e.status === 'ok'
    ? '<span class="count-yes">✅ Актуально</span>'
    : '<a href="' + e.id + '_map.html" class="count-no">⚠️ Застаріло</a>';
}

function buildIndexPage(entries) {
  const sorted = [...entries].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk'));
  const rows = sorted.map((e, i) => `
            <tr>
              <td class="col-n">${i + 1}</td>
              <td><a href="${e.id}_map.html" class="fw-cat-link">${escapeHtmlOuter(e.name || e.id)}</a></td>
              <td class="item-code" style="text-align:center;">${e.id}</td>
              <td style="text-align:center;">${e.levels ?? '—'}</td>
              <td style="text-align:center;" class="fw-count-cell">${e.total_products ?? '—'}</td>
              <td style="text-align:center;">${diffBadgeHtml(e)}</td>
              <td style="text-align:center;">${e.total_no !== undefined && e.total_no !== null ? `<span class="count-no">${e.total_no}</span>` : '—'}</td>
              <td style="text-align:center;font-size:0.78rem;color:var(--text-subtle);">${escapeHtmlOuter(e.scraped_at || '—')}</td>
              <td style="text-align:center;">${statusBadgeHtml(e)}</td>
            </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Мапа розділів — cncprom.ua</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="map-common.css">
<script src="map-common.js"></script>
<style>
  /* map-common.css розрахований на .workspace з фіксованою висотою вікна
     (сайдбар + скрол свого контенту) — індексна сторінка цього не має, тож
     повертаємо звичайний скрол сторінки й додаємо власну центровану обгортку. */
  html, body { height: auto; overflow: auto; }
  .index-wrap { max-width: 1100px; margin: 0 auto; padding: 20px; }
  .index-wrap h1 { font-size: 1.05rem; margin-bottom: 4px; }
  .index-wrap .sub { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 16px; line-height: 1.5; }
</style>
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="catalog-title">Мапа розділів каталогу — cncprom.ua</span>
    </div>
    <div class="header-right">
      <button id="btn-theme-toggle" class="btn-theme-toggle">
        <span class="theme-icon">🌙</span> <span class="theme-text">Темна</span>
      </button>
      <a href="https://cncprom.ua/ua/" target="_blank" rel="noopener noreferrer" class="link-site">cncprom.ua ↗</a>
    </div>
  </header>
  <div class="index-wrap">
    <h1>Категорії рівня 1 (${entries.length})</h1>
    <div class="sub">Кожен рядок веде до власної інтерактивної мапи категорії (&lt;ID&gt;_map.html). "⚠️ Застаріло" —
      category_map/csv цієї категорії розійшлись у часі більш ніж на ${STALE_THRESHOLD_HOURS} год відносно еталона
      (${REFERENCE_ID}); причина — на самій сторінці категорії та в <code>map.log</code>.</div>
    <div class="section-block">
      <div class="table-wrap">
        <table class="simple-table">
          <thead>
            <tr>
              <th class="col-n">№</th>
              <th>Назва категорії</th>
              <th style="text-align:center;">ID</th>
              <th style="text-align:center;">Рівнів</th>
              <th style="text-align:center;">Товарів</th>
              <th style="text-align:center;">В наявності</th>
              <th style="text-align:center;">Немає в наявності</th>
              <th style="text-align:center;">Оновлено</th>
              <th style="text-align:center;">Статус</th>
            </tr>
          </thead>
          <tbody>${rows}
          </tbody>
        </table>
      </div>
    </div>
  </div>
<script>initThemeToggle();</script>
</body>
</html>
`;
  fs.writeFileSync(path.join(DIR, "map.html"), html, "utf-8");
}

// ==================== ГОЛОВНА ЛОГІКА ====================
(() => {
  const ids = findCategoryIds();

  if (!ids.includes(REFERENCE_ID)) {
    console.error(`Еталонна категорія ${REFERENCE_ID} не знайдена (немає ${REFERENCE_ID}_category_map.json) — зупинка.`);
    logLine(`ПОМИЛКА: еталонна категорія ${REFERENCE_ID} відсутня, побудова мап скасована.`);
    process.exit(1);
  }

  // Гарантуємо, що еталон обробляється першим
  ids.sort((a, b) => (a === REFERENCE_ID ? -1 : b === REFERENCE_ID ? 1 : 0));

  const refJsonPath = path.join(DIR, `${REFERENCE_ID}_category_map.json`);
  const refCsvPath = path.join(DIR, `${REFERENCE_ID}_cncprom_complete.csv`);
  const refGapHours = fs.existsSync(refCsvPath)
    ? Math.abs(mtimeHours(refCsvPath) - mtimeHours(refJsonPath))
    : 0;

  console.log(`Еталон: ${REFERENCE_ID} (розрив json/csv: ${refGapHours.toFixed(2)} год)`);
  logLine(`СТАРТ build-maps: еталон ${REFERENCE_ID}, розрив ${refGapHours.toFixed(2)} год, поріг ${STALE_THRESHOLD_HOURS} год.`);

  const entries = [];

  ids.forEach(id => {
    const jsonPath = path.join(DIR, `${id}_category_map.json`);
    const csvPath = path.join(DIR, `${id}_cncprom_complete.csv`);
    const name = readCategoryName(jsonPath);

    if (id === REFERENCE_ID) {
      console.log(`[${id}] ${name} — еталон, будуємо повну мапу.`);
      buildRealMap(id);
      entries.push({ id, name, status: 'ok', ...readSummary(id) });
      return;
    }

    if (!fs.existsSync(csvPath)) {
      const reason = `${id}_cncprom_complete.csv відсутній (збір товарів ще не завершено) — дані неповні.`;
      console.warn(`[${id}] ${name} — ${reason} Заглушка замість мапи.`);
      logLine(`Категорія ${id} (${name}) пропущена: ${reason}`);
      writeStub(id, name, reason);
      entries.push({ id, name, status: 'stale', reason });
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
      entries.push({ id, name, status: 'stale', reason });
    } else {
      console.log(`[${id}] ${name} — свіжі дані (розрив ${gapHours.toFixed(2)} год), будуємо повну мапу.`);
      buildRealMap(id);
      entries.push({ id, name, status: 'ok', ...readSummary(id) });
    }
  });

  buildIndexPage(entries);
  console.log(`\nІндекс збережено: map.html (${entries.length} категорій).`);
  console.log("Готово. Деталі рішень — у map.log.");
  logLine(`ФІНІШ build-maps: оброблено категорій ${ids.length}.`);
})();

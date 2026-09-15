// diff-map.js — порівнює сьогоднішній знімок (пише generate-snapshot.js) із
// найближчим попереднім і пише Markdown-звіт про зміни день-до-дня — той самий
// дух, що й <id>_report.md зі scrape-complete.js, тільки не звірка
// скрапер-vs-сайт, а diff між двома днями. Фаза 3 плану, див. phase.md.
//
// Обсяг diff (узгоджено заздалегідь, не розширювати без потреби):
// - категорії: додано / видалено / перейменовано (той самий id, інша назва) /
//   переміщено (той самий id, інший parentId);
// - товари: додано / видалено / змінили наявність / перейшли в іншу категорію.
//   (Перейменування товару свідомо НЕ відстежується — поза узгодженим обсягом.)
//
// Порівняння йде не обов'язково з учорашнім днем буквально, а з НАЙБЛИЖЧИМ
// попереднім наявним знімком — якщо якоїсь ночі прогін не відбувся, звіт
// покаже зміни за весь пропущений період одним диффом, а не помилку.
//
// Використання:
//   node diff-map.js [dataDir] [todayDate]
//   dataDir   — тека зі snapshots/<YYYY-MM-DD>.json (той самий, куди пише
//               generate-snapshot.js), за замовчуванням ./data-branch
//   todayDate — за замовчуванням SNAPSHOT_DATE або поточна UTC-дата (як у
//               generate-snapshot.js) — знімок за цю дату має вже існувати.
//
// Результат: <dataDir>/reports/<todayDate>.md ТА <dataDir>/reports/<todayDate>.html
// (той самий diff, дві форми — HTML ділить map-common.css/.js з рештою сайту,
// оскільки deploy-pages.yml копіює reports/*.html із гілки data в
// output/<MAP_SUBDIR>/reports/ перед публікацією на Pages, плюс окрему копію
// сьогоднішнього під стабільним ім'ям reports/latest.html — саме на неї веде
// кнопка "📄 Diff-звіт" у шапці map.html/<id>_map.html, тож ця назва фіксована).

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(process.argv[2] || path.join(__dirname, 'data-branch'));
const TODAY = process.argv[3] || process.env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10);
const SNAPSHOTS_DIR = path.join(OUT_DIR, 'snapshots');
const REPORTS_DIR = path.join(OUT_DIR, 'reports');
const MAX_LISTED = 200; // захист від гігантського звіту при аномальній зміні (напр. видалення цілої категорії)

// ==================== ЗНАХОДЖЕННЯ ЗНІМКІВ ====================
const todayPath = path.join(SNAPSHOTS_DIR, `${TODAY}.json`);
if (!fs.existsSync(todayPath)) {
  console.error(`Не знайдено сьогоднішній знімок: ${todayPath}`);
  console.error('Спершу запустіть: node generate-snapshot.js');
  process.exit(1);
}
const today = JSON.parse(fs.readFileSync(todayPath, 'utf-8'));

const prevDate = fs.existsSync(SNAPSHOTS_DIR)
  ? fs.readdirSync(SNAPSHOTS_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f !== `${TODAY}.json`)
      .map(f => f.replace('.json', ''))
      .filter(d => d < TODAY)
      .sort()
      .pop()
  : undefined;

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const reportPath = path.join(REPORTS_DIR, `${TODAY}.md`);
const htmlReportPath = path.join(REPORTS_DIR, `${TODAY}.html`);

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Обгортка спільна для обох сторінок цього скрипта (звичайний diff і
// "перший знімок" нижче) — та сама шапка/лінки/теми, що й в решти сайту.
// map-common.css/.js підключені відносним "../", бо звіт лежить на рівень
// нижче (output/<MAP_SUBDIR>/reports/) за них (output/<MAP_SUBDIR>/) — саме
// туди їх копіює deploy-pages.yml.
function htmlReportPage(bodyHtml, subtitle) {
  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Diff-звіт · cncprom.ua</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../map-common.css">
<script src="../map-common.js"></script>
<style>
  /* map-common.css розрахований на .workspace фіксованої висоти — тут, як і в
     map.html (build-maps.js), звичайний скрол сторінки замість нього. */
  html, body { height: auto; overflow: visible; }
  /* 80% ширини body на великих (HD+) екранах, з розумною стелею, щоб на
     4K/ультраширокому текст не розтягувався в непрочитну стрічку; на
     вузьких екранах 80% і так лишає щонайменше 16px гутер з кожного боку. */
  .report-wrap { width: 80%; max-width: 1400px; margin: 0 auto; padding: 0 0 40px; display: flex; flex-direction: column; gap: 18px; }
  .report-wrap h1 { font-size: 1.15rem; margin: 0; }
  .report-wrap h2 { font-size: 0.92rem; margin: 4px 0 0; color: var(--text-main); }

  /* Заголовок + підсумкова статистика закріплені під шапкою (.app-header
     сама sticky top:0, 44px заввишки) під час скролу довгих таблиць нижче —
     видно "що взагалі сталось" не гортаючи назад до початку сторінки.
     Розділ "Категорії" і все далі за ним прокручується під цим блоком
     звичайно. */
  .report-sticky {
    position: sticky; top: 44px; z-index: 9; background: var(--bg-page);
    padding: 18px 0 14px; margin: 0; border-bottom: 1px solid var(--border-color);
    display: flex; flex-direction: column; gap: 14px;
  }

  /* Третій акцентний колір поза status-yes/status-no map-common.css — лише
     для "товар перейшов у іншу категорію" (ні добре, ні погано, просто інше),
     локальний для цієї сторінки, не додається у спільний файл. */
  :root { --accent-move: #7c3aed; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --accent-move: #b794f6; }
  }
  :root[data-theme="dark"] { --accent-move: #b794f6; }

  .stat-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1px; background: var(--border-color); border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden; }
  .stat-tile { background: var(--bg-white); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
  .stat-tile .stat-n { font-family: var(--font-mono); font-weight: 600; font-size: 1.7rem; line-height: 1; color: var(--text-main); }
  .stat-tile .stat-l { font-size: 0.76rem; color: var(--text-muted); line-height: 1.3; }
  .stat-tile.good .stat-n { color: var(--status-yes); }
  .stat-tile.bad .stat-n { color: var(--status-no); }
  .stat-tile.move .stat-n { color: var(--accent-move); }

  .netbar-wrap { display: flex; flex-direction: column; gap: 6px; }
  .netbar-label { display: flex; justify-content: space-between; font-size: 0.74rem; color: var(--text-muted); font-family: var(--font-mono); }
  .netbar { height: 10px; border-radius: 5px; overflow: hidden; display: flex; border: 1px solid var(--border-dark); }
  .netbar .seg-good { background: var(--status-yes); }
  .netbar .seg-bad { background: var(--status-no); }

  .quiet-note { font-size: 0.82rem; color: var(--text-muted); background: var(--bg-white); border: 1px solid var(--border-color); border-left: 3px solid var(--border-dark); border-radius: 0 6px 6px 0; padding: 10px 14px; line-height: 1.5; }

  .group-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .group-head h3 { font-size: 0.88rem; font-weight: 600; color: var(--text-main); }
  .group-block { display: flex; flex-direction: column; gap: 8px; }
</style>
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="catalog-title">cncprom.ua</span>
      <button class="btn-theme-toggle catalog-subtitle-btn">🕒 Diff-звіт · ${escapeHtml(subtitle)}</button>
    </div>
    <div class="header-right">
      <a href="../map.html" class="btn-theme-toggle" data-tip="Повернутись до мапи сайту">🗂️ Мапа сайту</a>
      <button id="btn-theme-toggle" class="btn-theme-toggle" data-tip="Перемкнути тему">
        <span class="theme-icon">🌙</span> <span class="theme-text">Темна</span>
      </button>
    </div>
  </header>
  <div class="report-wrap">
${bodyHtml}
  </div>
<script>
initThemeToggle();
setupTooltips();
</script>
</body>
</html>
`;
}

if (!prevDate) {
  fs.writeFileSync(reportPath,
    `# Diff-звіт: ${TODAY}\n\n` +
    `Це перший наявний знімок — попереднього дня для порівняння ще немає. ` +
    `Diff з'явиться, починаючи з наступного знімка.\n\n` +
    `Категорій у знімку: ${today.categories.length}, товарів: ${today.products.length}.\n`,
    'utf-8');
  fs.writeFileSync(htmlReportPath, htmlReportPage(
    `<h1>Diff-звіт: ${escapeHtml(TODAY)}</h1>
    <div class="empty-note" style="padding:28px 0;">
      Це перший наявний знімок — попереднього дня для порівняння ще немає.<br>
      Diff з'явиться, починаючи з наступного знімка.<br><br>
      Категорій у знімку: ${today.categories.length}, товарів: ${today.products.length}.
    </div>`,
    TODAY
  ), 'utf-8');
  console.log(`Перший знімок, порівнювати нема з чим. Звіт: ${reportPath}`);
  process.exit(0);
}

const prev = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, `${prevDate}.json`), 'utf-8'));

// ==================== ДІФ КАТЕГОРІЙ ====================
const catByIdToday = new Map(today.categories.map(c => [c.id, c]));
const catByIdPrev = new Map(prev.categories.map(c => [c.id, c]));
const catName = id => (catByIdToday.get(id) || catByIdPrev.get(id) || {}).name || id;

const catsAdded = today.categories.filter(c => !catByIdPrev.has(c.id));
const catsRemoved = prev.categories.filter(c => !catByIdToday.has(c.id));
const catsRenamed = [];
const catsMoved = [];
today.categories.forEach(c => {
  const before = catByIdPrev.get(c.id);
  if (!before) return;
  if (before.name !== c.name) catsRenamed.push({ id: c.id, before: before.name, after: c.name });
  if (before.parentId !== c.parentId) catsMoved.push({ id: c.id, name: c.name, before: before.parentId, after: c.parentId });
});

// ==================== ДІФ ТОВАРІВ ====================
const prodByIdToday = new Map(today.products.map(p => [p.id, p]));
const prodByIdPrev = new Map(prev.products.map(p => [p.id, p]));

const prodsAdded = today.products.filter(p => !prodByIdPrev.has(p.id));
const prodsRemoved = prev.products.filter(p => !prodByIdToday.has(p.id));
const prodsAvailChanged = [];
const prodsMoved = [];
today.products.forEach(p => {
  const before = prodByIdPrev.get(p.id);
  if (!before) return;
  if (before.availability !== p.availability) {
    prodsAvailChanged.push({ id: p.id, name: p.name, sku: p.sku, url: p.url, before: before.availability, after: p.availability });
  }
  if (before.categoryId !== p.categoryId) {
    prodsMoved.push({ id: p.id, name: p.name, sku: p.sku, url: p.url, availability: p.availability, before: catName(before.categoryId), after: catName(p.categoryId) });
  }
});

// ==================== РЕНДЕР ЗВІТУ ====================
function listSection(title, items, render) {
  if (items.length === 0) return `### ${title}\n\nНемає.\n\n`;
  const shown = items.slice(0, MAX_LISTED).map(render).join('\n');
  const more = items.length > MAX_LISTED ? `\n\n_...і ще ${items.length - MAX_LISTED}._` : '';
  return `### ${title}\n\n${shown}${more}\n\n`;
}

let md = `# Diff-звіт: ${prevDate} → ${TODAY}\n\n`;
md += `Порівняння знімків \`${prevDate}.json\` → \`${TODAY}.json\`.\n\n`;

md += `## Категорії\n\n`;
md += `| Показник | Кількість |\n|---|---|\n`;
md += `| Додано | ${catsAdded.length} |\n`;
md += `| Видалено | ${catsRemoved.length} |\n`;
md += `| Перейменовано | ${catsRenamed.length} |\n`;
md += `| Переміщено | ${catsMoved.length} |\n\n`;
md += listSection('Додано', catsAdded, c => `- \`${c.id}\` — ${c.name} (рівень ${c.level}${c.parentId ? `, батьківська: ${catName(c.parentId)}` : ''})`);
md += listSection('Видалено', catsRemoved, c => `- \`${c.id}\` — ${c.name} (рівень ${c.level})`);
md += listSection('Перейменовано', catsRenamed, c => `- \`${c.id}\`: "${c.before}" → "${c.after}"`);
md += listSection('Переміщено', catsMoved, c => `- \`${c.id}\` (${c.name}): ${catName(c.before)} → ${catName(c.after)}`);

md += `## Товари\n\n`;
md += `| Показник | Кількість |\n|---|---|\n`;
md += `| Додано | ${prodsAdded.length} |\n`;
md += `| Видалено | ${prodsRemoved.length} |\n`;
md += `| Змінили наявність | ${prodsAvailChanged.length} |\n`;
md += `| Перейшли в іншу категорію | ${prodsMoved.length} |\n\n`;
md += listSection('Додано', prodsAdded, p => `- \`${p.id}\` ${p.name} (${catName(p.categoryId)})`);
md += listSection('Видалено', prodsRemoved, p => `- \`${p.id}\` ${p.name} (${catName(p.categoryId)})`);
md += listSection('Змінили наявність', prodsAvailChanged, p => `- \`${p.id}\` ${p.name}: "${p.before}" → "${p.after}"`);
md += listSection('Перейшли в іншу категорію', prodsMoved, p => `- \`${p.id}\` ${p.name}: ${p.before} → ${p.after}`);

fs.writeFileSync(reportPath, md, 'utf-8');

// ==================== HTML-ВЕРСІЯ ТОГО САМОГО ЗВІТУ ====================
// Ті самі об'єкти diff'а вище (catsAdded/prodsAvailChanged/…), без парсингу
// щойно записаного Markdown — так само, як render-map.js будує сторінку з
// дерева категорій, а не з CSV, який сам і написав.
function countsTable(rows) {
  return `<table class="simple-table"><tbody>${
    rows.map(([label, n]) => `<tr><td>${escapeHtml(label)}</td><td class="fw-count-cell" style="text-align:right;">${n}</td></tr>`).join('')
  }</tbody></table>`;
}

// Таблиця без обгортки-заголовка (заголовок/лічильник тепер малює викликач —
// або .table-subhead секції, або .group-head "Знову в наявності"/"Раптом
// закінчились" нижче).
function itemsTableBlock(items, headCols, rowFn) {
  const shown = items.slice(0, MAX_LISTED);
  const tail = items.length > MAX_LISTED
    ? `<tr><td colspan="${headCols.length}" style="text-align:center;color:var(--text-subtle);">…і ще ${items.length - MAX_LISTED}.</td></tr>`
    : '';
  return `<div class="table-wrap">
    <table class="simple-table">
      <thead><tr>${headCols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${shown.map(rowFn).join('')}${tail}</tbody>
    </table>
  </div>`;
}

// Секція рендериться лише коли є що показати — на відміну від Markdown-версії
// вище (яка завжди пише "Немає."), порожні підрозділи тут просто не
// займають місця: нуль уже видно в статистичній смузі/summary-таблиці.
function listSectionHtml(title, items, headCols, rowFn) {
  if (items.length === 0) return '';
  return `<div class="section-block">
    <div class="table-subhead">${escapeHtml(title)} (${items.length})</div>
    ${itemsTableBlock(items, headCols, rowFn)}
  </div>`;
}

function availBadge(status) {
  const cls = status === 'Готово до відправки' ? 'yes' : status === 'Немає в наявності' ? 'no' : 'neutral';
  return `<span class="stock-badge ${cls}">${escapeHtml(status || '—')}</span>`;
}

// Стандартний рядок товару — Артикул (не productId — той для людини нічого
// не значить), Товар (лінк на сторінку товару на сайті, коли url відомий) і
// Наявність (badge) — та сама трійка колонок/класів (.col-code/.item-code,
// .col-name, .col-avail/.stock-badge), що вже використовує render-map.js для
// власних товарних таблиць (renderTableHtml) — стилі підтягуються з
// map-common.css без додаткового CSS тут. avail — окремий параметр, а не
// завжди p.availability, бо для prodsAvailChanged актуальний статус лежить у
// p.after, не в окремому полі availability.
function productRow(p, avail) {
  const status = avail !== undefined ? avail : p.availability;
  const nameHtml = p.url
    ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.name)}</a>`
    : escapeHtml(p.name);
  return `<tr>
    <td class="col-code"><span class="item-code">${escapeHtml(p.sku || '—')}</span></td>
    <td class="col-name">${nameHtml}</td>
    <td class="col-avail">${availBadge(status)}</td>
  </tr>`;
}

// "Знову в наявності"/"Вже немає в наявності" — товари одного напрямку зміни
// групуються під одним заголовком з переходом статусу один раз (не в кожному
// рядку, як у Markdown-таблиці) — сам напрямок і так однаковий для всієї
// групи; втім таблиця нижче все одно показує Наявність в кожному рядку
// (актуальний, "after" статус), щоб форма таблиці лишалась однаковою скрізь,
// де в звіті перелічуються товари.
function availGroup(title, items, tone, fromLabel, toLabel) {
  if (items.length === 0) return '';
  return `<div class="group-block">
    <div class="group-head">
      <h3>${escapeHtml(title)}</h3>
      <span class="${tone === 'good' ? 'count-yes' : 'count-no'}" style="font-weight:600;font-family:var(--font-mono);">${items.length}</span>
      <span style="font-size:0.74rem;color:var(--text-subtle);font-family:var(--font-mono);">${escapeHtml(fromLabel)} → ${escapeHtml(toLabel)}</span>
    </div>
    ${itemsTableBlock(items, ['Код', 'Назва товару', 'Наявність'], p => productRow(p, p.after))}
  </div>`;
}

const restocked = prodsAvailChanged.filter(p => p.after === 'Готово до відправки');
const wentOos = prodsAvailChanged.filter(p => p.after !== 'Готово до відправки');
const availTotal = prodsAvailChanged.length;
const net = restocked.length - wentOos.length;

const statStripHtml = `
  <div class="stat-strip">
    <div class="stat-tile"><div class="stat-n">${availTotal}</div><div class="stat-l">товарів змінили наявність</div></div>
    <div class="stat-tile good"><div class="stat-n">${restocked.length}</div><div class="stat-l">знову в наявності</div></div>
    <div class="stat-tile bad"><div class="stat-n">${wentOos.length}</div><div class="stat-l">вже немає в наявності</div></div>
    <div class="stat-tile move"><div class="stat-n">${prodsMoved.length}</div><div class="stat-l">перейшли в іншу категорію</div></div>
  </div>`;

const catsChangedTotal = catsAdded.length + catsRemoved.length + catsRenamed.length + catsMoved.length;
const catsBlockHtml = catsChangedTotal === 0
  ? `<div class="quiet-note">Категорії без змін: не додано, не видалено, не перейменовано, не переміщено.</div>`
  : `${countsTable([
      ['Додано', catsAdded.length], ['Видалено', catsRemoved.length],
      ['Перейменовано', catsRenamed.length], ['Переміщено', catsMoved.length],
    ])}
    ${listSectionHtml('Додано', catsAdded, ['Код', 'Назва', 'Рівень', 'Батьківська категорія'],
      c => `<tr><td class="item-code">${escapeHtml(c.id)}</td><td>${escapeHtml(c.name)}</td><td style="text-align:center;">${c.level}</td><td>${c.parentId ? escapeHtml(catName(c.parentId)) : '—'}</td></tr>`)}
    ${listSectionHtml('Видалено', catsRemoved, ['Код', 'Назва', 'Рівень'],
      c => `<tr><td class="item-code">${escapeHtml(c.id)}</td><td>${escapeHtml(c.name)}</td><td style="text-align:center;">${c.level}</td></tr>`)}
    ${listSectionHtml('Перейменовано', catsRenamed, ['Код', 'Було', 'Стало'],
      c => `<tr><td class="item-code">${escapeHtml(c.id)}</td><td>${escapeHtml(c.before)}</td><td>${escapeHtml(c.after)}</td></tr>`)}
    ${listSectionHtml('Переміщено', catsMoved, ['Код', 'Назва', 'Було', 'Стало'],
      c => `<tr><td class="item-code">${escapeHtml(c.id)}</td><td>${escapeHtml(c.name)}</td><td>${escapeHtml(catName(c.before))}</td><td>${escapeHtml(catName(c.after))}</td></tr>`)}`;

const prodsStructTotal = prodsAdded.length + prodsRemoved.length;
const prodsStructHtml = prodsStructTotal === 0
  ? `<div class="quiet-note">Товарів не додано і не видалено.</div>`
  : `${listSectionHtml('Додано', prodsAdded, ['Код', 'Назва товару', 'Наявність'], p => productRow(p))}
    ${listSectionHtml('Видалено', prodsRemoved, ['Код', 'Назва товару', 'Наявність'], p => productRow(p))}`;

const availSectionHtml = availTotal === 0
  ? `<div class="quiet-note">Наявність товарів без змін.</div>`
  : `<div class="netbar-wrap">
      <div class="netbar-label"><span>чистий приріст наявності</span><span>${net >= 0 ? '+' : ''}${net} (${restocked.length} / ${wentOos.length})</span></div>
      <div class="netbar" role="img" aria-label="${restocked.length} товарів знову в наявності, ${wentOos.length} закінчились">
        <div class="seg-good" style="width:${(restocked.length / availTotal * 100).toFixed(1)}%"></div>
        <div class="seg-bad" style="width:${(wentOos.length / availTotal * 100).toFixed(1)}%"></div>
      </div>
    </div>
    ${availGroup('Знову в наявності', restocked, 'good', 'Немає в наявності', 'Готово до відправки')}
    ${availGroup('Вже немає в наявності', wentOos, 'bad', 'Готово до відправки', 'Немає в наявності')}`;

// Той самий рядок-примітив, що й productRow (.col-code/.item-code,
// .col-name-лінк, .col-avail/badge) плюс єдина колонка, специфічна саме для
// цього розділу — категорія було→стало; той самий стандартний вигляд
// товарного рядка, що й у решті звіту, а не окрема картка. Заголовок секції —
// той самий .group-head/.group-block стиль, що й у availGroup (Знову в
// наявності / Вже немає в наявності), а не .section-block/.table-subhead.
const moveSectionHtml = prodsMoved.length === 0 ? '' : `<div class="group-block">
    <div class="group-head">
      <h3>Перейшли в іншу категорію</h3>
      <span style="font-weight:600;font-family:var(--font-mono);color:var(--accent-move);">${prodsMoved.length}</span>
    </div>
    ${itemsTableBlock(prodsMoved, ['Код', 'Назва товару', 'Категорія', 'Наявність'],
      p => `<tr>
    <td class="col-code"><span class="item-code">${escapeHtml(p.sku || '—')}</span></td>
    <td class="col-name">${p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.name)}</a>` : escapeHtml(p.name)}</td>
    <td>${escapeHtml(p.before)} <span style="color:var(--text-subtle);">→</span> ${escapeHtml(p.after)}</td>
    <td class="col-avail">${availBadge(p.availability)}</td>
  </tr>`)}
  </div>`;

const bodyHtml = `
    <div class="report-sticky">
      <h1>Diff-звіт: ${escapeHtml(prevDate)} → ${escapeHtml(TODAY)}</h1>
      ${statStripHtml}
    </div>

    <div class="group-block">
      <h2>Категорії</h2>
      ${catsBlockHtml}
    </div>

    <div class="group-block">
      <h2>Товари</h2>
      ${prodsStructHtml}
      ${availSectionHtml}
      ${moveSectionHtml}
    </div>
`;

fs.writeFileSync(htmlReportPath, htmlReportPage(bodyHtml, `${prevDate} → ${TODAY}`), 'utf-8');

console.log(`Звіт записано: ${reportPath} (+ ${path.basename(htmlReportPath)})`);
console.log(`Категорії: +${catsAdded.length} -${catsRemoved.length} перейм.${catsRenamed.length} перем.${catsMoved.length} | ` +
  `Товари: +${prodsAdded.length} -${prodsRemoved.length} наявн.${prodsAvailChanged.length} перем.${prodsMoved.length}`);

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
// Результат: <dataDir>/reports/<todayDate>.md — історія змін у гілці data.
// HTML-звіту цей скрипт більше не пише: сторінку змін для Pages будує
// build-reports.js (reports/index.html), причому для БУДЬ-ЯКОЇ пари дат, а не
// лише "сьогодні проти попереднього" — див. його власний коментар.

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

if (!prevDate) {
  fs.writeFileSync(reportPath,
    `# Diff-звіт: ${TODAY}\n\n` +
    `Це перший наявний знімок — попереднього дня для порівняння ще немає. ` +
    `Diff з'явиться, починаючи з наступного знімка.\n\n` +
    `Категорій у знімку: ${today.categories.length}, товарів: ${today.products.length}.\n`,
    'utf-8');
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

console.log(`Звіт записано: ${reportPath}`);
console.log(`Категорії: +${catsAdded.length} -${catsRemoved.length} перейм.${catsRenamed.length} перем.${catsMoved.length} | ` +
  `Товари: +${prodsAdded.length} -${prodsRemoved.length} наявн.${prodsAvailChanged.length} перем.${prodsMoved.length}`);

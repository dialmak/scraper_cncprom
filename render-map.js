// render-map.js — генерує інтерактивну HTML-мапу дерева категорій з файлу
// category_map_<ID>.json (від scrape-complete.js), опційно збагачену
// товарами (назва/SKU/наявність) з cncprom_complete_<ID>.csv.
//
// Використання:
//   node render-map.js category_map_<ID>.json
//   node render-map.js category_map_<ID>.json cncprom_complete_<ID>.csv
//
// Результат: map_<ID>.html — самодостатня сторінка (без зовнішніх залежностей),
// дерево категорій, що згортається/розгортається, перемикач теми, підсумок нагорі.

const fs = require('fs');
const path = require('path');

const mapFile = process.argv[2];
const csvFile = process.argv[3];

if (!mapFile) {
  console.error('Використання: node render-map.js category_map_<ID>.json [cncprom_complete_<ID>.csv]');
  process.exit(1);
}
if (!fs.existsSync(mapFile)) {
  console.error(`Файл не знайдено: ${mapFile}`);
  process.exit(1);
}

const idMatch = mapFile.match(/category_map_(.+)\.json$/);
const categoryId = idMatch ? idMatch[1] : path.basename(mapFile, '.json');
const OUTPUT_HTML = `map_${categoryId}.html`;

const tree = JSON.parse(fs.readFileSync(mapFile, 'utf-8'));

// ==================== ОПЦІЙНЕ ЗБАГАЧЕННЯ ТОВАРАМИ З CSV ====================
// CSV: UTF-8 з BOM, роздільник ";". Рядки групуються за categoryId — тим самим
// полем, яке scrape-complete.js записує і у вузол дерева (канонічна,
// найглибша категорія товару), тому мапа товар -> вузол тут точна.
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

const productsByCategory = new Map();
let totalProductsFromCsv = 0;
if (csvFile) {
  if (!fs.existsSync(csvFile)) {
    console.error(`Файл не знайдено: ${csvFile}`);
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(csvFile, 'utf-8'));
  totalProductsFromCsv = rows.length;
  rows.forEach(r => {
    if (!productsByCategory.has(r.categoryId)) productsByCategory.set(r.categoryId, []);
    productsByCategory.get(r.categoryId).push(r);
  });
}

// ==================== ПІДСУМОК ====================
function collectStats(node, acc) {
  if (!node || !node.categoryId) return acc;
  acc.categories++;
  acc.directProducts += node.directProductCount || 0;
  if (node.level === 1) acc.rootCounter = node.siteAvailableCounter;
  (node.children || []).forEach(c => collectStats(c, acc));
  return acc;
}
const stats = collectStats(tree, { categories: 0, directProducts: 0, rootCounter: null });

// ==================== HTML ====================
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderProducts(categoryId) {
  const items = productsByCategory.get(categoryId);
  if (!items || items.length === 0) return '';
  const rows = items.map(p => {
    // "наявн" навмисно виключено — воно є підрядком і в "Немає в наявності"
    const avail = /готово/i.test(p.availabilityStatus || '');
    return `<li class="product${p.isOrphan === 'true' ? ' orphan' : ''}">
      <a href="${esc(p.finalUrl)}" target="_blank" rel="noopener">${esc(p.productName || p.productId)}</a>
      <span class="sku">${esc(p.sku)}</span>
      <span class="avail ${avail ? 'yes' : 'no'}">${esc(p.availabilityStatus || '—')}</span>
    </li>`;
  }).join('');
  return `<ul class="products">${rows}</ul>`;
}

function renderNode(node, depth) {
  if (!node || !node.categoryId) return '';
  const hasChildren = node.children && node.children.length > 0;
  const hasProducts = productsByCategory.has(node.categoryId);
  const openAttr = depth === 0 ? ' open' : '';
  const counterHtml = node.siteAvailableCounter !== null && node.siteAvailableCounter !== undefined
    ? `<span class="counter">в наявності: ${node.siteAvailableCounter}</span>` : '';
  const orphanBadge = node.directProductCount > 0 && hasChildren
    ? `<span class="badge" title="Прямі товари на цій, не листковій, категорії">прямих: ${node.directProductCount}</span>` : '';

  const childrenHtml = hasChildren ? node.children.map(c => renderNode(c, depth + 1)).join('') : '';
  const productsHtml = renderProducts(node.categoryId);

  return `<details class="node"${openAttr}>
    <summary>
      <span class="name">${esc(node.categoryName)}</span>
      <span class="meta">
        ${counterHtml}
        ${orphanBadge}
        <span class="direct">прямих товарів: ${node.directProductCount ?? 0}</span>
      </span>
    </summary>
    <div class="node-body">
      ${productsHtml}
      ${childrenHtml}
    </div>
  </details>`;
}

const treeHtml = renderNode(tree, 0);

const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Мапа категорій — ${esc(tree.categoryName || categoryId)}</title>
<style>
  :root {
    --bg: #f7f7f8; --fg: #1a1a1a; --card: #ffffff; --border: #e2e2e5;
    --muted: #6b6b70; --accent: #2563eb; --yes: #178a3c; --no: #b3261e;
    --orphan-bg: #fff7e0;
  }
  [data-theme="dark"] {
    --bg: #16171a; --fg: #eaeaec; --card: #1e1f23; --border: #2c2d32;
    --muted: #9a9aa2; --accent: #6ea8fe; --yes: #4ade80; --no: #f87171;
    --orphan-bg: #2b2410;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 60px; background: var(--bg); color: var(--fg);
    font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px;
  }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 16px; }
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
  button {
    background: var(--card); color: var(--fg); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px;
  }
  button:hover { border-color: var(--accent); }
  .summary {
    background: var(--card); border: 1px solid var(--border); border-radius: 8px;
    padding: 12px 16px; margin-bottom: 16px; display: flex; gap: 24px; flex-wrap: wrap;
  }
  .summary div b { display: block; font-size: 18px; }
  .summary div span { color: var(--muted); font-size: 12px; }
  details.node {
    background: var(--card); border: 1px solid var(--border); border-radius: 8px;
    margin: 6px 0; padding: 0;
  }
  details.node > summary {
    list-style: none; cursor: pointer; padding: 8px 12px; display: flex;
    justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  details.node > summary::-webkit-details-marker { display: none; }
  details.node > summary::before { content: "▶"; margin-right: 8px; color: var(--muted); font-size: 10px; }
  details.node[open] > summary::before { content: "▼"; }
  .name { font-weight: 600; }
  .meta { display: flex; gap: 10px; align-items: center; font-size: 12px; color: var(--muted); }
  .meta .counter { color: var(--accent); }
  .meta .badge { background: var(--orphan-bg); border-radius: 4px; padding: 2px 6px; }
  .node-body { padding: 0 12px 10px 28px; }
  ul.products { list-style: none; margin: 4px 0 8px; padding: 0; }
  li.product {
    display: flex; gap: 10px; align-items: center; padding: 4px 8px; border-radius: 6px;
    font-size: 13px;
  }
  li.product:hover { background: var(--bg); }
  li.product.orphan { background: var(--orphan-bg); }
  li.product a { color: var(--fg); text-decoration: none; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li.product a:hover { color: var(--accent); text-decoration: underline; }
  li.product .sku { color: var(--muted); font-size: 11px; white-space: nowrap; }
  li.product .avail { font-size: 11px; white-space: nowrap; }
  li.product .avail.yes { color: var(--yes); }
  li.product .avail.no { color: var(--no); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Мапа категорій: ${esc(tree.categoryName || categoryId)}</h1>
  <p class="sub">Згенеровано ${new Date().toLocaleString('uk-UA')} · ${csvFile ? `товари з ${esc(path.basename(csvFile))}` : 'без товарів (передайте CSV другим аргументом)'}</p>
  <div class="toolbar">
    <button id="toggleTheme">🌓 Тема</button>
    <button id="expandAll">Розгорнути все</button>
    <button id="collapseAll">Згорнути все</button>
  </div>
  <div class="summary">
    <div><b>${stats.categories}</b><span>категорій</span></div>
    <div><b>${stats.directProducts}</b><span>прямих товарів (сума по вузлах)</span></div>
    <div><b>${totalProductsFromCsv || '—'}</b><span>товарів у CSV</span></div>
    <div><b>${stats.rootCounter ?? 'н/д'}</b><span>лічильник сайту (корінь)</span></div>
  </div>
  ${treeHtml}
</div>
<script>
  const root = document.documentElement;
  const stored = localStorage.getItem('map-theme');
  if (stored) root.setAttribute('data-theme', stored);
  document.getElementById('toggleTheme').addEventListener('click', () => {
    const cur = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', cur);
    localStorage.setItem('map-theme', cur);
  });
  document.getElementById('expandAll').addEventListener('click', () => {
    document.querySelectorAll('details.node').forEach(d => d.open = true);
  });
  document.getElementById('collapseAll').addEventListener('click', () => {
    document.querySelectorAll('details.node').forEach(d => d.open = false);
  });
</script>
</body>
</html>`;

fs.writeFileSync(OUTPUT_HTML, html, 'utf-8');
console.log(`Мапу збережено: ${OUTPUT_HTML}`);

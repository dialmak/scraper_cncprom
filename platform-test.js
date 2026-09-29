// «Тест платформи» — ПРОБНА сторінка (29.09.2026, на прохання користувача): що ще
// можна дізнатися про товари однієї категорії зі сторінок товарів на платформі
// Prom, крім того, що вже збирає скрапер. Не частина звірки й не впливає на мапи.
//
// Що береться зі сторінки товару (сирий HTML, без браузера):
//   - службові дані аналітики Prom: атрибут data-analytics (об'єкт clerk) і
//     window.AppState…ec_products_list — ланцюжок категорій ПЛАТФОРМИ Prom
//     («5140401 51404 514 5 0», від найглибшої до кореня 0), група магазину,
//     ціна в гривнях і доларах, тип продажу, Prom-оплата, доставка Rozetka тощо.
//     Це не офіційний інтерфейс: Prom може змінити його без попередження;
//   - JSON-LD Product (код, ціна, наявність, фото, опис) і блок характеристик.
// Назви категорій Prom і «Єдина комісія» — з двох файлів у корені репозиторію, вивантажених
// з таблиці «Комісія Prom» (дав користувач 29.09.2026, замість попереднього Комісія_Prom.csv):
// «…за замовлення» (% від ціни) і «…за перехід» (гривні за перехід на картку). Кожна
// категорія Prom є рівно в одному з них. Шукаються під час побудови сторінки, не під час
// збору: нові файли підхоплює й --reuse, без повторного збору.
//
// node platform-test.js [categoryId] [--reuse]
//   без --reuse — зібрати заново (≈3 хв на 180 товарів) і побудувати сторінку;
//   --reuse — лише перебудувати сторінку з наявного platform-test.json, якщо він є
//   (так робить «Перебудувати сайт»: fetch-published.js бере його з сайту).
// Пише output/site/platform-test.json і output/site/platform-test.html.

const fs = require('fs');
const path = require('path');
const { escapeHtmlOuter: esc } = require('./lib/html');
const { ICONS } = require('./lib/icons');
const { helpButtonHtml } = require('./lib/help');
const { narrowGuardHtml } = require('./lib/notice');
const { assetVer } = require('./lib/assets');
const { fmtDateTime } = require('./lib/time');
const { plural } = require('./lib/plural');
const { sleep } = require('./lib/browser');

const DIR = path.join(__dirname, 'output', 'site');
const OUT_JSON = path.join(DIR, 'platform-test.json');
const OUT_HTML = path.join(DIR, 'platform-test.html');
const ARGS = process.argv.slice(2);
const REUSE = ARGS.includes('--reuse');
const CAT_ID = ARGS.find(a => /^\d+$/.test(a)) || '1022485';   // Контролери для ЧПК
const DELAY_MS = 700;   // ввічливість до сервера, як DELAY_MS у скрапері
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

// mode: order — «Єдина комісія» у % від ціни; click — «Єдина комісія, грн» за перехід.
const COMMISSION_FILES = [
  { mode: 'order', file: 'Комісія Prom - Категорії з комісією за замовлення.csv', fee: 'Єдина комісія' },
  { mode: 'click', file: 'Комісія Prom - Категорії з комісією за перехід.csv', fee: 'Єдина комісія, грн' },
];
const fileUrl = f => 'https://github.com/dialmak/scraper_cncprom/blob/main/' + encodeURIComponent(f);

// ==================== ФАЙЛИ КОМІСІЙ ====================
// Вивантаження Google-таблиці як є: кома, поля в лапках (у назвах є коми), над
// заголовком рядок-пояснення й порожні рядки — заголовок шукаємо за «ID категорії».
function parseCsv(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c !== '"') f += c; else if (t[i + 1] === '"') { f += '"'; i++; } else q = false; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.map(r => r.map(v => v.trim()));
}

// id → { mode, level, names: [рівень 0 … рівень N], single: «6.59%» чи «2.79» }.
function loadCommission() {
  const byId = new Map();
  for (const src of COMMISSION_FILES) {
    const rows = parseCsv(fs.readFileSync(path.join(__dirname, src.file), 'utf8').replace(/^\uFEFF/, ''));
    const h = rows.findIndex(r => r.includes('ID категорії'));
    const H = rows[h] || [], iId = H.indexOf('ID категорії'), iLvl = H.indexOf('Рівень категорії'), iFee = H.indexOf(src.fee);
    if (iId < 0 || iLvl < 0 || iFee < 0) throw new Error(`${src.file}: немає колонки «ID категорії», «Рівень категорії» чи «${src.fee}»`);
    for (const x of rows.slice(h + 1)) {
      if (!/^\d+$/.test(x[iId] || '')) continue;
      const level = Number(x[iLvl]);
      byId.set(x[iId], { mode: src.mode, level, names: x.slice(0, level + 1), single: x[iFee] });
    }
  }
  return byId;
}

// Категорія Prom товару за файлами. Назви рівнів — з рядка файлу, ланцюжок ID від кореня
// лягає на колонки рівнів. Якщо самої категорії в жодному файлі немає, назви її предків
// беремо з ланцюжків інших товарів, які у файлах є (names: id → назва).
function resolveProm(chain, byId, names) {
  if (!chain || !chain.length) return null;
  const ids = chain.slice().reverse();              // 0, 1 рівень, …, найглибша
  const row = byId.get(chain[0]);
  if (row) return { found: true, mode: row.mode, level: row.level, single: row.single, path: row.names.map((n, k) => ({ id: ids[k] || '', name: n })) };
  return { found: false, mode: '', level: ids.length - 1, single: '', path: ids.map(id => ({ id, name: names.get(id) || '' })) };
}

// ==================== СТОРІНКА ТОВАРУ ====================
const decode = s => s.replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = s => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseProduct(html) {
  const out = {};
  // data-analytics='{…"clerk": {…}}' — JSON з лапками-сутностями &#34;.
  const a = html.match(/data-analytics='([^']*)'/);
  if (a) { try { out.clerk = JSON.parse(decode(a[1])).clerk || {}; } catch (e) { /* немає — лишаємо порожнім */ } }
  // window.AppState.modstate … "ec_products_list": {"<id>": {…}} — плаский об'єкт.
  const ec = html.match(/"ec_products_list":\s*\{"\d+":\s*(\{[^{}]*\})/);
  if (ec) { try { out.ec = JSON.parse(ec[1]); } catch (e) { /* див. вище */ } }
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { const o = JSON.parse(m[1]); if (o && o['@type'] === 'Product') out.ld = o; } catch (e) { /* зіпсований блок пропускаємо */ }
  }
  out.attrs = [...html.matchAll(/data-qaid="attribute_name"[^>]*>([\s\S]*?)<\/[a-z]+>[\s\S]*?data-qaid="attribute_value"[^>]*>([\s\S]*?)<\/(?:td|div|li|span)>/g)]
    .map(m => [text(m[1]), text(m[2])]);
  const pr = html.match(/data-qaid="presence_data"[^>]*>([^<]*)/);
  out.presence = pr ? text(pr[1]) : '';
  return out;
}

async function getPage(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'uk' } });
      if (r.ok) {
        const t = await r.text();
        if (/ec_products_list|"@type":\s*"Product"/.test(t)) return t;
      }
    } catch (e) { /* мережа — ще спроба */ }
    await sleep(2000 * attempt);
  }
  return null;
}

// ==================== ЗБІР ====================
async function collect() {
  const catalog = JSON.parse(fs.readFileSync(path.join(DIR, `${CAT_ID}_catalog.json`), 'utf8'));
  const products = [];
  let i = 0;
  for (const p of catalog.products) {
    i++;
    const html = await getPage(p.finalUrl);
    const row = { id: p.productId, name: p.productName, url: p.finalUrl, sku: p.sku,
      shopCatId: String(p.categoryId), shopCatName: p.categoryName, availability: p.availabilityStatus };
    if (!html) { row.error = 'сторінка не відкрилась'; products.push(row); continue; }
    const d = parseProduct(html);
    const c = d.clerk || {}, e = d.ec || {}, ld = d.ld || {}, of = ld.offers || {};
    row.chain = String(e.ec_product_category || c.product_category || '').trim().split(/\s+/).filter(Boolean);
    row.groupId = e.ec_group_id || '';
    row.price = e.ec_price_original || c.price_original || of.price || '';
    row.priceUsd = e.ec_price_usd || c.price_usd || '';
    row.presence = d.presence;
    row.ldAvailability = String(of.availability || '').replace(/^https?:\/\/schema\.org\//, '');
    row.image = typeof ld.image === 'string' ? ld.image : '';
    row.descLen = (ld.description || '').trim().length;
    row.attrs = d.attrs;
    // Усі службові поля як є — «все, що можна витягти» (показуються в підказці).
    row.platform = {
      product_type: c.product_type ?? e.ec_product_type, selling_type: c.selling_type,
      product_status_group: c.product_status_group, selling_flags: c.selling_flags,
      product_presence_sure: c.product_presence_sure ?? e.ec_presence_sure,
      prom_pay: c.prom_pay ?? e.prom_pay, rozetka_delivery_enabled: c.rozetka_delivery_enabled,
      variations: c.variations ?? e.variations, product_selection: c.product_selection ?? e.product_selection,
      prosale_campaign_id: e.ec_prosale_campaign_id
    };
    products.push(row);
    if (i % 20 === 0) console.log(`  ${i} з ${catalog.products.length}`);
    await sleep(DELAY_MS);
  }
  const data = { generatedAt: new Date().toISOString(), category: { id: CAT_ID, name: catalog.categoryName, url: catalog.url },
    products };
  fs.writeFileSync(OUT_JSON, JSON.stringify(data));
  return data;
}

// ==================== СТОРІНКА ====================
const pct = s => { const n = parseFloat(String(s || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const money = n => n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' ');
const SELLING = { retail: 'роздріб', wholesale: 'опт', universal: 'роздріб і опт' };

function flagsHtml(p) {
  const f = p.platform || {}, tags = [];
  if (f.selling_type) tags.push(SELLING[f.selling_type] || f.selling_type);
  if (f.product_status_group === 'prosale') tags.push('ProSale');
  if (f.prom_pay) tags.push('Prom-оплата');
  if (f.rozetka_delivery_enabled) tags.push('доставка Rozetka');
  if (f.variations) tags.push('варіації');
  const tip = Object.entries(f).map(([k, v]) => `${k}: ${v == null ? '(немає)' : v}`).join('\n');
  return `<span class="pt-flags" data-tip="${esc(tip)}">${tags.map(t => `<span class="pt-tag">${esc(t)}</span>`).join('') || '<span class="subtle">немає</span>'}</span>`;
}

function promHtml(p) {
  if (!p.chain || !p.chain.length) return '<span class="subtle">немає даних</span>';
  // ID — у тому ж порядку, що й назви над ними (від 1 рівня до найглибшого), без кореня 0;
  // на сторінці товару ланцюжок іде навпаки: «504 514 5 0».
  const ids = `<div class="pt-ids">${esc(p.chain.filter(x => x !== '0').reverse().join(' › '))}</div>`;
  const parts = p.prom.path.slice(1).map(x => x.name ? esc(x.name) : `<span class="subtle">ID ${esc(x.id)}</span>`);
  const last = parts.pop();
  const miss = p.prom.found ? '' : `<div class="pt-sub" data-tip="Цієї категорії Prom немає в жодному з файлів комісій, тому немає її назви й комісії.">немає у файлах комісій</div>`;
  return `<span class="pt-path">${parts.join('<span class="arrow-to">›</span>')}${parts.length ? '<span class="arrow-to">›</span>' : ''}<b>${last}</b></span>${ids}${miss}`;
}

// Комісія — лише «Єдина» (користувач 29.09.2026: інші режими не потрібні), дві колонки:
// «Єдина комісія» — % від ціни (під ним сума в гривнях для ціни товару), «Комісія за
// перехід» — гривні за перехід. Заповнена одна з двох: категорія є лише в одному файлі.
function feeCells(p) {
  const empty = '<td class="num"></td>';
  if (!p.prom) return empty + empty;
  const v = pct(p.prom.single);
  if (!p.prom.found || v == null) return '<td class="num"><span class="subtle" data-tip="Цієї категорії Prom немає в жодному з файлів комісій.">немає</span></td>' + empty;
  if (p.prom.mode === 'click') return empty + `<td class="num">${money(v)} ₴</td>`;
  const price = parseFloat(p.price);
  const sum = Number.isFinite(price) ? `<div class="pt-sub">${money(price * v / 100)} ₴</div>` : '';
  return `<td class="num">${esc(p.prom.single)}${sum}</td>` + empty;
}

// Сортування за комісією: рядок несе % і гривні за перехід; порожні — завжди внизу.
function sortAttrs(p, i) {
  const v = p.prom && p.prom.found ? pct(p.prom.single) : null;
  const order = p.prom && p.prom.mode === 'order' ? v : null, click = p.prom && p.prom.mode === 'click' ? v : null;
  return ` data-i="${i}" data-single="${order == null ? '' : order}" data-click="${click == null ? '' : click}"`;
}

// Клієнтський код сортування — серіалізується в сторінку через .toString().
function initFeeSort() {
  var tb = document.getElementById('pt-rows');
  var ths = Array.prototype.slice.call(document.querySelectorAll('th[data-sort]'));
  var st = { k: null, dir: 0 };
  function num(tr, k) { var v = parseFloat(tr.getAttribute('data-' + k)); return isNaN(v) ? null : v; }
  function apply() {
    var rows = Array.prototype.slice.call(tb.rows);
    rows.sort(function (a, b) {
      var ia = +a.getAttribute('data-i'), ib = +b.getAttribute('data-i');
      if (!st.k) return ia - ib;
      var va = num(a, st.k), vb = num(b, st.k);
      if (va === null || vb === null) return (va === null) - (vb === null) || ia - ib;
      return (va - vb) * st.dir || ia - ib;
    });
    rows.forEach(function (r) { tb.appendChild(r); });
    ths.forEach(function (th) {
      var on = th.getAttribute('data-sort') === st.k;
      th.classList.toggle('active', on);
      th.setAttribute('aria-sort', on ? (st.dir < 0 ? 'descending' : 'ascending') : 'none');
      th.querySelector('.sort-ind').textContent = on ? (st.dir < 0 ? ' ▼' : ' ▲') : '';
    });
  }
  function click(th) {
    var k = th.getAttribute('data-sort');
    if (st.k !== k) { st.k = k; st.dir = -1; }
    else if (st.dir < 0) st.dir = 1;
    else { st.k = null; st.dir = 0; }
    apply();
  }
  ths.forEach(function (th) {
    th.addEventListener('click', function () { click(th); });
    th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(th); } });
  });
}

function render(data) {
  const byId = loadCommission();
  // Назви проміжних рівнів з ланцюжків товарів, чия категорія у файлах є.
  const names = new Map();
  for (const p of data.products) {
    const r = p.chain && byId.get(p.chain[0]);
    if (r) p.chain.slice().reverse().forEach((id, k) => { if (r.names[k]) names.set(id, r.names[k]); });
  }
  data.products.forEach(p => { p.prom = resolveProm(p.chain, byId, names); });
  const ps = data.products, ok = ps.filter(p => !p.error);
  const withChain = ok.filter(p => p.chain && p.chain.length), withProm = ok.filter(p => p.prom && p.prom.found);
  const byMode = m => withProm.filter(p => p.prom.mode === m).length;
  const promCats = new Set(withChain.map(p => p.chain[0]));
  const rows = ps.map((p, i) => `
          <tr${sortAttrs(p, i)}>
            <td class="num subtle">${i + 1}</td>
            <td><a class="pname" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>${p.sku ? `<div class="pt-sub"><span class="code">${esc(p.sku)}</span></div>` : ''}</td>
            <td class="num">${p.price ? esc(money(parseFloat(p.price))) + ' ₴' : ''}${p.priceUsd ? `<div class="pt-sub">$${esc(p.priceUsd)}</div>` : ''}</td>
            <td><a class="cat-link" href="${esc(data.category.id)}_map.html#cat=${encodeURIComponent(p.shopCatId)}">${esc(p.shopCatName)}</a>${p.groupId && p.groupId !== p.shopCatId ? `<div class="pt-sub" data-tip="Сайт вказує іншу категорію магазину (ec_group_id), ніж та, де товар знайшов скрапер.">група ${esc(p.groupId)}</div>` : ''}</td>
            <td>${p.error ? `<span class="count-no">${esc(p.error)}</span>` : promHtml(p)}</td>
            <td class="num c">${p.prom ? p.prom.level : ''}</td>
            ${feeCells(p)}
            <td class="num">${p.attrs && p.attrs.length ? `<span data-tip-source="site" data-tip="${esc(p.attrs.map(a => a.join(': ')).join('\n'))}">${p.attrs.length}</span>` : (p.error ? '' : '<span class="subtle">0</span>')}</td>
            <td class="num">${p.error ? '' : p.descLen ? p.descLen : '<span class="count-no">0</span>'}</td>
            <td>${p.error ? '' : flagsHtml(p)}</td>
          </tr>`).join('');
  const when = fmtDateTime(new Date(data.generatedAt));
  const css = `
html, body { height: auto; overflow: visible; }
.pt-wrap { padding: 20px 24px 48px; }
.pt-wrap h1 { font-size: 1.25rem; margin: 0 0 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
/* «?» — голий знак питання, як у полі пошуку (без кружечка). */
.pt-help-btn { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 4px; background: none;
  color: var(--text-muted); font: inherit; font-size: 1.05rem; font-weight: 600; line-height: 1; cursor: pointer; }
.pt-help-btn:hover { color: var(--text-link); background: var(--bg-hover); }
.pt-help-btn:focus-visible { outline: 2px solid var(--border-active); outline-offset: 1px; }
/* Пояснення — модальне вікно (.help-overlay, як панелі на map.html), а не блок над таблицею:
   блок, що з'являвся й зникав, зсував таблицю на 179 рядків, і браузер щоразу
   перераховував її розмітку — сторінка підвисала після кількох кліків (29.09.2026). */
.pt-note { font-size: .85rem; line-height: 1.6; color: var(--text-main); padding-top: 14px; gap: 10px; }
.pt-note a { color: var(--text-link); }
.pt-stats { display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 0 0 18px; font-size: .85rem; color: var(--text-muted); }
.pt-stats b { color: var(--text-main); font-weight: 600; }
.pt-wrap h2 { font-size: 1rem; margin: 22px 0 8px; font-weight: 600; }
/* overflow: clip, не hidden: hidden робить картку контейнером прокрутки, і sticky-шапка
   таблиці чіплялася б до неї, а не до вікна (тоді вона не закріплюється зовсім). */
.pt-card { background: var(--bg-white); border: 1px solid var(--border-color); border-radius: 8px; overflow: clip; }
/* 11 колонок мають влазити від 1300px без горизонтальної прокрутки: ширини фіксовані
   (<colgroup>), решту ділять «Товар» і «Категорія Prom»; відступи вужчі за звичайні. */
.pt-table { table-layout: fixed; }
/* «Товар» — на 30% вужчий, ніж коли він ділив залишок порівну з «Категорією Prom»
   (користувач 29.09.2026), на будь-якій ширині: 0.7 × (T − 728) / 2, де T — ширина таблиці,
   728 — сума фіксованих колонок до того, як «Категорію магазину» розширили до 240px.
   cqw, а не %: calc() з % у ширині колонки браузер ігнорує (стає auto). */
.pt-card { container-type: inline-size; }
.pt-col-name { width: calc(35cqw - 254.8px); }
/* Шапка таблиці закріплена під шапкою сайту (.app-header, 44px) при прокрутці сторінки.
   Нижня межа — тінню: з border-collapse рамка sticky-комірки лишається на місці. */
.pt-table thead th { position: sticky; top: 44px; z-index: 5; box-shadow: inset 0 -1px 0 var(--border-color); }
.pt-table th, .pt-table td { padding: 6px 7px; }
.pt-table th { white-space: nowrap; vertical-align: bottom; }
.pt-table td { vertical-align: top; line-height: 1.45; overflow-wrap: break-word; }
/* Переноси з дефісом лише у вузьких колонках категорій: на 1300px довгі слова
   («радіовимірювальні») інакше рвались посередині без дефіса. */
.pt-table td:nth-child(4), .pt-table td:nth-child(5) { hyphens: auto; }
.pt-table th.th-sort:hover, .pt-table th.th-sort.active { color: var(--text-main); }
.pt-table th.th-sort:focus-visible { outline: 2px solid var(--border-active); outline-offset: -2px; }
.sort-ind { color: var(--text-link); }
.pt-table .c { text-align: center; }
.pt-table td.num, .pt-table th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pt-table .pt-sub { white-space: nowrap; }
.pt-sub { font-size: .72rem; color: var(--text-subtle); margin-top: 2px; }
.pt-ids { font-family: var(--font-mono); font-size: .7rem; color: var(--text-subtle); margin-top: 2px; }
.pt-path { color: var(--text-muted); }
.pt-path b { color: var(--text-main); font-weight: 600; }
.pt-tag { display: inline-block; font-size: .7rem; padding: 0 6px; margin: 0 4px 3px 0; border-radius: 999px; border: 1px solid var(--border-dark); color: var(--text-muted); white-space: nowrap; }
.pt-flags { display: inline-block; }
.pname { color: var(--text-main); text-decoration: none; }
.pname:hover { color: var(--text-link); text-decoration: underline; }
.cat-link { color: var(--text-muted); text-decoration: none; }
.cat-link:hover { color: var(--text-link); text-decoration: underline; }
.arrow-to { color: var(--text-faint); margin: 0 5px; }
.code { font-family: var(--font-mono); }
`;
  const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Тест платформи: ${esc(data.category.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="map-common.css${assetVer(path.join(DIR, 'map-common.css'))}">
<style>${css}</style>
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="catalog-title">cncprom.ua</span>
      <span class="btn-theme-toggle catalog-subtitle-btn" style="cursor:default">${ICONS.platform} Тест платформи · ${esc(when)}</span>
    </div>
    <div class="header-center"></div>
    <div class="header-right">
      <a href="map.html" class="btn-theme-toggle" data-tip="Мапа всіх категорій сайту">${ICONS.map} Мапа сайту</a>
${helpButtonHtml('map')}
      <button id="btn-theme-toggle" class="btn-theme-toggle"><span class="theme-icon">🌙</span> <span class="theme-text">Темна</span></button>
      <a href="https://cncprom.ua/ua/" class="link-site" target="_blank" rel="noopener">cncprom.ua ↗</a>
    </div>
  </header>
${narrowGuardHtml()}
  <main class="pt-wrap">
    <h1>${ICONS.platform} Тест платформи: <a class="cat-link" href="${esc(data.category.id)}_map.html">${esc(data.category.name)}</a>
      <button type="button" id="pt-note-btn" class="pt-help-btn" aria-haspopup="dialog" data-tip="Про цей тест і звідки дані">?</button></h1>
    <div class="pt-stats">
      <span>Товарів <b>${ps.length}</b></span>
      <span>Сторінку прочитано <b>${ok.length}</b></span>
      <span>Є категорія Prom <b>${withChain.length}</b></span>
      <span>Комісія за замовлення <b>${byMode('order')}</b></span>
      <span>Комісія за перехід <b>${byMode('click')}</b></span>
      <span>Різних категорій Prom <b>${promCats.size}</b></span>
    </div>

    <h2>Товари (${ps.length})</h2>
    <div class="pt-card"><table class="simple-table pt-table">
      <colgroup>
        <col style="width:34px"><col class="pt-col-name"><col style="width:88px"><col style="width:240px"><col>
        <col style="width:64px"><col style="width:104px"><col style="width:84px">
        <col style="width:106px"><col style="width:52px"><col style="width:96px">
      </colgroup>
      <thead><tr>
        <th class="num">№</th><th>Товар</th><th class="num">Ціна</th><th>Категорія<br>магазину</th>
        <th>Категорія Prom</th>
        <th class="num c" data-tip="Рівень категорії Prom">Рівень<br>категорії</th>
        <th class="num th-sort" role="button" tabindex="0" aria-sort="none" data-sort="single" data-tip="Єдина комісія за замовлення у % від ціни
Клік сортує: спершу більші, повторний клік навпаки, третій повертає як було. Порожні завжди внизу.">Комісія<span class="sort-ind"></span><br>за замовлення</th>
        <th class="num th-sort" role="button" tabindex="0" aria-sort="none" data-sort="click" data-tip="Єдина комісія за перехід на картку товару, грн
Клік сортує: спершу більші, повторний клік навпаки, третій повертає як було. Порожні завжди внизу.">Комісія<span class="sort-ind"></span><br>за перехід</th>
        <th class="num" data-tip="Кількість характеристик у картці товару; список у підказці.">Характеристики</th>
        <th class="num" data-tip="Довжина опису товару, символів.">Опис</th>
        <th data-tip="Позначки платформи. У підказці всі службові поля як є.">Позначки<br>платформи</th>
      </tr></thead>
      <tbody id="pt-rows">${rows}
      </tbody>
    </table></div>
  </main>
  <div class="help-overlay" id="pt-note-overlay" role="dialog" aria-modal="true" aria-labelledby="pt-note-title">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3 id="pt-note-title">Про тест платформи</h3>
        <button class="btn-help-close" id="btn-pt-note-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body pt-note">
        <p><b>Це пробний тест.</b> Перевіряємо, що ще можна дізнатися про товари зі сторінок товарів на платформі Prom, крім того, що вже збирає скрапер. Поки лише одна категорія, «${esc(data.category.name)}».</p>
        <p>Категорія платформи Prom (ланцюжок ID її рівнів), ціна й позначки платформи беруться зі службових даних аналітики на сторінці товару. Це не офіційний інтерфейс Prom, і він може змінитися без попередження. Назви категорій Prom і «Єдина комісія» беруться з файлів <a href="${esc(fileUrl(COMMISSION_FILES[0].file))}" target="_blank" rel="noopener">«${esc(COMMISSION_FILES[0].file)}»</a> (у відсотках від ціни) і <a href="${esc(fileUrl(COMMISSION_FILES[1].file))}" target="_blank" rel="noopener">«${esc(COMMISSION_FILES[1].file)}»</a> (у гривнях за перехід). Ціна в доларах — з тих самих службових даних сторінки (Prom сам перераховує ціну в долари). Дані зібрано ${esc(when)}.</p>
      </div>
    </div>
  </div>
  <script src="map-common.js${assetVer(path.join(DIR, 'map-common.js'))}"></script>
  <script>${initFeeSort.toString()}
initThemeToggle(); initHeaderMenus(); initHelpWindow(); initNarrowGuard(); setupTooltips(); initFeeSort();
setupModalOverlay('pt-note-overlay', 'pt-note-btn', 'btn-pt-note-close');</script>
</body>
</html>
`;
  fs.writeFileSync(OUT_HTML, html);
  console.log(`Тест платформи: ${ok.length} з ${ps.length} сторінок, категорій Prom ${promCats.size}, комісія за замовлення ${byMode('order')}, за перехід ${byMode('click')} → ${path.relative(__dirname, OUT_HTML)}`);
}

(async () => {
  let data = null;
  if (REUSE && fs.existsSync(OUT_JSON)) {
    data = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
    console.log(`Тест платформи: беремо наявний ${path.basename(OUT_JSON)} (${data.generatedAt})`);
  } else {
    console.log(`Тест платформи: збираємо категорію ${CAT_ID}…`);
    data = await collect();
  }
  render(data);
})().catch(e => { console.error('Тест платформи:', e.message || e); process.exit(1); });

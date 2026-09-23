// build-reports.js — сторінка змін каталогу output/site/reports/index.html
// (дашборд: шкала змін по днях + порівняння БУДЬ-ЯКИХ двох знімків).
//
// Замінив колишній щоденний HTML-звіт, який показував лише "сьогодні проти
// попереднього дня" й писався окремим файлом на кожен день. Тут diff рахується
// прямо в браузері з компактних знімків, тож порівняти можна будь-яку пару дат,
// а посиланням на порівняння — поділитися (?from=YYYY-MM-DD&to=YYYY-MM-DD).
//
// Джерело — повні знімки <dataDir>/snapshots/<дата>.json (пише
// generate-snapshot.js у гілку data). Вони важать ~1.6 МБ кожен, тому на Pages
// публікується компактна форма — лише те, що потрібне для diff:
//   reports/data/index.json      — список дат, таблиця статусів наявності і
//                                  готовий ряд "змін за день" для графіка;
//   reports/data/<дата>.json     — дерево категорій + [id, категорія, статус]
//                                  на кожен товар (~32 КБ у gzip на день);
//   reports/data/products.json   — словник id → [назва, код, URL] по всіх
//                                  знімках (назви змінюються рідко, тож не
//                                  дублюються в кожному дні).
//   reports/data/categories.json — словник id категорії → URL на сайті (див.
//                                  readCategoryUrls).
// Історія росте на ~12 МБ на рік — далеко від ліміту GitHub Pages (1 ГБ).
//
// ОДНА функція diff (reportDiff) для Node і для браузера — той самий механізм
// .toString(), що й у render-map.js для map-common.js. Node рахує нею ряд для
// графіка, браузер — вибрану пару дат, тож розійтися вони не можуть.
//
// Сторінка підвантажує дані через fetch(), тому (як і пошук по сайту на
// map.html) не працює з file:// — лише через сервер (Pages, Live Server).
//
// Використання:
//   node build-reports.js [dataDir]      dataDir за замовчуванням ./data-branch

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.argv[2] || path.join(__dirname, 'data-branch'));
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const OUT_DIR = path.join(__dirname, 'output', 'site', 'reports');
const SITE_DIR = path.join(__dirname, 'output', 'site');

// id категорії → URL на сайті (data/categories.json). Знімки несуть url
// категорії лише відтоді, як generate-snapshot.js почав його писати
// (23.09.2026); для старіших дат і як запас беремо URL зі свіжих
// <id>_catalog.json (у нічному прогоні build-maps.js уже відпрацював).
// URL зі знімків має пріоритет.
function readCategoryUrls(fromSnapshots) {
  const out = {};
  const walk = n => { if (n.url) out[n.categoryId] = n.url; (n.children || []).forEach(walk); };
  let files = [];
  try { files = fs.readdirSync(SITE_DIR).filter(f => f.endsWith('_catalog.json')); } catch (e) { /* немає output/site — лише знімки */ }
  files.forEach(f => { try { walk(JSON.parse(fs.readFileSync(path.join(SITE_DIR, f), 'utf-8')).tree || {}); } catch (e) { /* пошкоджений файл — пропускаємо */ } });
  return Object.assign(out, fromSnapshots);
}
const OUT_DATA = path.join(OUT_DIR, 'data');

// ==================== СПІЛЬНЕ ДЛЯ NODE І БРАУЗЕРА ====================
// Чисті функції без замикань на Node-змінні — серіалізуються в reports.js.

// Той самий критерій, що й isAvailableRow у scrape-complete.js: лише /готово/,
// бо "Немає в наявності" теж містить підрядок "наявн".
function reportIsYes(s) { return /готово/i.test(s || ''); }

// Компактний знімок { c: [[id, parentId, name, level]], p: [[id, catId, availIdx]] }
// → Map-и для швидкого пошуку.
function reportExpand(snap, avail) {
  var cats = new Map(), prods = new Map();
  snap.c.forEach(function (c) { cats.set(c[0], { id: c[0], parentId: c[1], name: c[2], level: c[3] }); });
  snap.p.forEach(function (p) { prods.set(p[0], { id: p[0], cat: p[1], avail: avail[p[2]] }); });
  return { cats: cats, prods: prods };
}

// Diff двох розгорнутих знімків. Обсяг зафіксовано при плануванні (його
// Markdown у гілці data лишається історією): товари додано / видалено /
// змінили наявність / змінили категорію; категорії додано / видалено /
// перейменовано / перенесено. Перейменування товару свідомо не відстежується.
// Наявність порівнюється за reportIsYes, а не за точним текстом статусу.
function reportDiff(a, b, products) {
  products = products || {};
  function catName(id) { var c = b.cats.get(id) || a.cats.get(id); return c ? c.name : '#' + id; }
  // Розділ 1 рівня: спершу шукаємо в новому знімку, для видаленого — у старому.
  function topOf(id) {
    var cur = b.cats.get(id) || a.cats.get(id), guard = 0;
    while (cur && cur.parentId && guard++ < 12) cur = b.cats.get(cur.parentId) || a.cats.get(cur.parentId);
    return cur || null;
  }
  // Повний шлях "Розділ › … › Категорія" — у таблиці видно лише розділ і саму
  // категорію, а проміжні рівні (часто 2–3) показуються в підказці, інакше
  // категорію важко знайти на сайті.
  // Шлях у ОДНОМУ знімку як [{id, name}] від 1 рівня — для "до" (a) і "після"
  // (b) на вкладці "Категорії": там назви предків саме того дня, а не змішані.
  function chainIn(s, id) {
    var out = [], cur = s.cats.get(id), guard = 0;
    while (cur && guard++ < 12) { out.unshift({ id: cur.id, name: cur.name }); cur = cur.parentId ? s.cats.get(cur.parentId) : null; }
    return out;
  }
  function pathOf(id) {
    var out = [], cur = b.cats.get(id) || a.cats.get(id), guard = 0;
    while (cur && guard++ < 12) { out.unshift(cur.name); cur = cur.parentId ? (b.cats.get(cur.parentId) || a.cats.get(cur.parentId)) : null; }
    return out.length ? out.join(' › ') : '#' + id;
  }
  function row(type, id, cat, avail) {
    var p = products[id] || ['#' + id, '', ''], t = topOf(cat);
    return { type: type, id: id, name: p[0], sku: p[1], url: p[2], cat: cat, catName: catName(cat), catPath: pathOf(cat),
      top: t ? t.id : '', topName: t ? t.name : '—', avail: avail };
  }
  var rows = [], cats = [];
  b.prods.forEach(function (pb, id) {
    var pa = a.prods.get(id);
    if (!pa) { rows.push(row('added', id, pb.cat, pb.avail)); return; }
    if (reportIsYes(pa.avail) !== reportIsYes(pb.avail)) rows.push(row(reportIsYes(pb.avail) ? 'in' : 'out', id, pb.cat, pb.avail));
    if (pa.cat !== pb.cat) { var r = row('moved', id, pb.cat, pb.avail); r.fromCat = pa.cat; r.fromCatName = catName(pa.cat); r.fromCatPath = pathOf(pa.cat); rows.push(r); }
  });
  a.prods.forEach(function (pa, id) { if (!b.prods.has(id)) rows.push(row('removed', id, pa.cat, pa.avail)); });
  b.cats.forEach(function (cb, id) {
    var ca = a.cats.get(id), t = topOf(id), top = t ? t.name : '—';
    if (!ca) { cats.push({ type: 'added', id: id, name: cb.name, path: pathOf(id), level: cb.level, topName: top, after: chainIn(b, id) }); return; }
    if (ca.name !== cb.name) cats.push({ type: 'renamed', id: id, name: cb.name, path: pathOf(id), oldName: ca.name, level: cb.level, topName: top, before: chainIn(a, id), after: chainIn(b, id) });
    if (ca.parentId !== cb.parentId) cats.push({ type: 'moved', id: id, name: cb.name, path: pathOf(id), level: cb.level, topName: top, before: chainIn(a, id), after: chainIn(b, id),
      fromName: ca.parentId ? catName(ca.parentId) : '(корінь)', toName: cb.parentId ? catName(cb.parentId) : '(корінь)' });
  });
  a.cats.forEach(function (ca, id) {
    if (!b.cats.has(id)) { var t = topOf(id); cats.push({ type: 'removed', id: id, name: ca.name, path: pathOf(id), level: ca.level, topName: t ? t.name : '—', before: chainIn(a, id) }); }
  });
  var totals = { in: 0, out: 0, added: 0, removed: 0, moved: 0, cats: cats.length, products: b.prods.size, categories: b.cats.size };
  rows.forEach(function (r) { totals[r.type]++; });
  return { rows: rows, cats: cats, totals: totals };
}

// ==================== КЛІЄНТ ====================
function initReportsPage() {
  var DATA = 'data/';
  var TYPES = ['out', 'in', 'added', 'removed', 'moved'];
  var TYPE = {
    out:     { icon: '▼', label: 'Зникли з наявності', cls: 't-out' },
    in:      { icon: '▲', label: 'Знову в наявності',  cls: 't-in' },
    added:   { icon: '+', label: 'Нові товари',        cls: 't-add' },
    removed: { icon: '−', label: 'Видалені товари',    cls: 't-rem' },
    moved:   { icon: '⇄', label: 'Змінили категорію',  cls: 't-mov' }
  };
  var CAT = { added: ['+', 'Нова категорія', 't-add'], removed: ['−', 'Видалена', 't-rem'], renamed: ['✎', 'Перейменована', 't-mov'], moved: ['⇄', 'Перенесена', 't-mov'] };
  var ORDER = { out: 0, in: 1, added: 2, removed: 3, moved: 4 };
  var PAGE = 200;

  var idx, products, catUrls = {}, snaps = {}, D, range = {}, st = { tab: 'prod', types: {}, q: '', top: '', limit: PAGE };
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function fmtShort(d) { var p = d.split('-'); return p[2] + '.' + p[1]; }
  function fmtLong(d) { var p = d.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function badge(type, short) {
    var t = TYPE[type];
    return '<span class="tb ' + t.cls + '"' + (short ? ' aria-label="' + esc(t.label) + '"' : '') + '><span class="ic" aria-hidden="true">' + t.icon + '</span>' + (short ? '' : esc(t.label)) + '</span>';
  }

  function getJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.json(); });
  }
  function loadSnap(date) {
    if (!snaps[date]) snaps[date] = getJson(DATA + date + '.json').then(function (s) { return reportExpand(s, idx.avail); });
    return snaps[date];
  }

  function fail(err) {
    $('panel-wrap').innerHTML = '<div class="card empty"><b>⚠️ Не вдалося завантажити дані звіту</b>' +
      'Якщо сторінка відкрита подвійним кліком з диска — браузер блокує fetch() локальних файлів; відкрийте її через сервер (напр. Live Server). ' +
      'Якщо через сервер — перевірте, що reports/data/ існує (його пише build-reports.js).<div class="subtle" style="margin-top:8px">' + esc(err && err.message) + '</div></div>';
    $('chart-card').style.display = 'none'; $('tiles').style.display = 'none';
  }

  // ---------- Період ----------
  function readRange() {
    var q = new URLSearchParams(location.search), ds = idx.dates, last = ds[ds.length - 1];
    var to = ds.indexOf(q.get('to')) > 0 ? q.get('to') : last;
    var from = ds.indexOf(q.get('from')) >= 0 && q.get('from') < to ? q.get('from') : ds[ds.indexOf(to) - 1];
    range.from = from; range.to = to;
  }
  // Швидкі кнопки завжди рахуються від ОСТАННЬОГО знімка, а не від вибраного
  // "по" — інакше "Останній день" при періоді 16.09→17.09 підсвічувався як
  // активний і по кліку давав 16→17, а не передостанній→останній.
  // "Тиждень" — календарні 7 днів: найпізніший знімок не пізніше last − 7 днів
  // (якщо якоїсь ночі знімка нема, період трохи довший, а не коротший).
  function quickRange(q) {
    var ds = idx.dates, last = ds[ds.length - 1];
    if (q === 'all') return { from: ds[0], to: last };
    if (q === 'week') {
      var t = new Date(last + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 7);
      var bound = t.toISOString().slice(0, 10);
      var older = ds.filter(function (d) { return d <= bound; });
      return { from: older.length ? older[older.length - 1] : ds[0], to: last };
    }
    return { from: ds[ds.length - 2], to: last };
  }
  function drawRange() {
    var ds = idx.dates;
    $('rf').innerHTML = ds.filter(function (d) { return d < range.to; }).map(function (d) {
      return '<option value="' + d + '"' + (d === range.from ? ' selected' : '') + '>' + fmtLong(d) + '</option>'; }).join('');
    $('rt').innerHTML = ds.slice(1).map(function (d) {
      return '<option value="' + d + '"' + (d === range.to ? ' selected' : '') + '>' + fmtLong(d) + (d === ds[ds.length - 1] ? ' (останній)' : '') + '</option>'; }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('[data-q]'), function (b) {
      var r = quickRange(b.getAttribute('data-q'));
      b.setAttribute('aria-pressed', String(r.from === range.from && r.to === range.to));
    });
    $('period-label').textContent = fmtLong(range.from) + ' → ' + fmtLong(range.to);
  }
  function setRange(from, to) {
    var ds = idx.dates;
    range.to = to;
    range.from = from < to ? from : ds[ds.indexOf(to) - 1];
    var q = new URLSearchParams(location.search); q.set('from', range.from); q.set('to', range.to);
    history.replaceState(null, '', '?' + q.toString());
    update();
  }

  // ---------- Графік "змін за день" ----------
  // Одна серія (разом змін за день) — розбивка за типами в підказці; колір
  // стовпчика — не статусний, щоб не змішуватися з бейджами наявності.
  function niceMax(v) { if (v <= 5) return 5; var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function dayTotal(d) { var t = d.t; return t ? t.in + t.out + t.added + t.removed + t.moved + t.cats : null; }
  function drawChart() {
    var svg = $('chart'), W = svg.clientWidth || 800, H = 190, pl = 40, pr = 8, pt = 18, pb = 24;
    var days = idx.daily, n = days.length, band = (W - pl - pr) / n, bw = Math.min(24, band * 0.55);
    var max = Math.max.apply(null, days.map(function (d) { return dayTotal(d) || 0; })), top = niceMax(max);
    var y = function (v) { return pt + (H - pt - pb) * (1 - v / top); };
    // Підписи осі X: спершу межі вибраного періоду, потім останній день, потім
    // решта — і кожен ставиться, лише якщо не налазить на вже поставлені (на
    // вузькому екрані чи за довгу історію сусідні дати інакше злипаються).
    var MIN_GAP = 42, placed = [], labels = {};
    var labelX = function (i) { return Math.max(pl + 16, Math.min(W - pr - 16, pl + band * i + band / 2)); };
    var prio = days.map(function (d, i) {
      var p = (d.date === range.to || d.date === range.from) ? 0 : i === n - 1 ? 1 : 2;
      return { i: i, p: p };
    }).sort(function (x, y) { return x.p - y.p || x.i - y.i; });
    prio.forEach(function (c) {
      var x = labelX(c.i);
      if (placed.every(function (px) { return Math.abs(px - x) >= MIN_GAP; })) { placed.push(x); labels[c.i] = true; }
    });
    var out = '', maxLabeled = false;
    [0, top / 2, top].forEach(function (v) {
      out += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="axis" x="' + (pl - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + Math.round(v) + '</text>';
    });
    days.forEach(function (d, i) {
      var cx = pl + band * i + band / 2, tot = dayTotal(d), inR = d.date > range.from && d.date <= range.to;
      var edge = d.date === range.to || d.date === range.from;
      out += '<g data-i="' + i + '">';
      if (tot) {
        var r = Math.min(4, y(0) - y(tot), bw / 2), x0 = cx - bw / 2, x1 = cx + bw / 2, yb = y(0), yt = y(tot);
        out += '<path class="bar' + (inR ? '' : ' off') + '" d="M' + x0 + ',' + yb + 'V' + (yt + r) + 'Q' + x0 + ',' + yt + ' ' + (x0 + r) + ',' + yt +
          'H' + (x1 - r) + 'Q' + x1 + ',' + yt + ' ' + x1 + ',' + (yt + r) + 'V' + yb + 'Z"/>';
        if (tot === max && !maxLabeled && (maxLabeled = true)) out += '<text class="cap" x="' + cx + '" y="' + (yt - 5) + '">' + tot + '</text>';
      }
      if (labels[i]) {
        var lx = labelX(i);
        out += '<text class="axis' + (edge ? ' cur' : '') + '" x="' + lx + '" y="' + (H - 6) + '" text-anchor="middle">' + fmtShort(d.date) + '</text>';
      }
      // Зона кліку — ПОВЕРХ стовпчика й на всю висоту колонки: ціль більша за саму позначку.
      out += '<rect class="hit" x="' + (pl + band * i) + '" y="' + pt + '" width="' + band + '" height="' + (H - pt) + '"/></g>';
    });
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML = out;
  }
  function chartTip(e) {
    var tip = $('chart-tip'), g = e.target.closest && e.target.closest('g[data-i]');
    if (!g) { tip.style.display = 'none'; return; }
    var i = +g.getAttribute('data-i'), d = idx.daily[i];
    if (!d.t) tip.innerHTML = '<b>' + fmtLong(d.date) + '</b><div class="foot">Перший знімок — порівнювати нема з чим</div>';
    else tip.innerHTML = '<b>' + fmtLong(d.date) + ' · змін: ' + dayTotal(d) + '</b>' +
      TYPES.map(function (k) { return '<div class="row"><span>' + TYPE[k].icon + ' ' + TYPE[k].label + '</span><span>' + d.t[k] + '</span></div>'; }).join('') +
      '<div class="row"><span>✎ Структура категорій</span><span>' + d.t.cats + '</span></div>' +
      '<div class="foot">Клік — порівняти з ' + fmtShort(idx.dates[i - 1]) + (range.to > d.date ? ' по ' + fmtShort(range.to) : '') + '</div>';
    tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
  }
  function drawChartTable() {
    $('chart-table').innerHTML = '<table><tr><th>День</th><th>Разом</th>' +
      TYPES.map(function (k) { return '<th data-tip="' + esc(TYPE[k].label) + '">' + TYPE[k].icon + '</th>'; }).join('') + '<th data-tip="Структура категорій">✎</th></tr>' +
      idx.daily.filter(function (d) { return d.t; }).map(function (d) {
        return '<tr><td>' + fmtLong(d.date) + '</td><td>' + dayTotal(d) + '</td>' + TYPES.map(function (k) { return '<td>' + d.t[k] + '</td>'; }).join('') + '<td>' + d.t.cats + '</td></tr>';
      }).join('') + '</table>';
  }

  // ---------- Картки ----------
  function drawTiles() {
    var t = D.totals;
    $('tiles').innerHTML = TYPES.map(function (k) {
      var on = st.tab === 'prod' && Object.keys(st.types).length === 1 && !!st.types[k];
      return '<button class="card tile" data-type="' + k + '" aria-pressed="' + on + '">' + badge(k, true) +
        '<span class="num' + (t[k] ? '' : ' zero') + '">' + t[k] + '</span><span class="lbl">' + TYPE[k].label + '</span></button>';
    }).join('') +
      '<button class="card tile" data-type="cats" aria-pressed="' + (st.tab === 'cats') + '"><span class="tb t-mov" aria-label="Структура категорій"><span class="ic" aria-hidden="true">✎</span></span>' +
      '<span class="num' + (t.cats ? '' : ' zero') + '">' + t.cats + '</span><span class="lbl">Змін у структурі категорій</span></button>';
  }

  // ---------- Таблиці ----------
  // Назва категорії → посилання на її сторінку на сайті; повний шлях — у
  // підказці. Без URL (категорія зникла раніше, ніж знімки почали зберігати
  // URL) — просто текст із тією ж підказкою.
  function catLink(id, name, path) {
    var u = catUrls[id];
    return u ? '<a class="cat-site" href="' + esc(u) + '" data-tip="' + esc(path) + '">' + esc(name) + '</a>'
      : '<span data-tip="' + esc(path) + '">' + esc(name) + '</span>';
  }
  function detail(r) {
    if (r.type === 'in')  return '<span class="subtle">Немає</span><span class="arrow-to">→</span><b class="count-yes">В наявності</b>';
    if (r.type === 'out') return '<span class="subtle">В наявності</span><span class="arrow-to">→</span><b class="count-no">Немає</b>';
    if (r.type === 'moved') return '<span class="subtle">' + catLink(r.fromCat, r.fromCatName, r.fromCatPath) + '</span><span class="arrow-to">→</span>' + catLink(r.cat, r.catName, r.catPath);
    if (r.type === 'added') return '<span class="muted">' + (reportIsYes(r.avail) ? 'В наявності' : 'Немає в наявності') + '</span>';
    return '<span class="subtle">зник із сайту</span>';
  }
  function productTable(rows) {
    var shown = rows.slice(0, st.limit);
    return '<div class="result-line">Показано ' + shown.length + ' з ' + rows.length + '</div>' +
      '<div class="table-wrap"><table class="simple-table rep-table"><thead><tr>' +
      '<th style="width:170px">Зміна</th><th style="width:110px">Код</th><th>Товар</th><th style="width:26%">Категорія</th><th style="width:24%">Що змінилось</th>' +
      '</tr></thead><tbody>' + shown.map(function (r) {
        return '<tr><td>' + badge(r.type) + '</td>' +
          '<td>' + (r.sku ? '<span class="code">' + esc(r.sku) + '</span>' : '<span class="subtle">—</span>') + '</td>' +
          '<td>' + (r.url ? '<a class="pname" href="' + esc(r.url) + '">' + esc(r.name) + '</a>' : esc(r.name)) + '</td>' +
          '<td>' + (r.top ? '<a class="cat-link" href="../' + esc(r.top) + '_map.html">' + esc(r.topName) + '</a>' : '<span class="muted">' + esc(r.topName) + '</span>') +
          (r.catName !== r.topName ? '<span class="arrow-to">›</span>' + catLink(r.cat, r.catName, r.catPath) : '') + '</td>' +
          '<td>' + detail(r) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (rows.length > st.limit ? '<div class="more-row"><button class="chip" data-more>Показати ще ' + Math.min(PAGE, rows.length - st.limit) + ' з ' + (rows.length - st.limit) + '</button></div>' : '');
  }
  function catTable(cats) {
    if (!cats.length) return '<div class="empty"><b>Структура каталогу не змінилась</b>За цей період жодна категорія не з\'явилась, не зникла, не перейменована й не перенесена.</div>';
    // "Що змінилось" — повний шлях від 1 рівня до і після; кожна ланка веде на
    // мапу розділу одразу на цю категорію (#cat=<id>, див. selectFromHash у
    // render-map.js). Назва в колонці "Категорія" веде на сайт (catLink).
    function pathHtml(chain) {
      if (!chain || !chain.length) return '<span class="subtle">—</span>';
      var top = chain[0].id;
      return chain.map(function (n) {
        return '<a class="path-link" href="../' + esc(top) + '_map.html#cat=' + encodeURIComponent(n.id) + '">' + esc(n.name) + '</a>';
      }).join('<span class="arrow-to">›</span>');
    }
    function line(label, chain) { return '<div class="path-line"><span class="path-label">' + label + '</span>' + pathHtml(chain) + '</div>'; }
    return '<div class="table-wrap"><table class="simple-table rep-table"><thead><tr><th style="width:170px">Зміна</th><th style="width:26%">Категорія</th><th>Що змінилось</th></tr></thead><tbody>' +
      cats.map(function (c) {
        var k = CAT[c.type];
        var d = c.type === 'added' ? line('Стало:', c.after)
          : c.type === 'removed' ? line('Було:', c.before)
          : line('Було:', c.before) + line('Стало:', c.after);
        return '<tr><td><span class="tb ' + k[2] + '"><span class="ic" aria-hidden="true">' + k[0] + '</span>' + k[1] + '</span></td><td>' + catLink(c.id, c.name, c.path) + '</td><td>' + d + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function filtered() {
    var q = st.q.trim().toLowerCase(), any = Object.keys(st.types).length > 0;
    return D.rows.filter(function (r) {
      if (any && !st.types[r.type]) return false;
      if (st.top && r.top !== st.top) return false;
      return !q || (r.name + ' ' + r.sku + ' ' + r.catName + ' ' + r.topName).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      return (ORDER[a.type] - ORDER[b.type]) || a.topName.localeCompare(b.topName, 'uk') || a.name.localeCompare(b.name, 'uk');
    });
  }
  function render() {
    drawTiles();
    $('tabs').innerHTML =
      '<button class="tab" role="tab" data-tab="prod" aria-selected="' + (st.tab === 'prod') + '">Товари<span class="n">' + D.rows.length + '</span></button>' +
      '<button class="tab" role="tab" data-tab="cats" aria-selected="' + (st.tab === 'cats') + '">Категорії<span class="n">' + D.cats.length + '</span></button>';
    var panel = $('panel');
    if (st.tab === 'cats') { panel.innerHTML = catTable(D.cats); return; }
    var tops = {}; D.rows.forEach(function (r) { if (r.top) tops[r.top] = r.topName; });
    var rows = filtered(), focused = document.activeElement && document.activeElement.id === 'q';
    panel.innerHTML =
      '<div class="filters"><div class="chips" role="group" aria-label="Тип зміни">' + TYPES.map(function (k) {
        var n = D.totals[k];
        return '<button class="chip" data-chip="' + k + '" aria-pressed="' + !!st.types[k] + '"' + (n ? '' : ' disabled') + '>' + TYPE[k].icon + ' ' + TYPE[k].label + '<span class="n">' + n + '</span></button>';
      }).join('') + '</div><div class="right">' +
      '<select id="top" aria-label="Розділ 1 рівня"><option value="">Усі розділи</option>' + Object.keys(tops).sort(function (a, b) { return tops[a].localeCompare(tops[b], 'uk'); })
        .map(function (id) { return '<option value="' + esc(id) + '"' + (id === st.top ? ' selected' : '') + '>' + esc(tops[id]) + '</option>'; }).join('') + '</select>' +
      '<input id="q" class="search-mini" type="search" placeholder="Пошук: назва, код, категорія" value="' + esc(st.q) + '"></div></div>' +
      (rows.length ? productTable(rows)
        : '<div class="empty"><b>' + (D.rows.length ? 'Нічого не знайдено' : 'Товари за цей період не змінювались') + '</b>' +
          (D.rows.length ? 'Зніміть фільтри або змініть запит.' : 'Оберіть ширший період — угорі або кліком по графіку.') + '</div>');
    if (focused) { var qi = $('q'); qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
  }

  // ---------- Оновлення ----------
  var seq = 0;
  function update() {
    drawRange(); drawChart();
    if (!$('panel')) return; // після fail() панелі вже немає
    var my = ++seq;
    $('panel').innerHTML = '<div class="empty subtle">Завантажуємо знімки…</div>';
    Promise.all([loadSnap(range.from), loadSnap(range.to)]).then(function (s) {
      if (my !== seq) return; // користувач уже обрав інший період — застарілу відповідь відкидаємо
      D = reportDiff(s[0], s[1], products);
      st.limit = PAGE; render();
    }).catch(fail);
  }

  // ---------- Події ----------
  function bindEvents() {
    $('rf').addEventListener('change', function (e) { setRange(e.target.value, range.to); });
    $('rt').addEventListener('change', function (e) { setRange(range.from, e.target.value); });
    $('quick').addEventListener('click', function (e) { var b = e.target.closest('[data-q]'); if (b) { var r = quickRange(b.getAttribute('data-q')); setRange(r.from, r.to); } });
    var svg = $('chart');
    svg.addEventListener('mousemove', chartTip);
    svg.addEventListener('mouseleave', function () { $('chart-tip').style.display = 'none'; });
    svg.addEventListener('click', function (e) {
      var g = e.target.closest('g[data-i]'); if (!g) return;
      var i = +g.getAttribute('data-i'); if (i === 0) return;
      var d = idx.dates[i];
      setRange(idx.dates[i - 1], range.to >= d ? range.to : d);
    });
    window.addEventListener('resize', drawChart);
    $('tiles').addEventListener('click', function (e) {
      var b = e.target.closest('[data-type]'); if (!b) return;
      var k = b.getAttribute('data-type');
      if (k === 'cats') st.tab = 'cats';
      else { var only = st.tab === 'prod' && Object.keys(st.types).length === 1 && st.types[k]; st.types = {}; if (!only) st.types[k] = true; st.tab = 'prod'; }
      st.limit = PAGE; render();
    });
    $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) { st.tab = b.getAttribute('data-tab'); render(); } });
    var panel = $('panel');
    panel.addEventListener('click', function (e) {
      var c = e.target.closest('[data-chip]');
      if (c) { var k = c.getAttribute('data-chip'); if (st.types[k]) delete st.types[k]; else st.types[k] = true; st.limit = PAGE; render(); return; }
      if (e.target.closest('[data-more]')) { st.limit += PAGE; render(); }
    });
    panel.addEventListener('change', function (e) { if (e.target.id === 'top') { st.top = e.target.value; st.limit = PAGE; render(); } });
    panel.addEventListener('input', function (e) { if (e.target.id === 'q') { st.q = e.target.value; st.limit = PAGE; render(); } });
  }

  initThemeToggle();
  setupModalOverlay('help-overlay', 'btn-help', 'btn-help-close');
  setupTooltips();
  Promise.all([getJson(DATA + 'index.json'), getJson(DATA + 'products.json'),
    getJson(DATA + 'categories.json').catch(function () { return {}; })]).then(function (r) {
    idx = r[0]; products = r[1]; catUrls = r[2];
    $('generated').textContent = fmtLong(idx.dates[idx.dates.length - 1]);
    if (idx.dates.length < 2) {
      $('panel-wrap').innerHTML = '<div class="card empty"><b>Поки що є лише один знімок (' + fmtLong(idx.dates[0]) + ')</b>Порівняння з\'явиться після наступного нічного прогону.</div>';
      $('chart-card').style.display = 'none'; $('tiles').style.display = 'none'; $('range').style.display = 'none';
      return;
    }
    readRange(); drawChartTable(); bindEvents(); update();
  }).catch(fail);
}

// ==================== СТИЛІ ====================
// Кольори, шрифти й темна тема — з ../map-common.css; тут лише компоненти звіту.
// --chg-bar (колір стовпчика) перевірено валідатором палітр в обох темах:
// контраст із поверхнею ≥ 3:1, світла — #2563eb на #fff, темна — #3794ff на #1f1f1f.
const css = `
:root { --chg-bar: #2563eb; --chg-mov: #6d28d9; --chg-mov-bg: #f5f3ff; --chg-mov-border: #ddd6fe; }
:root[data-theme="dark"] { --chg-bar: #3794ff; --chg-mov: #b4a0ff; --chg-mov-bg: rgba(180,160,255,.12); --chg-mov-border: rgba(180,160,255,.28); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --chg-bar: #3794ff; --chg-mov: #b4a0ff; --chg-mov-bg: rgba(180,160,255,.12); --chg-mov-border: rgba(180,160,255,.28); } }

/* map-common.css робить html,body { height:100%; overflow:hidden } — для
   <id>_map.html, де прокручується лише внутрішня .main-content. Тут, як і на
   map.html, прокручується весь документ; без цього перевизначення сторінка
   колесом не прокручувалась узагалі й таблиця нижче першого екрана була
   недосяжна. Саме visible, НЕ auto — з тієї ж причини, що й у build-maps.js:
   auto на html і body разом робить body окремим скрол-контейнером, і липка
   .app-header їде разом зі сторінкою. */
html, body { height: auto; overflow: visible; }
/* Смуга прокрутки й нативні елементи (select) — у кольорах поточної теми.
   Без color-scheme браузер малює світлу смугу навіть на темній сторінці.
   Тема задається перемикачем (data-theme) або системою — враховано обидва. */
:root { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; } }
.rep-wrap { max-width: 1280px; margin: 0 auto; padding: 20px 20px 48px; }
.card { background: var(--bg-white); border: 1px solid var(--border-color); border-radius: 10px; }
.top-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.top-row h1 { font-size: 1.25rem; margin: 0; font-weight: 600; }
.top-row h1 .muted { font-weight: 400; font-size: .9rem; margin-left: 6px; }

.range-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.range-bar label { font-size: .8rem; color: var(--text-muted); }
.range-bar select, .filters select { font: inherit; font-size: .85rem; padding: 5px 8px; border: 1px solid var(--border-dark); border-radius: 6px; background: var(--bg-white); color: var(--text-main); }
.filters select { max-width: 260px; }
.range-arrow { color: var(--text-subtle); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font: inherit; font-size: .78rem; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border-dark); background: var(--bg-white); color: var(--text-muted); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.chip:hover:not([disabled]) { background: var(--bg-hover); }
.chip[disabled] { opacity: .45; cursor: default; }
.chip[aria-pressed="true"] { background: var(--bg-active); border-color: var(--border-active); color: var(--text-main); }
.chip .n { font-family: var(--font-mono); font-size: .72rem; color: var(--text-subtle); }

.chart-card { padding: 16px 18px 10px; margin-bottom: 16px; }
.chart-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.chart-head h2 { font-size: .95rem; margin: 0; font-weight: 600; }
.chart-head .hint { font-size: .78rem; color: var(--text-muted); }
#chart { width: 100%; height: 190px; display: block; margin-top: 8px; }
#chart .grid { stroke: var(--border-color); stroke-width: 1; }
#chart .axis { fill: var(--text-subtle); font-size: 11px; font-family: var(--font-sans); }
#chart .axis.cur { fill: var(--text-main); font-weight: 600; }
#chart .bar { fill: var(--chg-bar); }
#chart .bar.off { fill: var(--border-dark); }
#chart g:hover .bar { opacity: .82; }
#chart .hit { fill: transparent; cursor: pointer; }
#chart .cap { fill: var(--text-muted); font-size: 11px; font-family: var(--font-mono); text-anchor: middle; }
.chart-tip { position: fixed; pointer-events: none; z-index: 50; background: var(--bg-header); border: 1px solid var(--border-dark);
  border-radius: 8px; padding: 8px 10px; font-size: .78rem; box-shadow: 0 6px 20px rgba(0,0,0,.12); display: none; min-width: 200px; }
.chart-tip b { display: block; margin-bottom: 4px; }
.chart-tip .row { display: flex; justify-content: space-between; gap: 16px; color: var(--text-muted); }
.chart-tip .row span:last-child { font-family: var(--font-mono); color: var(--text-main); }
.chart-tip .foot { margin-top: 6px; color: var(--text-subtle); }
details.data-table { margin-top: 6px; font-size: .78rem; color: var(--text-muted); }
details.data-table summary { cursor: pointer; }
details.data-table table { border-collapse: collapse; margin-top: 6px; }
details.data-table td, details.data-table th { padding: 2px 10px; border-bottom: 1px solid var(--border-color); text-align: right; font-family: var(--font-mono); }
details.data-table th:first-child, details.data-table td:first-child { text-align: left; }

.tiles { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
.tile { text-align: left; font: inherit; color: inherit; cursor: pointer; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.tile:hover { border-color: var(--border-dark); }
.tile[aria-pressed="true"] { border-color: var(--border-active); box-shadow: 0 0 0 1px var(--border-active) inset; }
.tile .tb { align-self: flex-start; }
.tile .num { font-size: 1.6rem; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; }
.tile .num.zero { color: var(--text-subtle); }
.tile .lbl { font-size: .78rem; color: var(--text-muted); }

.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border-color); padding: 0 12px; }
.tab { font: inherit; font-size: .88rem; padding: 10px 14px; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--text-muted); cursor: pointer; margin-bottom: -1px; }
.tab[aria-selected="true"] { color: var(--text-main); border-bottom-color: var(--border-active); font-weight: 600; }
.tab .n { font-family: var(--font-mono); font-size: .75rem; color: var(--text-subtle); margin-left: 4px; }
.filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px; border-bottom: 1px solid var(--border-color); }
.filters .right { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
.search-mini { font: inherit; font-size: .85rem; padding: 6px 10px; border: 1px solid var(--border-dark); border-radius: 6px; background: var(--bg-white); color: var(--text-main); min-width: 220px; }
.result-line { padding: 8px 12px; font-size: .78rem; color: var(--text-muted); }

/* Бейдж типу зміни: іконка + колір + текст — ніколи не колір сам по собі */
.tb { display: inline-flex; align-items: center; gap: 5px; font-size: .74rem; font-weight: 600; padding: 2px 8px; border-radius: 4px; border: 1px solid; white-space: nowrap; }
.tb .ic { font-family: var(--font-mono); }
.t-in  { color: var(--status-yes); background: var(--status-yes-bg); border-color: var(--status-yes-border); }
.t-out { color: var(--status-no);  background: var(--status-no-bg);  border-color: var(--status-no-border); }
.t-add { color: var(--text-link);  background: var(--bg-active);     border-color: var(--border-dark); }
.t-rem { color: var(--text-muted); background: var(--bg-tag);        border-color: var(--border-dark); }
.t-mov { color: var(--chg-mov);    background: var(--chg-mov-bg);    border-color: var(--chg-mov-border); }

.rep-table td { vertical-align: top; }
.rep-table th { white-space: nowrap; }
.code { font-family: var(--font-mono); font-size: .76rem; color: var(--text-muted); background: var(--bg-tag); padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
.pname { color: var(--text-main); text-decoration: none; }
.pname:hover { color: var(--text-link); text-decoration: underline; }
.cat-link { color: var(--text-muted); text-decoration: none; }
.cat-link:hover { color: var(--text-link); text-decoration: underline; }
/* Посилання з data-tip: [data-tip] у map-common.css ставить cursor: help,
   а на посиланні правильний курсор — pointer. */
.cat-site, .cat-site[data-tip] { color: inherit; text-decoration: none; cursor: pointer; }
.cat-site:hover { color: var(--text-link); text-decoration: underline; }
.path-line + .path-line { margin-top: 4px; }
.path-label { display: inline-block; min-width: 48px; color: var(--text-muted); }
.path-link { color: inherit; text-decoration: none; }
.path-link:hover { color: var(--text-link); text-decoration: underline; }
.muted { color: var(--text-muted); }
.subtle { color: var(--text-subtle); }
.arrow-to { color: var(--text-subtle); padding: 0 4px; }
.more-row { padding: 12px; text-align: center; border-top: 1px solid var(--border-color); }
.empty { padding: 48px 16px; text-align: center; color: var(--text-muted); }
.empty b { display: block; color: var(--text-main); font-size: 1rem; margin-bottom: 6px; }

@media (max-width: 1000px) { .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 560px) {
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rep-wrap { padding: 16px 16px 40px; }
  .filters .right { margin-left: 0; width: 100%; }
  .search-mini { min-width: 0; flex: 1; }
}
`;

// ==================== СТОРІНКА ====================
const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Зміни каталогу</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../map-common.css">
<link rel="stylesheet" href="reports.css">
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="catalog-title">cncprom.ua</span>
      <span class="btn-theme-toggle catalog-subtitle-btn" style="cursor:default">📊 Зміни каталогу · останній знімок <span id="generated">…</span></span>
    </div>
    <div class="header-center"></div>
    <div class="header-right">
      <a href="../map.html" class="btn-theme-toggle" data-tip="Мапа всіх категорій сайту">🗺️ Мапа сайту</a>
      <button id="btn-help" class="btn-theme-toggle" data-tip="Що означають типи змін і як рахується період">❓ Довідка</button>
      <button id="btn-theme-toggle" class="btn-theme-toggle"><span class="theme-icon">🌙</span> <span class="theme-text">Темна</span></button>
      <a href="https://cncprom.ua/ua/" class="link-site">cncprom.ua ↗</a>
    </div>
  </header>

  <div class="help-overlay" id="help-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Як читати зміни каталогу</h3>
        <button class="btn-help-close" id="btn-help-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <div class="help-term"><div class="help-term-label">Період</div>
          <div class="help-term-desc">Порівнюються два знімки каталогу: на початок і на кінець періоду. Скрапер знімає каталог щоночі. Зміни <b>всередині</b> періоду не видно: товар, що зник і повернувся між двома датами, не потрапить у список. Побачити, в які дні щось відбувалося, можна на графіку.</div></div>
        <div class="help-term"><div class="help-term-label">Графік «Змін за день»</div>
          <div class="help-term-desc">Кожен стовпчик — скільки змін було саме того дня порівняно з попереднім знімком. Синім виділено дні, що входять у вибраний період. Клік по стовпчику починає період із цього дня.</div></div>
        <div class="help-term"><div class="help-term-label">▼ Зникли з наявності · ▲ Знову в наявності</div>
          <div class="help-term-desc">Статус товару змінився між «Готово до відправки» та будь-яким іншим (зазвичай «Немає в наявності»).</div></div>
        <div class="help-term"><div class="help-term-label">+ Нові · − Видалені товари</div>
          <div class="help-term-desc">Товар з'явився на сайті або зник із нього (за внутрішнім ID сайту, а не за назвою).</div></div>
        <div class="help-term"><div class="help-term-label">⇄ Змінили категорію</div>
          <div class="help-term-desc">Той самий товар тепер лежить в іншій категорії. Перейменування товарів не відстежуються.</div></div>
        <div class="help-term"><div class="help-term-label">✎ Структура категорій</div>
          <div class="help-term-desc">Категорії, що з'явились, зникли, були перейменовані або перенесені до іншого батьківського розділу.</div></div>
        <div class="help-term"><div class="help-term-label">Поділитися</div>
          <div class="help-term-desc">Вибраний період зберігається в адресі сторінки (<code>?from=…&amp;to=…</code>): скопіюйте посилання, і той, хто його відкриє, побачить те саме порівняння.</div></div>
      </div>
    </div>
  </div>

  <main class="rep-wrap">
    <div class="top-row">
      <h1>Зміни каталогу<span class="muted" id="period-label"></span></h1>
      <div class="range-bar" id="range">
        <label for="rf">Порівняти</label><select id="rf"></select><span class="range-arrow" aria-hidden="true">→</span>
        <select id="rt" aria-label="по дату"></select>
        <div class="chips" id="quick" role="group" aria-label="Швидкий вибір періоду">
          <button class="chip" data-q="day">Останній день</button><button class="chip" data-q="week">Тиждень</button><button class="chip" data-q="all">Увесь період</button>
        </div>
      </div>
    </div>

    <section class="card chart-card" id="chart-card" aria-labelledby="chart-title">
      <div class="chart-head">
        <h2 id="chart-title">Змін за день</h2>
        <span class="hint">Синім — дні, що входять у порівняння. Клік по стовпчику — почати період із цього дня.</span>
      </div>
      <svg id="chart" role="img" aria-label="Кількість змін каталогу за кожен день"></svg>
      <details class="data-table"><summary>Дані графіка таблицею</summary><div id="chart-table"></div></details>
    </section>

    <div class="tiles" id="tiles"></div>

    <div id="panel-wrap">
      <section class="card">
        <div class="tabs" role="tablist" id="tabs"></div>
        <div id="panel"><div class="empty subtle">Завантажуємо дані…</div></div>
      </section>
    </div>
  </main>
  <div class="chart-tip" id="chart-tip" role="tooltip"></div>

  <script src="../map-common.js"></script>
  <script src="reports.js"></script>
  <script>initReportsPage();</script>
</body>
</html>
`;

// Старі посилання вели на reports/latest.html (окремий HTML на кожен день) —
// лишаємо його переадресацією, щоб закладки не ламались.
const latestRedirect = `<!DOCTYPE html>
<html lang="uk"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0; url=index.html">
<title>Зміни каталогу</title></head>
<body><p>Сторінка переїхала: <a href="index.html">зміни каталогу</a>.</p></body></html>
`;

// ==================== ЗБІРКА ====================
if (require.main === module) {
  if (!fs.existsSync(SNAP_DIR)) {
    console.error(`Немає теки зі знімками: ${SNAP_DIR}`);
    console.error('Спершу: node generate-snapshot.js [dataDir]');
    process.exit(1);
  }
  const dates = fs.readdirSync(SNAP_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort();
  if (dates.length === 0) {
    console.error(`У ${SNAP_DIR} немає жодного знімка — сторінку змін будувати нема з чого.`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DATA, { recursive: true });
  // Прибрати компактні знімки дат, яких більше немає в гілці data.
  const keep = new Set(dates.map(d => `${d}.json`).concat(['index.json', 'products.json', 'categories.json']));
  fs.readdirSync(OUT_DATA).filter(f => !keep.has(f)).forEach(f => fs.unlinkSync(path.join(OUT_DATA, f)));

  // Таблиця статусів наявності спільна для всіх днів: у кожному товарі лише її індекс.
  const avail = [], availIdx = new Map();
  const aIdx = s => { s = s || ''; if (!availIdx.has(s)) { availIdx.set(s, avail.length); avail.push(s); } return availIdx.get(s); };
  const products = {};
  const catUrls = {};
  const daily = [];
  let prevExpanded = null, bytes = 0;

  for (const d of dates) {
    let snap;
    try {
      snap = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, `${d}.json`), 'utf-8'));
    } catch (e) {
      // Один пошкоджений знімок не має валити всю сторінку: пропускаємо його й
      // кажемо про це — графік просто порівняє сусідні вцілілі дні.
      console.warn(`Знімок ${d} пошкоджений (${e.message}) — пропускаємо.`);
      continue;
    }
    // Словник назв: останній знімок перемагає (дати йдуть за зростанням), але
    // ПОРОЖНЄ значення ніколи не затирає наявне. Якщо скрапер не дочитав
    // сторінку товару (так було з 3 товарами у знімку за 18.09.2026 — порожні
    // назва й статус), такий знімок інакше стер би назву зі словника для всіх
    // порівнянь, а не лише для свого дня.
    snap.products.forEach(p => {
      const old = products[p.id] || ['', '', ''];
      products[p.id] = [p.name || old[0], p.sku || old[1], p.url || old[2]];
    });
    snap.categories.forEach(c => { if (c.url) catUrls[c.id] = c.url; });
    const compact = {
      c: snap.categories.map(c => [c.id, c.parentId, c.name, c.level]),
      p: snap.products.map(p => [p.id, p.categoryId, aIdx(p.availability)])
    };
    const json = JSON.stringify(compact);
    fs.writeFileSync(path.join(OUT_DATA, `${d}.json`), json, 'utf-8');
    bytes += json.length;

    const expanded = reportExpand(compact, avail);
    if (prevExpanded) {
      const t = reportDiff(prevExpanded, expanded).totals;
      daily.push({ date: d, t: { in: t.in, out: t.out, added: t.added, removed: t.removed, moved: t.moved, cats: t.cats } });
    } else {
      daily.push({ date: d, t: null });
    }
    prevExpanded = expanded;
  }

  const usedDates = daily.map(x => x.date);
  fs.writeFileSync(path.join(OUT_DATA, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), dates: usedDates, avail, daily }), 'utf-8');
  fs.writeFileSync(path.join(OUT_DATA, 'products.json'), JSON.stringify(products), 'utf-8');
  fs.writeFileSync(path.join(OUT_DATA, 'categories.json'), JSON.stringify(readCategoryUrls(catUrls)), 'utf-8');

  fs.writeFileSync(path.join(OUT_DIR, 'reports.css'), css.trim() + '\n', 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'reports.js'),
    [reportIsYes, reportExpand, reportDiff, initReportsPage].map(fn => fn.toString()).join('\n\n') + '\n', 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'latest.html'), latestRedirect, 'utf-8');

  const last = daily[daily.length - 1];
  console.log(`Сторінку змін збудовано: ${path.join(OUT_DIR, 'index.html')}`);
  console.log(`Знімків: ${usedDates.length} (${usedDates[0]} … ${usedDates[usedDates.length - 1]}), товарів у словнику: ${Object.keys(products).length}, ` +
    `компактні знімки: ${(bytes / 1024 / Math.max(1, usedDates.length)).toFixed(0)} КБ/день без стиснення.`);
  if (last.t) console.log(`Останній день (${last.date}): ` + JSON.stringify(last.t));
}

module.exports = { reportIsYes, reportExpand, reportDiff };

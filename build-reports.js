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
const { ICONS } = require('./lib/icons');
const { helpButtonHtml, writeLogos } = require('./lib/help');
const { assetVer, contentVer } = require('./lib/assets');
const { narrowGuardHtml } = require('./lib/notice');
const { realUrl, mediaFromHtml, mediaKey } = require('./lib/media');

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

// Пропущені дні (між першим і останнім знімком немає знімка) знаходяться самі; тут лише
// причина, яку покаже сторінка. Без запису — просто «знімка немає». → HISTORY п. 58.
const SNAPSHOT_GAPS = {
  '2026-10-15': 'збій GitHub', // пуш у data відхилено з HTTP 408, копії немає (п. 57)
};
// Календарні дні строго між сусідніми датами: [[дата, причина?]]. Прогалину понад 31 день
// не розписуємо: кожен день — колонка графіка, а таке буває лише зі штучною датою
// (regress додає знімок 2099-12-31).
function missingDays(dates) {
  const out = [];
  for (let k = 1; k < dates.length; k++) {
    if (Date.parse(dates[k]) - Date.parse(dates[k - 1]) > 32 * 864e5) continue;
    const t = new Date(dates[k - 1] + 'T00:00:00Z');
    for (t.setUTCDate(t.getUTCDate() + 1); t.toISOString().slice(0, 10) < dates[k]; t.setUTCDate(t.getUTCDate() + 1)) {
      const d = t.toISOString().slice(0, 10);
      out.push(SNAPSHOT_GAPS[d] ? [d, SNAPSHOT_GAPS[d]] : [d]);
    }
  }
  return out;
}

// ==================== СПІЛЬНЕ ДЛЯ NODE І БРАУЗЕРА ====================
// Чисті функції без замикань на Node-змінні — серіалізуються в reports.js.

// Той самий критерій, що й isAvailableRow у scrape-complete.js: лише /готово/,
// бо "Немає в наявності" теж містить підрядок "наявн".
function reportIsYes(s) { return /готово/i.test(s || ''); }

// Компактний знімок { c: [[id, parentId, name, level]], p: [[id, catId, availIdx, price?]] }
// → Map-и для швидкого пошуку. Ціна — четвертим елементом, лише коли знімок її має
// (знімки від 02.10.2026).
function reportExpand(snap, avail, date) {
  var cats = new Map(), prods = new Map();
  snap.c.forEach(function (c) { cats.set(c[0], { id: c[0], parentId: c[1], name: c[2], level: c[3] }); });
  snap.p.forEach(function (p) { prods.set(p[0], { id: p[0], cat: p[1], avail: avail[p[2]], price: p[3] }); });
  return { cats: cats, prods: prods, date: date || '' };
}

// Diff двох розгорнутих знімків: товари додано / видалено / змінили наявність /
// змінили категорію / змінилась ціна; категорії додано / видалено / перейменовано /
// перенесено. Ціна порівнюється, лише коли вона відома в обох знімках: перший знімок
// з цінами не дає «змін» проти знімка без них.
// Перейменування товару свідомо не відстежується.
// Наявність порівнюється за reportIsYes, а не за точним текстом статусу.
function reportDiff(a, b, products, content) {
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
    return { type: type, id: id, name: p[0], sku: p[1], url: p[2], cat: cat, catName: catName(cat),
      top: t ? t.id : '', topName: t ? t.name : '—', avail: avail };
  }
  var rows = [], cats = [], priced = 0, priceRows = [];
  b.prods.forEach(function (pb, id) {
    var pa = a.prods.get(id);
    if (!pa) { rows.push(row('added', id, pb.cat, pb.avail)); return; }
    if (reportIsYes(pa.avail) !== reportIsYes(pb.avail)) rows.push(row(reportIsYes(pb.avail) ? 'in' : 'out', id, pb.cat, pb.avail));
    if (pa.cat !== pb.cat) { var r = row('moved', id, pb.cat, pb.avail); r.fromCat = pa.cat; r.fromCatName = catName(pa.cat); var ft = topOf(pa.cat); r.fromTop = ft ? ft.id : ''; rows.push(r); }
    if (pa.price != null && pb.price != null) {
      priced++;
      if (pa.price !== pb.price) { var rp = row('price', id, pb.cat, pb.avail); rp.fromPrice = pa.price; rp.price = pb.price; rows.push(rp); priceRows.push(rp); }
    }
  });
  // Перерахунок за курсом (HISTORY п. 54): Prom час від часу перераховує ціни, задані у
  // валюті, і за ніч «змінюється» ціна тисяч товарів на той самий відсоток (06.10.2026
  // +0,22%, 14.10.2026 +0,44%). Ознака: ціна змінилась щонайменше в третини товарів, і
  // 80% змін — це «стара × медіанний коефіцієнт» з точністю до округлення (1 грн або
  // 0,3%). Такі зміни не показуються як «Змінилась ціна»; товари, чия ціна відійшла від
  // загального коефіцієнта, лишаються — це справжні зміни. Для періоду з кількох днів
  // коефіцієнт — добуток денних, і правило працює так само.
  var recalc = null;
  if (priceRows.length >= 50 && priceRows.length >= priced / 3) {
    var ratios = priceRows.map(function (r) { return r.price / r.fromPrice; }).sort(function (x, y) { return x - y; });
    var f = ratios[Math.floor(ratios.length / 2)];
    var fits = function (r) { return Math.abs(r.price - r.fromPrice * f) <= Math.max(1, 0.003 * r.fromPrice); };
    var n = priceRows.filter(fits).length;
    if (n >= 0.8 * priceRows.length) {
      recalc = { pct: (f - 1) * 100, n: n };
      rows = rows.filter(function (r) { return !(r.type === 'price' && fits(r)); });
    }
  }
  a.prods.forEach(function (pa, id) { if (!b.prods.has(id)) rows.push(row('removed', id, pa.cat, pa.avail)); });
  // Змінився контент: версія на кінець періоду інша, ніж на початок (content — історія з
  // index.json, див. readContentHistory). Вміст, що змінився й повернувся, зміною не є.
  // Власник — товар (p<id>) чи категорія (c<id>); обидва мають бути в обох знімках: новий
  // і зниклий — це «Нові» й «Видалені», а не зміна контенту.
  function verAt(list, d) { var h = null; for (var i = 0; i < list.length && list[i][0] <= d; i++) h = list[i][1]; return h; }
  if (content && a.date && b.date) Object.keys(content).forEach(function (o) {
    var id = o.slice(1), isCat = o.charAt(0) === 'c';
    if (isCat ? !(a.cats.has(id) && b.cats.has(id)) : !(a.prods.has(id) && b.prods.has(id))) return;
    var ha = verAt(content[o], a.date), hb = verAt(content[o], b.date);
    if (!ha || !hb || ha === hb) return;
    var r;
    if (isCat) {
      var cb = b.cats.get(id), t = topOf(id);
      r = { type: 'content', id: id, isCat: true, name: cb.name, sku: '', url: '', cat: cb.parentId || '', catName: cb.parentId ? catName(cb.parentId) : '',
        top: t ? t.id : '', topName: t ? t.name : '—', avail: '' };
    } else { var pb = b.prods.get(id); r = row('content', id, pb.cat, pb.avail); r.price = pb.price; }
    r.owner = o; r.fromHash = ha; r.toHash = hb;
    rows.push(r);
  });
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
  var totals = { in: 0, out: 0, added: 0, removed: 0, moved: 0, price: 0, content: 0, cats: cats.length, products: b.prods.size, categories: b.cats.size };
  rows.forEach(function (r) { totals[r.type]++; });
  return { rows: rows, cats: cats, totals: totals, recalc: recalc };
}

// LCS двох масивів ключів → [['=', i, j] | ['-', i] | ['+', j]] (індекси в x і y);
// спільні початок і кінець — без таблиці (версії між ночами майже однакові, тож таблиця
// зазвичай крихітна). Прибране стоїть перед доданим: «було → стало» зліва направо.
function reportOps(x, y) {
  var pre = 0, suf = 0, out = [], i, j;
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
  while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  var n = x.length - pre - suf, m = y.length - pre - suf;
  for (i = 0; i < pre; i++) out.push(['=', i, i]);
  if (n * m > 4000000) {
    for (i = 0; i < n; i++) out.push(['-', pre + i]);
    for (j = 0; j < m; j++) out.push(['+', pre + j]);
  } else {
    var T = new Uint32Array((n + 1) * (m + 1)), X = function (k) { return x[pre + k]; }, Y = function (k) { return y[pre + k]; };
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      T[i * (m + 1) + j] = X(i) === Y(j) ? T[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(T[(i + 1) * (m + 1) + j], T[i * (m + 1) + j + 1]);
    for (i = 0, j = 0; i < n || j < m;) {
      if (i < n && j < m && X(i) === Y(j)) { out.push(['=', pre + i, pre + j]); i++; j++; }
      else if (i < n && (j === m || T[(i + 1) * (m + 1) + j] >= T[i * (m + 1) + j + 1])) { out.push(['-', pre + i]); i++; }
      else { out.push(['+', pre + j]); j++; }
    }
  }
  for (i = 0; i < suf; i++) out.push(['=', x.length - suf + i, y.length - suf + i]);
  return out;
}

// Частини контенту (ключі статистики readContentHistory): назва для людини й вкладка
// вікна, на якій її видно. Порядок — як у ряду «Що змінилось».
var REPORT_PARTS = [
  ['text', 'Текст опису', 'text'], ['descImg', 'Картинки в описі', 'text'], ['video', 'Відео', 'text'],
  ['photos', 'Фото товару', 'photos'], ['attrs', 'Характеристики', 'attrs'], ['files', 'Файли', 'specs'],
  ['kit', 'Комплект', 'kit'], ['also', 'Супутні товари', 'also'], ['tile', 'Плитка категорії', 'tile']
];
// «+558 слів», «+1 −1», «+2 −1 ~3» (~ — змінене значення характеристики); нулі не пишуться.
function reportPartStat(k, v) {
  var s = [v[0] ? '+' + v[0] : '', v[1] ? '−' + v[1] : '', v[2] ? '~' + v[2] : ''].filter(Boolean).join(' ');
  return k === 'text' ? s + ' слів' : s;
}

// Вікно «Було / стало» для типу «Змінився контент» (вибір користувача з макета 16.10.2026:
// «як при merge»). Дві колонки: ліва — версія на початок періоду, права — на кінець;
// рядки вирівняні (LCS по блоках опису, пунктах, характеристиках за назвою), у зміненій
// парі блоків — слова: прибрані закреслені червоним зліва, додані зеленим справа; порожній
// бік заштрихований. «Лише зміни» (типово увімкнено) згортає незмінене, як git: по одному
// блоку контексту біля зміни, решта — «⋯ ще N». Картинка, що не відкривається, —
// рамка «не відкривається» з адресою: стара картинка показується з сервера Prom чи
// хостингу, копій ми не зберігаємо.
// open(r, dates, idx) — r: рядок reportDiff (owner, fromHash, toHash, назва, ціна…).
function initContentWindow(DATA) {
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var fmtLong = function (d) { var p = String(d).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; };
  var ov = document.createElement('div');
  ov.id = 'mg-overlay';
  ov.className = 'help-overlay mg-overlay';
  ov.innerHTML = '<div class="help-panel mg-panel" role="dialog" aria-modal="true" aria-labelledby="mg-title">' +
    '<div class="help-panel-head"><h3 id="mg-title"></h3><span class="mg-code" id="mg-code"></span>' +
    '<button type="button" class="btn-help-close" id="mg-close" aria-label="Закрити">✕</button></div>' +
    '<div class="mg-scroll" id="mg-scroll"></div></div>';
  document.body.appendChild(ov);
  setupModalOverlay('mg-overlay', null, 'mg-close');
  var scroll = ov.querySelector('#mg-scroll'), cache = {}, at = -1, current = 0;

  function imgKey(u) {
    u = String(u || '');
    var p = u.match(/^https?:\/\/ssl\.prom\.st\/q\?(?:.*&)?u=([^&]+)/i);
    if (p) { try { u = decodeURIComponent(p[1]); } catch (e) { /* лишаємо як є */ } }
    var m = u.match(/^https?:\/\/images\.(?:ua\.prom\.st|prom\.ua)\/(\d+)_/);
    return m ? 'prom:' + m[1] : u.split('#')[0];
  }
  // Картинка не відкрилась (файл видалено, хостинг зник чи не відповідає) — рамка з адресою.
  function guard(root) {
    Array.prototype.forEach.call(root.querySelectorAll('img'), function (im) {
      im.addEventListener('error', function () {
        var s = document.createElement('span');
        s.className = 'mg-broken';
        s.innerHTML = 'не відкривається<small>' + esc((im.getAttribute('src') || '').replace(/^https?:\/\//, '')) + '</small>';
        (im.closest('a') || im).replaceWith(s);
      });
    });
  }
  function align(a, b, key) {
    var out = [], dels = [], adds = [];
    function flush() {
      for (var k = 0; k < Math.max(dels.length, adds.length); k++)
        out.push({ t: dels[k] != null && adds[k] != null ? 'chg' : dels[k] != null ? 'del' : 'add', a: dels[k], b: adds[k] });
      dels = []; adds = [];
    }
    reportOps(a.map(key), b.map(key)).forEach(function (o) {
      if (o[0] === '=') { flush(); out.push({ t: 'eq', a: o[1], b: o[2] }); }
      else if (o[0] === '-') dels.push(o[1]); else adds.push(o[1]);
    });
    flush();
    return out;
  }
  function tokens(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), out = [], n;
    while ((n = w.nextNode())) { var re = /\S+/g, m; while ((m = re.exec(n.textContent))) out.push({ node: n, at: m.index, t: m[0] }); }
    return out;
  }
  function wrap(list, tag, cls) {
    list.slice().reverse().forEach(function (tk) {
      var r = document.createRange();
      r.setStart(tk.node, tk.at); r.setEnd(tk.node, tk.at + tk.t.length);
      var el = document.createElement(tag); el.className = cls; r.surroundContents(el);
    });
  }
  function markWords(A, B) {
    var ta = tokens(A), tb = tokens(B), del = [], ins = [];
    reportOps(ta.map(function (x) { return x.t; }), tb.map(function (x) { return x.t; })).forEach(function (o) {
      if (o[0] === '-') del.push(ta[o[1]]); else if (o[0] === '+') ins.push(tb[o[1]]);
    });
    wrap(del, 'del', 'd-del'); wrap(ins, 'ins', 'd-ins');
  }
  function cell(node, side) { var d = document.createElement('div'); d.className = 'mg-cell ' + side; if (node) d.appendChild(node); else d.classList.add('mg-empty'); return d; }
  function rowEl(t, l, r) { var d = document.createElement('div'); d.className = 'mg-row ' + t; d.appendChild(cell(l, 'l')); d.appendChild(cell(r, 'r')); return d; }
  function html(s) { var d = document.createElement('div'); d.innerHTML = s; return d; }

  // Опис: блоки — верхні елементи очищеного HTML (descFillHtml, як у вікні «Опис»).
  function blocks(h) {
    var box = document.createElement('div');
    descFillHtml(box, h || '');
    var out = [];
    Array.prototype.slice.call(box.childNodes).forEach(function (n) {
      if (n.nodeType === 3) { if (n.textContent.trim()) { var p = document.createElement('p'); p.textContent = n.textContent; out.push(p); } return; }
      if (n.nodeType === 1) out.push(n);
    });
    return out;
  }
  function blockKey(b) {
    return b.textContent.replace(/\s+/g, ' ').trim() + '|' +
      Array.prototype.map.call(b.querySelectorAll('img'), function (i) { return imgKey(i.getAttribute('src')); }).join(',') + '|' +
      Array.prototype.map.call(b.querySelectorAll('a[href]'), function (a) { return imgKey(a.getAttribute('href')); }).join(',');
  }
  function imgSet(list) { var s = {}; list.forEach(function (b) { Array.prototype.forEach.call(b.querySelectorAll('img'), function (i) { s[imgKey(i.getAttribute('src'))] = 1; }); }); return s; }
  function textPane(a, b) {
    var A = blocks(a.html), B = blocks(b.html), oldI = imgSet(A), newI = imgSet(B), pane = document.createElement('div');
    if (!A.length && !B.length) return null;
    align(A, B, blockKey).forEach(function (g) {
      var l = g.a != null ? A[g.a] : null, r = g.b != null ? B[g.b] : null;
      if (g.t === 'chg') markWords(l, r);
      if (l) Array.prototype.forEach.call(l.querySelectorAll('img'), function (i) { if (!newI[imgKey(i.getAttribute('src'))]) i.classList.add('img-del'); });
      if (r) Array.prototype.forEach.call(r.querySelectorAll('img'), function (i) { if (!oldI[imgKey(i.getAttribute('src'))]) i.classList.add('img-ins'); });
      pane.appendChild(rowEl(g.t, l, r));
    });
    return pane;
  }
  function photoPane(a, b) {
    if (!a.length && !b.length) return null;
    var pane = document.createElement('div');
    align(a, b, imgKey).forEach(function (g) {
      var img = function (u, cls) { return html('<img class="mg-photo ' + cls + '" alt="" loading="lazy" src="' + esc(u) + '">'); };
      pane.appendChild(rowEl(g.t, g.a != null ? img(a[g.a], g.t === 'eq' ? '' : 'img-del') : null, g.b != null ? img(b[g.b], g.t === 'eq' ? '' : 'img-ins') : null));
    });
    return pane;
  }
  // Характеристики — за назвою: порядок нового знімка, прибрані — у кінці.
  function attrsPane(a, b) {
    if (!a.length && !b.length) return null;
    var am = {}, bm = {}, names = [], pane = document.createElement('div');
    a.forEach(function (x) { am[x[0]] = x[1]; });
    b.forEach(function (x) { bm[x[0]] = x[1]; names.push(x[0]); });
    a.forEach(function (x) { if (!(x[0] in bm)) names.push(x[0]); });
    names.forEach(function (n) {
      var t = !(n in am) ? 'add' : !(n in bm) ? 'del' : am[n] !== bm[n] ? 'chg' : 'eq';
      var kv = function (v) { return html('<div class="mg-kv"><span class="k">' + esc(n) + '</span><span class="v">' + esc(v) + '</span></div>'); };
      var l = n in am ? kv(am[n]) : null, r = n in bm ? kv(bm[n]) : null;
      if (t === 'chg') markWords(l.querySelector('.v'), r.querySelector('.v'));
      pane.appendChild(rowEl(t, l, r));
    });
    return pane;
  }
  function listPane(a, b, key, item) {
    if (!a.length && !b.length) return null;
    var pane = document.createElement('div');
    align(a, b, key).forEach(function (g) {
      var l = g.a != null ? html('<div class="mg-li">' + item(a[g.a]) + '</div>') : null, r = g.b != null ? html('<div class="mg-li">' + item(b[g.b]) + '</div>') : null;
      if (g.t === 'chg') markWords(l, r);
      pane.appendChild(rowEl(g.t, l, r));
    });
    return pane;
  }
  // Незмінене згортається, як у git: блок контексту біля зміни лишається, решта — «⋯ ще N».
  function fold(pane) {
    var list = Array.prototype.slice.call(pane.children), ch = list.map(function (r) { return !r.classList.contains('eq'); });
    list.forEach(function (r, i) { if (!ch[i] && (ch[i - 1] || ch[i + 1])) r.classList.add('ctx'); });
    var run = [];
    function flush() {
      if (!run.length) return;
      var n = run.length, gap = document.createElement('button');
      gap.type = 'button'; gap.className = 'mg-gap';
      gap.textContent = '⋯ ще ' + n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'незмінений блок' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'незмінені блоки' : 'незмінених блоків');
      var rs = run;
      gap.addEventListener('click', function () { rs.forEach(function (r) { r.classList.add('ctx'); }); gap.remove(); });
      pane.insertBefore(gap, run[0]);
      run = [];
    }
    list.forEach(function (r) { if (r.classList.contains('eq') && !r.classList.contains('ctx')) run.push(r); else flush(); });
    flush();
  }

  var TABS = [['text', 'Опис'], ['photos', 'Фото'], ['attrs', 'Характеристики'], ['specs', 'Специфікація'], ['kit', 'Комплект постачання'],
    ['also', 'Супутні товари'], ['tile', 'Плитка категорії']];
  function showTab(name) {
    Array.prototype.forEach.call(scroll.querySelectorAll('[data-mg-tab]'), function (t) { t.classList.toggle('on', t.getAttribute('data-mg-tab') === name); });
    Array.prototype.forEach.call(scroll.querySelectorAll('[data-mg-pane]'), function (p) { p.hidden = p.getAttribute('data-mg-pane') !== name; });
  }
  function marks() { return scroll.querySelectorAll('.mg-row:not(.eq)'); }

  function draw(r, a, b, dates, idx) {
    var st = ((idx.contentStats || {})[r.owner] || {})[r.fromHash + '>' + r.toHash] || {};
    var files = function (v) { return v.specs.concat((v.files || []).map(function (u) { return ['', u]; })); };
    var panes = {
      text: textPane(a, b),
      photos: r.isCat ? null : photoPane(a.photos || [], b.photos || []),
      attrs: attrsPane(a.attrs || [], b.attrs || []),
      specs: listPane(files(a), files(b), function (s) { return imgKey(s[1]); }, function (s) {
        var name = s[0] || decodeURIComponent(String(s[1]).split(/[?#]/)[0].split('/').pop() || s[1]);
        return '<a href="' + esc(s[1]) + '" target="_blank" rel="noopener">📎 ' + esc(name) + ' ↗</a>' + (s[0] ? '' : ' <span class="subtle">посилання в описі</span>');
      }),
      kit: listPane(a.kit || [], b.kit || [], function (s) { return s; }, function (s) { return '• ' + esc(s); }),
      also: listPane(a.also || [], b.also || [], function (x) { return x[0] + '\t' + imgKey(x[1]); }, function (x) {
        return (x[1] ? '<img class="mg-thumb" alt="" loading="lazy" src="' + esc(x[1]) + '">' : '') + '<span>' + esc(x[0]) + '</span>';
      }),
      tile: (a.tile || b.tile) ? photoPane(a.tile ? [a.tile] : [], b.tile ? [b.tile] : []) : null
    };
    // Посилання на GitHub — кожна зміна цього власника в періоді: файл у коміті зі зміною.
    var anchor = (idx.contentAnchor || {})[r.owner] || [];
    var gh = ((idx.content || {})[r.owner] || []).filter(function (v) { return v[2] && v[0] > dates[0] && v[0] <= dates[1]; }).map(function (v) {
      var an = /h/.test(v[3] || '') ? anchor[0] : anchor[1];
      return '<a target="_blank" rel="noopener" href="https://github.com/dialmak/scraper_cncprom/commit/' + esc(v[2]) + (an ? '#diff-' + esc(an) : '') + '">Зміна від ' + fmtLong(v[0]) + ' на GitHub ↗</a>';
    }).join('');
    var price = r.price != null ? String(Math.round(r.price)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₴' : '';
    scroll.innerHTML = '<div class="mg-meta">' + (price ? '<span class="mg-price">' + price + '</span>' : '') +
      (r.avail ? '<span class="stock-badge ' + (/готово/i.test(r.avail) ? 'yes' : 'no') + '">' + esc(r.avail) + '</span>' : '') +
      (r.siteUrl ? '<a href="' + esc(r.siteUrl) + '" target="_blank" rel="noopener">Відкрити на cncprom.ua ↗</a>' : '') + gh + '</div>' +
      '<div class="mg-stats"><span class="subtle">Що змінилось:</span>' + REPORT_PARTS.filter(function (p) { return st[p[0]]; }).map(function (p) {
        return '<button type="button" class="chip" data-mg-go="' + p[2] + '">' + p[1] + ' <b>' + reportPartStat(p[0], st[p[0]]) + '</b></button>';
      }).join('') + '</div>' +
      '<div class="mg-sticky"><div class="desc-tabs mg-tabs" role="tablist"></div>' +
      '<div class="mg-tools"><button type="button" class="chip" id="mg-next">Наступна зміна ↓</button><span class="subtle" id="mg-count"></span><span class="grow"></span>' +
      '<label class="mg-only"><input type="checkbox" id="mg-only" checked> Лише зміни</label></div>' +
      '<div class="mg-cols"><div>Було · ' + fmtLong(dates[0]) + '</div><div>Стало · ' + fmtLong(dates[1]) + '</div></div></div>' +
      '<div class="mg-body only" id="mg-body"></div>';
    var body = scroll.querySelector('#mg-body'), tabs = scroll.querySelector('.mg-tabs'), first = null, any = null;
    TABS.forEach(function (t) {
      var p = panes[t[0]];
      if (!p) return;
      p.className = 'mg-pane'; p.setAttribute('data-mg-pane', t[0]); p.hidden = true;
      guard(p); fold(p);
      body.appendChild(p);
      var n = p.querySelectorAll('.mg-row:not(.eq)').length;
      if (n && !first) first = t[0];
      if (!any) any = t[0];
      tabs.insertAdjacentHTML('beforeend', '<button type="button" role="tab" class="desc-tab" data-mg-tab="' + t[0] + '">' + t[1] +
        (n ? '<span class="tab-chg">' + n + '</span>' : '') + '</button>');
    });
    showTab(first || any || 'text');
    at = -1;
    var n = marks().length;
    scroll.querySelector('#mg-count').textContent = n ? 'змін: ' + n : '';
    scroll.querySelector('#mg-next').style.display = n ? '' : 'none';
  }
  scroll.addEventListener('click', function (e) {
    var t = e.target.closest('[data-mg-tab], [data-mg-go]');
    if (t) { showTab(t.getAttribute('data-mg-tab') || t.getAttribute('data-mg-go')); return; }
    if (!e.target.closest('#mg-next')) return;
    var m = marks(); if (!m.length) return;
    at = (at + 1) % m.length;
    showTab(m[at].closest('[data-mg-pane]').getAttribute('data-mg-pane'));
    if (!m[at].offsetParent) m[at].classList.add('ctx'); // рядок у згорнутому — показати
    Array.prototype.forEach.call(scroll.querySelectorAll('.mg-now'), function (x) { x.classList.remove('mg-now'); });
    m[at].classList.add('mg-now');
    m[at].scrollIntoView({ block: 'center', behavior: 'smooth' });
    scroll.querySelector('#mg-count').textContent = 'зміна ' + (at + 1) + ' з ' + m.length;
  });
  scroll.addEventListener('change', function (e) {
    if (e.target.id === 'mg-only') scroll.querySelector('#mg-body').classList.toggle('only', e.target.checked);
  });

  return function open(r, dates, idx) {
    var my = ++current;
    document.getElementById('mg-title').textContent = r.isCat ? 'Категорія: ' + r.name : r.name;
    document.getElementById('mg-code').textContent = r.sku || '';
    scroll.innerHTML = '<div class="empty-note">Завантажуємо версії…</div>';
    ov.classList.add('open');
    scroll.scrollTop = 0;
    if (!cache[r.owner]) cache[r.owner] = fetch(DATA + 'content/' + encodeURIComponent(r.owner) + '.json').then(function (x) {
      if (!x.ok) throw new Error('HTTP ' + x.status); return x.json();
    });
    cache[r.owner].then(function (v) {
      if (my !== current) return;
      var a = v[r.fromHash], b = v[r.toHash];
      if (!a || !b) { scroll.innerHTML = '<div class="empty-note">Однієї з версій не знайдено.</div>'; return; }
      draw(r, a, b, dates, idx);
    }).catch(function (e) {
      delete cache[r.owner];
      if (my === current) scroll.innerHTML = '<div class="empty-note">Не вдалося завантажити версії (' + esc(e && e.message) + ').</div>';
    });
  };
}

// ==================== КЛІЄНТ ====================
function initReportsPage() {
  var DATA = 'data/';
  var TYPES = ['out', 'in', 'added', 'removed', 'moved', 'price', 'content'];
  var TYPE = {
    out:     { icon: '▼', label: 'Зникли з наявності', cls: 't-out' },
    in:      { icon: '▲', label: 'Знову в наявності',  cls: 't-in' },
    added:   { icon: '+', label: 'Нові товари',        cls: 't-add' },
    removed: { icon: '−', label: 'Видалені товари',    cls: 't-rem' },
    moved:   { icon: '⇄', label: 'Змінили категорію',  cls: 't-mov' },
    price:   { icon: '₴', label: 'Змінилась ціна',     cls: 't-price' },
    content: { icon: '✎', label: 'Змінився контент',   cls: 't-desc' }
  };
  var CAT = { added: ['+', 'Нова категорія', 't-add'], removed: ['−', 'Видалена', 't-rem'], renamed: ['✎', 'Перейменована', 't-mov'], moved: ['⇄', 'Перенесена', 't-mov'] };
  var ORDER = { out: 0, in: 1, added: 2, removed: 3, moved: 4, price: 5, content: 6 };
  var PAGE = 200;

  var idx, products, catUrls = {}, snaps = {}, D, range = {}, st = { tab: 'prod', types: {}, parts: {}, q: '', limit: PAGE };
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function fmtShort(d) { var p = d.split('-'); return p[2] + '.' + p[1]; }
  function fmtLong(d) { var p = d.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  // Дні без знімка строго між a і b (idx.missing: [[дата, причина?]], → HISTORY п. 58).
  function gapsBetween(a, b) { return (idx.missing || []).filter(function (m) { return m[0] > a && m[0] < b; }); }
  function gapDays(gaps) {
    if (gaps.length > 3) return gaps.length + ' днів';
    return gaps.map(function (m) { return fmtShort(m[0]); }).join(', ');
  }
  // Список дат з неактивними пунктами пропущених днів між сусідніми датами списку.
  function dateOptions(list, sel, last) {
    return list.map(function (d, k) {
      var gaps = k ? gapsBetween(list[k - 1], d) : [];
      return gaps.map(function (m) { return '<option disabled>' + fmtLong(m[0]) + ' (знімка немає)</option>'; }).join('') +
        '<option value="' + d + '"' + (d === sel ? ' selected' : '') + '>' + fmtLong(d) + (d === last ? ' (останній)' : '') + '</option>';
    }).join('');
  }
  // 12 960 ₴: пробіл між розрядами нерозривний; копійки — лише коли вони є.
  function fmtPrice(v) {
    var n = Math.round(v * 100) / 100;
    return (n % 1 ? n.toFixed(2).replace('.', ',') : String(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '\u00a0₴';
  }
  function badge(type, short) {
    var t = TYPE[type];
    return '<span class="tb ' + t.cls + '"' + (short ? ' aria-label="' + esc(t.label) + '"' : '') + '><span class="ic" aria-hidden="true">' + t.icon + '</span>' + (short ? '' : esc(t.label)) + '</span>';
  }

  function getJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.json(); });
  }
  function loadSnap(date) {
    if (!snaps[date]) snaps[date] = getJson(DATA + date + '.json').then(function (s) { return reportExpand(s, idx.avail, date); });
    return snaps[date];
  }

  function fail(err) {
    $('panel-wrap').innerHTML = '<div class="card empty"><b>⚠️ Не вдалося завантажити дані звіту</b>' +
      'Якщо сторінка відкрита подвійним кліком з диска, браузер блокує fetch() локальних файлів; відкрийте її через сервер (напр. Live Server). ' +
      'Якщо через сервер, перевірте, що reports/data/ існує (його пише build-reports.js).<div class="subtle" style="margin-top:8px">' + esc(err && err.message) + '</div></div>';
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
    $('rf').innerHTML = dateOptions(ds.filter(function (d) { return d < range.to; }), range.from, null);
    $('rt').innerHTML = dateOptions(ds.slice(1), range.to, ds[ds.length - 1]);
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
  // Зміни цін у стовпець не входять: ціни перераховуються сотнями за ніч і затулили б
  // решту змін. У підказці вони окремим рядком.
  function dayTotal(d) { var t = d.t; return t ? t.in + t.out + t.added + t.removed + t.moved + (t.content || 0) + t.cats : null; }
  function drawChart() {
    // У згорнутому блоці svg.clientWidth — 0, і графік малювався б по запасній
    // ширині 800 і лишився б таким після розгортання. setChartOpen перемалює.
    if ($('chart-body').hidden) return;
    var svg = $('chart'), W = svg.clientWidth || 800, H = 190, pl = 40, pr = 8, pt = 18, pb = 24;
    // Колонки — дні зі знімком і пропущені дні (пунктирна рамка без data-i). data-i —
    // індекс у idx.daily/idx.dates: на ньому тримаються підказка й клік, тож пропуски
    // в daily не вставляються, а лише займають місце на осі.
    var days = idx.daily, cols = [];
    days.forEach(function (d, i) {
      if (i) gapsBetween(days[i - 1].date, d.date).forEach(function (m) { cols.push({ date: m[0], gap: m }); });
      cols.push({ date: d.date, d: d, i: i });
    });
    var n = cols.length, band = (W - pl - pr) / n, bw = Math.min(24, band * 0.55);
    var max = Math.max.apply(null, days.map(function (d) { return dayTotal(d) || 0; })), top = niceMax(max);
    var y = function (v) { return pt + (H - pt - pb) * (1 - v / top); };
    // Підписи осі X: спершу межі вибраного періоду, потім останній день, потім
    // решта — і кожен ставиться, лише якщо не налазить на вже поставлені (на
    // вузькому екрані чи за довгу історію сусідні дати інакше злипаються).
    var MIN_GAP = 42, placed = [], labels = {};
    var labelX = function (i) { return Math.max(pl + 16, Math.min(W - pr - 16, pl + band * i + band / 2)); };
    var prio = cols.map(function (c, k) {
      var p = (c.date === range.to || c.date === range.from) ? 0 : k === n - 1 ? 1 : 2;
      return { i: k, p: p };
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
    cols.forEach(function (c, i) {
      var cx = pl + band * i + band / 2;
      if (c.gap) {
        out += '<g class="gap" data-gap="' + c.date + '"><rect class="gap-box" x="' + (cx - bw / 2 + .5) + '" y="' + (pt + .5) + '" width="' + (bw - 1) +
          '" height="' + (H - pt - pb - 1) + '" rx="3"/>' +
          (labels[i] ? '<text class="axis" x="' + labelX(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + fmtShort(c.date) + '</text>' : '') +
          '<rect class="hit" x="' + (pl + band * i) + '" y="' + pt + '" width="' + band + '" height="' + (H - pt) + '"/></g>';
        return;
      }
      var d = c.d, tot = dayTotal(d), inR = d.date > range.from && d.date <= range.to;
      var edge = d.date === range.to || d.date === range.from;
      out += '<g data-i="' + c.i + '">';
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
    var tip = $('chart-tip'), g = e.target.closest && e.target.closest('g[data-i], g[data-gap]');
    if (!g) { tip.style.display = 'none'; return; }
    if (g.hasAttribute('data-gap')) {
      // Пропущений день: зміни за нього — у стовпці наступного знімка.
      var gd = g.getAttribute('data-gap'), gm = (idx.missing || []).filter(function (m) { return m[0] === gd; })[0] || [gd];
      var next = idx.dates.filter(function (x) { return x > gd; })[0];
      var nd = new Date(gd + 'T00:00:00Z'); nd.setUTCDate(nd.getUTCDate() + 1);
      var both = next === nd.toISOString().slice(0, 10)
        ? 'Зміни за ' + (gd.slice(5, 7) === next.slice(5, 7) ? gd.slice(8) : fmtShort(gd)) + ' і ' + fmtShort(next) + ' показано разом у стовпці ' + fmtShort(next) + '.'
        : 'Зміни цього дня показано в стовпці ' + fmtShort(next) + '.';
      tip.innerHTML = '<b>' + fmtLong(gd) + ' · знімка немає</b><div class="foot">Тієї ночі знімок не вдалося зберегти' + (gm[1] ? ' (' + esc(gm[1]) + ')' : '') + '.<br>' + both + '</div>';
    } else {
      var i = +g.getAttribute('data-i'), d = idx.daily[i];
      var gaps = i ? gapsBetween(idx.dates[i - 1], d.date) : [];
      var span = gaps.length + 1;
      if (!d.t) tip.innerHTML = '<b>' + fmtLong(d.date) + '</b><div class="foot">Перший знімок: порівнювати нема з чим</div>';
      else tip.innerHTML = '<b>' + fmtLong(d.date) + ' · змін: ' + dayTotal(d) + '</b>' +
        TYPES.filter(function (k) { return k !== 'price'; }).map(function (k) { return '<div class="row"><span>' + TYPE[k].icon + ' ' + TYPE[k].label + '</span><span>' + d.t[k] + '</span></div>'; }).join('') +
        '<div class="row"><span>✎ Структура категорій</span><span>' + d.t.cats + '</span></div>' +
        (d.t.price ? '<div class="row"><span>₴ Змінилась ціна (окремо від стовпця)</span><span>' + d.t.price + '</span></div>' : '') +
        (gaps.length ? '<div class="foot">Зміни за ' + (span === 2 ? 'два дні' : span < 5 ? span + ' дні' : span + ' днів') + ': ' +
          (gaps.length === 1 ? 'знімка за ' + fmtShort(gaps[0][0]) + ' немає' : gaps.length > 3 ? 'немає знімків за ' + gapDays(gaps) : 'знімків за ' + gapDays(gaps) + ' немає') + '.</div>' : '') +
        '<div class="foot">Клік: порівняти з ' + fmtShort(idx.dates[i - 1]) + (range.to > d.date ? ' по ' + fmtShort(range.to) : '') + '</div>';
    }
    tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
  }
  // Графік згорнутий за замовчуванням: сторінка про те, що змінилось, а графік
  // відповідає на інше питання — коли саме щось відбувалось. Вибір запам'ятовується
  // в localStorage; коли сховище недоступне (приватне вікно), лишається згорнутим.
  var CHART_KEY = 'cncprom.chartOpen';
  function chartStored() {
    try { return localStorage.getItem(CHART_KEY) === '1'; } catch (e) { return false; }
  }
  function setChartOpen(on) {
    $('chart-body').hidden = !on;
    $('chart-hint').style.display = on ? '' : 'none';
    var btn = $('chart-toggle');
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    btn.querySelector('.caret').textContent = on ? '▾' : '▸';
    try { localStorage.setItem(CHART_KEY, on ? '1' : '0'); } catch (e) { /* не біда */ }
    if (on) drawChart();
  }

  // ---------- Картки ----------
  function drawTiles() {
    var t = D.totals;
    var tiles = TYPES.map(function (k) {
      // Підсвічена кожна плитка, чий тип вибраний, скільки б типів не було вибрано
      // (до 27.09.2026 лише коли вибраний рівно один, і з двома фішками плитки гасли).
      // Нульова плитка неклікабельна, як і фішка: інакше клік давав порожню таблицю з
      // натиснутою, але вимкненою фішкою, яку вже не зняти (27.09.2026).
      var on = st.tab === 'prod' && !!st.types[k];
      return '<button class="card tile" data-type="' + k + '" aria-pressed="' + on + '"' + (t[k] ? '' : ' disabled') + '>' + badge(k, true) +
        '<span class="num' + (t[k] ? '' : ' zero') + '">' + t[k] + '</span><span class="lbl">' + TYPE[k].label + '</span></button>';
    }).concat(
      '<button class="card tile" data-type="cats" aria-pressed="' + (st.tab === 'cats') + '"' + (t.cats || st.tab === 'cats' ? '' : ' disabled') + '><span class="tb t-mov" aria-label="Структура категорій"><span class="ic" aria-hidden="true">✎</span></span>' +
      '<span class="num' + (t.cats ? '' : ' zero') + '">' + t.cats + '</span><span class="lbl">Змін у структурі категорій</span></button>');
    // Чотири групи (користувач 18.10.2026, тонка лінія між ними): наявність і склад ·
    // ціна · контент · структура категорій. Як вони взаємодіють — toggleType.
    var k0 = 0;
    $('tiles').innerHTML = [5, 1, 1, 1].map(function (n) {
      var h = '<div class="tg" style="grid-template-columns:repeat(' + n + ',minmax(0,1fr));flex:' + n + ' 1 0">' + tiles.slice(k0, k0 + n).join('') + '</div>';
      k0 += n; return h;
    }).join('');
  }

  // ---------- Таблиці ----------
  // Лише вкладка «Категорії», колонка «Категорія»: назва → посилання на її
  // сторінку на сайті, повний шлях — у підказці (так і має бути, користувач
  // 27.09.2026). Вкладка «Товари» веде на мапу — mapLink нижче. Без URL
  // (категорія зникла раніше, ніж знімки почали зберігати URL) — просто текст
  // із тією ж підказкою.
  function catLink(id, name, path) {
    var u = catUrls[id];
    return u ? '<a class="cat-site" target="_blank" rel="noopener" href="' + esc(u) + '" data-tip="' + esc(path) + '">' + esc(name) + '</a>'
      : '<span data-tip="' + esc(path) + '">' + esc(name) + '</span>';
  }
  // Категорія товару → мапа розділу одразу на цю категорію (#cat=<id>), як шлях на
  // вкладці «Категорії»; до 27.09.2026 вела на сайт. Вигляд і поведінка — як у
  // розділу 1 рівня поруч (.cat-link, без підказки): користувач попросив, щоб усі
  // ланки виглядали однаково. Немає розділу — текст.
  function mapLink(top, id, name) {
    return top ? '<a class="cat-link" href="../' + esc(top) + '_map.html#cat=' + encodeURIComponent(id) + '">' + esc(name) + '</a>'
      : '<span class="muted">' + esc(name) + '</span>';
  }
  function detail(r) {
    if (r.type === 'in')  return '<span class="subtle">Немає</span><span class="arrow-to">→</span><b class="count-yes">В наявності</b>';
    if (r.type === 'out') return '<span class="subtle">В наявності</span><span class="arrow-to">→</span><b class="count-no">Немає</b>';
    if (r.type === 'moved') return mapLink(r.fromTop, r.fromCat, r.fromCatName) + '<span class="arrow-to">→</span>' + mapLink(r.top, r.cat, r.catName);
    if (r.type === 'added') return '<span class="muted">' + (reportIsYes(r.avail) ? 'В наявності' : 'Немає в наявності') + '</span>';
    if (r.type === 'price') {
      var pct = r.fromPrice ? (r.price - r.fromPrice) / r.fromPrice * 100 : 0;
      var sign = pct > 0 ? '+' : '−';
      return '<span class="subtle">' + fmtPrice(r.fromPrice) + '</span><span class="arrow-to">→</span><b>' + fmtPrice(r.price) + '</b>' +
        '<span class="muted price-pct">' + sign + Math.abs(pct).toFixed(1).replace('.', ',') + '%</span>';
    }
    if (r.type === 'content') {
      var cs = partStats(r);
      return '<div class="st-box">' + REPORT_PARTS.filter(function (p) { return cs[p[0]]; }).map(function (p) {
        return '<span class="st-name">' + p[1] + '</span><span class="st-val">' + reportPartStat(p[0], cs[p[0]]) + '</span>';
      }).join('') + '</div><button class="chip" data-content="' + esc(r.owner) + '">Було / стало</button>';
    }
    return '<span class="subtle">зник із сайту</span>';
  }

  // ---------- Змінився контент: вікно «Було / стало» (initContentWindow) ----------
  // Статистика пари версій — з index.json (contentStats), версії вікно бере само.
  function partStats(r) { return ((idx.contentStats || {})[r.owner] || {})[r.fromHash + '>' + r.toHash] || {}; }
  var openContent = initContentWindow(DATA);
  function siteUrl(r) { return r.isCat ? catUrls[r.id] || '' : r.url; }
  function productTable(rows, extra) {
    var shown = rows.slice(0, st.limit);
    return '<div class="result-line">Показано ' + shown.length + ' з ' + rows.length + (extra || '') + '</div>' +
      '<div class="table-wrap"><table class="simple-table rep-table"><thead><tr>' +
      '<th style="width:170px">Зміна</th><th style="width:110px">Код</th><th>Товар</th><th style="width:26%">Категорія</th><th style="width:24%">Що змінилось</th>' +
      '</tr></thead><tbody>' + shown.map(function (r) {
        return '<tr><td>' + badge(r.type) + '</td>' +
          '<td>' + (r.sku ? '<span class="code">' + esc(r.sku) + '</span>' : '<span class="subtle">—</span>') + '</td>' +
          '<td>' + (siteUrl(r) ? '<a class="pname" target="_blank" rel="noopener" href="' + esc(siteUrl(r)) + '">' + esc(r.name) + '</a>' : esc(r.name)) +
          (r.isCat ? '<span class="cat-tag">категорія</span>' : '') + '</td>' +
          // Категорія товару; для категорії — її батьківська (розділ 1 рівня — без батька: тире).
          '<td>' + (r.isCat && !r.cat ? '<span class="subtle">—</span>' :
            (r.top ? '<a class="cat-link" href="../' + esc(r.top) + '_map.html">' + esc(r.topName) + '</a>' : '<span class="muted">' + esc(r.topName) + '</span>') +
            (r.catName !== r.topName ? '<span class="arrow-to">›</span>' + mapLink(r.top, r.cat, r.catName) : '')) + '</td>' +
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
    // Код можна шукати без дефісів і пробілів: «23101» знаходить 23-101 (користувач 18.10.2026).
    var bare = function (s) { return s.toLowerCase().replace(/[^0-9a-zа-яіїєґё]/g, ''); }, qc = bare(q);
    return D.rows.filter(function (r) {
      if (any && !st.types[r.type]) return false;
      if (r.type === 'content' && Object.keys(st.parts).length && !Object.keys(partStats(r)).some(function (k) { return st.parts[k]; })) return false;
      return !q || (r.name + ' ' + r.sku + ' ' + r.catName + ' ' + r.topName).toLowerCase().indexOf(q) >= 0 ||
        (qc.length >= 2 && !!r.sku && bare(r.sku).indexOf(qc) >= 0);
    }).sort(function (a, b) {
      return (ORDER[a.type] - ORDER[b.type]) || a.topName.localeCompare(b.topName, 'uk') || a.name.localeCompare(b.name, 'uk');
    });
  }
  // Ряд «Що змінилось:» — скільки товарів змінили кожну частину контенту; клік фільтрує
  // (як фішки: можна кілька). Лише коли вибрано «Змінився контент».
  function partsHtml() {
    if (!st.types.content) return '';
    var n = {};
    D.rows.forEach(function (r) { if (r.type === 'content') Object.keys(partStats(r)).forEach(function (k) { n[k] = (n[k] || 0) + 1; }); });
    return '<div class="parts"><span class="parts-lbl">Що змінилось:</span>' + REPORT_PARTS.map(function (p) {
      return '<button class="chip" data-part="' + p[0] + '" aria-pressed="' + !!st.parts[p[0]] + '"' + (n[p[0]] ? '' : ' disabled') + '>' + p[1] + '<span class="n">' + (n[p[0]] || 0) + '</span></button>';
    }).join('') + '</div>';
  }
  // Над таблицею (користувач 18.10.2026): фішок типів немає, їх повторювали плитки;
  // фільтра розділів немає; пошук праворуч у рядку вкладок; «Скинути фільтр» знімає плитки.
  function render() {
    drawTiles();
    var focused = document.activeElement && document.activeElement.id === 'q';
    $('tabs').innerHTML =
      '<button class="tab" role="tab" data-tab="prod" aria-selected="' + (st.tab === 'prod') + '">Товари<span class="n">' + D.rows.length + '</span></button>' +
      '<button class="tab" role="tab" data-tab="cats" aria-selected="' + (st.tab === 'cats') + '">Категорії<span class="n">' + D.cats.length + '</span></button>' +
      (st.tab === 'prod' ? '<input id="q" class="search-mini tabs-q" type="search" placeholder="Пошук: назва, код, категорія" value="' + esc(st.q) + '">' : '');
    var panel = $('panel');
    if (st.tab === 'cats') { panel.innerHTML = catTable(D.cats); return; }
    var rows = filtered();
    var reset = Object.keys(st.types).length ? '<span class="sep" aria-hidden="true">·</span><button class="link-btn" data-reset>Скинути фільтр</button>' : '';
    panel.innerHTML = partsHtml() +
      (rows.length ? productTable(rows, reset)
        : '<div class="empty"><b>' + (D.rows.length ? 'Нічого не знайдено' : 'Товари за цей період не змінювались') + '</b>' +
          (D.rows.length ? 'Зніміть фільтри або змініть запит.' : 'Оберіть ширший період угорі або кліком по графіку.') + '</div>');
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
      D = reportDiff(s[0], s[1], products, idx.content);
      // Фільтр, якому в новому періоді нема що показати, знімається: вимкнену фішку не
      // зняти кліком, а розділу, якого немає в списку, не видно в <select>. Інакше після
      // зміни періоду таблиця порожня без видимої причини (27.09.2026).
      Object.keys(st.types).forEach(function (k) { if (!D.totals[k]) delete st.types[k]; });
      if (!st.types.content) st.parts = {};
      st.limit = PAGE; render();
    }).catch(fail);
  }

  // ---------- Події ----------
  // Групи типів (користувач 18.10.2026): наявність і склад поєднуються між собою; ціна,
  // контент і структура категорій — кожна окремо. Вибір в іншій групі скидає попередню.
  var GROUP = { out: 1, in: 1, added: 1, removed: 1, moved: 1, price: 2, content: 3 };
  function toggleType(k) {
    if (st.types[k]) delete st.types[k];
    else {
      Object.keys(st.types).forEach(function (t) { if (GROUP[t] !== GROUP[k]) delete st.types[t]; });
      st.types[k] = true;
    }
    if (!st.types.content) st.parts = {};
  }
  function bindEvents() {
    $('chart-toggle').addEventListener('click', function () { setChartOpen($('chart-body').hidden); });
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
      // Клік вмикає або вимикає тип (toggleType: вибір в іншій групі скидає попередню). До
      // 27.09.2026 плитка лишала «тільки цей тип», і клік по вже підсвіченій плитці при
      // двох вибраних не знімав її, а скидав другу. Плитка категорій — четверта група:
      // перемикає вкладку туди й назад і скидає вибрані типи товарів; з вкладки
      // «Категорії» плитка товарів повертає на «Товари» лише з цим типом.
      if (k === 'cats') { if (st.tab === 'cats') st.tab = 'prod'; else { st.tab = 'cats'; st.types = {}; st.parts = {}; } }
      else if (st.tab === 'cats') { st.tab = 'prod'; st.types = {}; st.types[k] = true; }
      else toggleType(k);
      st.limit = PAGE; render();
    });
    $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) { st.tab = b.getAttribute('data-tab'); render(); } });
    $('tabs').addEventListener('input', function (e) { if (e.target.id === 'q') { st.q = e.target.value; st.limit = PAGE; render(); } });
    var panel = $('panel');
    panel.addEventListener('click', function (e) {
      if (e.target.closest('[data-reset]')) { st.types = {}; st.parts = {}; st.tab = 'prod'; st.limit = PAGE; render(); return; }
      var pt = e.target.closest('[data-part]');
      if (pt) { var k = pt.getAttribute('data-part'); if (st.parts[k]) delete st.parts[k]; else st.parts[k] = true; st.limit = PAGE; render(); return; }
      var oc = e.target.closest('[data-content]');
      if (oc) { var o = oc.getAttribute('data-content'), r = D.rows.filter(function (x) { return x.owner === o; })[0]; if (r) { r.siteUrl = siteUrl(r); openContent(r, [range.from, range.to], idx); } return; }
      if (e.target.closest('[data-more]')) { st.limit += PAGE; render(); }
    });
  }

  initThemeToggle();
  initHelpWindow();
  initNarrowGuard();
  setupTooltips();
  Promise.all([getJson(DATA + 'index.json'), getJson(DATA + 'products.json'),
    getJson(DATA + 'categories.json').catch(function () { return {}; })]).then(function (r) {
    idx = r[0]; products = r[1]; catUrls = r[2];
    $('generated').textContent = fmtLong(idx.dates[idx.dates.length - 1]);
    if (idx.dates.length < 2) {
      $('panel-wrap').innerHTML = '<div class="card empty"><b>Поки що є лише один знімок (' + fmtLong(idx.dates[0]) + ')</b>Порівняння з\'явиться після наступного нічного скрапінгу.</div>';
      $('chart-card').style.display = 'none'; $('tiles').style.display = 'none'; $('range').style.display = 'none';
      return;
    }
    readRange();
    // ?type=content — сторінка відкривається з увімкненим типом (так веде пункт меню
    // «Змінений контент» на map.html). Старі посилання ?type=desc|img|file|video ведуть
    // туди ж. Тип, якого в періоді немає, update() знімає сам.
    var t0 = new URLSearchParams(location.search).get('type');
    if (/^(desc|img|file|video)$/.test(t0 || '')) t0 = 'content';
    if (TYPE[t0]) st.types[t0] = true;
    setChartOpen(chartStored()); bindEvents(); update();
  }).catch(fail);
}

// ==================== СТИЛІ ====================
// Кольори, шрифти й темна тема — з ../map-common.css; тут лише компоненти звіту.
// --chg-bar (колір стовпчика) перевірено валідатором палітр в обох темах:
// контраст із поверхнею ≥ 3:1, світла — #2563eb на #fff, темна — #3794ff на #1f1f1f.
const css = `
:root { --chg-bar: #2563eb; --chg-mov: #6d28d9; --chg-mov-bg: #f5f3ff; --chg-mov-border: #ddd6fe; --chg-price: #b45309; --chg-price-bg: #fffbeb; --chg-price-border: #fde68a; --chg-desc: #0f766e; --chg-desc-bg: #f0fdfa; --chg-desc-border: #99f6e4; }
:root[data-theme="dark"] { --chg-bar: #3794ff; --chg-mov: #b4a0ff; --chg-mov-bg: rgba(180,160,255,.12); --chg-mov-border: rgba(180,160,255,.28); --chg-price: #f0a04b; --chg-price-bg: rgba(240,160,75,.12); --chg-price-border: rgba(240,160,75,.3); --chg-desc: #2dd4bf; --chg-desc-bg: rgba(45,212,191,.12); --chg-desc-border: rgba(45,212,191,.3); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --chg-bar: #3794ff; --chg-mov: #b4a0ff; --chg-mov-bg: rgba(180,160,255,.12); --chg-mov-border: rgba(180,160,255,.28); --chg-price: #f0a04b; --chg-price-bg: rgba(240,160,75,.12); --chg-price-border: rgba(240,160,75,.3); --chg-desc: #2dd4bf; --chg-desc-bg: rgba(45,212,191,.12); --chg-desc-border: rgba(45,212,191,.3); } }

/* map-common.css робить html,body { height:100%; overflow:hidden } — для
   <id>_map.html, де прокручується лише внутрішня .main-content. Тут, як і на
   map.html, прокручується весь документ; без цього перевизначення сторінка
   колесом не прокручувалась узагалі й таблиця нижче першого екрана була
   недосяжна. Саме visible, НЕ auto — з тієї ж причини, що й у build-maps.js:
   auto на html і body разом робить body окремим скрол-контейнером, і липка
   .app-header їде разом зі сторінкою. */
html, body { height: auto; overflow: visible; }
.rep-wrap { max-width: 1280px; margin: 0 auto; padding: 20px 20px 48px; }
.card { background: var(--bg-white); border: 1px solid var(--border-color); border-radius: 10px; }
.top-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.top-row h1 { font-size: 1.25rem; margin: 0; font-weight: 600; }
.top-row h1 .muted { font-weight: 400; font-size: .9rem; margin-left: 6px; }
.range-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.range-bar label { font-size: .8rem; color: var(--text-muted); }
.range-bar select { font: inherit; font-size: .85rem; padding: 5px 8px; border: 1px solid var(--border-dark); border-radius: 6px; background: var(--bg-white); color: var(--text-main); }
.range-arrow { color: var(--text-faint); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font: inherit; font-size: .78rem; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border-dark); background: var(--bg-white); color: var(--text-muted); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
/* Під курсором рамка й текст світлішають: одного тла в темній темі майже не видно. */
.chip:hover:not([disabled]) { background: var(--bg-hover); border-color: var(--text-muted); color: var(--text-main); }
.chip[disabled] { opacity: .45; cursor: default; }
.chip[aria-pressed="true"] { background: var(--bg-active); border-color: var(--border-active); color: var(--text-main); }
.chip[aria-pressed="true"]:hover { background: var(--bg-active); border-color: var(--text-link); }
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
#chart .gap .hit { cursor: default; }
#chart .gap-box { fill: none; stroke: var(--border-dark); stroke-dasharray: 4 3; }
#chart .cap { fill: var(--text-muted); font-size: 11px; font-family: var(--font-mono); text-anchor: middle; }
.chart-tip { position: fixed; pointer-events: none; z-index: 50; background: var(--bg-header); border: 1px solid var(--border-dark);
  border-radius: 8px; padding: 8px 10px; font-size: .78rem; box-shadow: 0 6px 20px rgba(0,0,0,.12); display: none; min-width: 200px; }
.chart-tip b { display: block; margin-bottom: 4px; }
.chart-tip .row { display: flex; justify-content: space-between; gap: 16px; color: var(--text-muted); }
.chart-tip .row span:last-child { font-family: var(--font-mono); color: var(--text-main); }
.chart-tip .foot { margin-top: 6px; color: var(--text-subtle); }
/* Заголовок графіка — кнопка згортання, але виглядає як заголовок. */
.chart-toggle { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; padding: 0;
  font: inherit; color: inherit; cursor: pointer; }
.chart-toggle .caret { font-size: .8em; color: var(--text-muted); }
.chart-toggle:hover, .chart-toggle:hover .caret { color: var(--text-link); }

.tiles { display: flex; margin-bottom: 16px; }
.tiles .tg { display: grid; gap: 10px; min-width: 0; }
.tiles .tg + .tg { border-left: 1px solid var(--border-dark); margin-left: 11px; padding-left: 11px; }
.tile { text-align: left; font: inherit; color: inherit; cursor: pointer; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.tile[disabled] { cursor: default; }
.tile[aria-pressed="true"] { border-color: var(--border-active); box-shadow: 0 0 0 1px var(--border-active) inset; }
.tile .tb { align-self: flex-start; }
.tile .num { font-size: 1.6rem; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; }
.tile .num.zero { color: var(--text-subtle); }
.tile .lbl { font-size: .78rem; color: var(--text-muted); }

.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border-color); padding: 0 12px; }
.tab { font: inherit; font-size: .88rem; padding: 10px 14px; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--text-muted); cursor: pointer; margin-bottom: -1px; }
.tab:hover { color: var(--text-main); }
.tab[aria-selected="true"] { color: var(--text-main); border-bottom-color: var(--border-active); font-weight: 600; }
.tab .n { font-family: var(--font-mono); font-size: .75rem; color: var(--text-subtle); margin-left: 4px; }
.search-mini { font: inherit; font-size: .85rem; padding: 6px 10px; border: 1px solid var(--border-dark); border-radius: 6px; background: var(--bg-white); color: var(--text-main); min-width: 220px; }
.result-line { padding: 8px 12px; font-size: .78rem; color: var(--text-muted); }
.tabs .tabs-q { margin: 6px 0 6px auto; align-self: center; min-width: 300px; }
.result-line .sep { color: var(--text-faint); margin: 0 8px; }
.link-btn { font: inherit; border: 0; background: none; padding: 0; color: var(--text-link); cursor: pointer; }
.link-btn:hover { text-decoration: underline; }
/* Наведення на невибрану плитку чи фішку — синя рамка (користувач 18.10.2026: сіра в темній темі
   майже не помітна); вибрана відрізняється подвійною рамкою (плитка) чи тлом (фішка). */
.tile:hover:not([disabled]):not([aria-pressed="true"]), .chip:hover:not([disabled]):not([aria-pressed="true"]) { border-color: var(--border-active); }

/* Бейдж типу зміни: іконка + колір + текст — ніколи не колір сам по собі */
.tb { display: inline-flex; align-items: center; gap: 5px; font-size: .74rem; font-weight: 600; padding: 2px 8px; border-radius: 4px; border: 1px solid; white-space: nowrap; }
.tb .ic { font-family: var(--font-mono); }
.t-in  { color: var(--status-yes); background: var(--status-yes-bg); border-color: var(--status-yes-border); }
.t-out { color: var(--status-no);  background: var(--status-no-bg);  border-color: var(--status-no-border); }
.t-add { color: var(--text-link);  background: var(--bg-active);     border-color: var(--border-dark); }
.t-rem { color: var(--text-muted); background: var(--bg-tag);        border-color: var(--border-dark); }
.t-mov { color: var(--chg-mov);    background: var(--chg-mov-bg);    border-color: var(--chg-mov-border); }
.t-price { color: var(--chg-price); background: var(--chg-price-bg); border-color: var(--chg-price-border); }
.price-pct { margin-left: 8px; white-space: nowrap; }
.t-desc { color: var(--chg-desc); background: var(--chg-desc-bg); border-color: var(--chg-desc-border); }
/* «Змінився контент»: у рядку таблиці — що саме змінилось; над таблицею — ряд частин. */
.st-box { display: grid; grid-template-columns: auto auto; gap: 1px 10px; font-size: .78rem; margin-bottom: 6px; justify-content: start; }
.st-name { color: var(--text-muted); }
.st-val { font-family: var(--font-mono); font-size: .74rem; color: var(--text-main); }
.parts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
.parts-lbl { font-size: .78rem; color: var(--text-subtle); margin-right: 4px; }
.cat-tag { font-size: .72rem; color: var(--text-subtle); margin-left: 6px; }

/* Вікно «Було / стало» як при merge (вибір користувача з макета 16.10.2026): ліва колонка —
   початок періоду, права — кінець; змінене тлом і смужкою (червоне зліва, зелене справа),
   слова — закреслене червоне й підкреслене зелене (колір і вигляд разом, не колір сам по
   собі); порожній бік — штриховка. */
.help-overlay.mg-overlay { padding: 3vh 0; align-items: flex-start; }
.help-panel.mg-panel { width: 94vw; max-width: none; }
.mg-panel .help-panel-head h3 { flex: 1; min-width: 0; }
.mg-code { margin: 0 14px 0 16px; font-size: 1rem; font-weight: 700; color: var(--text-main); white-space: nowrap; }
.mg-code:empty { display: none; }
.mg-scroll { max-height: calc(94vh - 58px); overflow-y: auto; }
.mg-scroll > .empty-note { padding: 18px 20px; color: var(--text-muted); }
.mg-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; padding: 12px 20px 4px; font-size: .82rem; }
.mg-meta a { color: var(--text-link); text-decoration: none; }
.mg-meta a:hover { text-decoration: underline; }
.mg-price { font-weight: 600; }
.mg-stats { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 20px 4px; font-size: .8rem; }
.mg-stats .chip b { font-family: var(--font-mono); font-weight: 600; font-size: .74rem; color: var(--text-main); }
.mg-sticky { position: sticky; top: 0; z-index: 3; background: var(--bg-white); padding: 0 20px; border-bottom: 1px solid var(--border-dark); }
.mg-tabs { margin-bottom: 0; position: static; }
.mg-tools { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: .8rem; }
.mg-tools .grow { flex: 1; }
.mg-only { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; color: var(--text-muted); }
.mg-cols { display: grid; grid-template-columns: 1fr 1fr; font-size: .78rem; font-weight: 600; }
.mg-cols > div { padding: 6px 12px; }
.mg-cols > div:first-child { color: var(--status-no); border-right: 1px solid var(--border-dark); }
.mg-cols > div:last-child { color: var(--status-yes); }
.mg-body { padding: 0 20px 24px; }
.mg-row { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--border-color); }
.mg-cell { padding: 6px 12px; min-width: 0; overflow-wrap: anywhere; font-size: .88rem; line-height: 1.5; }
.mg-cell.l { border-right: 1px solid var(--border-dark); }
.mg-row.chg .mg-cell.l, .mg-row.del .mg-cell.l { background: var(--status-no-bg); box-shadow: inset 3px 0 0 var(--status-no); }
.mg-row.chg .mg-cell.r, .mg-row.add .mg-cell.r { background: var(--status-yes-bg); box-shadow: inset 3px 0 0 var(--status-yes); }
.mg-cell.mg-empty { background: repeating-linear-gradient(-45deg, transparent 0 6px, var(--border-color) 6px 7px); box-shadow: none; }
.mg-row.mg-now { outline: 2px solid var(--border-active); outline-offset: -1px; }
.mg-body.only .mg-row.eq:not(.ctx) { display: none; }
.mg-body:not(.only) .mg-gap { display: none; }
.mg-gap { display: block; width: 100%; text-align: center; font: inherit; font-size: .78rem; color: var(--text-link); background: var(--bg-hover); border: 0; border-bottom: 1px solid var(--border-color); padding: 5px; cursor: pointer; }
.mg-gap:hover { text-decoration: underline; }
.mg-cell p, .mg-cell ul, .mg-cell ol, .mg-cell table, .mg-cell h1, .mg-cell h2, .mg-cell h3, .mg-cell h4 { margin: 4px 0; }
.mg-cell img.desc-img { max-width: 100%; height: auto; }
.mg-cell .d-del { background: color-mix(in srgb, var(--status-no) 22%, transparent); color: var(--status-no); text-decoration: line-through; border-radius: 2px; }
.mg-cell .d-ins { background: color-mix(in srgb, var(--status-yes) 22%, transparent); color: var(--status-yes); text-decoration: underline; text-decoration-thickness: 1px; border-radius: 2px; }
.mg-cell img.img-del { outline: 3px dashed var(--status-no); outline-offset: 2px; opacity: .7; }
.mg-cell img.img-ins { outline: 3px solid var(--status-yes); outline-offset: 2px; }
/* Фото на білому в обох темах: фото Prom на білому, на темному тлі виходили б «вікна». */
.mg-photo { max-width: 220px; max-height: 220px; background: #fff; border-radius: 6px; display: block; }
.mg-thumb { width: 48px; height: 48px; object-fit: contain; background: #fff; border-radius: 4px; margin-right: 8px; vertical-align: middle; }
.mg-kv { display: grid; grid-template-columns: 45% 1fr; gap: 10px; }
.mg-kv .k { color: var(--text-muted); }
.mg-li a { color: var(--text-link); text-decoration: none; }
.mg-li a:hover { text-decoration: underline; }
.mg-broken { display: inline-flex; flex-direction: column; gap: 4px; border: 2px dashed var(--status-no); border-radius: 6px; padding: 10px 12px; font-size: .76rem; color: var(--status-no); max-width: 260px; }
.mg-broken small { color: var(--text-subtle); word-break: break-all; }
.tab-chg { display: inline-block; min-width: 17px; padding: 0 5px; margin-left: 6px; border-radius: 9px; font: 700 .7rem/17px var(--font-sans); text-align: center; background: var(--status-yes); color: var(--bg-white); }

.rep-table td { vertical-align: top; }
.rep-table th { white-space: nowrap; }
.code { font-family: var(--font-mono); font-size: .76rem; color: var(--text-muted); background: var(--bg-tag); padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
.pname { color: var(--text-main); text-decoration: none; }
.pname:hover { color: var(--text-link); text-decoration: underline; }
.cat-link { color: var(--text-muted); text-decoration: none; }
.cat-link:hover { color: var(--text-link); text-decoration: underline; }
.cat-site { color: inherit; text-decoration: none; }
.cat-site:hover { color: var(--text-link); text-decoration: underline; }
.path-line + .path-line { margin-top: 4px; }
.path-label { display: inline-block; min-width: 48px; color: var(--text-muted); }
.path-link { color: inherit; text-decoration: none; }
.path-link:hover { color: var(--text-link); text-decoration: underline; }
.muted { color: var(--text-muted); }
.subtle { color: var(--text-subtle); }
.arrow-to { color: var(--text-faint); padding: 0 4px; }
.more-row { padding: 12px; text-align: center; border-top: 1px solid var(--border-color); }
.empty { padding: 48px 16px; text-align: center; color: var(--text-muted); }
.empty b { display: block; color: var(--text-main); font-size: 1rem; margin-bottom: 6px; }

@media (max-width: 560px) {
  .rep-wrap { padding: 16px 16px 40px; }
  .search-mini { min-width: 0; flex: 1; }
}
`;

// Вміст reports.css/reports.js готується до сторінки: версія в посиланні
// рахується від того самого рядка, який потім записується у файл, — інакше
// браузер із новим HTML міг би лишитись на закешованих старих стилях чи коді.
const REPORTS_CSS = css.trim() + '\n';
const REPORTS_JS = [reportIsYes, reportExpand, reportDiff, reportOps, reportPartStat, initContentWindow, initReportsPage].map(fn => fn.toString()).join('\n\n') +
  '\n\nvar REPORT_PARTS = ' + JSON.stringify(REPORT_PARTS) + ';\n';

// ==================== СТОРІНКА ====================
const html = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Історія змін каталогу</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../map-common.css${assetVer(path.join(SITE_DIR, 'map-common.css'))}">
<link rel="stylesheet" href="reports.css${contentVer(REPORTS_CSS)}">
</head>
<body>
  <header class="app-header">
    <div class="header-left">
      <span class="catalog-title">cncprom.ua</span>
      <span class="btn-theme-toggle catalog-subtitle-btn" style="cursor:default">${ICONS.history} Історія змін каталогу · останній знімок <span id="generated">…</span></span>
    </div>
    <div class="header-center"></div>
    <div class="header-right">
${helpButtonHtml('changes', '../')}
      <button id="btn-theme-toggle" class="btn-theme-toggle"><span class="theme-icon">🌙</span> <span class="theme-text">Темна</span></button>
      <a href="../map.html" class="btn-theme-toggle" data-tip="Мапа всіх категорій сайту">${ICONS.map} Мапа сайту</a>
    </div>
  </header>

${narrowGuardHtml()}
  <main class="rep-wrap">
    <div class="top-row">
      <h1>Історія змін каталогу<span class="muted" id="period-label"></span></h1>
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
        <h2 id="chart-title"><button type="button" class="chart-toggle" id="chart-toggle" aria-expanded="false" aria-controls="chart-body"><span class="caret" aria-hidden="true">▸</span>Змін за день</button></h2>
        <span class="hint" id="chart-hint">Синім виділено дні, що входять у порівняння. Клік по стовпчику починає період із цього дня.</span>
      </div>
      <div id="chart-body" hidden>
        <svg id="chart" role="img" aria-label="Кількість змін каталогу за кожен день"></svg>
      </div>
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


  <script src="../map-common.js${assetVer(path.join(SITE_DIR, 'map-common.js'))}"></script>
  <script src="reports.js${contentVer(REPORTS_JS)}"></script>
  <script>initReportsPage();</script>
</body>
</html>
`;


// ==================== ЗМІНИ КОНТЕНТУ ====================
// Тип «Змінився контент» і вікно «Було / стало» як при merge (HISTORY.md, п. 55; до
// 16.10.2026 — окремо «Змінився опис», п. 49, і числа змін медіа). Джерело — історія git
// гілки data: generate-snapshot.js переписує products/<id>.html|.json і
// categories/<id>.html|.json, лише коли на сайті щось змінилось, тож коміт «Знімок за
// <дата>», що змінив файл, — кандидат у зміну контенту тієї дати.
//
// Контент — те, що бачить покупець на сторінці, крім назви, ціни й наявності (у них свої
// типи): текст опису, картинки й посилання на файли в ньому, відео, фото товару,
// характеристики, файли «Специфікації», комплект постачання, список супутніх, плитка
// категорії. Опис обох версій розбирається ТИМ САМИМ кодом, що й вікно «Опис»
// (lib/desc-parse.js), тож правка лише розмітки зміною не є. Характеристики — за назвою:
// магазин їх тасує, і новий порядок зміною не вважається. Картинки Prom — за номером
// (mediaKey): перейменування товару міняє назву файлу в адресі всіх його фото.
//
// Пише reports/data/content/<власник>.json — { відбиток: версія } (власник — p<id> чи
// c<id>; версія — те, що малює вікно: html, kit, also, photos, attrs, specs, tile), а в
// index.json: content: { власник: [[дата, відбиток, коміт, 'h'|'j'|'hj'], …] } (перший
// запис — дата '', версія до першої зміни; літери — який файл змінив коміт),
// contentStats: { власник: { 'від>до': статистика } } для кожної пари версій (таблиця
// показує «що змінилось», не завантажуючи версій) і contentAnchor: { власник: [якір
// .html, якір .json] } для посилань на GitHub.
function contentText(d) {
  return String((d && d.text) || '').replace(/!\[\]\([^)]*\)/g, '🖼').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
}
function contentVersion(json, raw, parsed) {
  let d = {};
  try { d = JSON.parse(json || '{}'); } catch (e) { /* пошкоджений файл — порожня версія */ }
  const p = parsed || {};
  // Картинки й файли — з розібраного опису, тобто з того, що видно: у сирому є ще шаблон
  // магазину й скриншоти-підказки до «Специфікації», які вікно «Опис» прибирає (з них
  // виходили хибні «+4 картинки»). Відео — із сирого: вбудовані плеєри розбір не лишає.
  const shown = p.html ? mediaFromHtml(p.html) : [], rawMedia = raw ? mediaFromHtml(raw) : [];
  const urls = (kind, places, from) => (from || shown).filter(m => m.kind === kind && places.includes(m.place)).map(m => m.url);
  return {
    html: p.html || '',
    text: contentText(p),
    kit: p.kit || [],
    // Список супутніх з опису: назва й мініатюра (мініатюри у вікні «Опис» не видно).
    also: (p.xsell || []).map(x => [x[0] || '', realUrl(x[2]) || '']).filter(x => x[0] || x[1]),
    descImg: urls('image', ['desc', 'link']),
    files: urls('file', ['link']),
    video: urls('video', ['video'], rawMedia),
    photos: (d.photos || []).map(realUrl).filter(Boolean),
    attrs: d.attrs || [],
    specs: (d.specs || []).map(s => [s[0] || '', realUrl(s[1]) || '']),
    tile: realUrl(d.image) || '',
  };
}
// Відбиток контенту: однаковий — зміни немає (лише назва, адреса, порядок характеристик
// чи розмітка опису).
function contentSig(v) {
  const keys = list => list.map(mediaKey);
  return JSON.stringify({
    t: v.text, k: v.kit, a: v.also.map(x => x[0] + '\t' + mediaKey(x[1])),
    di: keys(v.descImg), f: keys(v.files), v: v.video, p: keys(v.photos),
    at: v.attrs.map(x => x[0] + '\t' + x[1]).sort(), s: v.specs.map(s => s[0] + '\t' + mediaKey(s[1])), tl: v.tile ? mediaKey(v.tile) : '',
  });
}
// Скільки слів додано й прибрано: LCS по словах (спільні початок і кінець — без таблиці).
function wordStats(a, b) {
  const x = a.split(/\s+/).filter(Boolean), y = b.split(/\s+/).filter(Boolean);
  let pre = 0, suf = 0;
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
  while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  const X = x.slice(pre, x.length - suf), Y = y.slice(pre, y.length - suf);
  let same = 0;
  if (X.length && Y.length && X.length * Y.length <= 4e6) {
    let prev = new Uint32Array(Y.length + 1), cur = new Uint32Array(Y.length + 1);
    for (let i = 1; i <= X.length; i++) {
      for (let j = 1; j <= Y.length; j++) cur[j] = X[i - 1] === Y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      [prev, cur] = [cur, prev];
    }
    same = prev[Y.length];
  }
  return [Y.length - same, X.length - same];
}
// Статистика пари версій: на частину — [додано, прибрано] (характеристики — ще й
// змінено). Лише частини, що змінились.
function contentStats(a, b) {
  const st = {};
  const sets = (x, y, key) => {
    const A = new Set(x.map(key)), B = new Set(y.map(key));
    return [y.filter(v => !A.has(key(v))).length, x.filter(v => !B.has(key(v))).length];
  };
  const put = (k, v) => { if (v[0] || v[1] || v[2]) st[k] = v; };
  if (a.text !== b.text) put('text', wordStats(a.text, b.text));
  put('descImg', sets(a.descImg, b.descImg, mediaKey));
  put('photos', sets(a.photos, b.photos, mediaKey));
  const am = new Map(a.attrs), bm = new Map(b.attrs), at = [0, 0, 0];
  bm.forEach((v, k) => { if (!am.has(k)) at[0]++; else if (am.get(k) !== v) at[2]++; });
  am.forEach((v, k) => { if (!bm.has(k)) at[1]++; });
  put('attrs', at);
  const fa = sets(a.specs.map(s => s[1]).concat(a.files), b.specs.map(s => s[1]).concat(b.files), mediaKey);
  put('files', fa);
  put('kit', sets(a.kit, b.kit, s => s));
  put('also', sets(a.also, b.also, x => x[0] + '\t' + mediaKey(x[1])));
  put('tile', sets(a.tile ? [a.tile] : [], b.tile ? [b.tile] : [], mediaKey));
  put('video', sets(a.video, b.video, s => s));
  return st;
}
async function readContentHistory(products, catUrls) {
  const { execFileSync } = require('child_process');
  const crypto = require('crypto');
  const { parseMany } = require('./lib/desc-parse');
  const git = args => execFileSync('git', args, { cwd: DATA_DIR, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
  let log;
  try { log = git(['log', '--reverse', '--format=@%H %s', '--name-status', '--diff-filter=M', 'HEAD', '--', 'products/*.html', 'products/*.json', 'categories/*.html', 'categories/*.json']); }
  catch (e) { console.warn(`Історію контенту не прочитано (${DATA_DIR} не git-тека гілки data?) — тип «Змінився контент» буде порожній.`); return null; }
  // Коміт × власник: які з двох файлів він змінив.
  const changes = [], byKey = new Map();
  let commit = null, date = null;
  log.split('\n').forEach(line => {
    if (line[0] === '@') { const m = line.match(/^@(\w+) .*?(\d{4}-\d{2}-\d{2})/); commit = m ? m[1] : null; date = m ? m[2] : null; return; }
    const f = line.match(/^M\t(products|categories)\/(\d+)\.(html|json)$/);
    if (!f || !commit) return;
    const owner = (f[1] === 'products' ? 'p' : 'c') + f[2], key = commit + ':' + owner;
    if (!byKey.has(key)) { const c = { commit, date, owner, dir: f[1], id: f[2], files: '' }; byKey.set(key, c); changes.push(c); }
    const c = byKey.get(key);
    if (!c.files.includes(f[3][0])) c.files = (c.files + f[3][0]).split('').sort().join('');
  });
  const show = (rev, file) => { try { return git(['show', `${rev}:${file}`]); } catch (e) { return ''; } };
  const raws = new Map(), list = [];
  changes.forEach(c => {
    const url = c.dir === 'products' ? (products[c.id] || [])[2] || '' : catUrls[c.id] || '';
    [c.commit + '^', c.commit].forEach(rev => {
      const k = `${rev}:${c.owner}`;
      if (raws.has(k)) return;
      const r = { json: show(rev, `${c.dir}/${c.id}.json`), html: show(rev, `${c.dir}/${c.id}.html`) };
      raws.set(k, r);
      if (r.html) list.push({ key: k, raw: r.html, url });
    });
  });
  const parsed = await parseMany(list);
  const ver = k => { const r = raws.get(k); return contentVersion(r.json, r.html, parsed.get(k)); };
  const h = t => crypto.createHash('sha1').update(t).digest('hex').slice(0, 10);
  const hist = {}, versions = {}, anchors = {};
  let same = 0;
  changes.forEach(c => {
    const a = ver(`${c.commit}^:${c.owner}`), b = ver(`${c.commit}:${c.owner}`);
    const sa = contentSig(a), sb = contentSig(b);
    if (sa === sb) { same++; return; }
    const ha = h(sa), hb = h(sb);
    const keep = v => { const o = Object.assign({}, v); delete o.text; delete o.descImg; return o; };
    versions[c.owner] = versions[c.owner] || {};
    if (!versions[c.owner][ha]) versions[c.owner][ha] = { v: keep(a), full: a };
    versions[c.owner][hb] = { v: keep(b), full: b };
    if (!hist[c.owner]) hist[c.owner] = [['', ha]];
    hist[c.owner].push([c.date, hb, c.commit, c.files]);
    const path = `${c.dir}/${c.id}`, sha = p => crypto.createHash('sha256').update(p).digest('hex');
    anchors[c.owner] = [sha(path + '.html'), sha(path + '.json')];
  });
  // Статистика кожної пари версій власника (обидва напрями: період може «повернути»
  // старий вміст, і тоді початок пізніший за кінець у ланцюжку версій).
  const stats = {};
  Object.keys(hist).forEach(o => {
    const hs = Array.from(new Set(hist[o].map(x => x[1])));
    stats[o] = {};
    hs.forEach(x => hs.forEach(y => { if (x !== y) stats[o][x + '>' + y] = contentStats(versions[o][x].full, versions[o][y].full); }));
  });
  const files = {};
  Object.keys(versions).forEach(o => { files[o] = {}; Object.keys(versions[o]).forEach(k => { files[o][k] = versions[o][k].v; }); });
  console.log(`Зміни контенту: ${changes.length} змін файлів в історії, з них без зміни контенту ${same}; товарів і категорій зі зміненим контентом ${Object.keys(hist).length}.`);
  return { hist, files, stats, anchors };
}

// ==================== ЗБІРКА ====================
if (require.main === module) (async () => {
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
  // Логотипи панелі «Подяки» — один набір у output/site/logos/; ця сторінка
  // бере їх через ../, але збиратись може й окремо від build-maps.js.
  writeLogos(SITE_DIR);
  // Прибрати компактні знімки дат, яких більше немає в гілці data.
  const keep = new Set(dates.map(d => `${d}.json`).concat(['index.json', 'products.json', 'categories.json', 'content']));
  fs.readdirSync(OUT_DATA).filter(f => !keep.has(f)).forEach(f => fs.rmSync(path.join(OUT_DATA, f), { recursive: true, force: true }));

  // Таблиця статусів наявності спільна для всіх днів: у кожному товарі лише її індекс.
  const avail = [], availIdx = new Map();
  const aIdx = s => { s = s || ''; if (!availIdx.has(s)) { availIdx.set(s, avail.length); avail.push(s); } return availIdx.get(s); };
  const products = {};
  const catUrls = {};
  const daily = [];
  const expandedByDate = [];
  let bytes = 0;

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
      // Ціна — четвертим елементом, лише коли вона є у знімку (з 02.10.2026).
      p: snap.products.map(p => p.price != null ? [p.id, p.categoryId, aIdx(p.availability), p.price] : [p.id, p.categoryId, aIdx(p.availability)])
    };
    const json = JSON.stringify(compact);
    fs.writeFileSync(path.join(OUT_DATA, `${d}.json`), json, 'utf-8');
    bytes += json.length;

    expandedByDate.push(reportExpand(compact, avail, d));
  }

  // Зміни контенту — з історії git (потрібні словники products і catUrls: з них адреса
  // сторінки для розбору відносних посилань), тому після проходу по знімках. Тека
  // content/ щоразу збирається з нуля: версії власника, якого вже немає в історії, не
  // лишаються.
  const contentHist = await readContentHistory(products, catUrls);
  const CONTENT_OUT = path.join(OUT_DATA, 'content');
  fs.rmSync(CONTENT_OUT, { recursive: true, force: true });
  if (contentHist) {
    fs.mkdirSync(CONTENT_OUT, { recursive: true });
    Object.keys(contentHist.files).forEach(o => fs.writeFileSync(path.join(CONTENT_OUT, `${o}.json`), JSON.stringify(contentHist.files[o]), 'utf-8'));
  }
  const content = contentHist ? contentHist.hist : {};

  let prevExpanded = null;
  expandedByDate.forEach(expanded => {
    if (prevExpanded) {
      const t = reportDiff(prevExpanded, expanded, null, content).totals;
      daily.push({ date: expanded.date, t: { in: t.in, out: t.out, added: t.added, removed: t.removed, moved: t.moved, price: t.price, content: t.content, cats: t.cats } });
    } else {
      daily.push({ date: expanded.date, t: null });
    }
    prevExpanded = expanded;
  });

  const usedDates = daily.map(x => x.date);
  fs.writeFileSync(path.join(OUT_DATA, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), dates: usedDates, missing: missingDays(usedDates), avail, daily, content,
    contentStats: contentHist ? contentHist.stats : {}, contentAnchor: contentHist ? contentHist.anchors : {} }), 'utf-8');
  fs.writeFileSync(path.join(OUT_DATA, 'products.json'), JSON.stringify(products), 'utf-8');
  fs.writeFileSync(path.join(OUT_DATA, 'categories.json'), JSON.stringify(readCategoryUrls(catUrls)), 'utf-8');

  fs.writeFileSync(path.join(OUT_DIR, 'reports.css'), REPORTS_CSS, 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'reports.js'), REPORTS_JS, 'utf-8');
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf-8');


  const last = daily[daily.length - 1];
  console.log(`Сторінку змін збудовано: ${path.join(OUT_DIR, 'index.html')}`);
  console.log(`Знімків: ${usedDates.length} (${usedDates[0]} … ${usedDates[usedDates.length - 1]}), товарів у словнику: ${Object.keys(products).length}, ` +
    `компактні знімки: ${(bytes / 1024 / Math.max(1, usedDates.length)).toFixed(0)} КБ/день без стиснення.`);
  if (last.t) console.log(`Останній день (${last.date}): ` + JSON.stringify(last.t));
})().catch(e => { console.error(e); process.exit(1); });

module.exports = { reportIsYes, reportExpand, reportDiff };

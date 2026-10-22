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
const { assetVer, contentVer, faviconLinks } = require('./lib/assets');
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

// Вікно «Було / стало» для типу «Змінився контент» (вибір користувача з інтерактивного
// макета 18.10.2026: «два вікна Опис поруч», «найбільш наочний»; до того, з 16.10.2026, —
// рядки навпроти рядків «як при merge», HISTORY п. 60). Дві колонки, кожна — вікно «Опис»
// (descBodyHtml з map-common.js): ліва — версія на початок періоду, права — на кінець.
// Зміни підсвічено лише тлом, без закреслення й підкреслення (користувач): прибране
// червоним зліва, додане зеленим справа; де з іншого боку нічого немає — кольорова риска.
// Вкладки спільні, колонки прокручуються разом (вимикається). Фото — карусель, як в
// «Описі»: стрілки, мініатюри, клік — на весь екран (← → гортають, Esc закриває лише фото);
// прибране фото — червона пунктирна рамка, нове — зелена. Картинка, що не відкривається, —
// рамка з адресою: стара картинка показується з сервера Prom чи хостингу, копій немає.
// open(r, dates, idx) — r: рядок reportDiff (owner, fromHash, toHash, назва, ціна…).
function initContentWindow(DATA, loadSnap) {
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var fmtLong = function (d) { var p = String(d).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; };
  var ov = document.createElement('div');
  ov.id = 'mg-overlay';
  ov.className = 'help-overlay mg-overlay';
  // Шапка вікна — лише «Що змінилось» і ✕ (користувач 18.10.2026): назва, код, ціна й наявність
  // — у кожній колонці своєї дати, щоб і їхні зміни було видно на місці.
  ov.innerHTML = '<div class="help-panel mg-panel" role="dialog" aria-modal="true" aria-label="Було / стало">' +
    '<div class="help-panel-head mg-head"><div class="mg-stats" id="mg-stats"></div>' +
    '<button type="button" class="btn-help-close" id="mg-close" aria-label="Закрити">✕</button></div>' +
    '<div class="mg-scroll" id="mg-scroll"></div></div>';
  document.body.appendChild(ov);
  setupModalOverlay('mg-overlay', null, 'mg-close');
  var scroll = ov.querySelector('#mg-scroll'), cache = {}, current = 0, st = null;
  var ORDER_TABS = ['text', 'attrs', 'specs', 'kit', 'acc', 'also'];

  function imgKey(u) {
    u = String(u || '');
    var p = u.match(/^https?:\/\/ssl\.prom\.st\/q\?(?:.*&)?u=([^&]+)/i);
    if (p) { try { u = decodeURIComponent(p[1]); } catch (e) { /* лишаємо як є */ } }
    var m = u.match(/^https?:\/\/images\.(?:ua\.prom\.st|prom\.ua)\/(\d+)_/);
    return m ? 'prom:' + m[1] : u.split('#')[0];
  }
  // Розмір фото Prom — вставкою _wN_hN_ після id, як у вікні «Опис».
  function sized(u, s) { return String(u || '').replace(/^(https?:\/\/images\.prom\.ua\/\d+)_(?!w\d+_h\d+_)(?=[^?]*$)/i, '$1_' + s + '_'); }
  function fileName(u) { try { return decodeURIComponent(String(u).split(/[?#]/)[0].split('/').pop() || u); } catch (e) { return String(u); } }
  // Картинка не відкрилась (файл видалено, хостинг зник чи не відповідає) — рамка з адресою.
  function guard(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.desc-main img'), function (im) {
      im.addEventListener('error', function () {
        var s = document.createElement('span');
        s.className = 'mg-broken';
        s.innerHTML = 'не відкривається<small>' + esc((im.getAttribute('src') || '').replace(/^https?:\/\//, '')) + '</small>';
        (im.closest('a') || im).replaceWith(s);
      });
    });
  }

  // ---------- Версія як вікно «Опис» ----------
  function toDesc(v, r, f) {
    return { name: v.name || r.name, code: v.sku || r.sku, price: f.price, avail: f.avail, url: r.siteUrl || '', html: v.html || '', attrs: v.attrs || [],
      specs: (v.specs || []).concat((v.files || []).map(function (u) { return [fileName(u) + ' (посилання в описі)', u]; })),
      kit: v.kit || [],
      // Картки з build-reports.js (xsellCards): посилання на мапу — від кореня сайту, кнопки «Опис»
      // тут немає (на цій сторінці її вікна немає). Масив [назва, мініатюра] — версія без каталогів.
      also: (v.also || []).map(function (x) {
        if (Array.isArray(x)) return { name: x[0], photo: x[1] };
        var q = Object.assign({}, x); q.desc = false; if (q.map) q.map = '../' + q.map; return q;
      }),
      photos: r.isCat ? (v.tile ? [v.tile] : []) : (v.photos || []), category: r.isCat };
  }
  function docEl(v, r, f) {
    var d = document.createElement('div'), dd = toDesc(v, r, f);
    d.className = 'mg-doc';
    d.innerHTML = '<div class="mg-name"><h3 class="mg-title"></h3><span class="mg-code"></span></div>' + descBodyHtml(dd, false);
    d.querySelector('.mg-title').textContent = r.isCat ? 'Категорія: ' + dd.name : dd.name;
    d.querySelector('.mg-code').textContent = r.isCat ? '' : dd.code || '';
    var slot = d.querySelector('[data-desc-html]');
    if (slot) descFillHtml(slot, v.html);
    d._photos = dd.photos; d._marks = []; d._pi = 0;
    return d;
  }

  // ---------- Позначки змін ----------
  // Смислові класи, вигляд — лише в CSS (одна система для всього вікна):
  //   слова — .mkw.del (є лише в «Було»), .mkw.ins (лише в «Стало»);
  //   елемент (рядок, пункт, картка, фото, картинка, назва, ціна) — .mk і стан: .del, .ins,
  //   .chg (є з обох боків, але інший), .mov (той самий, на іншому місці);
  //   .mk-gap.del / .mk-gap.ins — місце, де з іншого боку щось прибрали / додали.
  // Кожна зміна — свій data-run, спільний для обох колонок: на ньому числа на вкладках і
  // «Наступна / Попередня зміна».
  function mark(el, state, id) { el.classList.add('mk', state); if (id != null) el.setAttribute('data-run', id); }
  // Слова й картинки опису в порядку документа (картинка — один «токен» за ключем).
  function toks(root) {
    var out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (n) { return n.nodeType === 1 && n.classList.contains('empty-note') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    }), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 1) { if (n.tagName === 'IMG') out.push({ img: n, t: 'img:' + imgKey(n.getAttribute('src')) }); continue; }
      var re = /\S+/g, m; while ((m = re.exec(n.textContent))) out.push({ node: n, at: m.index, t: m[0] });
    }
    return out;
  }
  function gapEl(state) { var s = document.createElement('span'); s.className = 'mk-gap ' + state; return s; }
  // Дії над токенами з кінця документа: обгортка слів (від i до end) чи позначка картинки, або
  // вставка вузла перед токеном i (i = довжина — після останнього). З кінця — щоб зміщення не з'їжджали.
  function apply(tk, root, acts) {
    acts.sort(function (x, y) { return y.i - x.i || (x.state ? -1 : 0) + (y.state ? 1 : 0); });
    acts.forEach(function (a) {
      var t, rg;
      if (a.state) {
        t = tk[a.i];
        if (t.img) { mark(t.img, a.state, a.id); return; }
        var te = tk[a.end];
        rg = document.createRange(); rg.setStart(t.node, t.at); rg.setEnd(te.node, te.at + te.t.length);
        var el = document.createElement('span'); el.className = 'mkw ' + a.state;
        if (a.id != null) el.setAttribute('data-run', a.id);
        rg.surroundContents(el);
        return;
      }
      if (a.id != null) a.node.setAttribute('data-run', a.id);
      if (a.i < tk.length) {
        t = tk[a.i];
        if (t.img) { var ref = t.img.closest('a') || t.img; ref.parentNode.insertBefore(a.node, ref); }
        else { rg = document.createRange(); rg.setStart(t.node, t.at); rg.collapse(true); rg.insertNode(a.node); }
      } else if (tk.length) {
        t = tk[tk.length - 1];
        if (t.img) { var ref2 = t.img.closest('a') || t.img; ref2.parentNode.insertBefore(a.node, ref2.nextSibling); }
        else { rg = document.createRange(); rg.setStart(t.node, t.at + t.t.length); rg.collapse(true); rg.insertNode(a.node); }
      } else root.appendChild(a.node);
    });
  }
  // Сусідні слова одного текстового вузла — однією позначкою; картинка — окремо, зі своїм станом
  // (замінена картинка — chg, див. markText).
  function wraps(tk, list, state, id, out, chg) {
    var g = null;
    list.forEach(function (i, q) {
      var t = tk[i], own = q ? null : id;
      if (t.img) { g = null; out.push({ i: i, state: chg && chg[i] ? 'chg' : state, id: own }); return; }
      if (g && tk[g.end].node === t.node && g.end === i - 1) { g.end = i; return; }
      g = { i: i, end: i, state: state, id: own };
      out.push(g);
    });
  }
  // Два списки ключів → стан кожного елемента (eq, del, ins, chg, mov), пари й зміни в порядку
  // документа. Однакові — опорні точки (LCS); той самий ключ, прибраний в одному місці й доданий
  // в іншому, — переміщений; між опорними прибраний і доданий на тому самому місці — змінений
  // (заміна фото, пункт з іншим словом); решта — прибрані чи додані.
  function diffKeys(ka, kb) {
    var sa = ka.map(function () { return 'eq'; }), sb = kb.map(function () { return 'eq'; }), pa = {}, gaps = [], g = null, ops = reportOps(ka, kb);
    ops.forEach(function (o) {
      if (o[0] === '=') { g = null; pa[o[1]] = o[2]; return; }
      if (!g) gaps.push(g = { d: [], a: [] });
      (o[0] === '-' ? g.d : g.a).push(o[1]);
    });
    var free = {}, used = {};
    gaps.forEach(function (x) { x.a.forEach(function (j) { (free[kb[j]] = free[kb[j]] || []).push(j); }); });
    gaps.forEach(function (x) {
      x.d = x.d.filter(function (i) {
        var l = free[ka[i]];
        if (!l || !l.length) return true;
        var j = l.shift(); used[j] = 1; sa[i] = sb[j] = 'mov'; pa[i] = j;
        return false;
      });
    });
    gaps.forEach(function (x) {
      x.a = x.a.filter(function (j) { return !used[j]; });
      for (var k = 0; k < Math.max(x.d.length, x.a.length); k++) {
        var i = x.d[k], j = x.a[k];
        if (i != null && j != null) { sa[i] = sb[j] = 'chg'; pa[i] = j; } else if (i != null) sa[i] = 'del'; else sb[j] = 'ins';
      }
    });
    var events = [], pb = {};
    Object.keys(pa).forEach(function (i) { pb[pa[i]] = +i; });
    ops.forEach(function (o) {
      if (o[0] === '-' && sa[o[1]] !== 'eq') events.push({ a: o[1], b: sa[o[1]] === 'del' ? null : pa[o[1]], s: sa[o[1]] });
      else if (o[0] === '+' && sb[o[1]] === 'ins') events.push({ a: null, b: o[1], s: 'ins' });
    });
    return { a: sa, b: sb, ab: pa, ba: pb, events: events };
  }
  // Слова підсвічуються лише там, де більша частина лишилась: тоді видно, що саме змінилось.
  // Абзац (заголовок, пункт, клітинка), де лишилось менше половини слів, — переписаний: його
  // позначено цілим (.mkb, лінія збоку), без тла на кожному слові. Так переклад чи новий опис
  // читаються як текст, а не як суцільна заливка (користувач 18.10.2026).
  var BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,dt,dd,figcaption,pre';
  function blockOf(t, root) {
    if (t.img) return null;
    // Текст просто в <div> (плашка «Важливо!», розкладка редактора) — блоком є найближчий div без
    // вкладених блоків; div, що обгортає весь опис, — ні.
    var b = null;
    for (var e = t.node.parentElement; e && e !== root; e = e.parentElement) {
      if (e.matches(BLOCK) || (e.tagName === 'DIV' && !e.querySelector('div,' + BLOCK + ',ul,ol,table'))) { b = e; break; }
    }
    // Абзац усередині пункту списку — блоком є сам пункт (лінія ліворуч від крапки, а не на ній).
    if (b && b.tagName !== 'LI' && b.parentElement && b.parentElement.tagName === 'LI') b = b.parentElement;
    return b && b !== root && root.contains(b) ? b : null;
  }
  function markBlock(el, state, id) { el.classList.add('mkb', state); if (id != null && !el.hasAttribute('data-run')) el.setAttribute('data-run', id); }
  // Текст опису: зміна — пробіг різних токенів між однаковими. Картинки в пробігу, прибрані й
  // додані на тому самому місці, — замінені (chg) парами по порядку. Слова переписаного абзацу,
  // що випадково збіглися («на», «для»), теж ідуть у пробіг: абзац — одна зміна, а не десяток.
  function markText(dA, dB, R) {
    var ra = dA.querySelector('[data-desc-pane="text"] .desc-text'), rb = dB.querySelector('[data-desc-pane="text"] .desc-text');
    if (!ra || !rb) return;
    var ta = toks(ra), tb = toks(rb), runs = [], cur = null, actA = [], actB = [];
    var ops = reportOps(ta.map(function (x) { return x.t; }), tb.map(function (x) { return x.t; }));
    var ba = ta.map(function (t) { return blockOf(t, ra); }), bb = tb.map(function (t) { return blockOf(t, rb); });
    var sa = new Map(), sb = new Map();
    var count = function (m, b, eq) { if (!b) return; var s = m.get(b) || { n: 0, eq: 0 }; s.n++; if (eq) s.eq++; m.set(b, s); };
    ops.forEach(function (o) {
      if (o[0] === '=') { count(sa, ba[o[1]], 1); count(sb, bb[o[2]], 1); } else if (o[0] === '-') count(sa, ba[o[1]], 0); else count(sb, bb[o[1]], 0);
    });
    var whole = function (m, b) { var s = b && m.get(b); return !!s && s.eq * 2 < s.n; };
    ops.forEach(function (o) {
      var wa = o[0] !== '+' && whole(sa, ba[o[1]]), wb = o[0] === '=' ? whole(sb, bb[o[2]]) : o[0] === '+' && whole(sb, bb[o[1]]);
      if (o[0] === '=' && !wa && !wb) { if (cur) { cur.a = o[1]; cur.b = o[2]; runs.push(cur); cur = null; } return; }
      if (!cur) cur = { del: [], ins: [] };
      // Слово поза абзацом (текст просто в описі) іде разом зі своєю парою.
      if (o[0] === '=') { if (wa || !ba[o[1]]) cur.del.push(o[1]); if (wb || !bb[o[2]]) cur.ins.push(o[2]); } else (o[0] === '-' ? cur.del : cur.ins).push(o[1]);
    });
    if (cur) { cur.a = ta.length; cur.b = tb.length; runs.push(cur); }
    // Пробіг: слова звичайних абзаців — позначками слів, переписані абзаци — цілими.
    var side = function (tk, bl, m, list, state, id, out, chg) {
      var words = [];
      list.forEach(function (i) { if (whole(m, bl[i])) markBlock(bl[i], state, id); else words.push(i); });
      wraps(tk, words, state, id, out, chg);
    };
    runs.forEach(function (ru) {
      var id = R.n++, ia = ru.del.filter(function (i) { return ta[i].img; }), ib = ru.ins.filter(function (j) { return tb[j].img; }), ca = {}, cb = {};
      for (var k = 0; k < Math.min(ia.length, ib.length); k++) { ca[ia[k]] = 1; cb[ib[k]] = 1; }
      side(ta, ba, sa, ru.del, 'del', id, actA, ca);
      side(tb, bb, sb, ru.ins, 'ins', id, actB, cb);
      if (!ru.ins.length) actB.push({ i: ru.b, node: gapEl('del'), id: id });
      if (!ru.del.length) actA.push({ i: ru.a, node: gapEl('ins'), id: id });
    });
    apply(ta, ra, actA);
    apply(tb, rb, actB);
  }
  // Змінений елемент (пункт, характеристика, назва): слова, що різняться, — коли більша частина
  // лишилась; інакше лише позначка самого елемента (те саме правило, що для абзаців).
  function markWords(A, B) {
    var ta = toks(A), tb = toks(B), del = [], ins = [], aa = [], bb = [], eq = 0;
    reportOps(ta.map(function (x) { return x.t; }), tb.map(function (x) { return x.t; })).forEach(function (o) {
      if (o[0] === '-') del.push(o[1]); else if (o[0] === '+') ins.push(o[1]); else eq++;
    });
    if (eq * 2 < Math.max(ta.length, tb.length)) return;
    wraps(ta, del, 'del', null, aa); wraps(tb, ins, 'ins', null, bb);
    apply(ta, A, aa); apply(tb, B, bb);
  }
  // Характеристики — за назвою (порядок магазин тасує, це не зміна).
  function markAttrs(dA, dB, R) {
    var rows = function (d) { var m = {}, t = d.querySelector('.desc-attrs'); if (t) Array.prototype.forEach.call(t.rows, function (tr) { m[tr.cells[0].textContent] = tr; }); return m; };
    var ma = rows(dA), mb = rows(dB);
    Object.keys(mb).forEach(function (k) {
      var rb = mb[k], ra = ma[k];
      if (!ra) { mark(rb, 'ins', R.n++); return; }
      if (ra.cells[1].textContent === rb.cells[1].textContent) return;
      var id = R.n++;
      markWords(ra.cells[1], rb.cells[1]);
      mark(ra, 'chg', id); mark(rb, 'chg', id);
    });
    Object.keys(ma).forEach(function (k) { if (!(k in mb)) mark(ma[k], 'del', R.n++); });
  }
  // Пункти списку (комплект, специфікація, супутні): diffKeys; змінений — по словах.
  function markList(dA, dB, sel, key, R) {
    var la = Array.prototype.slice.call(dA.querySelectorAll(sel)), lb = Array.prototype.slice.call(dB.querySelectorAll(sel));
    diffKeys(la.map(key), lb.map(key)).events.forEach(function (ev) {
      var id = R.n++, x = ev.a != null ? la[ev.a] : null, y = ev.b != null ? lb[ev.b] : null;
      if (ev.s === 'chg') markWords(x, y);
      if (x) mark(x, ev.s, id);
      if (y) mark(y, ev.s, id);
    });
  }
  // Назва, код, ціна й наявність — завжди видно вгорі колонки, тож без data-run.
  function markHead(dA, dB) {
    var na = dA.querySelector('.mg-name'), nb = dB.querySelector('.mg-name');
    if (na.textContent !== nb.textContent) {
      markWords(na.querySelector('.mg-title'), nb.querySelector('.mg-title'));
      markWords(na.querySelector('.mg-code'), nb.querySelector('.mg-code'));
      mark(na, 'chg'); mark(nb, 'chg');
    }
    var facts = function (d) { var m = {}; Array.prototype.forEach.call(d.querySelectorAll('.desc-facts tr'), function (tr) { m[tr.cells[0].textContent] = tr; }); return m; };
    var fa = facts(dA), fb = facts(dB);
    Object.keys(fb).forEach(function (k) {
      if (!fa[k] || fa[k].cells[1].textContent === fb[k].cells[1].textContent) return;
      // Наявність — кольоровий значок: його видно й так, слова в ньому не фарбуються.
      if (!fb[k].cells[1].querySelector('.stock-badge')) markWords(fa[k].cells[1], fb[k].cells[1]);
      mark(fa[k], 'chg'); mark(fb[k], 'chg');
    });
  }
  // Фото: стан кожного (doc._marks за номером) — на мініатюрі, великому фото й на весь екран.
  function markGallery(doc, states) {
    doc._marks = states.map(function (s) { return s === 'eq' ? '' : s; });
    Array.prototype.forEach.call(doc.querySelectorAll('.desc-gal-thumb'), function (t, i) { if (doc._marks[i]) mark(t, doc._marks[i]); });
    galShow(doc, 0);
  }
  function markAll(dA, dB) {
    var R = { n: 0 };
    markHead(dA, dB);
    markText(dA, dB, R);
    markAttrs(dA, dB, R);
    markList(dA, dB, '.desc-specs li', function (e) { var l = e.querySelector('a'); return e.textContent.trim() + '|' + imgKey(l ? l.getAttribute('href') : ''); }, R);
    markList(dA, dB, '.desc-kit li', function (e) { return e.textContent.trim(); }, R);
    markList(dA, dB, '[data-desc-pane="also"] .desc-card', function (e) { return e.textContent.trim(); }, R);
    var ph = diffKeys(dA._photos.map(imgKey), dB._photos.map(imgKey));
    markGallery(dA, ph.a); markGallery(dB, ph.b);
    return [ph.ab, ph.ba];
  }
  function runIds(docs) {
    var s = {};
    docs.forEach(function (d) { Array.prototype.forEach.call(d.querySelectorAll('[data-run]'), function (e) { s[e.getAttribute('data-run')] = 1; }); });
    return Object.keys(s).map(Number).sort(function (x, y) { return x - y; });
  }
  function paneRuns(docs, name) {
    var s = {};
    docs.forEach(function (d) { var p = d.querySelector('[data-desc-pane="' + name + '"]'); if (p) Array.prototype.forEach.call(p.querySelectorAll('[data-run]'), function (e) { s[e.getAttribute('data-run')] = 1; }); });
    return Object.keys(s).length;
  }
  var STATE_WORD = { del: 'прибране', ins: 'нове', chg: 'замінене', mov: 'переміщене' };
  function setState(el, state) { el.classList.remove('mk', 'del', 'ins', 'chg', 'mov'); if (state) el.classList.add('mk', state); }

  // ---------- Фото: карусель і перегляд на весь екран ----------
  // Карусель у колонці — як у вікні «Опис». На весь екран (користувач 18.10.2026: «екран
  // ділиться так само, як всюди») — дві половини, «Було» і «Стало», кожна з мініатюрами й
  // стрілками. Гортає половина, по якій клікнули (← → з клавіатури — теж вона); друга, коли
  // в ній є те саме фото, стає на нього, щоб його можна було порівняти.
  var lb = document.createElement('div');
  lb.className = 'mg-lightbox';
  lb.innerHTML = [0, 1].map(function (k) {
    return '<div class="mg-lb-half" data-side="' + k + '"><div class="mg-lb-lbl ' + (k ? 'new' : 'old') + '"></div><div class="desc-lb-thumbs"></div>' +
      '<div class="desc-lb-stage"><button type="button" class="desc-gal-arrow prev" data-lb-step="-1" aria-label="Попереднє фото">‹</button>' +
      '<img alt=""><button type="button" class="desc-gal-arrow next" data-lb-step="1" aria-label="Наступне фото">›</button>' +
      '<div class="mg-lb-count"></div></div></div>';
  }).join('') + '<button type="button" class="btn-help-close desc-lb-close" aria-label="Закрити фото">✕</button>';
  document.body.appendChild(lb);
  var lbSide = 0;
  function lbHalf(doc) { return lb.querySelector('.mg-lb-half[data-side="' + st.docs.indexOf(doc) + '"]'); }
  function lbUpdate(doc) {
    var h = lbHalf(doc), ph = doc._photos || [], i = doc._pi, mark = doc._marks[i] || '', stage = h.querySelector('.desc-lb-stage');
    if (!ph.length) return;
    stage.querySelector('img').src = sized(ph[i], 'w1280_h1280');
    setState(stage, mark);
    Array.prototype.forEach.call(h.querySelectorAll('.desc-lb-thumbs button'), function (t, k) { t.classList.toggle('on', k === i); });
    h.querySelector('.mg-lb-count').textContent = 'Фото ' + (i + 1) + ' з ' + ph.length + (mark ? ' · ' + STATE_WORD[mark] : '');
  }
  function galShow(doc, i) {
    var ph = doc._photos || [];
    if (!ph.length) return;
    i = (i + ph.length) % ph.length;
    doc._pi = i;
    var mark = doc._marks[i] || '', main = doc.querySelector('.desc-gal-main');
    Array.prototype.forEach.call(doc.querySelectorAll('.desc-gal-thumb'), function (t, k) { t.classList.toggle('on', k === i); });
    doc.querySelector('.desc-gal-open img').src = sized(ph[i], 'w640_h640');
    setState(main, mark);
    if (lb.classList.contains('open')) lbUpdate(doc);
  }
  // Друга половина — на пару показаного фото, якщо пара є.
  function pairTo(doc) {
    var k = st.docs.indexOf(doc), other = st.docs[1 - k], j = st.pairs[k][doc._pi];
    if (j != null && j !== other._pi) galShow(other, j);
  }
  function lbActive(k) {
    lbSide = k;
    Array.prototype.forEach.call(lb.querySelectorAll('.mg-lb-half'), function (h) { h.classList.toggle('active', +h.getAttribute('data-side') === k); });
  }
  function lbStep(k, i) { var d = st.docs[k]; galShow(d, i); pairTo(d); }
  function lbOpen(doc) {
    st.docs.forEach(function (d, k) {
      var h = lbHalf(d), ph = d._photos || [];
      h.querySelector('.mg-lb-lbl').textContent = (k ? 'Стало · ' : 'Було · ') + fmtLong(st.dates[k]);
      h.classList.toggle('single', ph.length < 2);
      h.classList.toggle('empty', !ph.length);
      h.querySelector('.desc-lb-thumbs').innerHTML = ph.length > 1 ? ph.map(function (u, i) {
        return '<button type="button" class="' + (d._marks[i] ? 'mk ' + d._marks[i] : '') + '" data-lb-i="' + i + '" aria-label="Фото ' + (i + 1) + '"><img alt="" src="' + esc(sized(u, 'w100_h100')) + '"></button>';
      }).join('') : '';
      if (!ph.length) h.querySelector('.mg-lb-count').textContent = 'Фото немає';
    });
    pairTo(doc);
    lb.classList.add('open');
    st.docs.forEach(lbUpdate);
    lbActive(st.docs.indexOf(doc));
    lb.querySelector('.desc-lb-close').focus();
  }
  window.addEventListener('keydown', function (e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); lb.classList.remove('open'); }
    else if (e.key === 'ArrowLeft') lbStep(lbSide, st.docs[lbSide]._pi - 1);
    else if (e.key === 'ArrowRight') lbStep(lbSide, st.docs[lbSide]._pi + 1);
  }, true);
  lb.addEventListener('click', function (e) {
    var h = e.target.closest('.mg-lb-half'), t = e.target.closest('[data-lb-i], [data-lb-step]');
    if (h && !h.classList.contains('empty')) lbActive(+h.getAttribute('data-side'));
    if (t && h) { var d = st.docs[lbSide]; lbStep(lbSide, t.hasAttribute('data-lb-i') ? +t.getAttribute('data-lb-i') : d._pi + +t.getAttribute('data-lb-step')); return; }
    if (e.target.closest('.desc-lb-close') || !e.target.closest('img')) lb.classList.remove('open');
  });

  // ---------- Прокрутка разом ----------
  // Колонки рухаються разом завжди (галочку прибрано, синхронність лишилась — користувач
  // 18.10.2026). Не за часткою висоти, а за змінами: кожна зміна має позначку в обох колонках
  // (data-run), між ними — пропорційно. Так навпроти тексту «Було» стоїть той самий текст «Стало»,
  // навіть коли з одного боку додано довгий абзац. Опорна точка — середина видимої частини
  // (біля верху — сам верх, щоб на початку обидві колонки стояли на початку).
  function anchors() {
    var c = st.cols, res = [[0, 0]], seen = {};
    var y = function (col, el) { return el.getBoundingClientRect().top - col.getBoundingClientRect().top + col.scrollTop; };
    Array.prototype.forEach.call(st.docs[0].querySelectorAll('[data-run]'), function (e) {
      var id = e.getAttribute('data-run');
      if (seen[id] || !e.getClientRects().length) return;
      seen[id] = 1;
      var f = st.docs[1].querySelector('[data-run="' + id + '"]');
      if (f && f.getClientRects().length) res.push([y(c[0], e), y(c[1], f)]);
    });
    res.push([c[0].scrollHeight, c[1].scrollHeight]);
    res.sort(function (p, q) { return p[0] - q[0]; });
    return res.filter(function (p, i, all) { return !i || p[1] > all[i - 1][1]; });
  }
  function syncScroll(k) {
    if (!st || Date.now() < st.quiet) return;
    if (st.to === k) { st.to = -1; return; }
    var S = st.cols[k], T = st.cols[1 - k], h = S.clientHeight / 2, a = anchors(), from = k ? 1 : 0, to = 1 - from;
    var p = S.scrollTop + Math.min(S.scrollTop, h), q = a[a.length - 1][to];
    for (var i = 1; i < a.length; i++) {
      if (p <= a[i][from]) { var x = a[i - 1], z = a[i], f = z[from] > x[from] ? (p - x[from]) / (z[from] - x[from]) : 0; q = x[to] + f * (z[to] - x[to]); break; }
    }
    var t = Math.max(0, q < 2 * h ? q / 2 : q - h), was = T.scrollTop;
    if (Math.abs(was - t) < 1) return;
    st.to = 1 - k; T.scrollTop = t;
    if (Math.abs(T.scrollTop - was) < 1) st.to = -1;
  }

  // ---------- Вікно ----------
  function showTab(name) {
    if (!st.docs.some(function (d) { return d.querySelector('[data-desc-pane="' + name + '"]'); })) name = 'text';
    Array.prototype.forEach.call(scroll.querySelectorAll('[data-mg-tab]'), function (t) { t.classList.toggle('on', t.getAttribute('data-mg-tab') === name); });
    st.docs.forEach(function (d) {
      Array.prototype.forEach.call(d.querySelectorAll('[data-desc-pane]'), function (p) { p.hidden = p.getAttribute('data-desc-pane') !== name; });
    });
  }
  function draw(r, a, b, dates, idx, sA, sB) {
    var id = String(r.id || r.owner.slice(1));
    var fact = function (sn) { var q = sn && sn.prods.get(id); return q ? { price: q.price, avail: q.avail } : {}; };
    var fA = r.isCat ? {} : fact(sA), fB = r.isCat ? {} : fact(sB);
    var dA = docEl(a, r, fA), dB = docEl(b, r, fB), names = [], labels = {};
    var pairs = markAll(dA, dB);
    [dA, dB].forEach(function (d) {
      Array.prototype.forEach.call(d.querySelectorAll('[data-desc-tab]'), function (t) {
        var n = t.getAttribute('data-desc-tab');
        if (names.indexOf(n) < 0) { names.push(n); labels[n] = t.firstChild.textContent.trim(); }
      });
    });
    names.sort(function (x, y) { return ORDER_TABS.indexOf(x) - ORDER_TABS.indexOf(y); });
    // Вкладка є лише в одній версії — в іншій колонці пояснення на її місці.
    [dA, dB].forEach(function (d) {
      names.forEach(function (n) {
        if (d.querySelector('[data-desc-pane="' + n + '"]')) return;
        d.querySelector('.desc-main').insertAdjacentHTML('beforeend', '<div class="desc-pane" data-desc-pane="' + n + '" hidden><div class="empty-note">Вкладки «' +
          esc(labels[n]) + '» ' + (d === dA ? 'тоді ще не було' : 'вже немає') + '.</div></div>');
      });
    });
    var stats = ((idx.contentStats || {})[r.owner] || {})[r.fromHash + '>' + r.toHash] || {};
    ov.querySelector('#mg-stats').innerHTML = '<span class="subtle">Що змінилось:</span>' + REPORT_PARTS.filter(function (p) { return stats[p[0]]; }).map(function (p) {
      return '<button type="button" class="chip" data-mg-go="' + p[2] + '">' + p[1] + ' <b>' + reportPartStat(p[0], stats[p[0]]) + '</b></button>';
    }).join('');
    scroll.innerHTML = '<div class="mg-bar"><div class="desc-tabs mg-tabs">' + names.map(function (n) {
        var k = paneRuns([dA, dB], n);
        return '<button type="button" class="desc-tab" data-mg-tab="' + n + '">' + esc(labels[n]) + (k ? '<span class="tab-chg">' + k + '</span>' : '') + '</button>';
      }).join('') + '</div>' +
      '<div class="mg-tools"><button type="button" class="chip" id="mg-prev">↑ Попередня зміна</button><button type="button" class="chip" id="mg-next">Наступна зміна ↓</button><span class="subtle" id="mg-count"></span><span class="grow"></span>' +
      // Легенда — у рядку керування, місця не займає (користувач 18.10.2026).
      '<span class="mg-legend">' + [['del', 'прибрано'], ['ins', 'додано'], ['chg', 'змінено'], ['mov', 'переміщено']].map(function (x) {
        return '<span><i class="lg mk ' + x[0] + '"></i>' + x[1] + '</span>';
      }).join('') + '</span></div></div>' +
      '<div class="mg-cols"><div class="mg-col" id="mg-l"><div class="mg-lbl old">Було · ' + fmtLong(dates[0]) + '</div></div>' +
      '<div class="mg-col" id="mg-r"><div class="mg-lbl new">Стало · ' + fmtLong(dates[1]) + '</div></div></div>';
    var cl = scroll.querySelector('#mg-l'), cr = scroll.querySelector('#mg-r');
    cl.appendChild(dA); cr.appendChild(dB);
    guard(dA); guard(dB);
    st = { docs: [dA, dB], cols: [cl, cr], ids: runIds([dA, dB]), at: -1, dates: dates, pairs: pairs, to: -1, quiet: 0 };
    [cl, cr].forEach(function (c, k) { c.addEventListener('scroll', function () { syncScroll(k); }, { passive: true }); });
    var first = names.filter(function (n) { return paneRuns([dA, dB], n); })[0];
    showTab(first || 'text');
    scroll.querySelector('#mg-count').textContent = st.ids.length ? 'змін: ' + st.ids.length : '';
    scroll.querySelector('#mg-next').style.display = scroll.querySelector('#mg-prev').style.display = st.ids.length ? '' : 'none';
  }
  ov.querySelector('.mg-panel').addEventListener('click', function (e) {
    if (!st) return;
    var t = e.target.closest('[data-mg-tab], [data-mg-go]');
    if (t) { showTab(t.getAttribute('data-mg-tab') || t.getAttribute('data-mg-go')); return; }
    var g = e.target.closest('[data-gal-i], [data-gal-step]');
    if (g) { var doc = g.closest('.mg-doc'); galShow(doc, g.hasAttribute('data-gal-i') ? +g.getAttribute('data-gal-i') : doc._pi + +g.getAttribute('data-gal-step')); return; }
    var o = e.target.closest('[data-gal-open]');
    if (o) { lbOpen(o.closest('.mg-doc')); return; }
    var step = e.target.closest('#mg-next') ? 1 : e.target.closest('#mg-prev') ? -1 : 0;
    if (!step || !st.ids.length) return;
    // Наступна / попередня зміна (по колу; «попередня» з початку — остання): обидві колонки —
    // до своєї позначки цієї зміни.
    st.at = st.at < 0 && step < 0 ? st.ids.length - 1 : (st.at + step + st.ids.length) % st.ids.length;
    var id = st.ids[st.at], els = [];
    st.docs.forEach(function (d) { var el = d.querySelector('[data-run="' + id + '"]'); if (el) els.push(el); });
    if (!els.length) return;
    showTab(els[0].closest('[data-desc-pane]').getAttribute('data-desc-pane'));
    Array.prototype.forEach.call(scroll.querySelectorAll('.mg-now'), function (x) { x.classList.remove('mg-now'); });
    // Кожна колонка — до своєї позначки; прокрутка разом цього не переставляє.
    st.quiet = Date.now() + 250;
    els.forEach(function (el) { el.classList.add('mg-now'); el.scrollIntoView({ block: 'center' }); });
    scroll.querySelector('#mg-count').textContent = 'зміна ' + (st.at + 1) + ' з ' + st.ids.length;
  });

  return function open(r, dates, idx) {
    var my = ++current;
    st = null;
    ov.querySelector('#mg-stats').innerHTML = '';
    scroll.innerHTML = '<div class="empty-note">Завантажуємо версії…</div>';
    ov.classList.add('open');
    if (!cache[r.owner]) cache[r.owner] = fetch(DATA + 'content/' + encodeURIComponent(r.owner) + '.json').then(function (x) {
      if (!x.ok) throw new Error('HTTP ' + x.status); return x.json();
    });
    // Ціна й наявність кожної колонки — зі знімка її дати (не завантажився — без них).
    var snap = function (d) { return loadSnap(d).catch(function () { return null; }); };
    Promise.all([cache[r.owner], snap(dates[0]), snap(dates[1])]).then(function (x) {
      if (my !== current) return;
      var v = x[0], a = v[r.fromHash], b = v[r.toHash];
      if (!a || !b) { scroll.innerHTML = '<div class="empty-note">Однієї з версій не знайдено.</div>'; return; }
      draw(r, a, b, dates, idx, x[1], x[2]);
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

  var idx, products, catUrls = {}, descIds = {}, snaps = {}, D, range = {}, st = { tab: 'prod', types: {}, parts: {}, q: '', limit: PAGE };
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
  var openContent = initContentWindow(DATA, loadSnap);
  function siteUrl(r) { return r.isCat ? catUrls[r.id] || '' : r.url; }
  // Назва відкриває вікно «Опис», на сайт — колонка «Перейти на сайт» ↗, як на мапах (користувач
  // 18.10.2026). Опису немає (товар видалено, файлу desc/ вже немає) — назва веде на сайт.
  function nameCell(r) {
    var u = siteUrl(r), d = r.isCat ? 'c' + r.id : String(r.id);
    if (descIds[d]) return '<a class="pname name-desc" href="' + esc(u || '#') + '" data-desc="' + esc(d) + '">' + esc(r.name) + '</a>';
    return u ? '<a class="pname" target="_blank" rel="noopener" href="' + esc(u) + '">' + esc(r.name) + '</a>' : esc(r.name);
  }
  function productTable(rows, extra) {
    var shown = rows.slice(0, st.limit);
    return '<div class="result-line">Показано ' + shown.length + ' з ' + rows.length + (extra || '') + '</div>' +
      '<div class="table-wrap"><table class="simple-table rep-table"><thead><tr>' +
      '<th style="width:170px">Зміна</th><th style="width:110px">Код</th><th>Товар</th><th style="width:26%">Категорія</th><th style="width:24%">Що змінилось</th><th class="col-site">Перейти на сайт</th>' +
      '</tr></thead><tbody>' + shown.map(function (r) {
        return '<tr><td>' + badge(r.type) + '</td>' +
          '<td>' + (r.sku ? '<span class="code">' + esc(r.sku) + '</span>' : '<span class="subtle">—</span>') + '</td>' +
          '<td>' + nameCell(r) +
          (r.isCat ? '<span class="cat-tag">категорія</span>' : '') + '</td>' +
          // Категорія товару; для категорії — її батьківська (розділ 1 рівня — без батька: тире).
          '<td>' + (r.isCat && !r.cat ? '<span class="subtle">—</span>' :
            (r.top ? '<a class="cat-link" href="../' + esc(r.top) + '_map.html">' + esc(r.topName) + '</a>' : '<span class="muted">' + esc(r.topName) + '</span>') +
            (r.catName !== r.topName ? '<span class="arrow-to">›</span>' + mapLink(r.top, r.cat, r.catName) : '')) + '</td>' +
          '<td>' + detail(r) + '</td>' +
          '<td class="col-site">' + (siteUrl(r) ? '<a class="link-site" href="' + esc(siteUrl(r)) + '" target="_blank" rel="noopener">↗</a>' : '') + '</td></tr>';
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
  initDescriptions({ base: '../' });
  Promise.all([getJson(DATA + 'index.json'), getJson(DATA + 'products.json'),
    getJson(DATA + 'categories.json').catch(function () { return {}; }), getJson(DATA + 'desc.json').catch(function () { return []; })]).then(function (r) {
    idx = r[0]; products = r[1]; catUrls = r[2];
    r[3].forEach(function (d) { descIds[d] = 1; });
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

/* Вікно «Було / стало» (вибір користувача 18.10.2026): два вікна «Опис» поруч, ліве — на
   початок періоду, праве — на кінець; змінене — лише тлом: червоне зліва, зелене справа. */
.help-overlay.mg-overlay { padding: 3vh 0; align-items: flex-start; }
.help-panel.mg-panel { width: 94vw; max-width: none; }
/* Дві колонки «Було · Стало», кожна — вікно «Опис»; прокручуються колонки, шапка вікна стоїть. */
.mg-scroll { display: flex; flex-direction: column; height: calc(94vh - 58px); overflow: hidden; }
.mg-scroll > .empty-note { padding: 18px 20px; color: var(--text-muted); }
.mg-stats { flex: none; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 20px 4px; font-size: .8rem; }
.mg-stats .chip b { font-family: var(--font-mono); font-weight: 600; font-size: .74rem; color: var(--text-main); }
.mg-bar { flex: none; padding: 0 20px; border-bottom: 1px solid var(--border-dark); }
.mg-tabs { margin-bottom: 0; position: static; }
.mg-tools { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: .8rem; }
.mg-tools .grow { flex: 1; }
.mg-cols { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; }
.mg-col { overflow-y: auto; padding: 0 16px 24px; min-width: 0; }
.mg-col + .mg-col { border-left: 1px solid var(--border-dark); }
.mg-lbl { position: sticky; top: 0; z-index: 3; background: var(--bg-white); padding: 8px 0; font-size: .78rem; font-weight: 600; }
.mg-lbl.old { color: var(--status-no); }
.mg-lbl.new { color: var(--status-yes); }
.mg-doc > .desc-tabs, #mg-l .desc-links { display: none; }
.mg-head .mg-stats { flex: 1; min-width: 0; padding: 0; }
.mg-name { display: flex; align-items: baseline; gap: 16px; padding: 2px 0 12px; }
.mg-name .mg-title { flex: 1; min-width: 0; margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.4; color: var(--text-main); }
.mg-name .mg-code { margin: 0; font-size: 1rem; font-weight: 700; color: var(--text-main); white-space: nowrap; }
.mg-name .mg-code:empty { display: none; }
.mg-doc .desc-grid { grid-template-columns: minmax(0, 1fr) 220px; gap: 18px; }
.mg-doc .desc-side { top: 40px; }
.mg-doc .desc-gal-open img { height: 200px; }
/* Фото на весь екран: дві половини «Було · Стало», кожна як перегляд у вікні «Опис». */
.mg-lightbox { position: fixed; inset: 0; z-index: 1100; display: none; grid-template-columns: 1fr 1fr; gap: 20px;
  padding: 20px 64px 20px 20px; background: rgba(15, 23, 42, 0.92); }
.mg-lightbox.open { display: grid; }
.mg-lb-half { display: grid; grid-template-columns: 84px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: 8px 12px; min-width: 0; min-height: 0; }
.mg-lb-half.single, .mg-lb-half.empty { grid-template-columns: minmax(0, 1fr); }
.mg-lb-half.single .desc-lb-thumbs, .mg-lb-half.empty .desc-lb-thumbs, .mg-lb-half.single .desc-gal-arrow, .mg-lb-half.empty .desc-gal-arrow, .mg-lb-half.empty img { display: none; }
.mg-lb-lbl { grid-column: 1 / -1; font-size: .85rem; font-weight: 600; }
.mg-lb-lbl.old { color: #fca5a5; }
.mg-lb-lbl.new { color: #86efac; }
.mg-lb-half .desc-lb-thumbs button { width: 72px; height: 72px; }
.mg-lb-half .desc-lb-stage { border: 3px solid transparent; }
.mg-lb-half.active .desc-lb-stage { border-color: #60a5fa; }
.mg-lightbox .desc-lb-thumbs button.on { border-color: #60a5fa; }
.mg-lb-half .desc-lb-stage img { max-width: calc(100% - 90px); max-height: calc(100vh - 90px); }
.mg-lb-count { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); padding: 3px 10px; border-radius: 12px;
  background: rgba(15, 23, 42, 0.75); color: #fff; font-size: 0.8rem; white-space: nowrap; }
.mg-lb-half.empty .mg-lb-count { position: static; transform: none; background: none; color: #475569; }
/* ---- Позначки змін у «Було / стало» (вибір користувача з макета 18.10.2026 → H60) ----
   Лише тлом: незмінене на вкладці зі змінами приглушене; слова — тло 38%; прибраний, доданий,
   переміщений елемент і переписаний абзац (.mkb) — тло 12%; змінений елемент, де слів не
   підсвічено (значення замінене цілком), — бурштинове тло. Фото й картинки — рамка. */
:root { --mk-del: #dc2626; --mk-ins: #15803d; --mk-chg: #b45309; --mk-mov: #7c3aed; }
:root[data-theme="dark"] { --mk-del: #f87171; --mk-ins: #4ade80; --mk-chg: #fbbf24; --mk-mov: #a78bfa; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --mk-del: #f87171; --mk-ins: #4ade80; --mk-chg: #fbbf24; --mk-mov: #a78bfa; } }
.mk-gap { display: inline-block; width: 3px; height: 1.15em; vertical-align: text-bottom; margin: 0 2px; border-radius: 2px; }
.mk-gap.del { background: var(--mk-del); }
.mk-gap.ins { background: var(--mk-ins); }
.mkw { border-radius: 2px; }
.mkw.del { background: color-mix(in srgb, var(--mk-del) 38%, transparent); }
.mkw.ins { background: color-mix(in srgb, var(--mk-ins) 38%, transparent); }
.mg-doc .mg-now { outline: 2px solid var(--border-active) !important; outline-offset: 2px; }
.mg-legend { display: inline-flex; gap: 12px; font-size: .74rem; color: var(--text-muted); white-space: nowrap; }
.mg-legend > span { display: inline-flex; align-items: center; gap: 5px; }
.mg-legend .lg { display: inline-block; width: 14px; height: 12px; border-radius: 3px; flex: none; }
.mg-legend .lg.del { background: color-mix(in srgb, var(--mk-del) 38%, transparent); }
.mg-legend .lg.ins { background: color-mix(in srgb, var(--mk-ins) 38%, transparent); }
.mg-legend .lg.chg { background: color-mix(in srgb, var(--mk-chg) 38%, transparent); }
.mg-legend .lg.mov { background: color-mix(in srgb, var(--mk-mov) 38%, transparent); }
.mg-doc .desc-text img.desc-img { max-height: 260px; width: auto; }
.mg-doc li.mk { padding-left: 6px; margin-left: -6px; border-radius: 4px; }
.mg-doc .desc-attrs td:first-child, .mg-doc .desc-facts td:first-child { padding-left: 8px; }
.mg-doc .desc-pane:has(.mk, .mkw, .mk-gap, .mkb) .desc-text > *:not(.mkb):not(:has(.mk, .mkw, .mk-gap, .mkb)),
.mg-doc .desc-pane:has(.mk, .mkw, .mk-gap, .mkb) .desc-attrs tr:not(.mk), .mg-doc .desc-pane:has(.mk, .mkw, .mk-gap, .mkb) .desc-kit li:not(.mk),
.mg-doc .desc-pane:has(.mk, .mkw, .mk-gap, .mkb) .desc-specs li:not(.mk), .mg-doc .desc-pane:has(.mk, .mkw, .mk-gap, .mkb) .desc-card:not(.mk),
.mg-doc .desc-facts:has(.mk) tr:not(.mk) { opacity: .4; }
.mg-doc .desc-gal:has(.mk) .desc-gal-thumb:not(.mk) { opacity: .3; }
.mg-doc .desc-gal-thumb.mk { opacity: 1; }
.mg-doc .desc-attrs tr.mk.del > td, .mg-doc li.mk.del, .mg-doc .desc-card.mk.del { background: color-mix(in srgb, var(--mk-del) 12%, transparent); }
.mg-doc .desc-attrs tr.mk.ins > td, .mg-doc li.mk.ins, .mg-doc .desc-card.mk.ins { background: color-mix(in srgb, var(--mk-ins) 12%, transparent); }
.mg-doc .desc-attrs tr.mk.mov > td, .mg-doc li.mk.mov, .mg-doc .desc-card.mk.mov { background: color-mix(in srgb, var(--mk-mov) 12%, transparent); }
.mg-doc .desc-attrs tr.mk.chg:not(:has(.mkw)) > td, .mg-doc .desc-facts tr.mk.chg:not(:has(.mkw)) > td, .mg-doc li.mk.chg:not(:has(.mkw)),
.mg-doc .desc-card.mk.chg:not(:has(.mkw)), .mg-doc .mg-name.mk.chg:not(:has(.mkw)) .mg-title { background: color-mix(in srgb, var(--mk-chg) 16%, transparent); }
.mg-doc .desc-card.mk { border-radius: 4px; }
.mg-doc .desc-text .mkb { border-radius: 3px; }
.mg-doc .desc-text .mkb.del { background: color-mix(in srgb, var(--mk-del) 12%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--mk-del) 12%, transparent); }
.mg-doc .desc-text .mkb.ins { background: color-mix(in srgb, var(--mk-ins) 12%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--mk-ins) 12%, transparent); }
.mg-doc .desc-gal-thumb.mk.del, .mg-lightbox .desc-lb-thumbs button.mk.del { border-color: var(--mk-del); }
.mg-doc .desc-gal-main.mk.del, .mg-doc img.mk.del { outline: 2px solid var(--mk-del); outline-offset: 2px; }
.mg-lightbox .desc-lb-stage.mk.del img { outline: 3px solid var(--mk-del); outline-offset: 4px; }
.mg-doc .desc-gal-thumb.mk.ins, .mg-lightbox .desc-lb-thumbs button.mk.ins { border-color: var(--mk-ins); }
.mg-doc .desc-gal-main.mk.ins, .mg-doc img.mk.ins { outline: 2px solid var(--mk-ins); outline-offset: 2px; }
.mg-lightbox .desc-lb-stage.mk.ins img { outline: 3px solid var(--mk-ins); outline-offset: 4px; }
.mg-doc .desc-gal-thumb.mk.chg, .mg-lightbox .desc-lb-thumbs button.mk.chg { border-color: var(--mk-chg); }
.mg-doc .desc-gal-main.mk.chg, .mg-doc img.mk.chg { outline: 2px solid var(--mk-chg); outline-offset: 2px; }
.mg-lightbox .desc-lb-stage.mk.chg img { outline: 3px solid var(--mk-chg); outline-offset: 4px; }
.mg-doc .desc-gal-thumb.mk.mov, .mg-lightbox .desc-lb-thumbs button.mk.mov { border-color: var(--mk-mov); }
.mg-doc .desc-gal-main.mk.mov, .mg-doc img.mk.mov { outline: 2px solid var(--mk-mov); outline-offset: 2px; }
.mg-lightbox .desc-lb-stage.mk.mov img { outline: 3px solid var(--mk-mov); outline-offset: 4px; }
.mg-broken { display: inline-flex; flex-direction: column; gap: 4px; border: 2px dashed var(--status-no); border-radius: 6px; padding: 10px 12px; font-size: .76rem; color: var(--status-no); max-width: 260px; }
.mg-broken small { color: var(--text-subtle); word-break: break-all; }
.tab-chg { display: inline-block; min-width: 17px; padding: 0 5px; margin-left: 6px; border-radius: 9px; font: 700 .7rem/17px var(--font-sans); text-align: center; background: var(--status-yes); color: var(--bg-white); }

.rep-table td { vertical-align: top; }
.rep-table th { white-space: nowrap; }
.code { font-family: var(--font-mono); font-size: .76rem; color: var(--text-muted); background: var(--bg-tag); padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
.pname { color: var(--text-main); text-decoration: none; }
.pname:hover { color: var(--text-link); text-decoration: underline; }
.rep-table .col-site { width: 72px; text-align: center; white-space: normal; }
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
${faviconLinks()}
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
// Покажчик усіх каталогів (lib/desc.js, descIndex) — для карток списку супутніх у вікні
// «Було / стало», як у вікні «Опис». Немає каталогів (сторінку збирають окремо) — null.
let catalogIdx;
function catalogIndex() {
  if (catalogIdx !== undefined) return catalogIdx;
  const { descIndex } = require('./lib/desc');
  let cats = [];
  try {
    cats = fs.readdirSync(SITE_DIR).filter(f => f.endsWith('_catalog.json'))
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(SITE_DIR, f), 'utf-8')); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { /* немає output/site */ }
  catalogIdx = cats.length ? descIndex(cats) : null;
  return catalogIdx;
}
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
    // Назва й код версії — для вікна «Було / стало»; у відбиток не входять (перейменування
    // змінами контенту не вважаються).
    name: d.name || '',
    sku: d.sku || '',
    html: p.html || '',
    text: contentText(p),
    kit: p.kit || [],
    // Список супутніх з опису: назва й мініатюра (мініатюри у вікні «Опис» не видно).
    also: (p.xsell || []).map(x => [x[0] || '', realUrl(x[2]) || '']).filter(x => x[0] || x[1]),
    xsell: p.xsell || [],
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
    // Супутні — картками, як у вікні «Опис» (xsellCards): пункт «КУПИТИ» з тим самим посиланням,
    // що й розділ поруч, не стає окремою карткою (18.10.2026). Без каталогів — назва й мініатюра.
    const keep = v => {
      const o = Object.assign({}, v), idx = catalogIndex();
      if (idx) o.also = require('./lib/desc').xsellCards(v.xsell, idx, c.id);
      delete o.text; delete o.descImg; delete o.xsell;
      return o;
    };
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
  const keep = new Set(dates.map(d => `${d}.json`).concat(['index.json', 'products.json', 'categories.json', 'desc.json', 'content']));
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
  // Які товари й категорії мають вікно «Опис» (output/site/desc/ пише build-maps.js, він іде раніше).
  const descDir = path.join(SITE_DIR, 'desc');
  fs.writeFileSync(path.join(OUT_DATA, 'desc.json'), JSON.stringify(fs.existsSync(descDir)
    ? fs.readdirSync(descDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : []), 'utf-8');

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

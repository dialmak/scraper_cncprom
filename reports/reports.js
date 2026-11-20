function reportIsYes(s) { return /готово/i.test(s || ''); }

function reportExpand(snap, avail, date) {
  var cats = new Map(), prods = new Map();
  snap.c.forEach(function (c) { cats.set(c[0], { id: c[0], parentId: c[1], name: c[2], level: c[3] }); });
  snap.p.forEach(function (p) { prods.set(p[0], { id: p[0], cat: p[1], avail: avail[p[2]], price: p[3] }); });
  return { cats: cats, prods: prods, date: date || '' };
}

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

function reportPartStat(k, v) {
  var s = [v[0] ? '+' + v[0] : '', v[1] ? '−' + v[1] : '', v[2] ? '~' + v[2] : ''].filter(Boolean).join(' ');
  return k === 'text' ? s + ' слів' : s;
}

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

var REPORT_PARTS = [["text","Текст опису","text"],["descImg","Картинки в описі","text"],["video","Відео","text"],["photos","Фото товару","photos"],["attrs","Характеристики","attrs"],["files","Файли","specs"],["kit","Комплект","kit"],["also","Супутні товари","also"],["tile","Плитка категорії","tile"]];

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

  var idx, products, catUrls = {}, snaps = {}, D, range = {}, st = { tab: 'prod', types: {}, parts: {}, q: '', top: '', limit: PAGE };
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function fmtShort(d) { var p = d.split('-'); return p[2] + '.' + p[1]; }
  function fmtLong(d) { var p = d.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
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
  // Зміни цін у стовпець не входять: ціни перераховуються сотнями за ніч і затулили б
  // решту змін. У підказці вони окремим рядком.
  function dayTotal(d) { var t = d.t; return t ? t.in + t.out + t.added + t.removed + t.moved + (t.content || 0) + t.cats : null; }
  function drawChart() {
    // У згорнутому блоці svg.clientWidth — 0, і графік малювався б по запасній
    // ширині 800 і лишився б таким після розгортання. setChartOpen перемалює.
    if ($('chart-body').hidden) return;
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
    if (!d.t) tip.innerHTML = '<b>' + fmtLong(d.date) + '</b><div class="foot">Перший знімок: порівнювати нема з чим</div>';
    else tip.innerHTML = '<b>' + fmtLong(d.date) + ' · змін: ' + dayTotal(d) + '</b>' +
      TYPES.filter(function (k) { return k !== 'price'; }).map(function (k) { return '<div class="row"><span>' + TYPE[k].icon + ' ' + TYPE[k].label + '</span><span>' + d.t[k] + '</span></div>'; }).join('') +
      '<div class="row"><span>✎ Структура категорій</span><span>' + d.t.cats + '</span></div>' +
      (d.t.price ? '<div class="row"><span>₴ Змінилась ціна (окремо від стовпця)</span><span>' + d.t.price + '</span></div>' : '') +
      '<div class="foot">Клік: порівняти з ' + fmtShort(idx.dates[i - 1]) + (range.to > d.date ? ' по ' + fmtShort(range.to) : '') + '</div>';
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
    $('tiles').innerHTML = TYPES.map(function (k) {
      // Підсвічена кожна плитка, чий тип вибраний, скільки б типів не було вибрано
      // (до 27.09.2026 лише коли вибраний рівно один, і з двома фішками плитки гасли).
      // Нульова плитка неклікабельна, як і фішка: інакше клік давав порожню таблицю з
      // натиснутою, але вимкненою фішкою, яку вже не зняти (27.09.2026).
      var on = st.tab === 'prod' && !!st.types[k];
      return '<button class="card tile" data-type="' + k + '" aria-pressed="' + on + '"' + (t[k] ? '' : ' disabled') + '>' + badge(k, true) +
        '<span class="num' + (t[k] ? '' : ' zero') + '">' + t[k] + '</span><span class="lbl">' + TYPE[k].label + '</span></button>';
    }).join('') +
      '<button class="card tile" data-type="cats" aria-pressed="' + (st.tab === 'cats') + '"' + (t.cats || st.tab === 'cats' ? '' : ' disabled') + '><span class="tb t-mov" aria-label="Структура категорій"><span class="ic" aria-hidden="true">✎</span></span>' +
      '<span class="num' + (t.cats ? '' : ' zero') + '">' + t.cats + '</span><span class="lbl">Змін у структурі категорій</span></button>';
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
  function productTable(rows) {
    var shown = rows.slice(0, st.limit);
    return '<div class="result-line">Показано ' + shown.length + ' з ' + rows.length + '</div>' +
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
    return D.rows.filter(function (r) {
      if (any && !st.types[r.type]) return false;
      if (r.type === 'content' && Object.keys(st.parts).length && !Object.keys(partStats(r)).some(function (k) { return st.parts[k]; })) return false;
      if (st.top && r.top !== st.top) return false;
      return !q || (r.name + ' ' + r.sku + ' ' + r.catName + ' ' + r.topName).toLowerCase().indexOf(q) >= 0;
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
      partsHtml() +
      (rows.length ? productTable(rows)
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
      if (st.top && !D.rows.some(function (r) { return r.top === st.top; })) st.top = '';
      st.limit = PAGE; render();
    }).catch(fail);
  }

  // ---------- Події ----------
  function toggleType(k) { if (st.types[k]) delete st.types[k]; else st.types[k] = true; }
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
      // Плитка діє так само, як фішка того ж типу: клік вмикає або вимикає тип. До
      // 27.09.2026 плитка лишала «тільки цей тип», і клік по вже підсвіченій плитці при
      // двох вибраних не знімав її, а скидав другу. Плитка категорій перемикає вкладку
      // туди й назад; з вкладки «Категорії» плитка товарів повертає на «Товари» з цим
      // типом увімкненим, а не вимкненим.
      if (k === 'cats') st.tab = st.tab === 'cats' ? 'prod' : 'cats';
      else if (st.tab === 'cats') { st.tab = 'prod'; st.types[k] = true; }
      else toggleType(k);
      st.limit = PAGE; render();
    });
    $('tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) { st.tab = b.getAttribute('data-tab'); render(); } });
    var panel = $('panel');
    panel.addEventListener('click', function (e) {
      var c = e.target.closest('[data-chip]');
      if (c) { toggleType(c.getAttribute('data-chip')); st.limit = PAGE; render(); return; }
      var pt = e.target.closest('[data-part]');
      if (pt) { var k = pt.getAttribute('data-part'); if (st.parts[k]) delete st.parts[k]; else st.parts[k] = true; st.limit = PAGE; render(); return; }
      var oc = e.target.closest('[data-content]');
      if (oc) { var o = oc.getAttribute('data-content'), r = D.rows.filter(function (x) { return x.owner === o; })[0]; if (r) { r.siteUrl = siteUrl(r); openContent(r, [range.from, range.to], idx); } return; }
      if (e.target.closest('[data-more]')) { st.limit += PAGE; render(); }
    });
    panel.addEventListener('change', function (e) { if (e.target.id === 'top') { st.top = e.target.value; st.limit = PAGE; render(); } });
    panel.addEventListener('input', function (e) { if (e.target.id === 'q') { st.q = e.target.value; st.limit = PAGE; render(); } });
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

var REPORT_PARTS = [["text","Текст опису","text"],["descImg","Картинки в описі","text"],["video","Відео","text"],["photos","Фото товару","photos"],["attrs","Характеристики","attrs"],["files","Файли","specs"],["kit","Комплект","kit"],["also","Супутні товари","also"],["tile","Плитка категорії","tile"]];

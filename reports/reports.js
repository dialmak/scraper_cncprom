function reportIsYes(s) { return /готово/i.test(s || ''); }

function reportExpand(snap, avail, date) {
  var cats = new Map(), prods = new Map();
  snap.c.forEach(function (c) { cats.set(c[0], { id: c[0], parentId: c[1], name: c[2], level: c[3] }); });
  snap.p.forEach(function (p) { prods.set(p[0], { id: p[0], cat: p[1], avail: avail[p[2]], price: p[3] }); });
  return { cats: cats, prods: prods, date: date || '' };
}

function reportDiff(a, b, products, desc) {
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
  var rows = [], cats = [];
  b.prods.forEach(function (pb, id) {
    var pa = a.prods.get(id);
    if (!pa) { rows.push(row('added', id, pb.cat, pb.avail)); return; }
    if (reportIsYes(pa.avail) !== reportIsYes(pb.avail)) rows.push(row(reportIsYes(pb.avail) ? 'in' : 'out', id, pb.cat, pb.avail));
    if (pa.cat !== pb.cat) { var r = row('moved', id, pb.cat, pb.avail); r.fromCat = pa.cat; r.fromCatName = catName(pa.cat); var ft = topOf(pa.cat); r.fromTop = ft ? ft.id : ''; rows.push(r); }
    if (pa.price != null && pb.price != null && pa.price !== pb.price) { var rp = row('price', id, pb.cat, pb.avail); rp.fromPrice = pa.price; rp.price = pb.price; rows.push(rp); }
  });
  a.prods.forEach(function (pa, id) { if (!b.prods.has(id)) rows.push(row('removed', id, pa.cat, pa.avail)); });
  // Змінився опис: видимий текст на кінець періоду інший, ніж на початок (desc — історія
  // з index.json, див. readDescHistory). Текст, що змінився й повернувся, зміною не є.
  function descAt(list, d) { var h = null; for (var i = 0; i < list.length && list[i][0] <= d; i++) h = list[i][1]; return h; }
  if (desc && a.date && b.date) Object.keys(desc).forEach(function (id) {
    var pb = b.prods.get(id);
    if (!pb || !a.prods.has(id)) return;
    var ha = descAt(desc[id], a.date), hb = descAt(desc[id], b.date);
    if (ha && hb && ha !== hb) { var rd = row('desc', id, pb.cat, pb.avail); rd.fromHash = ha; rd.toHash = hb; rows.push(rd); }
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
  var totals = { in: 0, out: 0, added: 0, removed: 0, moved: 0, price: 0, desc: 0, cats: cats.length, products: b.prods.size, categories: b.cats.size };
  rows.forEach(function (r) { totals[r.type]++; });
  return { rows: rows, cats: cats, totals: totals };
}

function reportLcs(x, y) {
  var pre = 0, suf = 0, out = [], i, j;
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++;
  while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++;
  var X = x.slice(pre, x.length - suf), Y = y.slice(pre, y.length - suf), n = X.length, m = Y.length;
  for (i = 0; i < pre; i++) out.push(['=', x[i]]);
  if (n * m > 4000000) { X.forEach(function (v) { out.push(['-', v]); }); Y.forEach(function (v) { out.push(['+', v]); }); }
  else {
    var T = new Uint32Array((n + 1) * (m + 1));
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      T[i * (m + 1) + j] = X[i] === Y[j] ? T[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(T[(i + 1) * (m + 1) + j], T[i * (m + 1) + j + 1]);
    for (i = 0, j = 0; i < n || j < m;) {
      if (i < n && j < m && X[i] === Y[j]) { out.push(['=', X[i]]); i++; j++; }
      else if (i < n && (j === m || T[(i + 1) * (m + 1) + j] >= T[i * (m + 1) + j + 1])) { out.push(['-', X[i]]); i++; }
      else { out.push(['+', Y[j]]); j++; }
    }
  }
  for (i = x.length - suf; i < x.length; i++) out.push(['=', x[i]]);
  return out;
}

function reportHtmlDiff(box, oldHtml, newHtml) {
  function tokens(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), out = [], n;
    while ((n = w.nextNode())) { var re = /\S+/g, m; while ((m = re.exec(n.textContent))) out.push({ node: n, at: m.index, t: m[0] }); }
    return out;
  }
  // Адреса картинки без підпису проксі Prom (він новий щоночі).
  function imgKey(img) {
    var s = img.getAttribute('src') || '', m = s.match(/^https?:\/\/ssl\.prom\.st\/q\?(?:.*&)?u=([^&]+)/i);
    try { return m ? decodeURIComponent(m[1]) : s; } catch (e) { return s; }
  }
  var oldBox = document.createElement('div');
  descFillHtml(oldBox, oldHtml || '');
  box.innerHTML = '';
  descFillHtml(box, newHtml || '');
  var A = tokens(oldBox), B = tokens(box), bi = 0, marks = [], pending = [];
  reportLcs(A.map(function (x) { return x.t; }), B.map(function (x) { return x.t; })).forEach(function (op) {
    if (op[0] === '-') { pending.push(op[1]); return; }
    var tk = B[bi++];
    if (op[0] === '+' || pending.length) marks.push({ tk: tk, ins: op[0] === '+', del: pending.join(' ') });
    pending = [];
  });
  // З кінця до початку: позиції в текстових вузлах, що лишились попереду, не зсуваються.
  marks.reverse().forEach(function (m) {
    var r = document.createRange();
    r.setStart(m.tk.node, m.tk.at); r.setEnd(m.tk.node, m.tk.at + m.tk.t.length);
    if (m.ins) { var ins = document.createElement('ins'); ins.className = 'd-ins'; r.surroundContents(ins); r.setStartBefore(ins); }
    r.collapse(true);
    if (m.del) { var del = document.createElement('del'); del.className = 'd-del'; del.textContent = m.del; r.insertNode(document.createTextNode(' ')); r.insertNode(del); }
  });
  // Вилучене в самому кінці опису: слова, після яких у новому тексті вже нічого немає.
  if (pending.length) { var tail = document.createElement('p'); tail.innerHTML = '<del class="d-del"></del>'; tail.firstChild.textContent = pending.join(' '); box.appendChild(tail); }
  var oldImgs = {}, newImgs = {};
  Array.prototype.forEach.call(oldBox.querySelectorAll('img'), function (i) { oldImgs[imgKey(i)] = i; });
  Array.prototype.forEach.call(box.querySelectorAll('img'), function (i) { var k = imgKey(i); newImgs[k] = true; if (!oldImgs[k]) i.classList.add('img-ins'); });
  var gone = Object.keys(oldImgs).filter(function (k) { return !newImgs[k]; });
  if (gone.length) {
    var gb = document.createElement('div'); gb.className = 'img-gone blk-chg';
    gb.innerHTML = '<div class="img-gone-label">Вилучені картинки</div>';
    gone.forEach(function (k) { var im = document.createElement('img'); im.className = 'desc-img img-del'; im.loading = 'lazy'; im.src = oldImgs[k].getAttribute('src'); gb.appendChild(im); });
    box.appendChild(gb);
  }
  // Сусідні додані (чи вилучені) слова, між якими лише пробіл, — одним виділенням.
  ['d-ins', 'd-del'].forEach(function (cls) {
    Array.prototype.slice.call(box.querySelectorAll('.' + cls)).forEach(function (el) {
      if (!el.parentNode) return;
      for (;;) {
        var sp = el.nextSibling, nx = sp && sp.nodeType === 3 && /^\s*$/.test(sp.textContent) ? sp.nextSibling : sp;
        if (!nx || nx.nodeType !== 1 || nx.tagName !== el.tagName || !nx.classList.contains(cls)) break;
        if (sp !== nx) el.appendChild(sp);
        while (nx.firstChild) el.appendChild(nx.firstChild);
        nx.remove();
      }
    });
  });
  Array.prototype.forEach.call(box.querySelectorAll('.d-ins, .d-del, .img-ins'), function (e) {
    var b = e.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, div');
    (b && b !== box && box.contains(b) ? b : e).classList.add('blk-chg');
  });
  return box.querySelectorAll('.blk-chg').length;
}

function reportListDiff(x, y) {
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  var ops = reportLcs(x, y), out = '<ul class="desc-kit">', i = 0;
  while (i < ops.length) {
    if (ops[i][0] === '=') { out += '<li>' + esc(ops[i][1]) + '</li>'; i++; continue; }
    var del = [], ins = [];
    while (i < ops.length && ops[i][0] !== '=') { (ops[i][0] === '-' ? del : ins).push(ops[i][1]); i++; }
    for (var k = 0; k < Math.max(del.length, ins.length); k++) {
      var o = del[k], n = ins[k], li = '';
      if (o != null && n != null) {
        var cur = '', buf = '';
        var flush = function () { if (buf) li += cur === '-' ? '<del class="d-del">' + esc(buf) + '</del> ' : cur === '+' ? '<ins class="d-ins">' + esc(buf) + '</ins>' : esc(buf); buf = ''; };
        reportLcs(o.split(/(\s+)/), n.split(/(\s+)/)).forEach(function (op) { if (op[0] !== cur) { flush(); cur = op[0]; } buf += op[1]; });
        flush();
      } else li = o != null ? '<del class="d-del">' + esc(o) + '</del>' : '<ins class="d-ins">' + esc(n) + '</ins>';
      out += '<li class="blk-chg">' + li + '</li>';
    }
  }
  return out + '</ul>';
}

function reportTextDiff(a, b) {
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  var lcs = reportLcs;
  function words(oldText, newText) {
    var tok = function (s) { return s.split(/(\s+)/).filter(function (t) { return t !== ''; }); };
    var html = '', cur = null, buf = '';
    function flush() { if (buf) html += cur === '-' ? '<del class="d-del">' + esc(buf) + '</del>' : cur === '+' ? (/<\/del>$/.test(html) ? ' ' : '') + '<ins class="d-ins">' + esc(buf) + '</ins>' : esc(buf); buf = ''; }
    lcs(tok(oldText), tok(newText)).forEach(function (op) {
      // Пробіл між двома зміненими словами не розриває виділення.
      var k = op[0] !== '=' || !/^\s+$/.test(op[1]) ? op[0] : cur;
      if (k !== cur) { flush(); cur = k; }
      buf += op[1];
    });
    flush();
    return html;
  }
  var ops = lcs(String(a).split('\n'), String(b).split('\n')), lines = [], i;
  for (i = 0; i < ops.length;) {
    if (ops[i][0] === '=') { lines.push({ eq: true, html: esc(ops[i][1]) }); i++; continue; }
    var del = [], ins = [];
    while (i < ops.length && ops[i][0] !== '=') { (ops[i][0] === '-' ? del : ins).push(ops[i][1]); i++; }
    if (del.length && ins.length) lines.push({ html: words(del.join('\n'), ins.join('\n')).replace(/\n/g, '<br>') });
    else if (del.length) lines.push({ html: '<del class="d-del">' + esc(del.join('\n')).replace(/\n/g, '<br>') + '</del>' });
    else lines.push({ html: '<ins class="d-ins">' + esc(ins.join('\n')).replace(/\n/g, '<br>') + '</ins>' });
  }
  var CTX = 2, out = '', near = lines.map(function () { return false; });
  lines.forEach(function (l, k) { if (!l.eq) for (var d = -CTX; d <= CTX; d++) if (lines[k + d]) near[k + d] = true; });
  function rows(n) { return n % 10 === 1 && n % 100 !== 11 ? 'рядок' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'рядки' : 'рядків'; }
  for (i = 0; i < lines.length;) {
    if (near[i]) { out += '<div class="diff-line' + (lines[i].eq ? '' : ' chg') + '">' + (lines[i].html || '&nbsp;') + '</div>'; i++; continue; }
    var k = i; while (k < lines.length && !near[k]) k++;
    out += '<div class="diff-skip">без змін: ' + (k - i) + ' ' + rows(k - i) + '</div>';
    i = k;
  }
  return out;
}

function initReportsPage() {
  var DATA = 'data/';
  var TYPES = ['out', 'in', 'added', 'removed', 'moved', 'price', 'desc'];
  var TYPE = {
    out:     { icon: '▼', label: 'Зникли з наявності', cls: 't-out' },
    in:      { icon: '▲', label: 'Знову в наявності',  cls: 't-in' },
    added:   { icon: '+', label: 'Нові товари',        cls: 't-add' },
    removed: { icon: '−', label: 'Видалені товари',    cls: 't-rem' },
    moved:   { icon: '⇄', label: 'Змінили категорію',  cls: 't-mov' },
    price:   { icon: '₴', label: 'Змінилась ціна',     cls: 't-price' },
    desc:    { icon: '¶', label: 'Змінився опис',      cls: 't-desc' }
  };
  var CAT = { added: ['+', 'Нова категорія', 't-add'], removed: ['−', 'Видалена', 't-rem'], renamed: ['✎', 'Перейменована', 't-mov'], moved: ['⇄', 'Перенесена', 't-mov'] };
  var ORDER = { out: 0, in: 1, added: 2, removed: 3, moved: 4, price: 5, desc: 6 };
  var PAGE = 200;

  var idx, products, catUrls = {}, snaps = {}, D, range = {}, st = { tab: 'prod', types: {}, q: '', top: '', limit: PAGE };
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
  function dayTotal(d) { var t = d.t; return t ? t.in + t.out + t.added + t.removed + t.moved + (t.desc || 0) + t.cats : null; }
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
    if (r.type === 'desc') return '<button class="chip" data-desc="' + esc(r.id) + '" data-diff="' + esc(r.id) + '" data-from="' + esc(r.fromHash) + '" data-to="' + esc(r.toHash) + '">Було / стало</button>';
    return '<span class="subtle">зник із сайту</span>';
  }

  // ---------- Зміни опису у вікні «Опис» ----------
  // Розмір і наповнення — самого вікна «Опис» (користувач 05.10.2026): ті самі вкладки,
  // фото, код, ціна й наявність; сторінка змін лише домальовує в ньому зміни. Кнопка
  // «Було / стало» має data-desc, тож вікно відкриває initDescriptions (map-common.js),
  // а що показати — каже want: { id, from, to } (відбитки версій на початок і кінець
  // періоду). Картки супутніх у вікні відкривають інші товари як звичайний опис;
  // «← Назад» повертає до змін.
  // Тексти версій — reports/data/desc/<id>.json (readDescHistory у build-reports.js).
  var descTexts = {}, want = null;
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-diff]');
    if (b) want = { id: b.getAttribute('data-diff'), from: b.getAttribute('data-from'), to: b.getAttribute('data-to'), dates: [range.from, range.to] };
  }, true);
  function showChanges(id, d, body) {
    if (!want || want.id !== id) return false;
    var w = want, tabs = body.querySelector('.desc-tabs'), tools = document.createElement('div');
    tools.className = 'chg-tools';
    tools.innerHTML = '<span class="subtle">Завантажуємо зміни опису…</span>';
    if (tabs) tabs.parentNode.insertBefore(tools, tabs.nextSibling); else body.insertBefore(tools, body.firstChild);
    // Рядок кнопок закріплено під вкладками, вкладки — під заголовком вікна.
    tools.style.top = (tabs ? tabs.offsetHeight : 0) + 'px';
    if (!descTexts[id]) descTexts[id] = getJson(DATA + 'desc/' + encodeURIComponent(id) + '.json');
    descTexts[id].then(function (t) {
      if (!document.body.contains(tools)) return; // вікно вже показує інше
      var a = t[w.from], b = t[w.to];
      if (!a || !b) { tools.innerHTML = '<span>Одну з версій опису не знайдено.</span>'; return; }
      var anchor = (idx.descAnchor || {})[id];
      var gh = (idx.desc[id] || []).filter(function (v) { return v[2] && v[0] > w.dates[0] && v[0] <= w.dates[1]; }).map(function (v) {
        return '<a target="_blank" rel="noopener" href="https://github.com/dialmak/scraper_cncprom/commit/' + esc(v[2]) + (anchor ? '#diff-' + esc(anchor) : '') + '">Зміна від ' + fmtLong(v[0]) + ' на GitHub ↗</a>';
      }).join('');
      tools.innerHTML = '<span>Зміни опису: було на ' + fmtLong(w.dates[0]) + ', стало на ' + fmtLong(w.dates[1]) + '</span>' +
        '<div class="chips" role="group" aria-label="Що показати"><button class="chip" data-dmode="diff">Зміни</button><button class="chip" data-dmode="old">Було</button><button class="chip" data-dmode="new">Стало</button></div>' +
        '<button class="chip" id="chg-next">Наступна зміна ↓</button><span class="subtle" id="chg-count"></span><span class="grow"></span>' + gh;
      var textPane = body.querySelector('[data-desc-pane="text"]'), kitPane = body.querySelector('[data-desc-pane="kit"]'), at = -1;
      if (!textPane) return;
      function list(items) { return '<ul class="desc-kit">' + items.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>'; }
      function marks() { return body.querySelectorAll('[data-desc-pane] .blk-chg'); }
      function draw(mode) {
        Array.prototype.forEach.call(tools.querySelectorAll('[data-dmode]'), function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-dmode') === mode)); });
        var v = mode === 'old' ? a : b, ak = a.kit || [], bk = b.kit || [], aa = a.also || [], ba = b.also || [];
        textPane.innerHTML = '<div class="desc-text desc-html" data-desc-html></div>';
        var slot = textPane.firstChild, extra = '';
        if (mode === 'diff') reportHtmlDiff(slot, a.html, b.html); else descFillHtml(slot, v.html || '');
        // Комплект: у своїй вкладці, коли вона є; інакше (у сьогоднішньому описі комплекту
        // вже немає) — під описом. Список «можна придбати» у вікні — картки, тому зміни
        // його назв теж під описом.
        var kitHtml = mode === 'diff' ? reportListDiff(ak, bk) : list(v.kit || []);
        if (kitPane) kitPane.innerHTML = kitHtml;
        else if (mode === 'diff' ? ak.join('\n') !== bk.join('\n') : (v.kit || []).length) extra += '<h4 class="chg-h">Комплект постачання</h4>' + kitHtml;
        if (mode === 'diff' ? aa.join('\n') !== ba.join('\n') : false) extra += '<h4 class="chg-h">До цього товару у нас можна придбати</h4>' + reportListDiff(aa, ba);
        if (extra) textPane.insertAdjacentHTML('beforeend', extra);
        // На вкладці зі змінами — лише число змін (замість кількості пунктів).
        Array.prototype.forEach.call(body.querySelectorAll('[data-desc-tab]'), function (tab) {
          var old = tab.querySelector('.tab-chg'); if (old) old.remove();
          var pane = body.querySelector('[data-desc-pane="' + tab.getAttribute('data-desc-tab') + '"]'), n = pane ? pane.querySelectorAll('.blk-chg').length : 0;
          tab.classList.toggle('has-chg', n > 0);
          if (n) tab.insertAdjacentHTML('beforeend', '<span class="tab-chg">' + n + '</span>');
        });
        if (tabs) tools.style.top = Math.ceil(tabs.getBoundingClientRect().height) + 'px';
        at = -1;
        var n = marks().length;
        $('chg-next').style.display = n ? '' : 'none';
        $('chg-count').textContent = n ? 'змінених місць: ' + n : '';
      }
      tools.addEventListener('click', function (e) {
        var c = e.target.closest('[data-dmode]');
        if (c) { draw(c.getAttribute('data-dmode')); return; }
        if (!e.target.closest('#chg-next')) return;
        var m = marks(); if (!m.length) return;
        at = (at + 1) % m.length;
        // Зміна на іншій вкладці — спершу відкрити її (клік, щоб спрацював обробник вікна).
        var name = m[at].closest('[data-desc-pane]').getAttribute('data-desc-pane'), tab = body.querySelector('[data-desc-tab="' + name + '"]');
        if (tab && !tab.classList.contains('on')) tab.click();
        Array.prototype.forEach.call(body.querySelectorAll('.chg-now'), function (x) { x.classList.remove('chg-now'); });
        m[at].classList.add('chg-now');
        m[at].scrollIntoView({ block: 'center', behavior: 'smooth' });
        $('chg-count').textContent = 'зміна ' + (at + 1) + ' з ' + m.length;
      });
      draw('diff');
    }).catch(function (e) { tools.innerHTML = '<span>Не вдалося завантажити версії опису. ' + esc(e && e.message) + '</span>'; });
    return true;
  }
  // Файлу опису на сайті вже немає (товар зник після кінця періоду): ті самі зміни без
  // вкладок і фото.
  function showChangesBare(id, body, title, code) {
    if (!want || want.id !== id) return false;
    var r = D.rows.filter(function (x) { return x.type === 'desc' && x.id === id; })[0];
    title.textContent = r ? r.name : 'Зміни опису'; code.textContent = r ? r.sku || '' : '';
    body.innerHTML = '<div class="desc-grid"><div class="desc-main"><div class="desc-pane" data-desc-pane="text"></div></div></div>';
    return showChanges(id, {}, body);
  }
  function productTable(rows) {
    var shown = rows.slice(0, st.limit);
    return '<div class="result-line">Показано ' + shown.length + ' з ' + rows.length + '</div>' +
      '<div class="table-wrap"><table class="simple-table rep-table"><thead><tr>' +
      '<th style="width:170px">Зміна</th><th style="width:110px">Код</th><th>Товар</th><th style="width:26%">Категорія</th><th style="width:24%">Що змінилось</th>' +
      '</tr></thead><tbody>' + shown.map(function (r) {
        return '<tr><td>' + badge(r.type) + '</td>' +
          '<td>' + (r.sku ? '<span class="code">' + esc(r.sku) + '</span>' : '<span class="subtle">—</span>') + '</td>' +
          '<td>' + (r.url ? '<a class="pname" target="_blank" rel="noopener" href="' + esc(r.url) + '">' + esc(r.name) + '</a>' : esc(r.name)) + '</td>' +
          '<td>' + (r.top ? '<a class="cat-link" href="../' + esc(r.top) + '_map.html">' + esc(r.topName) + '</a>' : '<span class="muted">' + esc(r.topName) + '</span>') +
          (r.catName !== r.topName ? '<span class="arrow-to">›</span>' + mapLink(r.top, r.cat, r.catName) : '') + '</td>' +
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
      D = reportDiff(s[0], s[1], products, idx.desc);
      // Фільтр, якому в новому періоді нема що показати, знімається: вимкнену фішку не
      // зняти кліком, а розділу, якого немає в списку, не видно в <select>. Інакше після
      // зміни періоду таблиця порожня без видимої причини (27.09.2026).
      Object.keys(st.types).forEach(function (k) { if (!D.totals[k]) delete st.types[k]; });
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
      if (e.target.closest('[data-more]')) { st.limit += PAGE; render(); }
    });
    panel.addEventListener('change', function (e) { if (e.target.id === 'top') { st.top = e.target.value; st.limit = PAGE; render(); } });
    panel.addEventListener('input', function (e) { if (e.target.id === 'q') { st.q = e.target.value; st.limit = PAGE; render(); } });
  }

  initThemeToggle();
  initDescriptions({ base: '../', onShow: showChanges, onFail: showChangesBare });
  initHeaderMenus();
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
    readRange(); setChartOpen(chartStored()); bindEvents(); update();
  }).catch(fail);
}

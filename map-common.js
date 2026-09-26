function initThemeToggle() {
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('map-theme', theme); } catch (e) {}
    var btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;
    if (theme === 'dark') { btn.innerHTML = '<span class="theme-icon">☀️</span> <span class="theme-text">Світла</span>'; }
    else { btn.innerHTML = '<span class="theme-icon">🌙</span> <span class="theme-text">Темна</span>'; }
  }
  var saved = null;
  try { saved = localStorage.getItem('map-theme'); } catch (e) {}
  applyTheme(saved === 'light' ? 'light' : (saved === 'dark' ? 'dark' : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')));

  var btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.addEventListener('click', function () {
    var current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

function setupModalOverlay(overlayId, openBtnId, closeBtnId) {
  var overlay = document.getElementById(overlayId);
  if (!overlay) return;
  var openBtn = document.getElementById(openBtnId);
  var closeBtn = document.getElementById(closeBtnId);
  function open() { overlay.classList.add('open'); }
  function close() { overlay.classList.remove('open'); }
  if (openBtn) openBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });
}

function setupTooltips() {
  var tipEl = document.createElement('div');
  tipEl.id = 'custom-tooltip';
  document.body.appendChild(tipEl);

  function place(el) {
    var r = el.getBoundingClientRect();
    var margin = 8;
    tipEl.style.left = '0px';
    tipEl.style.top = '0px';
    var tr = tipEl.getBoundingClientRect();
    var left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - tr.width - margin));
    var top = r.bottom + margin;
    if (top + tr.height > window.innerHeight - margin) top = r.top - tr.height - margin;
    tipEl.style.left = Math.round(left) + 'px';
    tipEl.style.top = Math.round(top) + 'px';
  }
  function show(el) {
    var text = el.getAttribute('data-tip');
    if (!text) return;
    tipEl.textContent = text;
    tipEl.classList.add('visible');
    place(el);
  }
  function hide() { tipEl.classList.remove('visible'); }

  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('mouseout', function (e) {
    var el = e.target.closest('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', function (e) {
    var el = e.target.closest('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('focusout', function (e) {
    var el = e.target.closest('[data-tip]');
    if (el) hide();
  });
  document.addEventListener('scroll', hide, true);
}

function initHeaderMenus() {
  var drops = [];
  // Шторка — окремий елемент .menu-scrim (CSS вище), клас open на ньому вмикає
  // затемнення. syncScrim — одна функція на всі шляхи закриття (кнопка, клік
  // поза списком, Esc, рядок із [data-open]), щоб шторка ніде не лишилась
  // висіти після закритого меню.
  var scrim = document.createElement('div');
  scrim.className = 'menu-scrim';
  document.body.appendChild(scrim);
  var syncScrim = function () {
    var any = false;
    drops.forEach(function (d) { if (d.classList.contains('open')) any = true; });
    scrim.classList.toggle('open', any);
  };
  Array.prototype.forEach.call(document.querySelectorAll('.hdr-menu'), function (m) {
    var btn = m.querySelector('.hdr-menu-btn'), drop = m.querySelector('.hdr-dropdown');
    if (!btn || !drop) return;
    drops.push(drop);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      // Підказка самої кнопки висить рівно там, куди розгортається список, і накриває
      // його заголовок: курсор після кліку лишається на кнопці, тож mouseleave не
      // сталось. Гасимо її вручну — вона з'явиться знову при наступному наведенні.
      var tip = document.getElementById('custom-tooltip');
      if (tip) tip.classList.remove('visible');
      var wasOpen = drop.classList.contains('open');
      drops.forEach(function (d) { d.classList.remove('open'); });
      if (!wasOpen) drop.classList.add('open');
      syncScrim();
    });
    // Клік усередині списку не має його закривати — крім кліку по [data-open],
    // який закриває його сам і відкриває потрібну панель (обробник нижче).
    drop.addEventListener('click', function (e) { e.stopPropagation(); });
  });
  document.addEventListener('click', function () {
    drops.forEach(function (d) { d.classList.remove('open'); });
    syncScrim();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { drops.forEach(function (d) { d.classList.remove('open'); }); syncScrim(); }
  });
  // Рядок меню відкриває свою панель і закриває саме меню: два відкритих
  // вікна одночасно виглядали б як помилка, а Esc закривав би обидва одразу.
  Array.prototype.forEach.call(document.querySelectorAll('[data-open]'), function (b) {
    b.addEventListener('click', function () {
      var hub = b.closest('.help-overlay, .hdr-dropdown');
      if (hub) hub.classList.remove('open');
      syncScrim();
      var o = document.getElementById(b.getAttribute('data-open'));
      if (o) o.classList.add('open');
    });
  });
}

function initNarrowGuard() {
  var el = document.getElementById('narrow-guard-width');
  if (!el) return;
  var show = function () { el.textContent = String(window.innerWidth); };
  show();
  window.addEventListener('resize', show);
}

function searchPrep(text) {
  var cache = searchPrep.cache || (searchPrep.cache = new Map());
  var s = String(text == null ? '' : text);
  var hit = cache.get(s);
  if (hit) return hit;
  var FOLD = { 'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c',
    'т': 't', 'х': 'x', 'у': 'y', 'і': 'i', '×': 'x', '’': "'", 'ʼ': "'", '`': "'" };
  var t = '', c = '', pos = [];
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i), lo = ch.toLowerCase();
    if (lo.length !== 1) lo = ch;
    if (FOLD[lo]) lo = FOLD[lo];
    t += lo;
    if (/[0-9a-zа-яіїєґ]/.test(lo)) { c += lo; pos.push(i); }
  }
  hit = { t: t, c: c, pos: pos, s: s };
  cache.set(s, hit);
  return hit;
}

function searchWords(text) {
  var P = searchPrep(text);
  if (P.words) return P.words;
  var words = [], re = /[0-9a-zа-яіїєґ']+/g, m;
  while ((m = re.exec(P.t))) {
    if (m[0].length >= 3) words.push([m[0], P.s.substr(m.index, m[0].length).toLowerCase()]);
  }
  P.words = words;
  return words;
}

function compileSearch(query) {
  if (query && query.terms) return query;
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var raw = String(query || '').trim();
  var terms = [];
  raw.split(/\s+/).forEach(function (w) {
    if (!w) return;
    var p = searchPrep(w);
    if (!/[*?]/.test(p.t)) { terms.push({ n: p.t, c: p.c, raw: w.toLowerCase() }); return; }
    // Кожен шматок — окрема група, щоб підсвітити лише літерали, а не все між ними.
    var parts = p.t.split(/([*?])/).filter(Boolean);
    var lits = parts.filter(function (x) { return x !== '*' && x !== '?'; });
    if (!lits.length) return; // запит з одних масок нічого не звужує
    var src = '', srcC = '';
    parts.forEach(function (x) {
      if (x === '*') { src += '([\\s\\S]*?)'; srcC += '([\\s\\S]*?)'; }
      else if (x === '?') { src += '([\\s\\S])'; srcC += '([\\s\\S])'; }
      else { src += '(' + esc(x) + ')'; srcC += '(' + esc(searchPrep(x).c) + ')'; }
    });
    terms.push({ wild: true, parts: parts, re: new RegExp(src, 'g'), reC: new RegExp(srcC, 'g') });
  });
  return { raw: raw, terms: terms };
}

function searchTermScore(term, P, kind) {
  var word = searchTermScore.word || (searchTermScore.word = /[0-9a-zа-яіїєґ']/);
  var w = kind === 'name' ? 1 : kind === 'code' ? 1 : 0.3;
  if (term.wild) {
    term.re.lastIndex = 0; term.reC.lastIndex = 0;
    if (term.re.test(P.t) || term.reC.test(P.c)) return (kind === 'code' ? 50 : 10) * w;
    return 0;
  }
  var i = P.t.indexOf(term.n);
  if (i !== -1) {
    if (kind === 'code') return P.t === term.n ? 100 : i === 0 ? 60 : 40;
    var best = 10;
    for (; i !== -1 && best < 30; i = P.t.indexOf(term.n, i + 1)) {
      var start = i === 0 || !word.test(P.t.charAt(i - 1));
      var end = i + term.n.length >= P.t.length || !word.test(P.t.charAt(i + term.n.length));
      best = Math.max(best, start && end ? 30 : start ? 20 : 10);
    }
    return best * w;
  }
  if (term.c && P.c.indexOf(term.c) !== -1) return kind === 'code' ? (P.c === term.c ? 100 : 50) : 8 * w;
  if (term.fz) {
    for (var k = 0; k < term.fz.length; k++) if (P.t.indexOf(term.fz[k]) !== -1) return 2 * w;
  }
  return 0;
}

function filterProducts(products, query, fields) {
  var q = compileSearch(query);
  if (!q.terms.length) return [];
  var kinds = fields.map(function (f) { return f === 'code' || f === 'name' ? f : 'cat'; });
  var preps = searchPreps(products, fields);
  var scored = [];
  for (var idx = 0; idx < products.length; idx++) {
    var row = preps[idx], total = 0, i;
    for (i = 0; i < q.terms.length; i++) {
      var best = 0;
      for (var f = 0; f < fields.length; f++) {
        var s = searchTermScore(q.terms[i], row[f], kinds[f]);
        if (s > best) best = s;
      }
      if (!best) break;
      total += best;
    }
    if (i === q.terms.length) scored.push({ p: products[idx], s: total, i: idx });
  }
  scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
  return scored.map(function (x) { return x.p; });
}

function searchPreps(products, fields) {
  var wm = searchPreps.cache || (searchPreps.cache = new WeakMap());
  var byFields = wm.get(products);
  if (!byFields) { byFields = {}; wm.set(products, byFields); }
  var key = fields.join('|');
  if (!byFields[key]) {
    byFields[key] = products.map(function (p) { return fields.map(function (f) { return searchPrep(p[f]); }); });
  }
  return byFields[key];
}

function searchVocab(products, fields) {
  var wm = searchVocab.cache || (searchVocab.cache = new WeakMap());
  var byFields = wm.get(products);
  if (!byFields) { byFields = {}; wm.set(products, byFields); }
  var key = fields.join('|');
  if (!byFields[key]) {
    var vocab = new Map();
    products.forEach(function (p) {
      fields.forEach(function (f) {
        searchWords(p[f]).forEach(function (w) { if (!vocab.has(w[0])) vocab.set(w[0], w[1]); });
      });
    });
    byFields[key] = vocab;
  }
  return byFields[key];
}

function searchLayoutSwap(raw) {
  var EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
  var UA = "йцукенгшщзхїфівапролджєячсмитьбю'";
  var s = String(raw || '').toLowerCase();
  var hasLat = /[a-z]/.test(s), hasCyr = /[а-яіїєґ]/.test(s), hasDigit = /\d/.test(s);
  var out = '', i, ch, k;
  if (hasLat && !hasCyr) {
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i); k = EN.indexOf(ch);
      out += k !== -1 && (/[a-z]/.test(ch) || !hasDigit) ? UA.charAt(k) : ch;
    }
  } else if (hasCyr && !hasLat) {
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i); k = UA.indexOf(ch);
      out += k !== -1 && /[a-z]/.test(EN.charAt(k)) ? EN.charAt(k) : ch;
    }
  } else return null;
  return out === s ? null : out;
}

function searchFuzzyWords(term, vocabs) {
  if (term.wild || /[^a-zа-яіїєґ']/.test(term.n) || term.n.length < 5) return null;
  var a = term.n, m = a.length, k = m >= 8 ? 2 : 1, W = m + k + 1, i, j;
  var ac = new Int32Array(m);
  for (i = 0; i < m; i++) ac[i] = a.charCodeAt(i);
  var r0 = new Int32Array(W), r1 = new Int32Array(W), r2 = new Int32Array(W);
  var seen = new Set(), found = [];
  vocabs.forEach(function (vocab) {
    vocab.forEach(function (shown, b) {
      if (b === a || b.length < m - k || seen.has(b)) return;
      seen.add(b);
      var n = Math.min(b.length, m + k), pp = r2, p = r0, c = r1, t;
      for (j = 0; j <= n; j++) p[j] = j;
      for (i = 1; i <= m; i++) {
        var ai = ac[i - 1], rowMin = i;
        c[0] = i;
        for (j = 1; j <= n; j++) {
          var bj = b.charCodeAt(j - 1);
          var v = p[j - 1] + (ai === bj ? 0 : 1);
          if (p[j] + 1 < v) v = p[j] + 1;
          if (c[j - 1] + 1 < v) v = c[j - 1] + 1;
          if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && ac[i - 2] === bj && pp[j - 2] + 1 < v) v = pp[j - 2] + 1;
          c[j] = v;
          if (v < rowMin) rowMin = v;
        }
        if (rowMin > k) return;
        t = pp; pp = p; p = c; c = t;
      }
      // Мінімум по довжинах префікса: «спирал» проти «спіральна» — це «спірал».
      var d = k + 1;
      for (j = Math.max(0, m - k); j <= n; j++) if (p[j] < d) d = p[j];
      if (d <= k) found.push({ w: b, d: d });
    });
  });
  found.sort(function (x, y) { return x.d - y.d; });
  return found.slice(0, 40).map(function (x) { return x.w; });
}

function searchProducts(sets, query) {
  function run(q) { return sets.map(function (s) { return filterProducts(s.products, q, s.fields); }); }
  function total(lists) { return lists.reduce(function (n, l) { return n + l.length; }, 0); }
  var q = compileSearch(query);
  var lists = run(q);
  if (!q.terms.length || total(lists)) return { q: q, lists: lists, note: null };

  var alt = searchLayoutSwap(q.raw);
  if (alt) {
    var qa = compileSearch(alt), la = run(qa);
    if (total(la)) return { q: qa, lists: la, note: { kind: 'layout', text: alt } };
  }

  var vocabs = sets.map(function (s) { return searchVocab(s.products, s.fields); });
  function shown(w) {
    for (var i = 0; i < vocabs.length; i++) if (vocabs[i].has(w)) return vocabs[i].get(w);
    return w;
  }
  function fuzzy(qq) {
    var pairs = [];
    var terms = qq.terms.map(function (t) {
      // Слово, яке саме по собі є в каталозі (частиною якогось слова), не
      // розмивається: запит не знайшовся через ІНШЕ слово, а «двигун → двигуна,
      // двигуни» в підказці — шум. Слова з опечатками розділових знаків не мають
      // (searchFuzzyWords бере лише їх), тож перевірки по словнику досить.
      if (t.wild) return t;
      var exists = vocabs.some(function (v) {
        for (var it = v.keys(), w = it.next(); !w.done; w = it.next()) if (w.value.indexOf(t.n) !== -1) return true;
        return false;
      });
      if (exists) return t;
      var fz = searchFuzzyWords(t, vocabs);
      if (!fz || !fz.length) return t;
      fz.slice(0, 3).forEach(function (w) { pairs.push([t.raw, shown(w)]); });
      return Object.assign({}, t, { fz: fz });
    });
    if (!pairs.length) return null;
    var qf = { raw: qq.raw, terms: terms }, lf = run(qf);
    return total(lf) ? { q: qf, lists: lf, note: { kind: 'fuzzy', pairs: pairs } } : null;
  }
  // Опечатки — спершу в набраному, потім у переведеному з іншої розкладки.
  return fuzzy(q) || (alt && fuzzy(compileSearch(alt))) || { q: q, lists: lists, note: null };
}

function searchNoteHtml(note) {
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  if (!note) return '';
  var text = note.kind === 'layout'
    ? 'Схоже, запит набрано в іншій розкладці клавіатури. Показано результати для «' + esc(note.text) + '».'
    : 'Точних збігів немає. Показано схожі за написанням: ' +
      note.pairs.map(function (p) { return esc(p[0]) + ' → ' + esc(p[1]); }).join(', ') + '.';
  return '<div class="search-note">' + text + '</div>';
}

function highlightMatch(text, query) {
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var str = String(text == null ? '' : text);
  var q = compileSearch(query);
  if (!q.terms.length || !str) return esc(str);
  var P = searchPrep(str), marks = [];
  function addAll(needle) {
    if (!needle) return false;
    var any = false;
    for (var i = P.t.indexOf(needle); i !== -1; i = P.t.indexOf(needle, i + needle.length)) {
      marks.push([i, i + needle.length]); any = true;
    }
    return any;
  }
  // Групи регулярки йдуть одна за одною без проміжків, тож початок кожної —
  // сума довжин попередніх; підсвічуються лише групи-літерали, не маски.
  function addGroups(re, parts, hay, map) {
    re.lastIndex = 0;
    var m, any = false;
    while ((m = re.exec(hay))) {
      var at = m.index;
      for (var g = 1; g < m.length; g++) {
        var len = m[g].length, lit = parts[g - 1] !== '*' && parts[g - 1] !== '?';
        if (lit && len) marks.push(map ? [map[at], map[at + len - 1] + 1] : [at, at + len]);
        at += len;
      }
      any = true;
      if (m[0].length === 0) re.lastIndex++;
    }
    return any;
  }
  q.terms.forEach(function (t) {
    if (t.wild) {
      if (!addGroups(t.re, t.parts, P.t, null)) addGroups(t.reC, t.parts, P.c, P.pos);
      return;
    }
    if (addAll(t.n)) return;
    if (t.c) {
      for (var i = P.c.indexOf(t.c); i !== -1; i = P.c.indexOf(t.c, i + t.c.length)) {
        marks.push([P.pos[i], P.pos[i + t.c.length - 1] + 1]);
      }
    }
    (t.fz || []).forEach(addAll);
  });
  if (!marks.length) return esc(str);
  marks.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
  var out = '', last = 0;
  marks.forEach(function (r) {
    var s = Math.max(r[0], last);
    if (r[1] <= s) return;
    out += esc(str.slice(last, s)) + '<mark class="search-highlight">' + esc(str.slice(s, r[1])) + '</mark>';
    last = r[1];
  });
  return out + esc(str.slice(last));
}

function sortByAvailability(list, mode) {
  if (!mode) return list;
  var yes = [], no = [];
  list.forEach(function (p) { (/готово/i.test(p.availability || '') ? yes : no).push(p); });
  return mode === 1 ? yes.concat(no) : no.concat(yes);
}

function availSortTh(mode) {
  var tips = [
    'Порядок: від кращого збігу із запитом. Клік: спершу «Готово до відправки».',
    'Порядок: спершу «Готово до відправки». Клік: спершу «Немає в наявності».',
    'Порядок: спершу «Немає в наявності». Клік: від кращого збігу із запитом.'
  ];
  var arrows = ['⇅', '▼', '▲'];
  return '<th class="col-avail th-sort' + (mode ? ' active' : '') + '" data-sort-avail data-tip="' + tips[mode] + '">' +
    'Наявність<span class="sort-arrow">' + arrows[mode] + '</span></th>';
}

function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function initSiteSearch() {
  var input = document.getElementById('search-input');
  var btnClear = document.getElementById('btn-clear-search');
  var indexContent = document.getElementById('index-content');
  var resultsEl = document.getElementById('search-results');
  if (!input || !indexContent || !resultsEl) return;

  var indexData = null;
  var indexFailed = false; // окремо від indexData=[] — той означає "завантажили, порожньо",
  // це — "не вдалося завантажити взагалі" (search-index.json відсутній,
  // напр. запуск render-map.js напряму без build-maps.js, або сторінка
  // відкрита подвійним кліком з диска — fetch() локальних файлів блокує
  // браузер). Без цього прапорця збій мовчки виглядав як "чесно перевірили,
  // нічого немає" — оманливо, коли пошук насправді жодного разу не відбувся.
  var indexPromise = null;
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch('search-index.json')
        .then(function (r) { return r.json(); })
        .then(function (data) { indexData = data; return data; })
        .catch(function () { indexData = []; indexFailed = true; return indexData; });
    }
    return indexPromise;
  }

  var sortMode = 0; // стовпець «Наявність», див. sortByAvailability
  var lastQuery = '';
  // Слухач один на контейнер: таблиця перемальовується на кожен символ.
  resultsEl.addEventListener('click', function (e) {
    if (!e.target.closest('[data-sort-avail]')) return;
    sortMode = (sortMode + 1) % 3;
    var tip = document.getElementById('custom-tooltip');
    if (tip) tip.classList.remove('visible');
    renderResults(lastQuery);
  });

  function renderResults(query) {
    function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
    lastQuery = query;
    var found = searchProducts([{ products: indexData || [], fields: ['name', 'code', 'categoryName'] }], query);
    var hq = found.q;
    var matches = sortByAvailability(found.lists[0], sortMode);
    if (indexFailed) {
      resultsEl.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">⚠️</div>' +
        '<div class="fw-meta-label" style="font-size:1.05rem;margin-bottom:8px;color:var(--text-main);">Не вдалося завантажити пошуковий індекс (search-index.json)</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted);max-width:480px;margin:0 auto;">Якщо сторінка відкрита подвійним кліком з диска — браузер блокує fetch() локальних файлів; відкрий через сервер (напр. Live Server). Якщо через сервер — переконайся, що search-index.json взагалі існує поруч (пишеться build-maps.js).</div>' +
        '</div>';
      return;
    }
    if (matches.length === 0) {
      resultsEl.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">🔍</div>' +
        '<div class="fw-meta-label" style="font-size:1.05rem;margin-bottom:8px;color:var(--text-main);">За запитом «' + escapeHtml(query) + '» нічого не знайдено</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted);max-width:480px;margin:0 auto;">Перевірте написання або спробуйте інше слово (назву, код товару чи категорію).</div>' +
        '</div>';
      return;
    }
    var rowsHtml = matches.map(function (p, idx) {
      var isYes = /готово/i.test(p.availability || '');
      return (
        '<tr><td class="col-n">' + (idx + 1) + '</td>' +
        '<td class="col-code"><span class="item-code">' + highlightMatch(p.code || '', hq) + '</span></td>' +
        '<td class="col-name"><a href="' + escapeAttr(p.url) + '" target="_blank" rel="noopener">' + highlightMatch(p.name, hq) + '</a></td>' +
        '<td class="col-cat"><a href="' + escapeAttr(p.topId) + '_map.html" class="cat-found-badge" data-tip="Відкрити мапу цієї категорії">📁 ' + highlightMatch(p.categoryName, hq) + '</a></td>' +
        '<td class="col-avail"><span class="stock-badge ' + (isYes ? 'yes' : 'no') + '">' + escapeHtml(p.availability || ' ') + '</span></td>' +
        '</tr>'
      );
    }).join('');
    resultsEl.innerHTML = searchNoteHtml(found.note) +
      '<div class="section-block"><div class="section-head"><div style="display:flex;align-items:center;gap:8px;"><span>Знайдені товари</span>' +
      '<span style="font-size:0.72rem;color:var(--text-muted);">(' + matches.length + ' позицій)</span></div></div>' +
      '<div class="table-wrap"><table class="simple-table search-table"><thead><tr>' +
      '<th class="col-n">№</th><th class="col-code">Код</th><th>Назва товару</th><th class="col-cat">Категорія</th>' + availSortTh(sortMode) +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>';
  }

  function showIndex() { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; indexContent.style.display = ''; }
  function showSearch(query) {
    indexContent.style.display = 'none';
    resultsEl.style.display = '';
    loadIndex().then(function () { renderResults(query); });
  }

  input.addEventListener('input', function (e) {
    var q = e.target.value.trim();
    if (btnClear) btnClear.style.display = q ? 'inline-flex' : 'none';
    if (q) showSearch(q); else showIndex();
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; if (btnClear) btnClear.style.display = 'none'; showIndex(); }
  });
  if (btnClear) btnClear.addEventListener('click', function () {
    input.value = ''; btnClear.style.display = 'none'; input.focus(); showIndex();
  });
}

function initCatalogMap(CATALOG_DATA) {
  var state = {
    selectedNodeId: CATALOG_DATA.tree.id,
    sidebarCollapsed: new Set(),
    nodeOverrides: new Map(),
    searchQuery: '',
    searchSort: 0 // стовпець «Наявність» у результатах пошуку, див. sortByAvailability
  };

  var nodeMap = new Map();
  var parentMap = new Map();
  var allNodes = [];
  var allProductsList = [];

  function indexTree(node, parent) {
    nodeMap.set(node.id, node);
    allNodes.push(node);
    if (parent) parentMap.set(node.id, parent);
    (node.own_products || []).forEach(function (p) {
      allProductsList.push(Object.assign({}, p, { nodeId: node.id, nodeName: node.name, nodeLevel: node.level }));
    });
    (node.children || []).forEach(function (child) { indexTree(child, node); });
  }
  indexTree(CATALOG_DATA.tree, null);

  // За замовчуванням розгорнутий лише рівень 1 (корінь) — його прямі підкатегорії
  // видно одразу, а самі вони згорнуті, тож рівні 3+ не розгортаються каскадом.
  allNodes.forEach(function (n) {
    if (n.level >= 2 && n.children && n.children.length > 0) state.sidebarCollapsed.add(n.id);
  });

  function getPath(node) {
    var path = [];
    var curr = node;
    while (curr) { path.unshift(curr); curr = parentMap.get(curr.id); }
    return path;
  }

  function isAvailableProduct(p) { return /готово/i.test(p.availability || ''); }

  function isNodeProductsVisible(node) {
    if (state.nodeOverrides.has(node.id)) return state.nodeOverrides.get(node.id);
    return true;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function diffBadge(stats) {
    // stats.diff вже враховує обидві причини, чому звірка неможлива: сайт не
    // показав лічильник (hasCounter=false) АБО в каталозі немає товарів
    // (HAS_PRODUCTS=false, тоді total_yes завжди 0 — порівнювати з ним не можна,
    // інакше майже кожна категорія хибно підсвітилась би червоним).
    if (stats.diff === null || stats.diff === undefined) {
      return '<span class="stock-badge neutral" data-tip="Сайт не показав лічильник «В наявності N», або товари не завантажені — звірка неможлива.">н/д</span>';
    }
    var cls = stats.diff === 0 ? 'diff-zero' : 'diff-nonzero';
    // Без data-tip на кожному значенні — пояснення формату "X/Y" дає сам <th> колонки.
    return '<span class="' + cls + '">' + stats.total_yes + '/' + stats.site_counter + '</span>';
  }

  // ── ЛІВЕ МЕНЮ КАТЕГОРІЙ ──
  function renderSidebar() {
    var container = document.getElementById('category-tree');
    container.innerHTML = '';

    function createSidebarNode(node) {
      var hasChildren = node.children && node.children.length > 0;
      var isCollapsed = state.sidebarCollapsed.has(node.id);
      var isActive = state.selectedNodeId === node.id;

      var nodeEl = document.createElement('div');
      nodeEl.className = 'nav-node';

      var row = document.createElement('div');
      row.className = 'nav-row' + (isActive ? ' active' : '');
      row.style.paddingLeft = (6 + (node.level - 1) * 16) + 'px';
      if (node.level === 1) row.style.fontWeight = '600';
      if (node.level >= 3) row.style.fontSize = '0.8rem';

      var arrow = document.createElement('span');
      arrow.className = 'arrow ' + (hasChildren ? (isCollapsed ? 'closed' : 'open') : 'empty');
      arrow.textContent = hasChildren ? '▼' : '';
      if (hasChildren) {
        arrow.addEventListener('click', function (e) {
          e.stopPropagation();
          if (state.sidebarCollapsed.has(node.id)) state.sidebarCollapsed.delete(node.id);
          else state.sidebarCollapsed.add(node.id);
          renderSidebar();
        });
      }
      row.appendChild(arrow);

      var title = document.createElement('span');
      title.className = 'node-title';
      title.textContent = node.name;
      title.title = node.name;
      row.appendChild(title);

      var ownCount = node.stats.own_products || 0;
      if (hasChildren && ownCount > 0) {
        var count = document.createElement('span');
        count.className = 'node-count';
        count.textContent = '(' + ownCount + ')';
        count.setAttribute('data-tip', 'Кількість товарів, які не входять до підкатегорій');
        row.appendChild(count);
      }

      row.addEventListener('click', function () {
        state.selectedNodeId = node.id;
        renderSidebar();
        renderContent();
      });

      nodeEl.appendChild(row);

      if (hasChildren) {
        var childrenBox = document.createElement('div');
        childrenBox.className = 'nav-children' + (isCollapsed ? ' hidden' : '');
        node.children.forEach(function (child) { childrenBox.appendChild(createSidebarNode(child)); });
        nodeEl.appendChild(childrenBox);
      }
      return nodeEl;
    }

    container.appendChild(createSidebarNode(CATALOG_DATA.tree));
  }

  // ── ОСНОВНИЙ ВМІСТ ──
  function renderContent() {
    var body = document.getElementById('content-body');
    body.innerHTML = '';

    if (state.searchQuery) { renderSearchResultsView(body, state.searchQuery); return; }

    var selNode = nodeMap.get(state.selectedNodeId) || CATALOG_DATA.tree;
    updateHeader(selNode);
    renderSingleView(selNode, body);
  }

  function updateHeader(node) {
    var bc = document.getElementById('breadcrumbs');
    var badge = document.getElementById('cat-level-badge');
    var totalCell = document.getElementById('cat-total-products');
    var verdict = document.getElementById('cat-verdict-badge');
    var totalNoCell = document.getElementById('cat-total-no');
    var heading = document.getElementById('cat-heading');
    var siteLink = document.getElementById('cat-site-link');

    var path = getPath(node);
    bc.innerHTML = '<a href="map.html" class="crumb-link">Мапа</a>' +
      path.map(function (p, idx) {
        return '<span class="sep">/</span><span class="' + (idx === path.length - 1 ? 'crumb-current' : 'crumb-link') + '" data-id="' + p.id + '">' + escapeHtml(p.name) + '</span>';
      }).join('');

    Array.prototype.forEach.call(bc.querySelectorAll('span.crumb-link'), function (el) {
      el.addEventListener('click', function () {
        var targetId = el.dataset.id;
        state.selectedNodeId = targetId;
        // Те саме, що для .cat-jump-link — розкрити гілку до вибраної категорії.
        var curr = parentMap.get(targetId);
        while (curr) { state.sidebarCollapsed.delete(curr.id); curr = parentMap.get(curr.id); }
        renderSidebar(); renderContent();
      });
    });

    badge.textContent = 'Рівень ' + node.level;
    badge.setAttribute('data-tip', 'Глибина вкладеності цієї категорії в дереві каталогу (1 = коренева категорія цього прогону).');
    totalCell.textContent = node.stats.total_products;
    verdict.innerHTML = diffBadge(node.stats);
    totalNoCell.innerHTML = '<span class="count-no">' + node.stats.total_no + '</span>';
    heading.textContent = node.name;
    if (node.url) { siteLink.href = node.url; siteLink.style.display = ''; } else siteLink.style.display = 'none';

    document.getElementById('node-header-row').style.display = '';
    document.getElementById('search-header-row').style.display = 'none';
  }

  function renderTableHtml(products) {
    var rows = products.map(function (p, i) {
      var isYes = isAvailableProduct(p);
      return (
        '<tr>' +
        '<td class="col-n">' + (p.index || i + 1) + '</td>' +
        '<td class="col-code"><span class="item-code">' + escapeHtml(p.code || ' ') + '</span></td>' +
        '<td class="col-name">' + (p.url ? '<a href="' + escapeAttr(p.url) + '" target="_blank" rel="noopener">' + escapeHtml(p.name) + '</a>' : escapeHtml(p.name)) + '</td>' +
        '<td class="col-avail"><span class="stock-badge ' + (isYes ? 'yes' : 'no') + '">' + escapeHtml(p.availability || ' ') + '</span></td>' +
        '</tr>'
      );
    }).join('');
    return (
      '<table class="simple-table"><thead><tr>' +
      '<th class="col-n">№</th><th class="col-code">Код</th><th>Назва товару</th><th class="col-avail">Наявність</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>'
    );
  }

  function productsSectionHtml(node, hasChildren, prods) {
    if (prods.length === 0) {
      if (!CATALOG_DATA.global_stats.has_products) {
        return '<div class="empty-note">Товари не завантажено — запустіть скрапер для цієї категорії ще раз.</div>';
      }
      return hasChildren ? '' : '<div class="empty-note">У цій категорії немає товарів.</div>';
    }
    return renderTableHtml(prods);
  }

  // Розклад "своє / у підкатегоріях / разом" для проміжних рядків під
  // "Підкатегорії" (renderSingleView) — інваріант "не показувати дублікат
  // рядка" (grand-рядок лише коли є ОБИДВА складники) рахується тут в одному
  // місці, а не дублюється в кожному викликаючому місці.
  function ownSubBreakdown(stats) {
    var ownTotal = stats.own_products || 0;
    var ownYes = stats.own_yes || 0;
    var ownNo = stats.own_no || 0;
    var allTotal = stats.total_products || ownTotal;
    var allYes = stats.total_yes || ownYes;
    var allNo = stats.total_no || ownNo;
    var subTotal = allTotal - ownTotal;
    var subYes = allYes - ownYes;
    var subNo = allNo - ownNo;
    // "Своя" сума показується, якщо вона є, або якщо взагалі немає товарів (щоб
    // блок не лишився порожнім); "у підкатегоріях" — лише якщо там є товари;
    // "разом" — лише коли показані ОБИДВА складники (інакше дублював би один з них).
    var showOwnRow = ownTotal > 0 || allTotal === 0;
    var showSubRow = subTotal > 0;
    var showGrandRow = showOwnRow && showSubRow;
    return {
      ownTotal: ownTotal, ownYes: ownYes, ownNo: ownNo,
      allTotal: allTotal, allYes: allYes, allNo: allNo,
      subTotal: subTotal, subYes: subYes, subNo: subNo,
      showOwnRow: showOwnRow, showSubRow: showSubRow, showGrandRow: showGrandRow
    };
  }

  // Один рядок проміжної суми ("своє" / "у підкатегоріях" / "разом") — без власного
  // <thead>, стовпці й ширини ті самі, що в таблиці "Назва категорії"/"Підкатегорії"
  // над ним, через .aligned-table. Кілька таких рядків збираються в одну таблицю
  // (див. виклик у renderSingleView), а не в окремі таблиці одна за одною.
  function summaryRowTr(label, total, yes, no, isGrand) {
    var rowClass = isGrand ? ' class="fw-grand-row"' : '';
    var countClass = isGrand ? '' : ' class="fw-count-cell"';
    var badgeExtra = isGrand ? ' fw-grand-badge' : '';
    return (
      '<tr' + rowClass + '>' +
      '<td class="col-n"></td>' +
      '<td>' + escapeHtml(label) + '</td>' +
      '<td style="width:80px;text-align:center;"> </td>' +
      '<td style="width:90px;text-align:center;"' + countClass + '>' + total + '</td>' +
      '<td style="width:100px;text-align:center;"><span class="count-yes' + badgeExtra + '">' + yes + '</span></td>' +
      '<td style="width:78px;text-align:center;"><span class="count-no' + badgeExtra + '">' + no + '</span></td>' +
      '<td style="width:72px;text-align:center;"> </td>' +
      '</tr>'
    );
  }

  // ── РЕЖИМ: ОБРАНИЙ РОЗДІЛ ──
  function renderSingleView(node, container) {
    var hasChildren = node.children && node.children.length > 0;
    var prods = node.own_products || [];
    var stats = node.stats || {};
    var b = ownSubBreakdown(stats);
    var ownTotal = b.ownTotal, ownYes = b.ownYes, ownNo = b.ownNo;
    var allTotal = b.allTotal, allYes = b.allYes, allNo = b.allNo;
    var subTotal = b.subTotal, subYes = b.subYes, subNo = b.subNo;
    // hasChildren завжди true в блоці нижче (він і так лише всередині if (hasChildren)),
    // але лишаємо явно — ці рядки мають сенс тільки коли підкатегорії є.
    var showOwnRow = hasChildren && b.showOwnRow;
    var showSubRow = hasChildren && b.showSubRow;
    var showGrandRow = hasChildren && b.showGrandRow;

    if (hasChildren) {
      var subBlock = document.createElement('div');
      subBlock.className = 'section-block';
      subBlock.innerHTML =
        '<div class="section-head section-head-aligned"><span>Підкатегорії (' + node.children.length + ')</span></div>' +
        // Без власного <thead> — рядок заголовків над цим блоком уже дає його таблиця
        // категорії (title-row), стовпці вирівняні через .aligned-table + однакові ширини.
        '<div class="table-wrap"><table class="simple-table aligned-table"><tbody>' +
        node.children.map(function (ch, i) {
          return (
            '<tr>' +
            '<td class="col-n">' + (i + 1) + '</td>' +
            '<td><a href="#" class="cat-jump-link fw-cat-link" data-id="' + ch.id + '">' + escapeHtml(ch.name) + '</a></td>' +
            '<td style="width:80px;text-align:center;"><span class="level-tag" data-tip="Глибина вкладеності в дереві категорій (1 = коренева категорія цього прогону).">Рівень ' + ch.level + '</span></td>' +
            '<td style="width:90px;text-align:center;" class="fw-count-cell">' + ch.stats.total_products + '</td>' +
            '<td style="width:100px;text-align:center;">' + diffBadge(ch.stats) + '</td>' +
            '<td style="width:78px;text-align:center;"><span class="count-no">' + ch.stats.total_no + '</span></td>' +
            '<td style="width:72px;text-align:center;">' + (ch.url ? '<a href="' + escapeAttr(ch.url) + '" class="link-site" target="_blank" rel="noopener">↗</a>' : ' ') + '</td>' +
            '</tr>'
          );
        }).join('') +
        '</tbody></table></div>';

      Array.prototype.forEach.call(subBlock.querySelectorAll('.cat-jump-link'), function (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          state.selectedNodeId = link.dataset.id;
          // Розкрити гілку дерева до вибраної категорії — інакше вона може лишитись
          // невидимою в лівому меню, якщо цей рівень згорнутий (дефолт для рівня 2+).
          var curr = parentMap.get(link.dataset.id);
          while (curr) { state.sidebarCollapsed.delete(curr.id); curr = parentMap.get(curr.id); }
          renderSidebar(); renderContent();
        });
      });
      container.appendChild(subBlock);

      // Одна таблиця з проміжними сумами одразу під "Підкатегорії": своє (якщо є) /
      // у підкатегоріях / разом (якщо є "своє" — інакше він дублював би єдиний рядок).
      var summaryRows =
        (showOwnRow ? summaryRowTr('Товари категорії, які не входять до підкатегорій', ownTotal, ownYes, ownNo, false) : '') +
        (showSubRow ? summaryRowTr('Товари в підкатегоріях', subTotal, subYes, subNo, false) : '') +
        (showGrandRow ? summaryRowTr('Разом в цій категорії', allTotal, allYes, allNo, true) : '');

      var summaryBlock = document.createElement('div');
      summaryBlock.className = 'section-block summary-block';
      summaryBlock.innerHTML = '<div class="table-wrap"><table class="simple-table aligned-table"><tbody>' + summaryRows + '</tbody></table></div>';
      container.appendChild(summaryBlock);
    }

    if (prods.length === 0 && !hasChildren) {
      var emptyBlock = document.createElement('div');
      emptyBlock.className = 'section-block';
      emptyBlock.innerHTML = productsSectionHtml(node, hasChildren, prods);
      container.appendChild(emptyBlock);
    } else if (prods.length > 0) {
      var prodBlock = document.createElement('div');
      prodBlock.className = 'section-block';
      var isVisible = isNodeProductsVisible(node);
      var headerTitle = hasChildren
        ? 'Товари категорії, які не входять до підкатегорій (' + prods.length + ')'
        : 'Товари категорії (' + prods.length + ')';

      prodBlock.innerHTML =
        '<div class="section-head section-head-aligned"><span>' + headerTitle + '</span>' +
        '<button class="btn-default" id="btn-toggle-single-prods">' + (isVisible ? 'Приховати товари' : 'Показати товари') + '</button></div>' +
        '<div class="table-wrap" id="single-prods-table" style="display:' + (isVisible ? 'block' : 'none') + ';">' + renderTableHtml(prods) + '</div>';

      var toggleBtn = prodBlock.querySelector('#btn-toggle-single-prods');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', function () {
          state.nodeOverrides.set(node.id, !isNodeProductsVisible(node));
          renderContent();
        });
      }
      container.appendChild(prodBlock);
    }
  }

  // ── ПОШУК (filterProducts/highlightMatch — спільні з map.html, див. їх власний
  // блок вище в цьому файлі) ──
  // Пошук у категорії свідомо охоплює й увесь сайт, не лише цю категорію
  // (за проханням користувача, 2026-09-14 — раніше кожна <id>_map.html знала
  // лише про власні товари). Локальні збіги (allProductsList, вже вбудовані
  // в CATALOG_DATA) рендеряться одразу, синхронно — як і раніше, без затримки
  // на мережу. search-index.json (той самий файл, що на map.html) підвантажується
  // ЛЕНИВО й ОДИН РАЗ при першому пошуку (siteIndexData кешується в цьому ж
  // замиканні), топ-категорія query фільтрується з нього, щоб не дублювати
  // локальні результати (вони й так уже свої). Коли індекс завантажиться,
  // сторінка перемальовується (renderContent()) — але лише якщо запит з того
  // часу не змінився (інакше застаріла відповідь просто відкидається).
  var siteIndexData = null;
  var siteIndexOthers = null; // siteIndexData без товарів цього розділу
  var siteIndexFailed = false; // окремо від siteIndexData=[] — див. те саме
  // розрізнення в initSiteSearch/loadIndex вище: без цього прапорця збій
  // fetch() виглядав би як "решту сайту перевірили, там нуль", хоча
  // насправді перевірка не відбулась узагалі.
  var siteIndexPromise = null;
  function loadSiteIndex() {
    if (!siteIndexPromise) {
      siteIndexPromise = fetch('search-index.json')
        .then(function (r) { return r.json(); })
        .then(function (data) { siteIndexData = data; return data; })
        .catch(function () { siteIndexData = []; siteIndexFailed = true; return siteIndexData; });
    }
    return siteIndexPromise;
  }

  // isLocal=true — товар цієї категорії (allProductsList): клік по категорії
  // робить jump у межах цієї самої сторінки, як і раніше. isLocal=false —
  // товар з іншої категорії 1 рівня (search-index.json): клік відкриває
  // <topId>_map.html, як на map.html — переходу до вузла на
  // чужій сторінці мапа не підтримує.
  function buildResultsSection(title, matches, query, isLocal) {
    var section = document.createElement('div');
    section.className = 'section-block';
    var head = document.createElement('div');
    head.className = 'section-head';
    head.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span>' + title + '</span>' +
      '<span style="font-size:0.72rem;color:var(--text-muted);">(' + matches.length + ' позицій)</span></div>';
    section.appendChild(head);

    var tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    var rowsHtml = matches.map(function (p, idx) {
      var isYes = isAvailableProduct(p);
      var categoryCell = isLocal
        ? '<a href="#" class="cat-found-badge" data-node-id="' + escapeAttr(p.nodeId) + '" data-tip="Перейти до розділу в каталозі">📁 ' + highlightMatch(p.nodeName, query) + '</a>'
        : '<a href="' + escapeAttr(p.topId) + '_map.html" class="cat-found-badge" data-tip="Відкрити мапу цієї категорії">📁 ' + highlightMatch(p.categoryName, query) + '</a>';
      return (
        '<tr><td class="col-n">' + (idx + 1) + '</td>' +
        '<td class="col-code"><span class="item-code">' + highlightMatch(p.code || '', query) + '</span></td>' +
        '<td class="col-name"><a href="' + escapeAttr(p.url) + '" target="_blank" rel="noopener">' + highlightMatch(p.name, query) + '</a></td>' +
        '<td class="col-cat">' + categoryCell + '</td>' +
        '<td class="col-avail"><span class="stock-badge ' + (isYes ? 'yes' : 'no') + '">' + escapeHtml(p.availability || ' ') + '</span></td>' +
        '</tr>'
      );
    }).join('');
    tableWrap.innerHTML =
      '<table class="simple-table search-table"><thead><tr>' +
      '<th class="col-n">№</th><th class="col-code">Код</th><th>Назва товару</th><th class="col-cat">Категорія</th>' + availSortTh(state.searchSort) +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
    section.appendChild(tableWrap);

    // Один стан на обидва блоки (цей розділ / інші): клік по будь-якому
    // заголовку перемикає порядок в обох.
    tableWrap.querySelector('[data-sort-avail]').addEventListener('click', function () {
      state.searchSort = (state.searchSort + 1) % 3;
      var tip = document.getElementById('custom-tooltip');
      if (tip) tip.classList.remove('visible');
      renderContent();
    });

    if (isLocal) {
      Array.prototype.forEach.call(section.querySelectorAll('.cat-found-badge'), function (el) {
        el.addEventListener('click', function (e) {
          e.preventDefault();
          var targetId = el.getAttribute('data-node-id');
          if (!targetId) return;
          var searchInput = document.getElementById('search-input');
          var btnClear = document.getElementById('btn-clear-search');
          if (searchInput) searchInput.value = '';
          if (btnClear) btnClear.style.display = 'none';
          state.searchQuery = '';
          state.selectedNodeId = targetId;
          var curr = parentMap.get(targetId);
          while (curr) { state.sidebarCollapsed.delete(curr.id); curr = parentMap.get(curr.id); }
          renderSidebar(); renderContent();
        });
      });
    }
    return section;
  }

  function renderSearchResultsView(body, query) {
    var currentTopId = CATALOG_DATA.tree.id.replace(/^node-/, '');
    var localSet = { products: allProductsList, fields: ['name', 'code', 'nodeName'] };
    // Поки індекс сайту не підвантажено, шукаємо лише тут і без запасних ходів
    // (розкладка, опечатки): вирішувати, що точних збігів немає, можна лише
    // за обома наборами разом, а другий ще в дорозі.
    // Відфільтрований індекс — один масив на сторінку, а не новий на кожен
    // символ: на ньому тримаються кеші searchPreps/searchVocab.
    if (siteIndexData && !siteIndexOthers) {
      siteIndexOthers = siteIndexData.filter(function (e) { return e.topId !== currentTopId; });
    }
    var found = siteIndexData
      ? searchProducts([localSet, { products: siteIndexOthers, fields: ['name', 'code', 'categoryName'] }], query)
      : { q: compileSearch(query), lists: [filterProducts(localSet.products, query, localSet.fields)], note: null };
    var hq = found.q;
    var localMatches = sortByAvailability(found.lists[0], state.searchSort);
    // null = ще не підвантажено (запит іде нижче) — відрізняється від "уже
    // перевірили, там нуль", щоб не показати "нічого не знайдено" завчасно.
    var remoteMatches = siteIndexData ? sortByAvailability(found.lists[1], state.searchSort) : null;

    var bc = document.getElementById('breadcrumbs');
    document.getElementById('node-header-row').style.display = 'none';
    document.getElementById('search-header-row').style.display = '';
    var heading = document.getElementById('search-heading');
    var badge = document.getElementById('search-found-badge');

    var totalKnown = localMatches.length + (remoteMatches ? remoteMatches.length : 0);
    bc.innerHTML = '<a href="map.html" class="crumb-link">Мапа</a> <span class="sep">/</span> <span class="crumb-current">Результати пошуку</span>';
    heading.textContent = 'Пошук за запитом «' + query + '»';
    badge.textContent = totalKnown + ' знайдено' + (
      siteIndexFailed ? ' (у цій категорії; решту сайту перевірити не вдалося)' :
      remoteMatches === null ? ' (ще шукаємо по сайту…)' : ''
    );

    if (localMatches.length === 0 && remoteMatches !== null && remoteMatches.length === 0) {
      body.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">🔍</div>' +
        '<div class="fw-meta-label" style="font-size:1.05rem;margin-bottom:8px;color:var(--text-main);">За запитом «' + escapeHtml(query) + '» нічого не знайдено</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted);max-width:480px;margin:0 auto;">Перевірте написання або спробуйте інше слово (назву, код товару чи категорію).</div>' +
        '</div>';
    } else if (localMatches.length === 0 && remoteMatches === null) {
      body.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:1.6rem;margin-bottom:10px;">🔍</div>' +
        '<div class="fw-meta-label" style="font-size:0.9rem;color:var(--text-muted);">У цій категорії нічого немає — перевіряємо решту сайту…</div>' +
        '</div>';
    } else {
      body.innerHTML = '';
      var resetHead = document.createElement('div');
      resetHead.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:8px;';
      resetHead.innerHTML = '<button class="btn-link" id="btn-reset-search-in-view" style="font-size:0.75rem;">✕ Скинути пошук</button>';
      body.appendChild(resetHead);
      resetHead.querySelector('#btn-reset-search-in-view').addEventListener('click', function () {
        var searchInput = document.getElementById('search-input');
        var btnClear = document.getElementById('btn-clear-search');
        if (searchInput) searchInput.value = '';
        if (btnClear) btnClear.style.display = 'none';
        state.searchQuery = '';
        renderContent();
      });

      if (found.note) body.insertAdjacentHTML('beforeend', searchNoteHtml(found.note));
      if (localMatches.length > 0) {
        body.appendChild(buildResultsSection('Знайдені товари (у цій категорії)', localMatches, hq, true));
      }
      if (remoteMatches && remoteMatches.length > 0) {
        body.appendChild(buildResultsSection('Знайдені в інших категоріях', remoteMatches, hq, false));
      }
    }

    if (remoteMatches === null) {
      loadSiteIndex().then(function () {
        if (state.searchQuery === query) renderContent();
      });
    }
  }

  // ── ІНІЦІАЛІЗАЦІЯ ПОДІЙ ──
  function setupEvents() {
    document.getElementById('btn-expand-all').addEventListener('click', function () { state.sidebarCollapsed.clear(); renderSidebar(); });
    document.getElementById('btn-collapse-all').addEventListener('click', function () {
      // Рівень 1 лишається розгорнутим — згортаються рівні 2+ (те саме, що й дефолтний стан).
      allNodes.forEach(function (n) { if (n.level >= 2 && n.children && n.children.length > 0) state.sidebarCollapsed.add(n.id); });
      renderSidebar();
    });

    // Посилання в панелі "Товари поза категоріями" — статичний список (рахується
    // один раз при генерації), тож слухачі теж достатньо навісити один раз тут,
    // а не при кожному renderContent.
    var orphanOverlayEl = document.getElementById('orphan-overlay');
    Array.prototype.forEach.call(document.querySelectorAll('.orphan-cat-link'), function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        state.selectedNodeId = link.dataset.id;
        var curr = parentMap.get(link.dataset.id);
        while (curr) { state.sidebarCollapsed.delete(curr.id); curr = parentMap.get(curr.id); }
        if (orphanOverlayEl) orphanOverlayEl.classList.remove('open');
        renderSidebar(); renderContent();
      });
    });

    // Відкривача-кнопки в панелей більше немає — їх відкриває рядок меню «Довідка»
    // (initHeaderMenus), тож setupModalOverlay потрібен лише заради закриття.
    setupModalOverlay('help-overlay', null, 'btn-help-close');
    setupModalOverlay('about-overlay', null, 'btn-about-close');
    setupModalOverlay('credits-overlay', null, 'btn-credits-close');
    initHeaderMenus();
    setupModalOverlay('orphan-overlay', 'btn-orphan-cats', 'btn-orphan-close');

    var searchInput = document.getElementById('search-input');
    var btnClear = document.getElementById('btn-clear-search');
    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        state.searchQuery = e.target.value.trim();
        if (btnClear) btnClear.style.display = state.searchQuery ? 'inline-flex' : 'none';
        renderContent();
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          searchInput.value = ''; state.searchQuery = '';
          if (btnClear) btnClear.style.display = 'none';
          renderContent();
        }
      });
    }
    if (btnClear) {
      btnClear.addEventListener('click', function () {
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        state.searchQuery = '';
        btnClear.style.display = 'none';
        renderContent();
      });
    }
  }

  // ── ЗМІНЮВАНА ШИРИНА ЛІВОГО МЕНЮ (перетягування за #sidebar-resize-handle) ──
  function setupSidebarResize() {
    var MIN = 220, MAX = 640;
    var handle = document.getElementById('sidebar-resize-handle');
    if (!handle) return;

    var saved = null;
    try { saved = parseInt(localStorage.getItem('map-sidebar-width'), 10); } catch (e) {}
    if (saved && saved >= MIN && saved <= MAX) {
      document.documentElement.style.setProperty('--sidebar-width', saved + 'px');
    }

    var dragging = false;
    handle.addEventListener('pointerdown', function (e) {
      dragging = true;
      handle.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var width = Math.max(MIN, Math.min(MAX, window.innerWidth - 300, e.clientX));
      document.documentElement.style.setProperty('--sidebar-width', width + 'px');
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      var current = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10);
      if (current) { try { localStorage.setItem('map-sidebar-width', current); } catch (e) {} }
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  // Посилання ззовні на конкретну категорію: <id>_map.html#cat=<categoryId>
  // (без префікса "node-"). Використовує сторінка змін (build-reports.js) —
  // шлях категорії там веде на мапу саме цього вузла, а не на корінь розділу.
  // Невідомий id (категорії вже нема в дереві) просто лишає корінь.
  function selectFromHash() {
    var m = /^#cat=([^&]+)$/.exec(location.hash);
    if (!m) return false;
    var targetId = 'node-' + decodeURIComponent(m[1]);
    if (!nodeMap.has(targetId)) return false;
    state.selectedNodeId = targetId;
    var curr = parentMap.get(targetId);
    while (curr) { state.sidebarCollapsed.delete(curr.id); curr = parentMap.get(curr.id); }
    return true;
  }
  selectFromHash();
  window.addEventListener('hashchange', function () {
    if (selectFromHash()) { renderSidebar(); renderContent(); }
  });

  initThemeToggle();
  renderSidebar();
  renderContent();
  setupEvents();
  setupTooltips();
  setupSidebarResize();
}

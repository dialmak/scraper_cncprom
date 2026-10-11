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

function descBtnHtml(p, tip) {
  return p.desc ? '<button type="button" class="desc-btn" data-desc="' + escapeAttr(p.desc) +
    '" data-tip="' + (tip || 'Опис товару: текст, схеми, характеристики, фото й ціна') + '">📄 Опис</button>' : '';
}

function descBodyHtml(d, back) {
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // Фото зберігаються без розміру (images.prom.ua/<id>_<slug>.jpg); розмір Prom
  // підставляє за вставкою _wN_hN_ після id. Картинку з опису (вже з розміром чи з ?…) не чіпаємо.
  function sized(u, s) { return String(u || '').replace(/^(https?:\/\/images\.prom\.ua\/\d+)_(?!w\d+_h\d+_)(?=[^?]*$)/i, '$1_' + s + '_'); }
  function price(v, cur) {
    if (v == null) return '';
    var n = Math.round(v * 100) / 100;
    var s = (n % 1 ? n.toFixed(2) : String(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return s + ' ' + (cur === 'UAH' || !cur ? '₴' : cur);
  }
  function badge(a) { return '<span class="stock-badge ' + (/готово/i.test(a || '') ? 'yes' : 'no') + '">' + esc(a || 'н/д') + '</span>'; }
  var text = String(d.description || '').split('\n').map(function (line) {
    var im = line.match(/^!\[\]\((https?:\/\/[^)\s]+)\)$/);
    if (im) {
      return '<a class="desc-img-link" href="' + esc(im[1]) + '" target="_blank" rel="noopener">' +
        '<img class="desc-img" loading="lazy" alt="" src="' + esc(im[1]) + '"></a>';
    }
    return esc(line).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m, t, u) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>';
    }) + '<br>';
  }).join('');
  var attrs = d.attrs || [];
  var specs = d.specs || [];
  var acc = d.acc || [];
  var also = d.also || [];
  var kit = d.kit || [];
  var photos = d.photos || [];
  // Є очищений HTML (каталоги з 01.10.2026) — порожнє місце, яке заповнить descFillHtml.
  var tabs = [['text', 'Опис', d.html
    ? '<div class="desc-text desc-html" data-desc-html></div>'
    : '<div class="desc-text">' + (d.description ? text : '<span class="empty-note">Опису на сайті немає.</span>') + '</div>']];
  if (attrs.length) {
    tabs.push(['attrs', 'Характеристики', '<table class="desc-attrs">' +
      attrs.map(function (a) { return '<tr><td>' + esc(a[0]) + '</td><td>' + esc(a[1]) + '</td></tr>'; }).join('') + '</table>']);
  }
  if (specs.length) {
    // Файли з вкладки «Специфікація» сторінки товару (посібники, PDF).
    tabs.push(['specs', 'Специфікація', '<ul class="desc-specs">' +
      specs.map(function (s) { return '<li><a href="' + esc(s[1]) + '" target="_blank" rel="noopener">📎 ' + esc(s[0]) + ' ↗</a></li>'; }).join('') + '</ul>']);
  }
  if (kit.length) {
    // Рядки комплекту з опису; тире й маркери на початку — зайві, це вже список.
    tabs.push(['kit', 'Комплект постачання', '<ul class="desc-kit">' +
      kit.map(function (s) { return '<li>' + esc(String(s).replace(/^[\s—–\-•·*]+/, '')) + '</li>'; }).join('') + '</ul>']);
  }
  // Три види карток (lib/desc.js, descriptionJson): товар (є id) — наші код, наявність,
  // ціна й «📄 Опис»; розділ (є cat); решта — назва з картинкою. Посилання — на мапу
  // (користувач 02.10.2026): [data-desc-go] закриває вікно, щоб було видно вузол.
  function cardsHtml(list) {
    return '<div class="desc-cards">' + list.map(function (q) {
      var img = q.photo ? '<img loading="lazy" alt="" src="' + esc(sized(q.photo, 'w200_h200')) + '">' : '';
      if (q.cat) {
        return '<div class="desc-card">' + img +
          '<a class="desc-card-name" href="' + esc(q.map) + '" data-desc-go>' + esc(q.name) + '</a>' +
          '<div class="desc-card-meta"><span class="desc-card-kind">📁 розділ мапи</span></div></div>';
      }
      if (!q.id) {
        return '<div class="desc-card">' + img + (q.url
          ? '<a class="desc-card-name" href="' + esc(q.url) + '" target="_blank" rel="noopener">' + esc(q.name) + ' ↗</a>'
          : '<span class="desc-card-name plain">' + esc(q.name) + '</span>') + '</div>';
      }
      var pr = (q.oldPrice != null ? '<s class="desc-old-price">' + price(q.oldPrice, q.currency) + '</s> ' : '') + price(q.price, q.currency);
      return '<div class="desc-card">' + img +
        (q.map ? '<a class="desc-card-name" href="' + esc(q.map) + '" data-desc-go>' + esc(q.name) + '</a>'
          : '<span class="desc-card-name plain">' + esc(q.name) + '</span>') +
        '<div class="desc-card-meta"><span class="desc-card-code">' + esc(q.code) + '</span>' + badge(q.avail) + '</div>' +
        '<div class="desc-card-foot"><span class="desc-card-price">' + pr + '</span>' +
        (q.desc ? '<button type="button" class="desc-btn" data-desc="' + esc(q.id) + '">📄 Опис</button>' : '') + '</div></div>';
    }).join('') + '</div>';
  }
  // Карусель сайту й список з опису — окремими вкладками, з назвами сайту.
  if (acc.length) tabs.push(['acc', 'З цим товаром також замовляють', cardsHtml(acc)]);
  if (also.length) tabs.push(['also', 'До цього товару у нас можна придбати', cardsHtml(also)]);
  var tabsHtml = '<div class="desc-tabs" role="tablist">' +
    (back ? '<button type="button" class="desc-back" data-desc-back>← Назад</button>' : '') + tabs.map(function (t, i) {
    var n = t[0] === 'attrs' ? attrs.length : t[0] === 'specs' ? specs.length : t[0] === 'kit' ? kit.length : t[0] === 'acc' ? acc.length : t[0] === 'also' ? also.length : 0;
    return '<button type="button" role="tab" class="desc-tab' + (i ? '' : ' on') + '" data-desc-tab="' + t[0] + '" aria-selected="' + (i ? 'false' : 'true') + '">' +
      t[1] + (n ? ' <span class="desc-tab-n">' + n + '</span>' : '') + '</button>';
  }).join('') + '</div>';
  var panes = tabs.map(function (t, i) { return '<div class="desc-pane" data-desc-pane="' + t[0] + '"' + (i ? ' hidden' : '') + '>' + t[2] + '</div>'; }).join('');
  var gallery = photos.length
    ? '<div class="desc-gal">' +
      '<div class="desc-gal-main">' +
      (photos.length > 1 ? '<button type="button" class="desc-gal-arrow prev" data-gal-step="-1" aria-label="Попереднє фото">‹</button>' : '') +
      '<button type="button" class="desc-gal-open" data-gal-open aria-label="Фото на весь екран"><img alt="" src="' + esc(sized(photos[0], 'w640_h640')) + '"></button>' +
      (photos.length > 1 ? '<button type="button" class="desc-gal-arrow next" data-gal-step="1" aria-label="Наступне фото">›</button>' : '') +
      '</div>' +
      (photos.length > 1 ? '<div class="desc-gal-thumbs">' + photos.map(function (u, i) {
        return '<button type="button" class="desc-gal-thumb' + (i ? '' : ' on') + '" data-gal-i="' + i + '" aria-label="Фото ' + (i + 1) + '"><img loading="lazy" alt="" src="' + esc(sized(u, 'w100_h100')) + '"></button>';
      }).join('') + '</div>' : '') +
      '</div>'
    : '';
  var facts = d.category ? '' : '<table class="desc-facts">' +
    '<tr><td>Код</td><td class="desc-price">' + esc(d.code || 'н/д') + '</td></tr>' +
    (d.price != null ? '<tr><td>Ціна</td><td class="desc-price">' + (d.oldPrice != null ? '<s class="desc-old-price">' + price(d.oldPrice, d.currency) + '</s> ' : '') + price(d.price, d.currency) + '</td></tr>' : '') +
    (d.avail ? '<tr><td>Наявність</td><td>' + badge(d.avail) + '</td></tr>' : '') +
    '</table>';
  var links = '<div class="desc-links">' +
    '<a href="' + esc(d.url) + '" target="_blank" rel="noopener">Відкрити на cncprom.ua ↗</a>' +
    // Посилання на GitHub дописує initDescriptions (descHistoryLink), і лише товару, чий
    // опис магазин справді міняв: веде на файл цього товару в коміті зі зміною.
    '</div>';
  return tabsHtml + '<div class="desc-grid"><div class="desc-main">' + panes + '</div>' +
    '<aside class="desc-side">' + gallery + facts + links + '</aside></div>';
}

function descFillHtml(slot, html) {
  var KEEP = { P: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1, S: 1, SUB: 1, SUP: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
    UL: 1, OL: 1, LI: 1, TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TH: 1, TD: 1, CAPTION: 1, IMG: 1, A: 1, BLOCKQUOTE: 1, HR: 1, DIV: 1, SPAN: 1 };
  var ATTRS = { IMG: { src: 1, alt: 1 }, A: { href: 1 }, TD: { colspan: 1, rowspan: 1, style: 1 }, TH: { colspan: 1, rowspan: 1, style: 1 } };
  var LAYOUT = /^(d-flow|d-fr|d-fl|d-title|d-cols|d-col|d-red|d-orange|d-green|d-blue|d-alert( d-alert-(green|blue|red|orange))?)$/;
  var tpl = document.createElement('template');
  tpl.innerHTML = html;
  (function clean(el) {
    Array.prototype.slice.call(el.children).forEach(function (ch) {
      var tag = ch.tagName.toUpperCase();
      if (!KEEP[tag]) { ch.remove(); return; }
      clean(ch);
      var ok = ATTRS[tag] || { style: 1 };
      // Класи розкладки й кольору тексту (lib/desc-dom.js: layoutClass, colorClass): лише наші d-*.
      var cls = LAYOUT.test(ch.getAttribute('class') || '') ? ch.getAttribute('class') : '';
      Array.prototype.slice.call(ch.attributes).forEach(function (a) {
        var n = a.name.toLowerCase();
        if (n === 'class') { if (!cls) ch.removeAttribute(a.name); }
        else if (!ok[n]) ch.removeAttribute(a.name);
        else if (n === 'style' && !/^text-align: (center|right)$/.test(a.value)) ch.removeAttribute(a.name);
        else if ((n === 'src' || n === 'href') && !/^https?:\/\//i.test(a.value)) ch.removeAttribute(a.name);
      });
      if (tag === 'A') { ch.target = '_blank'; ch.rel = 'noopener'; }
      if (tag === 'IMG') {
        if (!ch.getAttribute('src')) { ch.remove(); return; }
        ch.className = 'desc-img';
        ch.loading = 'lazy';
        var link = document.createElement('a');
        // Притиснута картинка: клас переходить на посилання-обгортку.
        link.className = 'desc-img-link' + (cls ? ' ' + cls : '');
        link.href = ch.getAttribute('src');
        link.target = '_blank';
        link.rel = 'noopener';
        ch.replaceWith(link);
        link.appendChild(ch);
      }
    });
  })(tpl.content);
  slot.appendChild(tpl.content);
}

function initDescriptions(opts) {
  opts = opts || {};
  var base = opts.base || '';
  var overlay = document.createElement('div');
  overlay.id = 'desc-overlay';
  overlay.className = 'help-overlay desc-overlay';
  overlay.innerHTML = '<div class="help-panel desc-panel" role="dialog" aria-modal="true" aria-labelledby="desc-title">' +
    '<div class="help-panel-head"><h3 id="desc-title"></h3><span class="desc-head-code" id="desc-code"></span>' +
    '<button type="button" class="btn-help-close" id="desc-close" aria-label="Закрити">✕</button></div>' +
    '<div class="desc-body" id="desc-body"></div></div>';
  document.body.appendChild(overlay);
  setupModalOverlay('desc-overlay', null, 'desc-close');
  var lb = document.createElement('div');
  lb.id = 'desc-lightbox';
  lb.className = 'desc-lightbox';
  lb.innerHTML = '<div class="desc-lb-thumbs"></div>' +
    '<div class="desc-lb-stage"><button type="button" class="desc-gal-arrow prev" data-lb-step="-1" aria-label="Попереднє фото">‹</button>' +
    '<img alt=""><button type="button" class="desc-gal-arrow next" data-lb-step="1" aria-label="Наступне фото">›</button></div>' +
    '<div class="desc-lb-count"></div>' +
    '<button type="button" class="btn-help-close desc-lb-close" aria-label="Закрити фото">✕</button>';
  document.body.appendChild(lb);
  var title = document.getElementById('desc-title');
  var code = document.getElementById('desc-code');
  var body = document.getElementById('desc-body');
  var cache = {};
  var current = null;
  var stack = [];
  var photos = [];
  var pi = 0;
  function sized(u, s) { return String(u || '').replace(/^(https?:\/\/images\.prom\.ua\/\d+)_(?!w\d+_h\d+_)(?=[^?]*$)/i, '$1_' + s + '_'); }
  function showPhoto(i) {
    if (!photos.length) return;
    pi = (i + photos.length) % photos.length;
    var main = body.querySelector('.desc-gal-open img');
    if (main) main.src = sized(photos[pi], 'w640_h640');
    body.querySelectorAll('.desc-gal-thumb').forEach(function (t, k) { t.classList.toggle('on', k === pi); });
    if (lb.classList.contains('open')) {
      lb.querySelector('.desc-lb-stage img').src = sized(photos[pi], 'w1280_h1280');
      lb.querySelectorAll('.desc-lb-thumbs button').forEach(function (t, k) { t.classList.toggle('on', k === pi); });
      lb.querySelector('.desc-lb-count').textContent = 'Фото ' + (pi + 1) + ' з ' + photos.length;
    }
  }
  function openLightbox() {
    lb.querySelector('.desc-lb-thumbs').innerHTML = photos.length > 1 ? photos.map(function (u, k) {
      return '<button type="button" data-lb-i="' + k + '" aria-label="Фото ' + (k + 1) + '"><img alt="" src="' + escapeAttr(sized(u, 'w100_h100')) + '"></button>';
    }).join('') : '';
    lb.classList.toggle('single', photos.length < 2);
    lb.classList.add('open');
    showPhoto(pi);
    lb.querySelector('.desc-lb-close').focus();
  }
  function closeLightbox() { lb.classList.remove('open'); }
  window.addEventListener('keydown', function (e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); closeLightbox(); }
    else if (e.key === 'ArrowLeft') showPhoto(pi - 1);
    else if (e.key === 'ArrowRight') showPhoto(pi + 1);
  }, true);
  lb.addEventListener('click', function (e) {
    var t = e.target.closest('[data-lb-i], [data-lb-step]');
    if (t) { showPhoto(t.hasAttribute('data-lb-i') ? +t.getAttribute('data-lb-i') : pi + +t.getAttribute('data-lb-step')); return; }
    if (e.target.closest('.desc-lb-close') || !e.target.closest('img')) closeLightbox();
  });
  body.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-desc-tab]');
    if (tab) {
      var name = tab.getAttribute('data-desc-tab');
      body.querySelectorAll('[data-desc-tab]').forEach(function (b) {
        var on = b === tab;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      body.querySelectorAll('[data-desc-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-desc-pane') !== name; });
      return;
    }
    var g = e.target.closest('[data-gal-i], [data-gal-step]');
    if (g) { showPhoto(g.hasAttribute('data-gal-i') ? +g.getAttribute('data-gal-i') : pi + +g.getAttribute('data-gal-step')); return; }
    if (e.target.closest('[data-gal-open]')) { openLightbox(); return; }
    // Картка розділу веде на мапу: вікно закривається, щоб було видно вузол.
    if (e.target.closest('[data-desc-go]')) { overlay.classList.remove('open'); return; }
    if (e.target.closest('[data-desc-back]')) { var prev = stack.pop(); if (prev) show(prev); }
  });
  function show(id) {
    current = id;
    title.textContent = 'Опис товару';
    code.textContent = '';
    body.innerHTML = '<div class="empty-note">Завантаження опису…</div>';
    if (!cache[id]) {
      cache[id] = fetch(base + 'desc/' + encodeURIComponent(id) + '.json').then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      });
    }
    cache[id].then(function (d) {
      if (current !== id) return;
      // Назва без коду; код — праворуч, перед ✕ (користувач 02.10.2026).
      title.textContent = d.category ? 'Категорія: ' + d.name : d.name;
      code.textContent = d.category ? '' : d.code || '';
      photos = d.photos || [];
      pi = 0;
      body.innerHTML = descBodyHtml(d, stack.length > 0);
      var slot = body.querySelector('[data-desc-html]');
      if (slot) descFillHtml(slot, d.html);
      body.scrollTop = 0;
      var own = opts.onShow && opts.onShow(id, d, body);
      if (!d.category && !own) descHistoryLink(id);
    }).catch(function () {
      delete cache[id];
      if (current !== id) return;
      body.innerHTML = '<div class="empty-note">Не вдалося завантажити опис. Спробуйте ще раз.</div>';
      if (opts.onFail) { photos = []; opts.onFail(id, body, title, code); }
    });
  }
  // Остання зміна опису на GitHub (користувач 05.10.2026: «показати реальні зміни опису
  // конкретного товару, а не все підряд»). Історія змін — reports/data/index.json
  // (build-reports.js: desc — [[дата, відбиток, коміт]], descAnchor — якір файлу в
  // коміті), завантажується раз на сторінку при першому відкритому вікні. Товар, чий
  // опис не мінявся, посилання не має: показувати нема чого.
  var histPromise = null;
  function descHistoryLink(id) {
    if (!histPromise) histPromise = fetch(base + 'reports/data/index.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    histPromise.then(function (ix) {
      var h = ((ix.desc || {})[id] || []).filter(function (v) { return v[2]; }), box = body.querySelector('.desc-links');
      if (current !== id || !h.length || !box) return;
      var last = h[h.length - 1], d = last[0].split('-'), anchor = (ix.descAnchor || {})[id];
      var a = document.createElement('a');
      a.target = '_blank'; a.rel = 'noopener';
      a.href = 'https://github.com/dialmak/scraper_cncprom/commit/' + encodeURIComponent(last[2]) + (anchor ? '#diff-' + encodeURIComponent(anchor) : '');
      a.textContent = 'Зміна опису від ' + d[2] + '.' + d[1] + '.' + d[0] + ' на GitHub ↗';
      box.appendChild(a);
    });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-desc]');
    if (!btn) return;
    e.preventDefault();
    var id = btn.getAttribute('data-desc');
    var tip = document.getElementById('custom-tooltip');
    if (tip) tip.classList.remove('visible');
    if (overlay.classList.contains('open') && overlay.contains(btn)) {
      if (current && current !== id) stack.push(current);
    } else {
      stack = [];
      overlay.classList.add('open');
      document.getElementById('desc-close').focus();
    }
    show(id);
  });
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

function initHelpWindow() {
  var win = null, frame = null;
  function isFull() { return !!win && win.classList.contains('full'); }
  function tellFrame() {
    try { frame.contentWindow.postMessage(isFull() ? 'help-full-on' : 'help-full-off', '*'); } catch (e) {}
  }
  function close() { if (win) win.classList.remove('open'); }
  function open(section, src) {
    var url = src + '#' + section;
    if (!win) {
      win = document.createElement('div');
      win.className = 'help-window';
      try { if (localStorage.getItem('help-full') === '1') win.classList.add('full'); } catch (e) {}
      frame = document.createElement('iframe');
      frame.className = 'help-window-frame';
      frame.setAttribute('title', 'Довідка');
      frame.addEventListener('load', tellFrame);
      win.appendChild(frame);
      document.body.appendChild(win);
      win.addEventListener('click', function (e) { if (e.target === win) close(); });
      frame.src = url;
    } else {
      // Той самий документ: міняємо лише розділ, без перезавантаження.
      try { frame.contentWindow.location.hash = '#' + section; } catch (e) { frame.src = url; }
    }
    win.classList.add('open');
    var tip = document.getElementById('custom-tooltip');
    if (tip) tip.classList.remove('visible');
    setTimeout(function () { try { frame.focus(); } catch (e) {} }, 50);
  }
  // Фаза перехоплення: «Докладніше в Довідці» лежить у шпаргалці пошуку, а
  // випадне меню зупиняє спливання кліків усередині себе (initHeaderMenus).
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-help]') : null;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    Array.prototype.forEach.call(document.querySelectorAll('.hdr-dropdown.open'), function (d) { d.classList.remove('open'); });
    var scrim = document.querySelector('.menu-scrim');
    if (scrim) scrim.classList.remove('open');
    open(b.getAttribute('data-help'), b.getAttribute('data-help-src') || 'help.html');
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  window.addEventListener('message', function (e) {
    if (!frame || e.source !== frame.contentWindow) return;
    if (e.data === 'help-close') close();
    if (e.data === 'help-full') {
      win.classList.toggle('full');
      try { localStorage.setItem('help-full', isFull() ? '1' : '0'); } catch (x) {}
      tellFrame();
    }
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
  // Слова запиту разом, лише літери й цифри: «nema 43» → nema43. Товар, де вони
  // стоять поруч і в тому самому порядку (NEMA 43, NEMA43, NEMA-43), вище.
  var phrase = terms.length > 1 && terms.every(function (t) { return !t.wild; })
    ? terms.map(function (t) { return t.c; }).join('') : '';
  return { raw: raw, terms: terms, phrase: phrase };
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
    if (i !== q.terms.length) continue;
    // Фраза важить більше за частину коду: інакше «nema 43» ставив першим
    // NEMA 17 з кодом 12-043, а NEMA43 опускав у кінець.
    if (q.phrase) {
      var bonus = 0;
      for (var g = 0; g < fields.length; g++) {
        if (row[g].c.indexOf(q.phrase) !== -1) bonus = Math.max(bonus, kinds[g] === 'cat' ? 15 : 50);
      }
      total += bonus;
    }
    scored.push({ p: products[idx], s: total, i: idx });
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
  // Підказка показує все коло й поточний стан — окремі «спершу …» читались
  // як три незалежні стани, а не як коло (зауваження користувача 27.09.2026).
  var cycle = 'Клік перемикає порядок по колу: кращий збіг, «Готово до відправки», «Немає в наявності».';
  var tips = [
    cycle + ' Зараз: кращий збіг.',
    cycle + ' Зараз: «Готово до відправки».',
    cycle + ' Зараз: «Немає в наявності».'
  ];
  var arrows = ['⇅', '▼', '▲'];
  return '<th class="col-avail th-sort' + (mode ? ' active' : '') + '" data-sort-avail data-tip="' + tips[mode] + '">' +
    'Наявність<span class="sort-arrow">' + arrows[mode] + '</span></th>';
}

function descSearchLoad() {
  if (!descSearchLoad.p) {
    var FOLD = { 'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c',
      'т': 't', 'х': 'x', 'у': 'y', 'і': 'i', '×': 'x', '’': "'", 'ʼ': "'", '`': "'" };
    // Та сама нормалізація, що в searchPrep (довжина не міняється, тож позиції в
    // нормалізованому й вихідному тексті збігаються), але одним проходом: текстів 14 МБ.
    var norm = function (s) {
      var lo = s.toLowerCase();
      if (lo.length !== s.length) return searchPrep(s).t;
      return lo.replace(/[авекмнорстхуі×’ʼ`]/g, function (ch) { return FOLD[ch]; });
    };
    descSearchLoad.p = fetch('desc-index.json')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        descSearchLoad.ix = {
          p: (data.p || []).map(function (d) { return { id: d[0], ra: d[1], rt: d[2], a: norm(d[1]), t: norm(d[2]) }; }),
          c: (data.c || []).map(function (d) { return { id: d[0], topId: d[1], name: d[2], rt: d[3], t: norm(d[3]) }; })
        };
        return descSearchLoad.ix;
      })
      .catch(function () { descSearchLoad.ix = null; return null; });
  }
  return descSearchLoad.p;
}

function searchDescriptions(ix, query, skip) {
  var q = compileSearch(query);
  var out = { products: [], cats: [], q: q };
  if (!ix || !q.terms.length) return out;
  var word = /[0-9a-zа-яіїєґ]/;
  // Українське слово від 6 літер шукається без закінчення: «закритий контур» має
  // знайти й «закритим контуром», «втулка» — «втулки». Без цього фраза з опису майже
  // ніколи не збігалась би з набраною (перевірено: 2 товари замість 20+).
  var ENDS = ['ими', 'ого', 'ому', 'ий', 'ій', 'им', 'их', 'ої', 'ою', 'ом', 'ам', 'ів', 'а', 'я', 'і', 'и', 'у', 'ю', 'е', 'о', 'ь'];
  var terms = q.terms.map(function (t) {
    if (t.wild) return t;
    var n = t.n, raw = t.raw || '';
    if (raw.length === n.length && /^[а-яіїєґ]{6,}$/.test(raw)) {
      for (var k = 0; k < ENDS.length; k++) {
        if (raw.slice(-ENDS[k].length) === ENDS[k] && raw.length - ENDS[k].length >= 4) { n = n.slice(0, n.length - ENDS[k].length); break; }
      }
    }
    return { n: n, c: searchPrep(n).c, whole: n.length <= 2 || /^[0-9.,]+$/.test(n) };
  });
  // Запит для підсвітки: ті самі слова без закінчень.
  out.q = { raw: q.raw, terms: terms, phrase: '' };
  // Місце слова в рядку за правилами вище; -1 — немає.
  function termAt(line, t) {
    if (t.wild) { t.re.lastIndex = 0; var m = t.re.exec(line); return m ? m.index : -1; }
    for (var i = line.indexOf(t.n); i !== -1; i = line.indexOf(t.n, i + 1)) {
      if (i > 0 && word.test(line.charAt(i - 1))) continue;
      var e = i + t.n.length;
      if (t.whole && e < line.length && word.test(line.charAt(e))) continue;
      return i;
    }
    return -1;
  }
  // Найкращий рядок тексту: { from, to, at, phrase } або null.
  function find(norm) {
    if (!norm) return null;
    for (var k = 0; k < terms.length; k++) if (!terms[k].wild && norm.indexOf(terms[k].n) === -1) return null;
    var best = null;
    for (var from = 0; from <= norm.length;) {
      var to = norm.indexOf('\n', from);
      if (to === -1) to = norm.length;
      var line = norm.slice(from, to), at = -1, ok = true;
      for (var i = 0; i < terms.length; i++) {
        var p = termAt(line, terms[i]);
        if (p === -1) { ok = false; break; }
        if (at === -1 || p < at) at = p;
      }
      if (ok) {
        var phrase = !!q.phrase && line.replace(/[^0-9a-zа-яіїєґ]/g, '').indexOf(q.phrase) !== -1;
        if (!best || (phrase && !best.phrase)) best = { from: from, to: to, at: at, phrase: phrase };
        if (best.phrase || !q.phrase) break;
      }
      from = to + 1;
    }
    return best;
  }
  var scored = [];
  ix.p.forEach(function (d, i) {
    if (skip && skip.has(d.id)) return;
    var where = 'attrs', raw = d.ra, hit = find(d.a);
    var inText = hit && hit.phrase ? null : find(d.t);
    // Фраза в тексті краща за розкидані слова в характеристиках.
    if (inText && (!hit || (inText.phrase && !hit.phrase))) { hit = inText; where = 'text'; raw = d.rt; }
    if (!hit) return;
    scored.push({ id: d.id, where: where, line: raw.slice(hit.from, hit.to), at: hit.at,
      s: (hit.phrase ? 50 : 0) + (where === 'attrs' ? 20 : 0), i: i });
  });
  scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
  out.products = scored;
  ix.c.forEach(function (d) {
    var hit = find(d.t);
    if (hit) out.cats.push({ id: d.id, topId: d.topId, name: d.name, line: d.rt.slice(hit.from, hit.to), at: hit.at });
  });
  return out;
}

function searchWithDescriptions(sets, query, ix) {
  function ids(lists) {
    var s = new Set();
    lists.forEach(function (l) { l.forEach(function (p) { if (p.desc) s.add(String(p.desc)); }); });
    return s;
  }
  var q = compileSearch(query);
  if (!ix) return Object.assign(searchProducts(sets, q), { desc: null });
  var exact = sets.map(function (s) { return filterProducts(s.products, q, s.fields); });
  var desc = searchDescriptions(ix, q, ids(exact));
  var any = exact.some(function (l) { return l.length; }) || desc.products.length || desc.cats.length;
  if (any) return { q: q, lists: exact, note: null, desc: desc };
  var found = searchProducts(sets, q);
  // Запит в іншій розкладці — ним же шукаємо й в описах; схожі слова — ні.
  found.desc = found.note && found.note.kind === 'layout' ? searchDescriptions(ix, found.q, ids(found.lists)) : desc;
  return found;
}

function descResultsHtml(desc, q, byId, sortMode) {
  if (!desc) return '';
  var LIMIT = 200;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // Довгий абзац — вікно навколо першого знайденого слова.
  function snippet(line, at) {
    var MAX = 230;
    if (line.length <= MAX) return highlightMatch(line, desc.q || q);
    var from = Math.max(0, Math.min(at - 70, line.length - MAX));
    if (from > 0) { var sp = line.indexOf(' ', from); if (sp !== -1 && sp < at) from = sp + 1; }
    var cut = line.slice(from, from + MAX);
    return (from > 0 ? '… ' : '') + highlightMatch(cut, desc.q || q) + (from + MAX < line.length ? ' …' : '');
  }
  var html = '';
  var rows = desc.products.map(function (r) {
    var m = byId.get(r.id);
    return m ? { r: r, m: m, availability: m.availability } : null;
  }).filter(Boolean);
  if (rows.length) {
    var total = rows.length;
    rows = sortByAvailability(rows, sortMode).slice(0, LIMIT);
    html += '<div class="section-block"><div class="section-head"><div style="display:flex;align-items:center;gap:8px;"><span>Знайдено в описі</span>' +
      '<span style="font-size:0.72rem;color:var(--text-muted);">(' + total + ' позицій' + (total > LIMIT ? ', показано перші ' + LIMIT : '') + ')</span></div></div>' +
      '<div class="table-wrap"><table class="simple-table search-table"><thead><tr>' +
      '<th class="col-n">№</th><th class="col-code">Код</th><th>Назва товару й рядок опису</th><th class="col-cat">Категорія</th>' + availSortTh(sortMode) +
      '</tr></thead><tbody>' + rows.map(function (x, idx) {
        var p = x.m, isYes = /готово/i.test(p.availability || '');
        return '<tr><td class="col-n">' + (idx + 1) + '</td>' +
          '<td class="col-code"><span class="item-code">' + esc(p.code || '') + '</span>' + descBtnHtml(p) + '</td>' +
          '<td class="col-name"><a href="' + escapeAttr(p.url) + '" target="_blank" rel="noopener">' + esc(p.name) + '</a>' +
          '<div class="desc-snip"><span class="desc-snip-where">' + (x.r.where === 'attrs' ? 'Характеристики' : 'Опис') + ':</span> ' + snippet(x.r.line, x.r.at) + '</div></td>' +
          '<td class="col-cat"><a href="' + escapeAttr(p.topId + '_map.html#cat=' + p.categoryId + '&p=' + x.r.id) + '" class="cat-found-badge" data-map-go data-tip="Відкрити категорію на мапі й підсвітити цей товар">📁 ' + esc(p.categoryName) + '</a></td>' +
          '<td class="col-avail"><span class="stock-badge ' + (isYes ? 'yes' : 'no') + '">' + esc(p.availability || ' ') + '</span></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  if (desc.cats.length) {
    html += '<div class="section-block"><div class="section-head"><div style="display:flex;align-items:center;gap:8px;"><span>Знайдено в описах категорій</span>' +
      '<span style="font-size:0.72rem;color:var(--text-muted);">(' + desc.cats.length + ' позицій)</span></div></div>' +
      '<div class="table-wrap"><table class="simple-table search-table"><thead><tr>' +
      '<th class="col-n">№</th><th class="col-cat">Категорія</th><th>Рядок опису</th>' +
      '</tr></thead><tbody>' + desc.cats.map(function (c, idx) {
        return '<tr><td class="col-n">' + (idx + 1) + '</td>' +
          '<td class="col-cat"><a href="' + escapeAttr(c.topId + '_map.html#cat=' + c.id) + '" class="cat-found-badge" data-map-go data-tip="Відкрити категорію на мапі">📁 ' + esc(c.name) + '</a>' +
          '<button type="button" class="desc-btn" data-desc="' + escapeAttr('c' + c.id) + '" data-tip="Опис категорії з сайту">📄 Опис</button></td>' +
          '<td class="col-name"><div class="desc-snip">' + snippet(c.line, c.at) + '</div></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  return html;
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
  var byId = null; // id товару → запис індексу, для блоку «Знайдено в описі»
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
    var dix = descSearchLoad.ix;
    var found = searchWithDescriptions([{ products: indexData || [], fields: ['name', 'code', 'categoryName'] }], query, dix);
    var hq = found.q;
    var matches = sortByAvailability(found.lists[0], sortMode);
    if (!byId && indexData) { byId = new Map(); indexData.forEach(function (p) { if (p.desc) byId.set(String(p.desc), p); }); }
    var descHtml = descResultsHtml(found.desc, hq, byId || new Map(), sortMode);
    // Описи ще в дорозі: рядок-очікування замість передчасного «нічого не знайдено».
    var descWait = dix === undefined ? '<div class="search-note">Шукаємо в описах…</div>' : '';
    if (indexFailed) {
      resultsEl.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">⚠️</div>' +
        '<div class="fw-meta-label" style="font-size:1.05rem;margin-bottom:8px;color:var(--text-main);">Не вдалося завантажити пошуковий індекс (search-index.json)</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted);max-width:480px;margin:0 auto;">Якщо сторінка відкрита подвійним кліком з диска, браузер блокує fetch() локальних файлів; відкрий через сервер (напр. Live Server). Якщо через сервер, переконайся, що search-index.json взагалі існує поруч (пишеться build-maps.js).</div>' +
        '</div>';
      return;
    }
    if (matches.length === 0 && !descHtml) {
      resultsEl.innerHTML = descWait ||
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">🔍</div>' +
        '<div class="fw-meta-label" style="font-size:1.05rem;margin-bottom:8px;color:var(--text-main);">За запитом «' + escapeHtml(query) + '» нічого не знайдено</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted);max-width:480px;margin:0 auto;">Перевірте написання або спробуйте інше слово (назву, код товару, категорію чи слово з опису).</div>' +
        '</div>';
      return;
    }
    var rowsHtml = matches.map(function (p, idx) {
      var isYes = /готово/i.test(p.availability || '');
      return (
        '<tr><td class="col-n">' + (idx + 1) + '</td>' +
        '<td class="col-code"><span class="item-code">' + highlightMatch(p.code || '', hq) + '</span>' + descBtnHtml(p) + '</td>' +
        '<td class="col-name"><a href="' + escapeAttr(p.url) + '" target="_blank" rel="noopener">' + highlightMatch(p.name, hq) + '</a></td>' +
        '<td class="col-cat"><a href="' + escapeAttr(p.topId) + '_map.html" class="cat-found-badge" data-tip="Відкрити мапу цієї категорії">📁 ' + highlightMatch(p.categoryName, hq) + '</a></td>' +
        '<td class="col-avail"><span class="stock-badge ' + (isYes ? 'yes' : 'no') + '">' + escapeHtml(p.availability || ' ') + '</span></td>' +
        '</tr>'
      );
    }).join('');
    resultsEl.innerHTML = searchNoteHtml(found.note) + (matches.length === 0 ? '' :
      '<div class="section-block"><div class="section-head"><div style="display:flex;align-items:center;gap:8px;"><span>Знайдені товари</span>' +
      '<span style="font-size:0.72rem;color:var(--text-muted);">(' + matches.length + ' позицій)</span></div></div>' +
      '<div class="table-wrap"><table class="simple-table search-table"><thead><tr>' +
      '<th class="col-n">№</th><th class="col-code">Код</th><th>Назва товару</th><th class="col-cat">Категорія</th>' + availSortTh(sortMode) +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div></div>') + descHtml + descWait;
  }

  function showIndex() { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; indexContent.style.display = ''; }
  function showSearch(query) {
    indexContent.style.display = 'none';
    resultsEl.style.display = '';
    loadIndex().then(function () { renderResults(query); });
    // Індекс описів — окремо й пізніше: назви показуються одразу, блок «Знайдено в
    // описі» домальовується, якщо запит за цей час не змінився.
    if (descSearchLoad.ix === undefined) {
      descSearchLoad().then(function () { if (indexData && lastQuery && input.value.trim() === lastQuery) renderResults(lastQuery); });
    }
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
      return '<span class="stock-badge neutral" data-tip="Сайт не показав лічильник «В наявності N», або товари не завантажені: звірка неможлива.">н/д</span>';
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
    badge.setAttribute('data-tip', 'Глибина вкладеності категорії в дереві каталогу.');
    totalCell.textContent = node.stats.total_products;
    verdict.innerHTML = diffBadge(node.stats);
    totalNoCell.innerHTML = '<span class="count-no">' + node.stats.total_no + '</span>';
    // «📄 Опис» біля назви — коли категорія має опис на сайті (користувач 01.10.2026).
    heading.innerHTML = escapeHtml(node.name) + descBtnHtml(node, 'Опис категорії з сайту');
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
        '<td class="col-code"><span class="item-code">' + escapeHtml(p.code || ' ') + '</span>' + descBtnHtml(p) + '</td>' +
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
        return '<div class="empty-note">Товари не завантажено. Запустіть скрапер для цієї категорії ще раз.</div>';
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
            '<td style="width:80px;text-align:center;"><span class="level-tag" data-tip="Глибина вкладеності категорії в дереві каталогу.">Рівень ' + ch.level + '</span></td>' +
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
  var siteIndexById = null; // id товару → запис індексу, для блоку «Знайдено в описі»
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
        '<td class="col-code"><span class="item-code">' + highlightMatch(p.code || '', query) + '</span>' + descBtnHtml(p) + '</td>' +
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
    // Описи шукаються, коли є і їхній індекс, і індекс сайту (з нього назва, код і
    // категорія знайденого товару).
    var dix = siteIndexData && !siteIndexFailed ? descSearchLoad.ix : null;
    var found = siteIndexData
      ? searchWithDescriptions([localSet, { products: siteIndexOthers, fields: ['name', 'code', 'categoryName'] }], query, dix)
      : { q: compileSearch(query), lists: [filterProducts(localSet.products, query, localSet.fields)], note: null };
    if (siteIndexData && !siteIndexById) { siteIndexById = new Map(); siteIndexData.forEach(function (p) { if (p.desc) siteIndexById.set(String(p.desc), p); }); }
    var descHtml = descResultsHtml(found.desc, found.q, siteIndexById || new Map(), state.searchSort);
    var descWait = !siteIndexFailed && (!siteIndexData || descSearchLoad.ix === undefined);
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

    var totalKnown = localMatches.length + (remoteMatches ? remoteMatches.length : 0) +
      (found.desc ? found.desc.products.length + found.desc.cats.length : 0);
    bc.innerHTML = '<a href="map.html" class="crumb-link">Мапа</a> <span class="sep">/</span> <span class="crumb-current">Результати пошуку</span>';
    heading.textContent = 'Пошук за запитом «' + query + '»';
    badge.textContent = totalKnown + ' знайдено' + (
      siteIndexFailed ? ' (у цій категорії; решту сайту перевірити не вдалося)' :
      remoteMatches === null ? ' (ще шукаємо по сайту…)' : descWait ? ' (ще шукаємо в описах…)' : ''
    );

    if (localMatches.length === 0 && remoteMatches !== null && remoteMatches.length === 0 && !descHtml && !descWait) {
      body.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">🔍</div>' +
        '<div class="fw-meta-label" style="font-size:1.05rem;margin-bottom:8px;color:var(--text-main);">За запитом «' + escapeHtml(query) + '» нічого не знайдено</div>' +
        '<div style="font-size:0.85rem;color:var(--text-muted);max-width:480px;margin:0 auto;">Перевірте написання або спробуйте інше слово (назву, код товару, категорію чи слово з опису).</div>' +
        '</div>';
    } else if (localMatches.length === 0 && (remoteMatches === null || (remoteMatches.length === 0 && !descHtml))) {
      body.innerHTML =
        '<div class="empty-note" style="padding:40px 20px;text-align:center;">' +
        '<div style="font-size:1.6rem;margin-bottom:10px;">🔍</div>' +
        '<div class="fw-meta-label" style="font-size:0.9rem;color:var(--text-muted);">' + (remoteMatches === null ? 'У цій категорії нічого немає, перевіряємо решту сайту…' : 'У назвах і кодах нічого немає, шукаємо в описах…') + '</div>' +
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
      if (descHtml) {
        var descBox = document.createElement('div');
        descBox.innerHTML = descHtml;
        // Той самий стан сортування, що в блоках вище.
        Array.prototype.forEach.call(descBox.querySelectorAll('[data-sort-avail]'), function (th) {
          th.addEventListener('click', function () {
            state.searchSort = (state.searchSort + 1) % 3;
            var tip = document.getElementById('custom-tooltip');
            if (tip) tip.classList.remove('visible');
            renderContent();
          });
        });
        body.appendChild(descBox);
      }
    }

    if (remoteMatches === null) {
      loadSiteIndex().then(function () {
        if (state.searchQuery === query) renderContent();
      });
    }
    if (descSearchLoad.ix === undefined) {
      descSearchLoad().then(function () {
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

    initHeaderMenus();
    initHelpWindow();
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
    // #cat=<id> — вузол; #cat=<id>&p=<productId> — ще й підсвітити рядок товару
    // (так ведуть картки вкладок вікна «Опис»).
    var m = /^#cat=([^&]+?)(?:&p=(\d+))?$/.exec(location.hash);
    if (!m) return false;
    state.flashProduct = m[2] || null;
    var targetId = 'node-' + decodeURIComponent(m[1]);
    if (!nodeMap.has(targetId)) return false;
    state.selectedNodeId = targetId;
    var curr = parentMap.get(targetId);
    while (curr) { state.sidebarCollapsed.delete(curr.id); curr = parentMap.get(curr.id); }
    return true;
  }
  // Рядок товару з адреси: рамка й прокрутка до нього. Шукається за кнопкою «📄 Опис»
  // (у ній id товару), тож товар без опису не підсвічується.
  function flashProduct() {
    if (!state.flashProduct) return;
    var btn = document.querySelector('.main-content [data-desc="' + state.flashProduct + '"]');
    state.flashProduct = null;
    var row = btn && btn.closest('tr');
    if (!row) return;
    row.classList.add('row-flash');
    row.scrollIntoView({ block: 'center' });
  }
  selectFromHash();
  // Перехід на вузол закриває пошук: інакше результати лишились би поверх вузла.
  function clearSearch() {
    var searchInput = document.getElementById('search-input');
    var btnClear = document.getElementById('btn-clear-search');
    if (searchInput) searchInput.value = '';
    if (btnClear) btnClear.style.display = 'none';
    state.searchQuery = '';
  }
  window.addEventListener('hashchange', function () {
    if (selectFromHash()) { clearSearch(); renderSidebar(); renderContent(); flashProduct(); }
  });
  // Посилання з блоку «Знайдено в описі» на вузол, який уже стоїть в адресі:
  // hashchange не настає, тож перехід робиться тут.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-map-go]');
    if (!a || a.pathname !== location.pathname || a.hash !== location.hash) return;
    e.preventDefault();
    if (selectFromHash()) { clearSearch(); renderSidebar(); renderContent(); flashProduct(); }
  });

  initThemeToggle();
  renderSidebar();
  renderContent();
  flashProduct();
  setupEvents();
  setupTooltips();
  setupSidebarResize();
}

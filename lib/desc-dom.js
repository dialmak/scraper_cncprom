// Розбір опису товару чи категорії з Prom. Писалась для браузера
// (page.evaluate(readDescription)), з 02.10.2026 виконується в збиранні над документом
// jsdom (lib/desc-parse.js передає її текстом), тож функція самодостатня: жодних
// замикань і require всередині, а document, location, NodeFilter і URL — глобальні.
// У браузері й у jsdom результат має бути однаковий.
//
// Повертає { text, html, kit, xsell } або null, якщо блоку опису немає:
//   text — опис рядками, картинки окремим рядком `![](адреса)`, посилання
//          `[текст](адреса)`. Для історії змін у гілці data (git log -p читабельний).
//   html — той самий опис очищеним HTML для показу у вікні «Опис»: лишаються
//          абзаци, заголовки, жирний/курсив/підкреслення, списки, таблиці з
//          colspan/rowspan, картинки, посилання й вирівнювання тексту; шрифти,
//          кольори, розміри, класи, скрипти — геть. Текстом таблиці розсипались
//          (користувач 01.10.2026: «опис нечитабельний, таблиці пошкоджені»).
//   kit  — рядки «Комплекту постачання»; xsell — список супутніх з опису,
//          пункти [назва, посилання, картинка].
// Усе — з одного й того самого DOM, з якого вже вирізано шаблон магазину
// «Дивіться всі наші оголошення» зі списком розділів.
function readDescription() {
  const root = document.querySelector('[data-qaid="product_description"]');
  if (!root) return null;
  const HTTP = /^https?:\/\//i;
  const SHOP = /^https?:\/\/(cnc\.prom\.ua|(www\.)?cncprom\.ua)(\/|$)/i;
  // Маркер з хвостом до двокрапки: «, у нас є:», «:», « на сайті компанії CNCPROM:» — хвіст
  // буває в іншому тезі, ніж самі слова, тож шукається в тексті всього блоку.
  // Пробіли після — лише в межах рядка: інакше маркер забирав перенос і тире першого
  // пункту тире-списку («— Контролери…»), і той переставав бути пунктом списку.
  const MARK = /(?:Дивіться (?:всі|усі) наші оголошення|Смотрите все наши объявления)(?:[^\n:]{0,40}:+)?[ \t ]*[–—-]?/i;
  const MARK_WORDS = /Дивіться (всі|усі) наші оголошення|Смотрите все наши объявления/i;
  const BLOCK = 'p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, table, blockquote, center';
  const imgSrc = img => {
    const ds = img.getAttribute('data-src');
    // Зіпсована адреса (new URL кидає виняток) — картинки немає, а не збій усього розбору.
    let src = '';
    try { src = ds ? new URL(ds, location.href).href : img.src; } catch (e) { src = ''; }
    // Іконка кнопки «товар» з редактора Prom (ckeditor/…/insert_button) — не зміст.
    return HTTP.test(src) && !/\/ckeditor/i.test(src) ? src : '';
  };
  // Зовнішні картинки Prom віддає через проксі ssl.prom.st/q?u=<адреса>&s=…&h=…, і
  // підпис s/h новий при кожному завантаженні сторінки. Для показу годиться проксі
  // (https), а в текст історії — справжня адреса з u, інакше «змінювався» б щоночі.
  const stableSrc = src => {
    const m = src.match(/^https?:\/\/ssl\.prom\.st\/q\?(?:.*&)?u=([^&]+)/i);
    if (!m) return src;
    try { return decodeURIComponent(m[1]); } catch (e) { return src; }
  };

  const c = root.cloneNode(true);
  c.querySelectorAll('script, style, noscript').forEach(el => el.remove());
  // Уламок HTML-коментаря редактора («-->» окремим текстом, 59-008).
  for (let w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT), n = w.nextNode(); n;) {
    const next = w.nextNode();
    if (n.textContent.trim() === '-->') n.remove();
    n = next;
  }

  // ── Шаблон магазину ──
  // Рядки блоку з урахуванням <br>; рядок «списку розділів» — лише посилання на
  // сам магазин (з хвостиком до 3 літер: «[Контролер](…)и») або коротка назва з тире.
  function lines(el) {
    const x = el.cloneNode(true);
    x.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    x.querySelectorAll('a').forEach(a => { if (SHOP.test(a.href)) a.replaceWith('\u0001'); });
    x.querySelectorAll('p, li, div, tr').forEach(b => b.append('\n'));
    return x.textContent.replace(MARK, '').split('\n').map(s => s.replace(/ /g, ' ').trim()).filter(Boolean);
  }
  function isListingLine(s) {
    if (s.includes('\u0001') && s.replace(/\u0001/g, '').replace(/[\s:–—\-•·,.;]/g, '').length <= 3) return true;
    return /^[—–-]\s*\S/.test(s) && s.length <= 90;
  }
  function isListing(el) {
    if (el.querySelector && el.querySelector('img') && !el.querySelector('a')) return false;
    return lines(el).every(isListingLine);
  }
  const marks = [];
  const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (MARK_WORDS.test(n.textContent)) marks.push(n);
  marks.forEach(node => {
    if (!c.contains(node)) return;
    let blk = node.parentElement.closest(BLOCK);
    if (!blk || blk === c || !c.contains(blk)) { node.remove(); return; }
    if (!isListing(blk)) { node.textContent = node.textContent.replace(MARK_WORDS, ''); return; }
    // Підіймаємось, поки батько не містить нічого, крім цього блоку й шаблону.
    while (blk.parentElement && blk.parentElement !== c && isListing(blk.parentElement)) blk = blk.parentElement;
    let next = blk.nextElementSibling;
    blk.remove();
    while (next && isListing(next)) { const n2 = next.nextElementSibling; next.remove(); next = n2; }
  });

  // ── Відсилання до «Специфікації», список супутніх товарів, «Комплект постачання» ──
  // Правила (isSpecPointer, SPEC_SHOT, XSELL, KIT, SECTION) — на DOM: списки часто йдуть не
  // рядками одного абзацу, а окремими блоками, і в HTML мають зникнути й обгортки.
  // Список супутніх і комплект з опису не губляться: повертаються окремо (xsell, kit) —
  // у вікні «Опис» це вкладки «З цим товаром також замовляють» і «Комплект постачання».
  const SPEC_SHOT = /images\.prom\.ua\/(841143443|1881074281|841165131|841086891)_/;
  const XSELL = /^(До|З|Із|Разом із|Разом з)\s.{0,70}?((можна|можете)\s+придбати|також замовляють)\s*:?\s*$/i;
  const KIT = /^(Комплект\s+(постачання|поставки)|Комплектація)\s*:?\s*$/i;
  const SECTION = /^(Комплект (постачання|поставки)|Комплектація|Важливо|Увага|Зверніть увагу|Примітка|Гарантія|Як (придбати|купити)|Корисна інформація|Інструкція|Розміри)(?=[\s:!.,]|$)/i;
  const isSpecPointer = t => t.length <= 200 && /^(Більш|Докладн|Детальн|Інструкці|Шукайте)/i.test(t) &&
    /інструкці/i.test(t) && /специфікаці/i.test(t);
  const textLines = el => {
    if (el.nodeType === 3) return el.textContent.split('\n').map(s => s.replace(/ /g, ' ').trim()).filter(Boolean);
    if (el.nodeType !== 1) return [];
    const x = el.cloneNode(true);
    x.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    x.querySelectorAll('p, li, div, tr, h1, h2, h3, h4, h5, h6').forEach(b => b.append('\n'));
    return x.textContent.split('\n').map(s => s.replace(/ /g, ' ').trim()).filter(Boolean);
  };
  const hasTable = n => n.nodeType === 1 && (n.tagName === 'TABLE' || !!n.querySelector('table'));
  const hasImg = n => n.nodeType === 1 && (n.tagName === 'IMG' || !!n.querySelector('img'));
  const isXsellNode = n => !hasTable(n) && textLines(n).every(s => !SECTION.test(s) && s.length <= 120);
  const isKitNode = n => !hasTable(n) && !hasImg(n) && textLines(n).every(s => !SECTION.test(s) && !XSELL.test(s) && s.length <= 160);
  // Найвищий предок вузла, у якому немає нічого, крім нього самого (тексту й картинок).
  const ownBlock = (node, text) => {
    let b = node;
    while (b.parentNode && b.parentNode !== c && b.parentNode.textContent.replace(/ /g, ' ').trim() === text &&
      [...b.parentNode.querySelectorAll('img')].every(i => b.nodeType === 1 && b.contains(i))) b = b.parentNode;
    return b;
  };
  // Вузол, що йде за даним: наступний сусід, а коли рівень скінчився — сусід батька
  // (заголовок буває вкладений глибше, ніж пункти).
  const following = node => {
    let cur = node;
    while (cur && cur !== c) {
      let next = cur.nextSibling;
      // Порожнє між заголовком і пунктами (пробіли, порожній абзац редактора) — пропустити.
      while (next && !next.textContent.trim() && !hasImg(next) && !hasTable(next)) next = next.nextSibling;
      if (next) return next;
      cur = cur.parentNode;
    }
    return null;
  };
  // Видалити заголовок і все за ним, поки це пункти списку; пункти — у bucket.
  const cutList = (start, isItem, bucket) => {
    let next = following(start);
    start.remove();
    while (next && isItem(next)) { const n2 = following(next); next.remove(); bucket.push(next); next = n2; }
  };
  const textNodes = () => {
    const out = [], w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
    return out;
  };
  // Заголовок списку: цілим текстовим вузлом, інакше — цілим блоком (буває розбитий тегами).
  const findHeads = (hint, re) => {
    const heads = [];
    textNodes().filter(n => hint.test(n.textContent)).forEach(n => {
      const t = n.textContent.replace(/ /g, ' ').trim();
      if (re.test(t)) { heads.push(ownBlock(n, t)); return; }
      const blk = n.parentElement.closest(BLOCK);
      if (!blk || blk === c) return;
      const bt = blk.textContent.replace(/ /g, ' ').trim();
      if (re.test(bt)) heads.push(ownBlock(blk, bt));
    });
    return heads.filter((h, i) => heads.indexOf(h) === i);
  };
  textNodes().filter(n => /специфікаці/i.test(n.textContent)).forEach(n => {
    if (!c.contains(n)) return;
    const blk = n.parentElement.closest(BLOCK);
    if (!blk || blk === c || !c.contains(blk)) return;
    const ls = textLines(blk);
    if (ls.length === 1 && isSpecPointer(ls[0])) ownBlock(blk, ls[0]).remove();
  });
  c.querySelectorAll('img').forEach(img => { if (SPEC_SHOT.test(imgSrc(img))) img.remove(); });

  // Список супутніх: пункти — назва, посилання (на товар чи розділ магазину), картинка.
  const xsellNodes = [];
  findHeads(/придбати|замовляють/i, XSELL).forEach(h => { if (c.contains(h)) cutList(h, isXsellNode, xsellNodes); });
  const xsell = [];
  xsellNodes.forEach(node => {
    const x = node.nodeType === 1 ? node.cloneNode(true) : document.createElement('span');
    if (node.nodeType !== 1) x.textContent = node.textContent;
    const hrefOf = el => { const a = el.closest('a[href]'); return a && HTTP.test(a.href) ? a.href : ''; };
    (x.tagName === 'IMG' ? [x] : [...x.querySelectorAll('img')]).forEach(img => {
      const src = imgSrc(img);
      const mark = document.createTextNode(src ? '\n\u0002' + stableSrc(src) + '\u0003' + hrefOf(img) + '\n' : '');
      if (img === x) { x.replaceChildren(); x.append(mark); } else img.replaceWith(mark);
    });
    if (x.querySelectorAll) {
      x.querySelectorAll('a[href]').forEach(a => { const t = a.textContent.trim(); if (t && !t.includes('\u0002') && HTTP.test(a.href)) a.replaceWith(t + '\u0003' + a.href); });
      x.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
      x.querySelectorAll('p, li, div, tr, h1, h2, h3, h4, h5, h6').forEach(b => b.append('\n'));
    }
    x.textContent.split('\n').map(s => s.replace(/ /g, ' ').trim()).filter(Boolean).forEach(line => {
      const last = xsell[xsell.length - 1];
      if (line[0] === '\u0002') {
        const [src, href] = line.slice(1).split('\u0003');
        // Картинка — до попереднього пункту без картинки, інакше чекає на наступну назву.
        if (last && !last[2] && last[0]) { last[2] = src; if (!last[1] && href) last[1] = href; }
        else xsell.push(['', href || '', src]);
        return;
      }
      const [name, href] = line.split('\u0003');
      const clean = name.replace(/^[\s—–\-•·]+/, '').replace(/\s+/g, ' ').trim();
      if (!clean) return;
      if (last && !last[0]) { last[0] = clean; if (!last[1] && href) last[1] = href; }
      else xsell.push([clean, href || '', '']);
    });
  });

  // Комплект постачання: заголовок і пункти за ним (без картинок і таблиць).
  const kit = [];
  findHeads(/Комплект/i, KIT).forEach(h => {
    if (!c.contains(h)) return;
    const first = following(h);
    if (!first || !isKitNode(first) || !textLines(first).length) return;
    const nodes = [];
    cutList(h, isKitNode, nodes);
    nodes.forEach(n => textLines(n).forEach(s => kit.push(s.split(' ').filter(Boolean).join(' '))));
  });

  // ── HTML для показу ──
  const KEEP = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB', 'SUP', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'IMG', 'A', 'BLOCKQUOTE', 'HR', 'DIV']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'SVG', 'VIDEO', 'AUDIO', 'CANVAS']);
  const ALIGN = /text-align\s*:\s*(left|center|right|justify)/i;
  // Розкладка редактора Prom (класи ck-*) — у наші класи d-*, решта класів геть:
  //   ck-image-text-left/right — блок «текст + картинка»: обгортка картинки притиснута
  //     праворуч (left) чи ліворуч (right), текст обтікає (38% описів; користувач
  //     01.10.2026: «як на сайті, текст зліва, картинки справа»);
  //   ck-list-horizontal — колонки «картинка + підпис» в один ряд;
  //   ck-alert — кольорова плашка: застереження, «Увага!», заголовок «Комплект постачання».
  // Обгортка картинки притискається, лише коли в ній самі картинки: у 04-001 у неї
  // вкладено ще один такий блок з усім текстом, і він стиснувся б у вузьку колонку.
  function layoutClass(ch) {
    const cl = String(ch.getAttribute('class') || '').split(/\s+/);
    const has = n => cl.includes(n);
    if (has('ck-alert')) {
      const theme = (cl.join(' ').match(/ck-alert_theme_(green|blue|red|orange)/) || [])[1];
      return 'd-alert' + (theme ? ' d-alert-' + theme : '');
    }
    if (has('ck-image-text-left') || has('ck-image-text-right')) return 'd-flow';
    if (has('ck-image-text-left__image-wrapper') || has('ck-image-text-right__image-wrapper')) {
      if (!ch.querySelector('img') || ch.textContent.trim()) return '';
      return has('ck-image-text-left__image-wrapper') ? 'd-fr' : 'd-fl';
    }
    if (has('ck-image-text-left__title') || has('ck-image-text-right__title') || has('ck-list-horizontal__title') || has('ck-alert__title')) return 'd-title';
    if (has('ck-list-horizontal__table')) return 'd-cols';
    if (has('ck-list-horizontal__table-item') && !cl.some(n => /_type_narrow/.test(n))) return 'd-col';
    return '';
  }
  // Колір тексту зі стилю: змістовний (червоне «Зверніть увагу:» у 04-001) — у клас
  // d-red / d-orange / d-green / d-blue, який сторінка малює кольором своєї теми;
  // чорний, сірий і решта відкидаються. Кольоровий текст рідкість: 4 зі 100 сторінок.
  const colorCache = {};
  function colorClass(el) {
    const v = ((el.getAttribute('style') || '').match(/(?:^|;)\s*color\s*:\s*([^;]+)/i) || [])[1] ||
      (el.tagName === 'FONT' ? el.getAttribute('color') : '');
    if (!v) return '';
    const key = v.trim().toLowerCase();
    if (key in colorCache) return colorCache[key];
    // Колір розбирається тут же, без getComputedStyle: функція працює і в браузері, і в
    // збиранні (lib/desc-parse.js, jsdom), і має давати однаковий результат.
    const NAMED = { red: 'ff0000', darkred: '8b0000', firebrick: 'b22222', crimson: 'dc143c', maroon: '800000', tomato: 'ff6347',
      orangered: 'ff4500', orange: 'ffa500', darkorange: 'ff8c00', gold: 'ffd700', yellow: 'ffff00', green: '008000', darkgreen: '006400',
      lime: '00ff00', limegreen: '32cd32', forestgreen: '228b22', seagreen: '2e8b57', olive: '808000', teal: '008080', blue: '0000ff',
      darkblue: '00008b', navy: '000080', mediumblue: '0000cd', royalblue: '4169e1', dodgerblue: '1e90ff', steelblue: '4682b4' };
    let m = [];
    const hex = NAMED[key] || (key.match(/^#([0-9a-f]{6})$/) || [])[1] ||
      ((key.match(/^#([0-9a-f]{3})$/) || [])[1] || '').replace(/./g, ch => ch + ch);
    if (hex) m = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    else if (/^rgba?\(/.test(key)) m = (key.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    let cls = '';
    if (m.length >= 3) {
      const [r, g, b] = m, max = Math.max(r, g, b), d = max - Math.min(r, g, b);
      if (d >= 60) {
        let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
        cls = h <= 20 || h >= 335 ? 'd-red' : h <= 60 ? 'd-orange' : h <= 170 ? 'd-green' : h <= 265 ? 'd-blue' : '';
      }
    }
    return (colorCache[key] = cls);
  }
  // Попередження звичайним текстом — теж плашкою (користувач 01.10.2026: описи писали
  // різні люди в різний час, стиль різний, а суттєве попередження має бути помітним).
  // Абзац, що починається з «Увага!», «Зверніть увагу:», «Важливо!»…; про пошкодження
  // чи небезпеку — червона, решта — помаранчева. Лише абзац без вкладених блоків і не
  // всередині готової плашки сайту.
  function warnClass(ch, tag) {
    if (tag !== 'P' && tag !== 'DIV') return '';
    if (ch.querySelector('p, div, table, ul, ol, img') || ch.closest('.ck-alert')) return '';
    const t = ch.textContent.replace(/ /g, ' ').trim();
    if (t.length > 400 || !/^(Зверніть увагу|Увага|Важливо|Попередження|Застереження|Обережно)\s*[!:.]/i.test(t)) return '';
    return /пошкод|з ладу|згор|небезпе|заборон|уражен|травм/i.test(t) ? 'd-alert d-alert-red' : 'd-alert d-alert-orange';
  }
  function clean(el) {
    [...el.childNodes].forEach(ch => {
      if (ch.nodeType === 3) return;
      if (ch.nodeType !== 1) { ch.remove(); return; }
      const tag = ch.tagName.toUpperCase();
      if (tag === 'IFRAME') {
        // Відео YouTube в описі — посиланням, а не вбудованим плеєром.
        const src = ch.getAttribute('src') || '';
        const m = src.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/);
        if (m) { const p = document.createElement('p'); const a = document.createElement('a'); a.href = 'https://www.youtube.com/watch?v=' + m[1]; a.textContent = '▶ Відео на YouTube'; p.append(a); ch.replaceWith(p); clean(p); return; }
      }
      if (DROP.has(tag)) { ch.remove(); return; }
      clean(ch);
      if (tag === 'CENTER') { const d = document.createElement('div'); d.setAttribute('style', 'text-align: center'); d.append(...ch.childNodes); ch.replaceWith(d); return; }
      if (tag === 'SPAN' || tag === 'FONT') {
        const cc = ch.textContent.trim() ? colorClass(ch) : '';
        if (!cc) { ch.replaceWith(...ch.childNodes); return; }
        const s = document.createElement('span');
        s.setAttribute('class', cc);
        s.append(...ch.childNodes);
        ch.replaceWith(s);
        return;
      }
      if (!KEEP.has(tag)) { ch.replaceWith(...ch.childNodes); return; }
      if (tag === 'IMG') {
        const src = imgSrc(ch);
        if (!src) { ch.remove(); return; }
        const alt = ch.getAttribute('alt') || '';
        // Картинка, притиснута стилем (float: right) — так само текст обтікає.
        const fl = ((ch.getAttribute('style') || '').match(/float\s*:\s*(left|right)/i) || [])[1];
        [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
        ch.setAttribute('src', src);
        if (alt) ch.setAttribute('alt', alt);
        if (fl) ch.setAttribute('class', fl.toLowerCase() === 'right' ? 'd-fr' : 'd-fl');
        return;
      }
      if (tag === 'A') {
        const href = ch.href;
        // Посилання навколо картинки знімається: у вікні картинка сама веде на повний розмір.
        if (!HTTP.test(href) || ch.querySelector('img')) { ch.replaceWith(...ch.childNodes); return; }
        [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
        ch.setAttribute('href', href);
        return;
      }
      const align = ((ch.getAttribute('style') || '').match(ALIGN) || [])[1] ||
        (/^(left|center|right|justify)$/i.test(ch.getAttribute('align') || '') ? ch.getAttribute('align') : '');
      const span = { colspan: ch.getAttribute('colspan'), rowspan: ch.getAttribute('rowspan') };
      const layout = (tag === 'DIV' ? layoutClass(ch) : '') || warnClass(ch, tag) || colorClass(ch);
      [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
      if (layout) ch.setAttribute('class', layout);
      if (align && align.toLowerCase() !== 'left') ch.setAttribute('style', 'text-align: ' + align.toLowerCase());
      if (tag === 'TD' || tag === 'TH') {
        if (/^\d+$/.test(span.colspan || '') && +span.colspan > 1) ch.setAttribute('colspan', span.colspan);
        if (/^\d+$/.test(span.rowspan || '') && +span.rowspan > 1) ch.setAttribute('rowspan', span.rowspan);
      }
    });
  }
  const h = c.cloneNode(true);
  clean(h);
  // Порожні абзаци й блоки (лише &nbsp; чи пробіли) — від редактора, дають великі дірки.
  for (let changed = true; changed;) {
    changed = false;
    h.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, strong, b, em, i, u, li, ul, ol, blockquote').forEach(el => {
      if (!el.querySelector('img, br, table, hr') && !el.textContent.replace(/ /g, ' ').trim()) { el.remove(); changed = true; }
    });
  }
  const html = h.innerHTML.replace(/ /g, '&nbsp;').replace(/\n\s*\n/g, '\n').trim();

  // ── Текст для історії ──
  c.querySelectorAll('a[href]').forEach(a => {
    const href = a.href, t = a.textContent.replace(/\s+/g, ' ').trim();
    if (a.querySelector('img') || !t || !HTTP.test(href)) { a.replaceWith(...a.childNodes); return; }
    a.replaceWith(t === href ? href : `[${t}](${href})`);
  });
  c.querySelectorAll('img').forEach(img => { const src = imgSrc(img); img.replaceWith(src ? `\n![](${stableSrc(src)})\n` : ''); });
  c.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
  c.querySelectorAll('td, th').forEach(el => el.append('\t'));
  c.querySelectorAll('p, div, li, tr, ul, ol, table, h1, h2, h3, h4, h5, h6, blockquote').forEach(el => el.append('\n'));
  const text = c.textContent.replace(/ /g, ' ').replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
  return { text, html, kit, xsell };
}

module.exports = { readDescription };

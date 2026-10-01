// Опис товару зі сторінки Prom — виконується В БРАУЗЕРІ (page.evaluate(readDescription)),
// тож функція самодостатня: жодних замикань і require всередині, Playwright
// передає її текстом. Окремим файлом, щоб скрапер і перевірки на багатьох
// товарах (сесія 01.10.2026) запускали той самий код.
//
// Повертає { text, html } або null, якщо блоку опису немає:
//   text — опис рядками, картинки окремим рядком `![](адреса)`, посилання
//          `[текст](адреса)`. Для історії змін у гілці data (git log -p читабельний).
//   html — той самий опис очищеним HTML для показу у вікні «Опис»: лишаються
//          абзаци, заголовки, жирний/курсив/підкреслення, списки, таблиці з
//          colspan/rowspan, картинки, посилання й вирівнювання тексту; шрифти,
//          кольори, розміри, класи, скрипти — геть. Текстом таблиці розсипались
//          (користувач 01.10.2026: «опис нечитабельний, таблиці пошкоджені»).
// Обидва — з одного й того самого DOM, з якого вже вирізано шаблон магазину
// «Дивіться всі наші оголошення» зі списком розділів (див. lib/desc.js).
function readDescription() {
  const root = document.querySelector('[data-qaid="product_description"]');
  if (!root) return null;
  const HTTP = /^https?:\/\//i;
  const SHOP = /^https?:\/\/(cnc\.prom\.ua|(www\.)?cncprom\.ua)(\/|$)/i;
  // Маркер з хвостом до двокрапки: «, у нас є:», «:», « на сайті компанії CNCPROM:» — хвіст
  // буває в іншому тезі, ніж самі слова, тож шукається в тексті всього блоку.
  // Пробіли після — лише в межах рядка: інакше маркер забирав перенос і тире першого
  // пункту тире-списку («— Контролери…»), і той переставав бути пунктом списку.
  const MARK = /Дивіться (всі|усі) наші оголошення(?:[^\n:]{0,40}:+)?[ \t ]*[–—-]?/i;
  const MARK_WORDS = /Дивіться (всі|усі) наші оголошення/i;
  const BLOCK = 'p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, table, blockquote, center';
  const imgSrc = img => {
    const ds = img.getAttribute('data-src');
    const src = ds ? new URL(ds, location.href).href : img.src;
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

  // ── HTML для показу ──
  const KEEP = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB', 'SUP', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'IMG', 'A', 'BLOCKQUOTE', 'HR', 'DIV']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'SVG', 'VIDEO', 'AUDIO', 'CANVAS']);
  const ALIGN = /text-align\s*:\s*(left|center|right|justify)/i;
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
      if (!KEEP.has(tag)) { ch.replaceWith(...ch.childNodes); return; }
      if (tag === 'IMG') {
        const src = imgSrc(ch);
        if (!src) { ch.remove(); return; }
        const alt = ch.getAttribute('alt') || '';
        [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
        ch.setAttribute('src', src);
        if (alt) ch.setAttribute('alt', alt);
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
      [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
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
  return { text, html };
}

module.exports = { readDescription };

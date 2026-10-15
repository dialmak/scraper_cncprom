// Медіа каталогу: фото галерей, картинки й файли в описах, PDF зі «Специфікації»,
// плитки категорій, відео YouTube. Один збирач адрес для check-media.js (перевірка
// доступності) і для збирання сторінок (де стоїть кожен файл), щоб обидва бачили
// той самий перелік.
//
// Вид медіа (`kind`): image | file | video. Місце (`place`): gallery — фото товару,
// desc — картинка в описі, link — посилання в описі на файл чи картинку, spec —
// вкладка «Специфікація», tile — плитка категорії, video — вбудоване відео, xsell —
// мініатюра в списку супутніх товарів в описі.

// Картинки в описах Prom віддає через проксі ssl.prom.st/q?u=…&s=…&h=…: підпис
// новий щоразу, а справжня адреса — в `u` (так само, як у desc-dom.js і знімку).
function realUrl(src) {
  let u = String(src || '').trim().replace(/&amp;/g, '&');
  if (!u || u.startsWith('data:')) return '';
  if (u.startsWith('//')) u = 'https:' + u;
  const m = u.match(/^https?:\/\/ssl\.prom\.st\/q\?(?:[^#]*&)?u=([^&#]+)/);
  if (m) u = decodeURIComponent(m[1]);
  if (!/^https?:\/\//i.test(u)) return '';
  return u;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;
// Посилання в описі вважаємо файлом лише за розширенням: звичайних посилань на
// сторінки ~100 тис., і майже всі внутрішні — їх не перевіряємо.
const FILE_EXT = /\.(pdf|zip|rar|7z|gz|tar|txt|csv|docx?|xlsx?|pptx?|dwg|dxf|step|stp|stl|igs|iges|exe|msi|iso|hex|bin)$/i;
// Файлообмінники: у посиланні розширення немає (drive.google.com/file/d/<id>/view), але це
// теж файл. Google Drive — у 68 товарах (15.10.2026, помітив користувач).
const FILE_SHARE = /^(drive|docs)\.google\.com$|(^|\.)dropbox\.com$|^disk\.yandex\.|^yadi\.sk$|^mega\.nz$|^1drv\.ms$|^onedrive\.live\.com$|(^|\.)mediafire\.com$|(^|\.)dfiles\.ru$/i;

// Відео: адреса для перевірки — службовий запит YouTube oEmbed. Звичайна сторінка
// видаленого відео теж відповідає 200, а oEmbed — 401/404.
function youtubeId(src) {
  const m = String(src || '').match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})|youtu\.be\/([\w-]{11})/);
  return m ? (m[1] || m[2]) : '';
}
const youtubeUrl = id => 'https://www.youtube.com/embed/' + id;
const youtubeCheckUrl = id => 'https://www.youtube.com/oembed?format=json&url=' +
  encodeURIComponent('https://www.youtube.com/watch?v=' + id);

// Сторінка товару (/p<id>-…, /p<id>.html) або розділу (/g<id>-…) Prom, на cncprom.ua й
// старому cnc.prom.ua.
const PRODUCT_LINK = /\/[pg]\d+(?:[-.]|$)/;

// Медіа з HTML опису: картинки, посилання на файли й картинки, вбудовані відео.
// Картинка всередині посилання на інший товар чи розділ — мініатюра в списку супутніх («До цього
// товару у нас можна придбати»): місце xsell, а не desc. У вікні «Опис» такі мініатюри
// не показуються (там картки з поточним фото товару), тож бита мініатюра видна лише на
// cncprom.ua — і саме тому її треба називати окремо (14.10.2026, 199 товарів ШВП).
function fromHtml(html, push) {
  if (!html) return;
  const xsell = new Set();
  for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!PRODUCT_LINK.test(m[1])) continue;
    for (const im of m[2].matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi)) xsell.add(im[1]);
  }
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi)) {
    const u = realUrl(m[1]);
    if (u) push(u, 'image', xsell.has(m[1]) ? 'xsell' : 'desc');
  }
  for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"]+)"/gi)) {
    const u = realUrl(m[1]);
    if (!u) continue;
    const pathOnly = u.split(/[?#]/)[0];
    if (IMAGE_EXT.test(pathOnly)) push(u, 'image', 'link');
    else if (FILE_EXT.test(pathOnly) || FILE_SHARE.test(hostOf(u))) push(u, 'file', 'link');
  }
  for (const m of html.matchAll(/<iframe\b[^>]*?\ssrc="([^"]+)"/gi)) {
    const id = youtubeId(m[1]);
    if (id) push(youtubeUrl(id), 'video', 'video');
  }
}

// Усі згадки медіа одного каталогу: [{ url, kind, place, productId?, categoryId }].
// Один файл може стояти в товарі кілька разів — повтори в межах одного місця
// одного товару прибрані.
function collectMedia(catalog) {
  const out = [];
  const seen = new Set();
  const add = (owner) => (url, kind, place) => {
    const key = url + '|' + place + '|' + (owner.productId || 'c' + owner.categoryId);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(Object.assign({ url, kind, place }, owner));
  };
  const walk = (node) => {
    const push = add({ categoryId: String(node.categoryId) });
    const tile = realUrl(node.image);
    if (tile) push(tile, 'image', 'tile');
    fromHtml(node.descriptionRaw, push);
    (node.children || []).forEach(walk);
  };
  if (catalog.tree) walk(catalog.tree);
  for (const p of catalog.products || []) {
    const push = add({ productId: String(p.productId), categoryId: String(p.categoryId) });
    for (const ph of p.photos || []) {
      const u = realUrl(ph);
      if (u) push(u, 'image', 'gallery');
    }
    for (const s of p.specs || []) {
      const u = realUrl(s && s[1]);
      if (u) push(u, 'file', 'spec');
    }
    fromHtml(p.descriptionRaw, push);
  }
  return out;
}

// Ключ для порівняння версій. Та сама картинка Prom буває під різними адресами:
// інший розмір (_w640_h2048_), назва після номера (її міняє перейменування товару),
// ?PIMAGE_ID=…, images.ua.prom.st замість images.prom.ua. Зображення Prom визначає
// номер на початку імені файлу; без цього половина «змін» картинок хибна.
function mediaKey(url) {
  const u = String(url || '');
  const m = u.match(/^https?:\/\/images\.(?:ua\.prom\.st|prom\.ua)\/(\d+)_/);
  return m ? 'prom:' + m[1] : u.split('#')[0];
}

const hostOf = u => { try { return new URL(u).host; } catch (e) { return ''; } };
// «Свої» хостинги: сервери Prom. Усе інше — сторонні (ризик зникнення).
const isPromHost = h => /(^|\.)prom\.(ua|st)$/i.test(h) || /(^|\.)prom\.ua$/i.test(h);

// ---- Посилання в описах (16.10.2026, HISTORY п. 56) ----
// Не медіа, а сторінки: на товари й розділи магазину й на сторонні сайти. Перевіряти всі
// ~100 тис. не треба: посилання на товар чи розділ, що є в каталозі, робоче (Prom
// переадресовує будь-який слаг і старий домен cnc.prom.ua). Тож:
//   - помилка в адресі видна з самої адреси (problem): подвоєне «https://https://»,
//     номер товару замість адреси («https://1007337799» — браузер бере його за IP), слово
//     замість адреси («http://аксесуарів»);
//   - товар чи розділ, якого немає в каталозі, — check: адреса для запиту (404 — бите);
//   - сторонній сайт — check: сама адреса.
// Місце: listing — шаблон магазину «Дивіться всі наші оголошення» зі списком розділів
// (вікно «Опис» його ховає, але на cncprom.ua покупець його бачить), desc — решта опису.
const SHOP_HOST = /^(www\.)?(cncprom\.ua|cnc\.prom\.ua)$/i;
const LISTING = /(Дивіться|Дивитесь|Смотрите)\s+(всі|усі|все)\s+(наші|наши)\s+(оголошення|объявления)/i;
function linkProblem(href) {
  const u = String(href || '').trim();
  // https://https://…, https://https//…, http://http://…, https://httpshttps://…
  if (/^https?:\/\/+https?(:|\/|https?)/i.test(u) || /^https?https?:/i.test(u)) return 'double';
  const m = u.match(/^https?:\/\/([^/?#]+)/i);
  if (!m) return '';
  let host = m[1];
  try { host = decodeURIComponent(host); } catch (e) { /* лишаємо як є */ }
  if (/^https?$/i.test(host)) return 'double'; // «https://https» без решти адреси
  if (/^\d+$/.test(host)) return 'number';
  if (!/\./.test(host) && !/^localhost$/i.test(host)) return 'word';
  return '';
}
function linksFromHtml(html, known, push) {
  if (!html) return;
  const at = html.search(LISTING);
  const end = at < 0 ? -1 : (() => { const e = html.indexOf('</ul>', at); return e < 0 ? html.length : e; })();
  for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/gi)) {
    const href = m[1].replace(/&amp;/g, '&').trim();
    if (!/^https?:/i.test(href)) continue; // пошта, телефон, якір, відносне — не сюди
    const place = at >= 0 && m.index > at && m.index < end ? 'listing' : 'desc';
    const problem = linkProblem(href);
    if (problem) { push({ url: href, problem, place }); continue; }
    const host = hostOf(href).toLowerCase(), pathOnly = href.split(/[?#]/)[0];
    // Картинки й файли за посиланням — це медіа (collectMedia), не сторінки.
    if (IMAGE_EXT.test(pathOnly) || FILE_EXT.test(pathOnly) || FILE_SHARE.test(host) || /youtube\.com|youtu\.be/.test(host)) continue;
    if (SHOP_HOST.test(host)) {
      const t = href.match(/\/(?:ua\/)?([pg])(\d+)(?:[-./?#]|$)/);
      if (!t || (t[1] === 'p' ? known.p : known.g).has(t[2])) continue; // інша сторінка магазину чи робоче посилання
      push({ url: href, check: 'https://cncprom.ua/ua/' + t[1] + t[2], place });
      continue;
    }
    if (isPromHost(host)) continue; // форма відгуку prom.ua тощо — службове
    push({ url: href, check: href.split('#')[0], place, ext: host });
  }
}
// Усі посилання каталогу, які варто показати: [{ url, check?, problem?, ext?, place,
// productId?, categoryId }]. known — id товарів і розділів УСІХ каталогів ({p: Set, g: Set}).
function collectLinks(catalog, known) {
  const out = [], seen = new Set();
  const add = owner => l => {
    const key = l.url + '|' + l.place + '|' + (owner.productId || 'c' + owner.categoryId);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(Object.assign(l, owner));
  };
  const walk = node => { linksFromHtml(node.descriptionRaw, known, add({ categoryId: String(node.categoryId) })); (node.children || []).forEach(walk); };
  if (catalog.tree) walk(catalog.tree);
  for (const p of catalog.products || []) linksFromHtml(p.descriptionRaw, known, add({ productId: String(p.productId), categoryId: String(p.categoryId) }));
  return out;
}
// id товарів і розділів у каталогах — щоб відрізнити робоче посилання від битого.
function knownIds(catalogs) {
  const known = { p: new Set(), g: new Set() };
  catalogs.forEach(c => {
    (function walk(n) { if (!n) return; known.g.add(String(n.categoryId)); (n.children || []).forEach(walk); })(c.tree);
    (c.products || []).forEach(p => known.p.add(String(p.productId)));
  });
  return known;
}

// Медіа одного HTML опису списком [{ url, kind, place }] — для історії змін, де опис
// береться з файлу гілки data, а не з каталогу.
function mediaFromHtml(html) {
  const out = [];
  fromHtml(html, (url, kind, place) => out.push({ url, kind, place }));
  return out;
}

module.exports = { realUrl, collectMedia, collectLinks, knownIds, linkProblem, mediaFromHtml, mediaKey, youtubeId, youtubeCheckUrl, hostOf, isPromHost };

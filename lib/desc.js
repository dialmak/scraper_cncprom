// Опис товару: очищення при скрапінгу (scrape-complete.js) і перегляд на сайті
// (кнопка «Опис» у таблицях товарів і в результатах пошуку). Одне правило «чи є
// що показати» для render-map.js (CATALOG_DATA) і build-maps.js
// (search-index.json, файли desc/<id>.json).
//
// Опис ~20–25 МБ на весь сайт, тож він не йде ні в сторінку, ні в індекс пошуку:
// там лише id товару в полі `desc`, а сам текст — окремим файлом на товар, який
// браузер завантажує лише при кліку.

// ── Шаблон магазину в описі ──
// У 3613 з 4298 описів (01.10.2026) є рядок «Дивіться всі наші оголошення…» і
// одразу за ним список розділів магазину: посиланнями на cnc.prom.ua / cncprom.ua
// або тими самими назвами з тире. Це не опис товару (користувач 01.10.2026), тож
// вирізається саме цей блок. Не «все до кінця»: у частини товарів після списку
// йде справжній текст («Важливо!…», «Комплект постачання», у 05-242 — після
// картинки), а в деяких шаблон стоїть двічі.
const LISTING_START = /^\[?(Дивіться (всі|усі) наші оголошення|Смотрите все наши объявления)/i;
const SHOP_URL = String.raw`https?:\/\/(?:cnc\.prom\.ua|(?:www\.)?cncprom\.ua)(?:\/[^)\s]*)?`;
const SHOP_LINK = new RegExp(String.raw`\[[^\]]*\]\(${SHOP_URL}\)`, 'g');
const SHOP_BARE = new RegExp(SHOP_URL, 'g');

// Рядок списку розділів: лише посилання на сам магазин (від них може лишитись
// хвостик з 1–3 літер, коли редактор розірвав слово на два посилання:
// «[Контролер](…)и»), або коротка назва розділу з тире на початку.
function isListingLine(line) {
  const t = line.trim();
  if (!t) return true;
  const rest = t.replace(SHOP_LINK, '').replace(SHOP_BARE, '');
  if (rest !== t && rest.replace(/[\s:–—\-•·,.;]/g, '').length <= 3) return true;
  return /^[—–-]\s*\S/.test(t) && t.length <= 90;
}

function stripShopListing(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!LISTING_START.test(lines[i].trim())) { out.push(lines[i]); continue; }
    while (i + 1 < lines.length && isListingLine(lines[i + 1])) i++;
  }
  return out.join('\n').replace(/\n{2,}/g, '\n').trim();
}

// ── Відсилання до «Специфікації», список супутніх товарів, «Комплект постачання» ──
// Не опис товару (користувач 01.10.2026): у вікні «Опис» це окремі вкладки —
// «Специфікація», «Комплект постачання» і «З цим товаром також замовляють». Тож з
// тексту опису вони виймаються, а список супутніх і комплект повертаються окремо.
// Ті самі правила в lib/desc-dom.js (там — на DOM, бо в HTML є таблиці й обгортки).
//
// Рядок-відсилання: ~200 описів, 40 формулювань («Більш докладну інструкцію по
// експлуатації дивіться в розділі "Специфікація"», «БІЛЬШ ДЕТАЛЬНУ ІНСТРУКЦІЮ ДИВІТЬСЯ
// У ВКЛАДЦІ "СПЕЦИФІКАЦІЇ"»…). Лише рядок, що з цього починається: у двох датчиках
// відсилання стоїть у дужках посеред справжнього речення.
function isSpecPointer(line) {
  const t = line.trim();
  return t.length <= 200 && /^(Більш|Докладн|Детальн|Інструкці|Шукайте)/i.test(t) &&
    /інструкці/i.test(t) && /специфікаці/i.test(t);
}
// Скриншоти сайту зі стрілкою на вкладку «Специфікація» — одразу після рядка-відсилання.
const SPEC_SHOT = /images\.prom\.ua\/(841143443|1881074281|841165131|841086891)_/;
// Заголовок списку супутніх (2744 описи, ~300 формулювань): «До цієї КГП у нас можна
// придбати», «З цим валом у нас можна придбати:», «З цим товаром Ви можете придбати:»,
// «До цього подовжувача у нас також замовляють», «З цим товаром також замовляють:».
// Сенс той самий, що в каруселі сайту «З цим товаром також замовляють»: писали в різний
// час. «Для редуктора, при необхідності, можна придбати перехідні втулки…» — порада, не він.
const XSELL = /^(До|З|Із|Разом із|Разом з)\s.{0,70}?((можна|можете)\s+придбати|також замовляють)\s*:?\s*$/i;
// «Комплект постачання» (3598 описів) — заголовок окремим рядком і пункти за ним.
// «Комплект постачання: двигун, драйвер, дріт» одним рядком лишається в описі.
const KIT = /^(Комплект\s+(постачання|поставки)|Комплектація)\s*:?\s*$/i;
// Обидва списки закінчуються на наступному розділі («Важливо!», «Як придбати цей
// товар:») або довгому абзаці. \b з кирилицею в JS не працює — межа слова явно.
const SECTION = /^(Комплект (постачання|поставки)|Комплектація|Важливо|Увага|Зверніть увагу|Примітка|Гарантія|Як (придбати|купити)|Корисна інформація|Інструкція|Розміри)(?=[\s:!.,]|$)/i;
const IMG_LINE = /^!\[\]\(([^)]*)\)$/;
const LINK_LINE = /^\[([^\]]*)\]\(([^)]*)\)$/;
const plain = t => t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

function isXsellItem(line) {
  const t = line.trim();
  if (SECTION.test(t)) return false;
  return IMG_LINE.test(t) || LINK_LINE.test(t) || plain(t).length <= 120;
}
function isKitItem(line) {
  const t = line.trim();
  return !SECTION.test(t) && !XSELL.test(t) && !/!\[\]\(/.test(t) && plain(t).length <= 160;
}

// Пункти списку супутніх: [назва, посилання, картинка]. Картинка йде до попереднього
// пункту без картинки, інакше чекає на наступну назву (буває і «назва, фото», і «фото, назва»).
function xsellItems(lines) {
  const items = [];
  lines.forEach(line => {
    const t = line.trim();
    if (!t) return;
    const last = items[items.length - 1];
    const im = t.match(IMG_LINE);
    if (im) {
      if (last && !last[2] && last[0]) last[2] = im[1];
      else items.push(['', '', im[1]]);
      return;
    }
    const lk = t.match(/\[([^\]]*)\]\(([^)]*)\)/);
    const name = plain(t).replace(/^[\s—–\-•·]+/, '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    if (last && !last[0]) { last[0] = name; if (!last[1] && lk) last[1] = lk[2]; }
    else items.push([name, lk ? lk[2] : '', '']);
  });
  return items;
}

// { text, kit, xsell }: опис без зайвого, рядки комплекту, пункти списку супутніх.
function splitDescription(text) {
  const lines = String(text || '').split('\n');
  const out = [], kit = [], xs = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isSpecPointer(t)) {
      if (i + 1 < lines.length && SPEC_SHOT.test(lines[i + 1])) i++;
      continue;
    }
    if (IMG_LINE.test(t) && SPEC_SHOT.test(t)) continue;
    if (XSELL.test(t)) {
      while (i + 1 < lines.length && isXsellItem(lines[i + 1])) xs.push(lines[++i]);
      continue;
    }
    out.push(lines[i]);
  }
  // Комплект — другим проходом: список супутніх часто стоїть одразу за ним.
  const res = [];
  for (let i = 0; i < out.length; i++) {
    if (KIT.test(out[i].trim()) && i + 1 < out.length && out[i + 1].trim() && isKitItem(out[i + 1])) {
      while (i + 1 < out.length && isKitItem(out[i + 1])) kit.push(out[++i].trim());
      continue;
    }
    res.push(out[i]);
  }
  return { text: res.join('\n').trim(), kit: kit.filter(Boolean), xsell: xsellItems(xs) };
}

// Усе, що не є описом товару, одним викликом: шаблон магазину, відсилання до
// специфікації, список супутніх, комплект. Повторно нічого не змінює.
function cleanDescription(text) {
  return splitDescription(stripShopListing(text)).text;
}

// Каталог, зібраний до 30.09.2026, опису не має зовсім (поля немає) — тоді й
// кнопки немає. '' без характеристик і специфікацій — опису на сайті справді немає.
function hasDescription(p) {
  return typeof p.description === 'string' &&
    (p.description !== '' || (p.attrs || []).length > 0 || (p.specs || []).length > 0 || (p.kit || []).length > 0);
}

// ── Файл опису desc/<id>.json ──
// Назви в списках супутніх писали руками: «Гнучка муфта 10x12» з латинською x,
// «Контролери» замість «Контролери для ЧПК». Порівняння як у пошуку сайту: без
// регістру й розділювачів, кирилиця-двійник = латиниця.
const TWINS = { 'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'і': 'i', 'з': '3' };
const nameKey = s => String(s || '').toLowerCase().replace(/×/g, 'x')
  .replace(/[авекмнорстухіз]/g, ch => TWINS[ch]).replace(/[^a-z0-9а-яґєїё]/g, '');

// Покажчик усіх каталогів (build-maps.js збирає один на збірку): товари за id і за
// назвою, розділи за id і за назвою (з однаковою назвою — той, що вище в дереві).
function descIndex(catalogs) {
  const byId = new Map(), prods = [], cats = [], catById = new Map();
  catalogs.forEach(c => {
    const topId = String(c.categoryId);
    (function walk(n, level) {
      if (!n || !n.categoryId) return;
      const cat = { key: nameKey(n.categoryName), id: String(n.categoryId), name: n.categoryName, topId, level };
      cats.push(cat);
      if (!catById.has(cat.id)) catById.set(cat.id, cat);
      (n.children || []).forEach(ch => walk(ch, level + 1));
    })(c.tree, 1);
    (c.products || []).forEach(p => { byId.set(String(p.productId), p); prods.push({ key: nameKey(p.productName), p }); });
  });
  cats.sort((a, b) => a.level - b.level);
  const prodByKey = new Map(prods.map(x => [x.key, x.p]));
  const catByKey = new Map();
  cats.forEach(c => { if (!catByKey.has(c.key)) catByKey.set(c.key, c); });
  const cache = new Map();
  // Назва пункту → { p: товар } | { cat: розділ } | null. Спершу точний збіг, далі —
  // єдиний товар, чия назва з цього починається, або розділ з таким початком назви.
  function byName(name) {
    const k = nameKey(name);
    if (!k) return null;
    if (cache.has(k)) return cache.get(k);
    let r = null;
    if (prodByKey.has(k)) r = { p: prodByKey.get(k) };
    else if (catByKey.has(k)) r = { cat: catByKey.get(k) };
    else if (k.length >= 8) {
      const pp = prods.filter(x => x.key.startsWith(k));
      const cc = cats.find(c => c.key.startsWith(k) || (c.key.length >= 8 && k.startsWith(c.key)));
      if (pp.length === 1) r = { p: pp[0].p };
      else if (cc) r = { cat: cc };
    }
    cache.set(k, r);
    return r;
  }
  return { byId, catById, byName };
}

// idx — descIndex усіх каталогів. Вкладка «З цим товаром також замовляють» — це
// карусель сайту (accessories, id товарів) плюс список з опису «До цього … у нас можна
// придбати» (xsell: назва, посилання, картинка): сенс той самий (користувач 01.10.2026).
// Пункт стає карткою товару (наші код, наявність, ціна, фото), розділу (посилання на
// мапу) або, коли назву не впізнано, лишається назвою з картинкою, як на сайті.
function descriptionJson(p, idx) {
  const productCard = (q, img) => ({
    id: String(q.productId),
    code: q.sku || '',
    name: q.productName || '',
    url: q.finalUrl || '',
    avail: q.availabilityStatus || '',
    price: q.price == null ? null : q.price,
    currency: q.currency || '',
    photo: (q.photos || [])[0] || img || '',
    desc: hasDescription(q)
  });
  const catCard = (c, img) => ({ cat: c.id, name: c.name, map: `${c.topId}_map.html#cat=${c.id}`, photo: img || '' });
  // Каталог з HTML, але без поля kit, зібрано до 02.10.2026: комплект і список там
  // ще всередині HTML, і з тексту їх не виймаємо — інакше показались би двічі.
  const old = p.kit === undefined;
  const split = old && !p.descriptionHtml ? splitDescription(stripShopListing(p.description || '')) : null;
  const kit = old ? (split ? split.kit : []) : p.kit || [];
  const xsell = old ? (split ? split.xsell : []) : p.xsell || [];
  const cards = [], seen = new Set();
  const add = (key, card) => { if (card && !seen.has(key)) { seen.add(key); cards.push(card); } };
  if (idx) {
    (p.accessories || []).forEach(id => { const q = idx.byId.get(String(id)); if (q) add('p' + q.productId, productCard(q, '')); });
    xsell.forEach(([name, href, img]) => {
      const pm = String(href || '').match(/\/p(\d+)-/), gm = String(href || '').match(/\/g(\d+)-/);
      const q = pm && idx.byId.get(pm[1]);
      const c = gm && idx.catById.get(gm[1]);
      const m = q ? { p: q } : c ? { cat: c } : idx.byName(name);
      if (m && m.p) { if (String(m.p.productId) !== String(p.productId)) add('p' + m.p.productId, productCard(m.p, img)); }
      else if (m && m.cat) add('c' + m.cat.id, catCard(m.cat, img));
      else if (name) add('n' + nameKey(name), { name, url: /^https?:\/\//i.test(href || '') ? href : '', photo: img || '' });
    });
  }
  return JSON.stringify({
    id: String(p.productId),
    code: p.sku || '',
    name: p.productName || '',
    url: p.finalUrl || '',
    avail: p.availabilityStatus || '',
    // Ціна, фото, комплект і «З цим товаром також замовляють» — з каталогів від
    // 02.10.2026; у старіших їх немає, і вікно показує без них.
    price: p.price == null ? null : p.price,
    currency: p.currency || '',
    photos: p.photos || [],
    // Скрапер уже чистить; тут ще раз — для каталогів без HTML, зібраних раніше,
    // щоб «Перебудувати сайт» прибирав зайве одразу.
    description: split ? split.text : (old ? stripShopListing(p.description || '') : p.description || ''),
    // Очищений HTML (lib/desc-dom.js) — вікно показує його, коли є; інакше текст.
    html: p.descriptionHtml || '',
    attrs: p.attrs || [],
    specs: p.specs || [],
    kit,
    acc: cards
  });
}

module.exports = { hasDescription, descriptionJson, descIndex, stripShopListing, cleanDescription, splitDescription };

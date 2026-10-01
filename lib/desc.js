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
const LISTING_START = /^\[?Дивіться (всі|усі) наші оголошення/i;
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

// ── Відсилання до вкладки «Специфікація» і «До цього … у нас можна придбати» ──
// Не опис товару (користувач 01.10.2026): у вікні «Опис» специфікації — своя
// вкладка, а замість списку «можна придбати» — вкладка «З цим товаром також
// замовляють». Ті самі правила в lib/desc-dom.js (там — на DOM, бо в HTML є таблиці).
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
// Заголовок списку (2744 описи, ~300 формулювань): «До цієї КГП у нас можна придбати»,
// «З цим валом у нас можна придбати:», «З цим товаром Ви можете придбати:». «Для
// редуктора, при необхідності, можна придбати перехідні втулки…» — справжня порада, не він.
const XSELL = /^(До|З|Із|Разом із|Разом з)\s.{0,70}?(можна|можете)\s+придбати\s*:?\s*$/i;
// Список іде до кінця опису: назви товарів, картинки, посилання, підзаголовки на
// кшталт «Лінійні підшипники:». Зупинка — довгий абзац (> 120 знаків) або справжній
// розділ після нього: «Важливо!» (17 описів), «Комплект постачання:» (20).
const XSELL_STOP = /^(Комплект (постачання|поставки)|Важливо|Увага|Зверніть увагу|Примітка|Гарантія)(?=[\s:!.,]|$)/i;
function isXsellItem(line) {
  const t = line.trim();
  if (XSELL_STOP.test(t)) return false;
  if (/^!\[\]\([^)]*\)$/.test(t) || /^\[[^\]]*\]\([^)]*\)$/.test(t)) return true;
  return t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').length <= 120;
}

function stripPromo(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isSpecPointer(t)) {
      if (i + 1 < lines.length && SPEC_SHOT.test(lines[i + 1])) i++;
      continue;
    }
    if (/^!\[\]\(/.test(t) && SPEC_SHOT.test(t)) continue;
    if (XSELL.test(t)) {
      while (i + 1 < lines.length && isXsellItem(lines[i + 1])) i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

// Усе, що не є описом товару, одним викликом: шаблон магазину, відсилання до
// специфікації, список «можна придбати». Повторно нічого не змінює.
function cleanDescription(text) {
  return stripPromo(stripShopListing(text));
}

// Каталог, зібраний до 30.09.2026, опису не має зовсім (поля немає) — тоді й
// кнопки немає. '' без характеристик і специфікацій — опису на сайті справді немає.
function hasDescription(p) {
  return typeof p.description === 'string' &&
    (p.description !== '' || (p.attrs || []).length > 0 || (p.specs || []).length > 0);
}

// byId — Map productId → товар з усіх каталогів (build-maps.js): картки вкладки
// «З цим товаром також замовляють» беруть назву, код, наявність і фото з наших
// даних. Товар, якого в каталогах немає (розділ не зібрано), пропускається.
function descriptionJson(p, byId) {
  const card = id => {
    const q = byId && byId.get(String(id));
    return q ? {
      id: String(q.productId),
      code: q.sku || '',
      name: q.productName || '',
      url: q.finalUrl || '',
      avail: q.availabilityStatus || '',
      price: q.price == null ? null : q.price,
      currency: q.currency || '',
      photo: (q.photos || [])[0] || '',
      desc: hasDescription(q)
    } : null;
  };
  return JSON.stringify({
    id: String(p.productId),
    code: p.sku || '',
    name: p.productName || '',
    url: p.finalUrl || '',
    avail: p.availabilityStatus || '',
    // Ціна, фото й «З цим товаром також замовляють» — з каталогів від 02.10.2026;
    // у старіших їх немає, і вікно показує без них.
    price: p.price == null ? null : p.price,
    currency: p.currency || '',
    photos: p.photos || [],
    // Скрапер уже чистить; тут ще раз (повторно нічого не змінює) — для каталогів,
    // зібраних раніше, щоб «Перебудувати сайт» прибирав зайве одразу.
    description: cleanDescription(p.description || ''),
    // Очищений HTML (lib/desc-dom.js) — вікно показує його, коли є; інакше текст.
    html: p.descriptionHtml || '',
    attrs: p.attrs || [],
    specs: p.specs || [],
    acc: (p.accessories || []).map(card).filter(Boolean)
  });
}

module.exports = { hasDescription, descriptionJson, stripShopListing, cleanDescription };

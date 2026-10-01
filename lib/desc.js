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

// Каталог, зібраний до 30.09.2026, опису не має зовсім (поля немає) — тоді й
// кнопки немає. '' без характеристик і специфікацій — опису на сайті справді немає.
function hasDescription(p) {
  return typeof p.description === 'string' &&
    (p.description !== '' || (p.attrs || []).length > 0 || (p.specs || []).length > 0);
}

function descriptionJson(p) {
  return JSON.stringify({
    id: String(p.productId),
    code: p.sku || '',
    name: p.productName || '',
    url: p.finalUrl || '',
    // Скрапер уже вирізає шаблон; тут ще раз (повторно нічого не змінює) — для
    // каталогів, зібраних до 01.10.2026, щоб «Перебудувати сайт» прибирав його одразу.
    description: stripShopListing(p.description || ''),
    attrs: p.attrs || [],
    specs: p.specs || []
  });
}

module.exports = { hasDescription, descriptionJson, stripShopListing };

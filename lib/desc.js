// Опис товару й категорії для перегляду на сайті (кнопка «Опис» у таблицях товарів,
// у результатах пошуку й біля назви категорії). Одне правило «чи є що показати» для
// render-map.js (CATALOG_DATA) і build-maps.js (search-index.json, файли desc/).
//
// Скрапер зберігає опис таким, як його віддав сайт (`descriptionRaw`); усе, що тут
// показується, виводиться з нього під час збирання (lib/desc-parse.js). Описи ~50 МБ
// на весь сайт, тож ні в сторінку, ні в індекс пошуку вони не йдуть: там лише id у
// полі `desc`, а сам опис — окремим файлом, який браузер завантажує при кліку.

// '' — опису на сайті немає; поля немає зовсім — каталог зібрано до переходу на сирий
// опис (02.10.2026), і кнопки тоді немає. Кнопка є в кожного прочитаного товару, і без
// опису теж (користувач 02.10.2026): вікно відкривається, як в інших, і на вкладці
// «Опис» пише, що опису на сайті немає; код, ціна й наявність у ньому є завжди.
function hasDescription(p) {
  return typeof p.descriptionRaw === 'string';
}
// Вузол дерева каталогу: опис категорії є приблизно в чверті категорій.
function hasCategoryDescription(node) {
  return typeof node.descriptionRaw === 'string' && node.descriptionRaw.replace(/<[^>]*>|&nbsp;|\s/g, '') !== '';
}

// ── Супутні товари ──
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

// ── Файл опису товару desc/<id>.json ──
// parsed — розбір сирого опису (lib/desc-parse.js): { text, html, kit, xsell }.
// idx — descIndex усіх каталогів. Дві вкладки (користувач 02.10.2026): «З цим товаром
// також замовляють» — карусель сайту (accessories, id товарів) → acc; «До цього товару у
// нас можна придбати» — список з опису (xsell: назва, посилання, картинка) → also.
// Пункт стає карткою товару (наші код, наявність, ціна, фото), розділу або, коли назву
// не впізнано, лишається назвою з картинкою, як на сайті. Посилання карток — на мапу:
// розділ — на свій вузол, товар — на вузол своєї категорії з підсвіткою рядка (&p=<id>).
function descriptionJson(p, idx, parsed) {
  const d = parsed || { text: '', html: '', kit: [], xsell: [] };
  const mapOf = q => {
    const c = idx && idx.catById.get(String(q.categoryId));
    return c ? `${c.topId}_map.html#cat=${c.id}&p=${q.productId}` : '';
  };
  const productCard = (q, img) => ({
    id: String(q.productId),
    code: q.sku || '',
    name: q.productName || '',
    url: q.finalUrl || '',
    avail: q.availabilityStatus || '',
    price: q.price == null ? null : q.price,
    oldPrice: q.oldPrice == null ? null : q.oldPrice,
    currency: q.currency || '',
    photo: (q.photos || [])[0] || img || '',
    desc: hasDescription(q),
    map: mapOf(q)
  });
  const catCard = (c, img) => ({ cat: c.id, name: c.name, map: `${c.topId}_map.html#cat=${c.id}`, photo: img || '' });
  // Товар, що є в каруселі сайту, у списку з опису не повторюється.
  const acc = [], also = [], seen = new Set();
  let cards = acc;
  const add = (key, card) => { if (card && !seen.has(key)) { seen.add(key); cards.push(card); } };
  if (idx) {
    (p.accessories || []).forEach(id => { const q = idx.byId.get(String(id)); if (q) add('p' + q.productId, productCard(q, '')); });
    cards = also;
    d.xsell.forEach(([name, href, img]) => {
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
    price: p.price == null ? null : p.price,
    // Стара перекреслена ціна — лише в товарів зі знижкою.
    oldPrice: p.oldPrice == null ? null : p.oldPrice,
    currency: p.currency || '',
    photos: p.photos || [],
    // Текст з позначками картинок і посилань — запас на випадок порожнього HTML.
    description: d.text,
    html: d.html,
    attrs: p.attrs || [],
    specs: p.specs || [],
    kit: d.kit,
    acc,
    also
  });
}

// ── Файл опису категорії desc/c<id>.json ── (те саме вікно, без вкладок товару)
function categoryJson(node, parsed) {
  const d = parsed || { text: '', html: '' };
  return JSON.stringify({
    id: 'c' + node.categoryId,
    category: true,
    name: node.categoryName || '',
    url: node.url || '',
    photos: node.image ? [node.image] : [],
    description: d.text,
    html: d.html
  });
}

// ── Індекс пошуку за описом: desc-index.json ── (HISTORY.md, п. 48)
// Окремий файл, який браузер завантажує лише при першому пошуку (search-index.json з
// назвами й кодами лишається легким): { p: [[id, характеристики, текст]], c: [[id
// категорії, id розділу, назва, текст]] }. Текст — рядками, як у вікні «Опис»: абзац,
// рядок таблиці чи пункт списку — один рядок; пошук вимагає, щоб усі слова запиту
// стояли в одному рядку.
//
// Шаблонні рядки не індексуються: довгий рядок (від 60 знаків), що повторюється
// щонайменше в 30 описах, — це застереження магазину («Інформація на сайті є
// актуальною…», 792 товари) чи однакова інструкція на цілу групу, а не опис товару.
// Через них «доставка» знаходила 42 товари. Короткі рядки («Матеріал: алюмінієвий
// сплав», 271 товар) лишаються: це зміст. Виміряно 03.10.2026: 144 рядки, 13,6% тексту.
const BOILER_MIN_LEN = 60;
const BOILER_MIN_DOCS = 30;
function searchLines(text) {
  return String(text || '')
    .replace(/!\[\]\([^)]*\)/g, ' ')            // картинки
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // посилання → їхній текст
    .replace(/https?:\/\/\S+/g, ' ')
    .split('\n').map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => /[0-9a-zа-яіїєґ]/i.test(s));
}
// products: [{ p, parsed }], nodes: [{ n, parsed }]; idx — descIndex (розділ категорії).
function descSearchIndex(products, nodes, idx) {
  const docs = products.map(({ p, parsed }) => ({
    id: String(p.productId),
    attrs: (p.attrs || []).map(a => `${a[0]}: ${a[1]}`.replace(/\s+/g, ' ').trim()),
    lines: [...searchLines(parsed && parsed.text), ...searchLines(((parsed && parsed.kit) || []).join('\n'))],
  }));
  const df = new Map();
  docs.forEach(d => new Set(d.lines.filter(l => l.length >= BOILER_MIN_LEN)).forEach(l => df.set(l, (df.get(l) || 0) + 1)));
  const boiler = l => (df.get(l) || 0) >= BOILER_MIN_DOCS;
  return {
    p: docs.map(d => [d.id, d.attrs.join('\n'), d.lines.filter(l => !boiler(l)).join('\n')]).filter(r => r[1] || r[2]),
    c: nodes.map(({ n, parsed }) => {
      const cat = idx && idx.catById.get(String(n.categoryId));
      return [String(n.categoryId), cat ? cat.topId : '', n.categoryName || '', searchLines(parsed && parsed.text).filter(l => !boiler(l)).join('\n')];
    }).filter(r => r[1] && r[3]),
  };
}

module.exports = { hasDescription, hasCategoryDescription, descriptionJson, categoryJson, descIndex, descSearchIndex };

// generate-snapshot.js — читає щойно зібрані output/site/<id>_catalog.json
// для всіх категорій із output/site/categories.json і пише в гілку data:
//
//   snapshots/<YYYY-MM-DD>.json   стан дня, компактно — сировина для сторінки змін
//                                 (build-reports.js рахує різницю будь-яких двох дат);
//   products/<id>.html            опис товару таким, як його віддав сайт, слово в слово;
//   products/<id>.json            назва, код, адреса, характеристики, специфікації,
//                                 фото, карусель сайту «З цим товаром також замовляють»;
//   categories/<id>.html|.json    те саме для категорій (опис є приблизно в чверті);
//   home.html, home.json          блок «Групи товарів та послуг» з головної.
//
// Рішення користувача 01.10.2026: знімок опису — те, що зчитано з сайту, без обробки,
// бо порівнюються ночі до знака («навіть пробіл має значення»). Усе, що з опису
// виводиться для показу, рахується в збиранні (lib/desc-parse.js) і сюди не потрапляє:
// наші правила показу міняються, а історія — лише коли змінився сайт.
//
// Що де лежить і чому:
// - файл товару чи категорії міняється лише коли магазин переписав опис або поля,
//   тож список змінених за ніч файлів і є списком змін; git зберігає лише їх.
//   Історія одного товару — `git log -p origin/data -- products/<id>.html`;
// - ціна й наявність — у знімку дня, не у файлі товару: вони міняються часто
//   (ціна перераховується), і зміни описів потонули б у тисячах файлів;
// - у знімку дня на товар два відбитки: rawHash (сирий опис і поля — ловить усе,
//   до пробілу) і textHash (видимий текст — чи змінився зміст, а не лише розмітка).
//   Обидва залежать і від нашого коду, тож у знімку є parser і format: відбитки
//   знімків з різними parser (textHash) чи format (rawHash) не порівнюються;
// - файли ніколи не видаляються: товар, що зник, або категорія, яку тієї ночі не
//   зібрано, інакше дали б «видалено», а наступної ночі «додано».
//
// Знімок пишеться НЕ в output/ (те гітигнориться на main), а в окрему теку —
// у нічному прогоні це робочий checkout гілки `data` (deploy-pages.yml готує його
// як git-worktree перед викликом цього скрипта).
//
// Використання:
//   node generate-snapshot.js [outDir]
//   outDir — куди писати, за замовчуванням ./data-branch
//   SNAPSHOT_DATE=YYYY-MM-DD (опційно, для тестів/бекфілу) — інакше береться
//   поточна UTC-дата в момент запуску.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readCategoriesOrExit } = require('./lib/categories');
const { parseMany, VERSION: PARSER_VERSION } = require('./lib/desc-parse');

// ==================== НАЛАШТУВАННЯ ====================
const SITE_DIR = path.join(__dirname, 'output', 'site');
const OUT_DIR = path.resolve(process.argv[2] || path.join(__dirname, 'data-branch'));
const DATE = process.env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10); // UTC-дата запуску

// Міняється склад чи вигляд products/<id>.json, categories/<id>.json — збільшити.
const FORMAT = 1;

const hash = text => crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);

// Єдине відступлення від «слово в слово». Зовнішні картинки Prom віддає через проксі
// ssl.prom.st/q?u=<адреса>&s=…&h=…, і підпис s/h новий при кожному завантаженні
// сторінки (без нього проксі відповідає 403, тож у каталозі він лишається). Для
// порівняння підпис відкидається: файл переписується лише коли змінилось щось, крім нього.
const stable = html => html.replace(/(https?:\/\/ssl\.prom\.st\/q\?[^"'\s<>]*?)(?:&amp;|&)s=[^"'&\s<>]*(?:&amp;|&)h=[^"'&\s<>]*/g, '$1');

// ==================== ДЕРЕВО КАТЕГОРІЙ ====================
// Рекурсивно розгортає дерево з <id>_catalog.json (той самий формат, що читає
// render-map.js) у плаский список. level береться напряму з кожного вузла — його
// вже пише scrape-complete.js, рахувати заново не треба.
function flattenTree(node, parentId, out, nodes) {
  out.push({
    id: node.categoryId,
    name: node.categoryName,
    parentId,
    level: node.level,
    // Посилання на сторінку категорії — на нього веде назва категорії на
    // сторінці змін (build-reports.js). Лише числовий id для URL не годиться:
    // сайт віддає 404 на /ua/g<id> без slug.
    url: node.url || '',
  });
  nodes.push({ node, parentId });
  (node.children || []).forEach(child => flattenTree(child, node.categoryId, out, nodes));
}

// Помилки прогону цієї категорії — щоб знімок відповідав і на питання "чи все
// було гаразд тієї ночі", а не лише "що було в каталозі".
function readRunErrors(categoryId) {
  const p = path.join(SITE_DIR, `${categoryId}_errors.json`);
  try { const list = JSON.parse(fs.readFileSync(p, 'utf-8')); return Array.isArray(list) ? list : []; } catch (e) { return []; }
}

const readOr = (file, fallback) => { try { return fs.readFileSync(file, 'utf-8'); } catch (e) { return fallback; } };
// Переписується лише файл, чий вміст справді змінився: так і mtime, і git бачать
// тільки справжні зміни. same — своє порівняння (для HTML — без підпису проксі).
let written = 0;
function writeIfChanged(file, text, same) {
  const old = readOr(file, null);
  if (old !== null && (same ? same(old, text) : old === text)) return;
  fs.writeFileSync(file, text, 'utf-8');
  written++;
}
const sameHtml = (a, b) => stable(a) === stable(b);
// Опис: файл з'являється, коли опис є; порожнім стає лише коли опис зник із сайту.
// keepOld — запобіжник нижче: порожній опис наявного файлу не затирає.
function writeHtml(file, raw, keepOld) {
  if (raw === '' && (keepOld || !fs.existsSync(file))) return;
  writeIfChanged(file, raw, sameHtml);
}
// JSON по полю на рядок, а пари [назва, значення] — кожна одним рядком: так різницю
// між днями видно рядок за рядком.
// Пара — масив у масиві (відступи 6 і 4): photos чи accessories з двох елементів не склеюються.
const PAIR = /\[\n {6}("(?:[^"\\]|\\.)*"),\n {6}("(?:[^"\\]|\\.)*")\n {4}\]/g;
const pretty = obj => JSON.stringify(obj, null, 2).replace(PAIR, '[$1, $2]') + '\n';

(async () => {
  // ==================== ОСНОВНИЙ ПРОХІД ====================
  const rows = readCategoriesOrExit(SITE_DIR);
  const categories = [];
  const catNodes = [];              // { node, parentId } — для categories/<id>.*
  const productsById = new Map();   // захист від дублів, якщо productId колись з'явиться у двох деревах
  const topImage = new Map(rows.map(r => [String(r.categoryId), r.image || '']));

  let missingCatalog = 0;
  const run = [];

  rows.forEach(row => {
    const catalogPath = path.join(SITE_DIR, `${row.categoryId}_catalog.json`);
    if (!fs.existsSync(catalogPath)) {
      missingCatalog++;
      console.warn(`Пропущено (нема ${row.categoryId}_catalog.json): ${row.categoryName}`);
      return;
    }
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    flattenTree(catalog.tree, null, categories, catNodes);
    (catalog.products || []).forEach(p => {
      if (!productsById.has(String(p.productId))) productsById.set(String(p.productId), p);
    });
    run.push({
      categoryId: String(row.categoryId),
      name: row.categoryName,
      scrapedAt: catalog.scrapedAt || null,
      reconciliation: catalog.reconciliation || null,
      crumbSummary: catalog.crumbSummary || null,
      errors: readRunErrors(row.categoryId),
    });
  });

  // Видимий текст опису — для textHash. Розбір той самий, що в збиранні, і бере його
  // з кешу на диску: build-maps.js щойно розібрав ці самі описи.
  const withRaw = [...productsById.values()].filter(p => typeof p.descriptionRaw === 'string');
  const catsWithRaw = catNodes.filter(c => typeof c.node.descriptionRaw === 'string');
  const parsed = await parseMany([
    ...withRaw.map(p => ({ key: 'p' + p.productId, raw: p.descriptionRaw, url: p.finalUrl })),
    ...catsWithRaw.map(c => ({ key: 'c' + c.node.categoryId, raw: c.node.descriptionRaw, url: c.node.url })),
  ]);
  const visibleText = d => d ? [d.text, ...(d.kit || []), ...(d.xsell || []).map(x => x[0])].join('\n') : '';

  // ==================== ФАЙЛИ ТОВАРІВ І КАТЕГОРІЙ ====================
  const productsDir = path.join(OUT_DIR, 'products');
  const categoriesDir = path.join(OUT_DIR, 'categories');
  if (withRaw.length) fs.mkdirSync(productsDir, { recursive: true });
  if (catsWithRaw.length) fs.mkdirSync(categoriesDir, { recursive: true });
  // Кінці рядків у гілці data git не чіпає: інакше «до знака» не вийде.
  if (withRaw.length || catsWithRaw.length) writeIfChanged(path.join(OUT_DIR, '.gitattributes'), '* -text\n');

  // Запобіжник: скрапер не відрізняє «опису на сторінці немає» від «блок опису не
  // знайдено» (обидва — ''). Якщо Prom змінить розмітку, порожніми за ніч стали б усі
  // описи. Тому коли спорожніло одразу багато описів, що вчора були, файли лишаються
  // вчорашніми, а у знімок іде descriptionsSuspect — скільки таких.
  const blanked = withRaw.filter(p => p.descriptionRaw === '' && readOr(path.join(productsDir, `${p.productId}.html`), '') !== '').length;
  const keepOld = blanked > Math.max(20, withRaw.length * 0.05);
  if (keepOld) console.warn(`УВАГА: опис зник одразу в ${blanked} товарів — схоже на зміну розмітки сайту, а не на правки магазину. Файли описів лишено вчорашніми.`);

  const hashes = new Map();
  withRaw.forEach(p => {
    const id = String(p.productId);
    const jsonFile = path.join(productsDir, `${id}.json`);
    // Карусель тієї ночі не прочиталась (null) — лишається попередня, а не «зникла».
    let accessories = p.accessories;
    if (accessories == null) { try { accessories = JSON.parse(readOr(jsonFile, '{}')).accessories || []; } catch (e) { accessories = []; } }
    const json = pretty({
      id,
      name: p.productName || '',
      sku: p.sku || '',
      url: p.finalUrl || '',
      attrs: p.attrs || [],
      specs: p.specs || [],
      photos: p.photos || [],
      accessories,
    });
    writeIfChanged(jsonFile, json);
    writeHtml(path.join(productsDir, `${id}.html`), p.descriptionRaw, keepOld);
    hashes.set('p' + id, { rawHash: hash(stable(p.descriptionRaw) + '\n' + json), textHash: hash(visibleText(parsed.get('p' + id))) });
  });
  catsWithRaw.forEach(({ node, parentId }) => {
    const id = String(node.categoryId);
    const json = pretty({
      id,
      name: node.categoryName || '',
      url: node.url || '',
      parentId: parentId == null ? null : String(parentId),
      level: node.level,
      // Картинка плитки: у підкатегорій — зі сторінки батька, у розділів 1 рівня — з головної.
      image: node.image || (parentId == null ? topImage.get(id) || '' : ''),
      // Підкатегорії в порядку сайту.
      children: (node.children || []).map(ch => String(ch.categoryId)),
    });
    writeIfChanged(path.join(categoriesDir, `${id}.json`), json);
    writeHtml(path.join(categoriesDir, `${id}.html`), node.descriptionRaw);
    hashes.set('c' + id, { rawHash: hash(stable(node.descriptionRaw) + '\n' + json), textHash: hash(visibleText(parsed.get('c' + id))) });
  });

  // Головна: блок розділів, як на сайті (scrape-site.js), і той самий список полями.
  const homeRaw = readOr(path.join(SITE_DIR, 'home.html'), null);
  if (homeRaw !== null) {
    writeIfChanged(path.join(OUT_DIR, 'home.html'), homeRaw, sameHtml);
    const home = rows.filter(r => r.position).sort((a, b) => a.position - b.position)
      .map(r => ({ position: r.position, id: String(r.categoryId), name: r.categoryName, url: r.categoryUrl, image: r.image || '' }));
    if (home.length) writeIfChanged(path.join(OUT_DIR, 'home.json'), JSON.stringify(home, null, 2) + '\n');
  }

  // ==================== ЗНІМОК ДНЯ ====================
  // З каталогу лишаємо те, що потрібне для різниці й сторінки змін, плюс crumbVerdict —
  // вердикт звірки з хлібними крихтами сайту (див. scrape-complete.js): він дає змогу
  // через тиждень сказати, чи була та "зміна категорії" справжньою, чи це скрапер помилився.
  const products = [...productsById.values()].map(p => {
    const row = {
      id: String(p.productId),
      name: p.productName,
      sku: p.sku,
      categoryId: String(p.categoryId),
      availability: p.availabilityStatus,
      url: p.finalUrl,
      crumbVerdict: p.crumbVerdict || 'unknown',
    };
    // Ціна й стара перекреслена ціна (лише в товарів зі знижкою) — з каталогів від 02.10.2026.
    if (p.price != null) row.price = p.price;
    if (p.oldPrice != null) row.oldPrice = p.oldPrice;
    // Відбитки файлів products/<id>.*: лише коли опис читався; інакше полів немає.
    const h = hashes.get('p' + row.id);
    if (h) { row.rawHash = h.rawHash; row.textHash = h.textHash; }
    return row;
  });
  categories.forEach(c => { const h = hashes.get('c' + c.id); if (h) { c.rawHash = h.rawHash; c.textHash = h.textHash; } });

  const snapshot = {
    date: DATE,
    generatedAt: new Date().toISOString(),
    // Версія розбору описів (lib/desc-parse.js) і складу файлів products/, categories/:
    // textHash знімків з різним parser і rawHash з різним format порівнювати не можна —
    // змінився наш код, а не сайт.
    parser: PARSER_VERSION,
    format: FORMAT,
    ...(keepOld ? { descriptionsSuspect: blanked } : {}),
    // Діагностика прогону поряд із даними: звірка, підсумок по крихтах і помилки
    // кожної категорії. Знімки в гілці data лишаються назавжди, тож "чи була
    // проблема тієї ночі" видно й через тиждень, а не лише в поточному лозі.
    run,
    categories,
    products,
  };

  const snapshotsDir = path.join(OUT_DIR, 'snapshots');
  fs.mkdirSync(snapshotsDir, { recursive: true });
  const outPath = path.join(snapshotsDir, `${DATE}.json`);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf-8');

  console.log(`Знімок записано: ${outPath}`);
  if (withRaw.length || catsWithRaw.length) console.log(`Файлів товарів: ${withRaw.length}, категорій: ${catsWithRaw.length}; записано нових чи змінених файлів: ${written}`);
  console.log(`Категорій: ${categories.length}, товарів: ${snapshot.products.length}` +
    (missingCatalog ? `, без каталогу: ${missingCatalog}` : '') +
    `, помилок прогону: ${run.reduce((n, r) => n + r.errors.length, 0)}`);
})().catch(e => { console.error(e); process.exit(1); });

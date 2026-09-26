// scrape-complete.js — скрапер однієї категорії 1 рівня; URL — єдиний аргумент.
//
// Три етапи: обхід дерева категорій зі збором товарів на КОЖНОМУ вузлі (і
// проміжному теж — так знаходяться товари поза підкатегоріями); сторінка кожного
// унікального товару (назва, код, наявність, хлібні крихти); звірка з лічильником
// сайту «В наявності» і з крихтами. Результат — один output/site/<id>_catalog.json,
// записаний одним разом у кінці; хід прогону — події в scrape.jsonl.
// Черга по всіх категоріях — scrape-site.js.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { nowStr, logEvent } = require('./lib/log');
const { sleep, BLOCKED_RESOURCE_TYPES } = require('./lib/browser');

// ==================== НАЛАШТУВАННЯ ====================
const BASE = "https://cncprom.ua";
const DEFAULT_START_URL = "https://cncprom.ua/ua/g1022952-istochniki-pitaniya-akkumulyatory";
const START_URL = process.argv[2] || DEFAULT_START_URL;
const MAX_DEPTH = 6;
const DELAY_MS = 700;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 6000;
// Пауза перед повторним проходом по товарах, що не вдались на ЕТАПІ 2 —
// щоб короткий збій сайту встиг минути (див. кінець ЕТАПУ 2).
const RETRY_PASS_DELAY_MS = 60000;
// Скільки чекати на появу сітки товарів (її малює React уже після
// domcontentloaded). Див. waitForProductGrid — без цього очікування
// категорія тихо отримувала 0 товарів.
const GRID_WAIT_MS = 10000;
const MAX_PAGES_SAFETY = 200;

// Усі згенеровані файли лежать в output/site/, не в корені проєкту. Шлях від
// __dirname, а не process.cwd(), тож неважливо, звідки викликано `node`.
const OUTPUT_DIR = path.join(__dirname, 'output', 'site');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Ім'я файлу починається з ID категорії (не з назви типу файлу) — так усі
// файли однієї категорії стоять поруч один з одним при сортуванні за іменем
// у провіднику/файловому менеджері, замість групування за типом файлу.
const START_CATEGORY_ID = (START_URL.match(/\/g(\d+)-/) || [, "unknown"])[1];
// Один файл на категорію: дерево + товари + звірка, записується ОДИН раз у
// кінці прогону. Раніше було двоє — дерево в кінці етапу 1 і CSV у кінці
// етапу 2, — і через цей розрив build-maps.js мусив вгадувати, чи не зібрано
// мапу з дерева одного прогону й товарів іншого (еталонна категорія, поріг у
// годинах, заглушки "застаріло"). З одним файлом такої ситуації не буває.
const OUTPUT_CATALOG = path.join(OUTPUT_DIR, `${START_CATEGORY_ID}_catalog.json`);
const OUTPUT_FAILED = path.join(OUTPUT_DIR, `${START_CATEGORY_ID}_failed_urls.json`);
// Помилки цього прогону — ті самі, що записи error у scrape.jsonl, але окремо по
// категорії й повним текстом з адресою: з них build-maps.js складає панель
// «Помилки» на map.html.
const OUTPUT_ERRORS = path.join(OUTPUT_DIR, `${START_CATEGORY_ID}_errors.json`);

// Трекери й аналітика — ріжуться на додачу до типів ресурсів з lib/browser.js.
const BLOCKED_PATTERNS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'facebook.net', 'facebook.com/tr', 'connect.facebook.net',
  'ringostat.com', 'hotjar.com', 'criteo.com',
  '/ptrack', '/gatrack', 'advtracking'
];

// ==================== ЛОГ (scrape.jsonl — доповнюється, ніколи не перезаписується) ====================
// Один файл на весь проєкт (не per-категорія, як JSON-каталоги), бо це історія
// запусків скрапера в часі, а не результат конкретного прогону. Лежить в output/
// разом з рештою згенерованого, а не в корені проєкту.
//
// JSONL, а не текст (з 26.09.2026, до того — scrape.log): сторінка будує з нього
// таблицю прогону, і тоді розбирати формулювання не треба — зміна слова в рядку
// нічого не ламає.
const LOG_FILE = path.join(OUTPUT_DIR, "scrape.jsonl");
// Ідентифікатор прогону: scrape-site.js запускає кожну категорію окремим
// процесом, тож без спільного id 23 категорії однієї ночі виглядали б як 23
// різні прогони. Передається через середовище; поодинокий запуск робить свій.
const RUN_ID = process.env.SCRAPE_RUN_ID || new Date().toISOString();
const logEvt = (ev, fields) => logEvent(LOG_FILE, ev, Object.assign({ run: RUN_ID }, fields));
const runErrors = [];
// text — повний рядок для <id>_errors.json (панель «Помилки» на map.html, там адреса
// корисна). extra — те, що йде в scrape.jsonl замість тексту: msg без адреси й items
// [{name, url}] — з них таблиця прогону робить посилання з назвою товару.
function logError(text, extra) {
  runErrors.push({ time: nowStr(), text });
  logEvt('error', Object.assign({ id: START_CATEGORY_ID, msg: text }, extra));
}

// Попередження — у лог, але НЕ в помилки прогону: стан незвичний, але пояснюваний.
function logWarn(text, extra) {
  logEvt('warn', Object.assign({ id: START_CATEGORY_ID, msg: text }, extra));
}

// ==================== ДОПОМІЖНІ ФУНКЦІЇ ====================

// opts.silent — не рахувати остаточну невдачу помилкою прогону (етап 2 спершу
// збирає такі товари для повторного проходу й логує лише тих, що не вдались
// і вдруге — див. кінець ЕТАПУ 2).
async function gotoWithRetry(page, url, opts = {}) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Раніше статус відповіді не перевірявся зовсім: сторінка помилки сайту
      // (429/5xx під час короткого збою) вважалась успіхом. Так у знімку за
      // 18.09.2026 три сусідні товари отримали порожні назву, код і статус —
      // а в diff це виглядало як "зникли з наявності" й наступного дня "знову
      // в наявності". Звичайні сторінки сайту віддають 200, неіснуючий товар —
      // 404 (перевірено), тож >= 400 — завжди збій, який варто повторити.
      // resp буває null для навігації в межах того самого документа — це не збій.
      if (resp && resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);
      return true;
    } catch (e) {
      console.warn(`  Помилка навігації (спроба ${attempt}/${MAX_RETRIES}): ${url} — ${e.message}`);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }
  console.error(`  ПРОПУЩЕНО після ${MAX_RETRIES} спроб: ${url}`);
  if (!opts.silent) {
    const isProduct = /\/p\d+-/.test(url);
    logError(`Не вдалось завантажити після ${MAX_RETRIES} спроб: ${url}`, {
      msg: isProduct ? `Не вдалось завантажити товар після ${MAX_RETRIES} спроб`
        : `Не вдалось завантажити сторінку категорії після ${MAX_RETRIES} спроб`,
      items: [{ name: isProduct ? gridNameOf(url) : null, url }]
    });
  }
  return false;
}

function extractCategoryIdFromUrl(url) {
  const m = url.match(/\/g(\d+)-/);
  return m ? m[1] : "";
}

// Єдине місце в скрапері, де збій розмітки міг покласти ВЕСЬ прогін категорії:
// <li> без жодного з двох посилань давав TypeError усередині evaluate, і той
// спливав крізь усю рекурсію crawlTree до фатального catch. Тепер такий вузол
// просто пропускається, а збій самого $$eval логується — інакше категорія з
// поламаним списком тихо виглядала б як листок без підкатегорій.
async function getSubcategoryLinks(page, url) {
  return page.$$eval(
    "ul.cs-product-groups-list > li.cs-product-groups-list__item",
    (items, base) => items.map(li => {
      const a = li.querySelector("a.cs-product-groups-list__title") || li.querySelector("a.cs-product-groups-list__image-link");
      if (!a || !a.getAttribute("href")) return null;
      return { url: new URL(a.getAttribute("href"), base).href, name: a.textContent.trim() };
    }).filter(Boolean),
    BASE
  ).catch(e => {
    logError(`Не вдалось прочитати список підкатегорій: ${url} — ${e.message}`);
    return [];
  });
}

async function getPagerMaxPage(page) {
  return page.$$eval(
    "div.b-pager > a.b-pager__link",
    as => {
      let max = 1;
      as.forEach(a => {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\/page_(\d+)/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > max) max = n;
        }
      });
      return max;
    }
  ).catch(() => 1);
}

// Назва товару з картки сітки — id → назва. Потрібна лише для лога: якщо
// сторінка товару потім не відкрилась, назви з неї вже не буде, а в таблиці
// прогону помилка без назви не каже, про який товар ідеться.
// На збір товарів не впливає: ті самі посилання, той самий фільтр.
const gridNames = new Map();

// Тільки справжня сітка товарів категорії — виключає карусельні блоки
// ("Подібні товари компанії" / "Ви переглядали" / "Ми рекомендуємо").
// Повертає кількість знайдених НА СТОРІНЦІ позицій, а не приріст мапи: саме
// вона відрізняє "сторінка порожня" від "усі ці товари вже були в мапі".
async function collectProductsFromCurrentPage(page, mapOut) {
  const items = await page.$$eval(
    'ul.cs-product-gallery > li.cs-product-gallery__item a[href]',
    (as, base) => as
      .map(a => ({ href: a.getAttribute("href"), text: (a.getAttribute("title") || a.textContent || "").trim() }))
      .filter(x => /\/ua\/p\d+-[^/]*\.html$/i.test(x.href))
      .map(x => ({ url: new URL(x.href, base).href, text: x.text })),
    BASE
  ).catch(() => []);
  items.forEach(({ url, text }) => {
    const m = url.match(/\/p(\d+)-/);
    if (!m) return;
    mapOut.set(m[1], url);
    // У картці кілька посилань (фото, назва) — беремо найдовший текст.
    if (text && text.length > (gridNames.get(m[1]) || '').length) gridNames.set(m[1], text.replace(/\s+/g, ' '));
  });
  return items.length;
}
const gridNameOf = url => { const m = String(url).match(/\/p(\d+)-/); return m ? gridNames.get(m[1]) || null : null; };

// Сітку товарів малює React уже ПІСЛЯ domcontentloaded, тому чекаємо саме її
// появу, а не фіксовану паузу. Це ключове місце: page.$$eval на нуль збігів
// НЕ кидає виняток, а повертає порожній масив — тож сторінка, яка не встигла
// відрендеритись за DELAY_MS (700 мс), давала категорії 0 товарів без жодної
// помилки, без ретраю і без рядка в scrape.log, а прогін звітував "успішно".
// Саме так у ніч на 19.09.2026 усі 14 товарів "Гальмівних резисторів"
// (154899610) втратили свою категорію й успадкували батьківську, а 20.09
// повернулись назад — у diff-звітах це виглядало як 28 справжніх переміщень.
async function waitForProductGrid(page) {
  return page.waitForSelector('ul.cs-product-gallery > li.cs-product-gallery__item', { timeout: GRID_WAIT_MS })
    .then(() => true).catch(() => false);
}

// Запобіжник на випадок СИСТЕМНОГО збою (сайт змінив розмітку сітки): без
// нього ~400 вузлів × (GRID_WAIT_MS + RETRY_DELAY_MS) додали б до нічного
// прогону кілька годин і вибили б timeout-minutes: 300 у deploy-pages.yml.
// Після такої кількості порожніх сторінок ретраї вимикаються — помилки все
// одно вже в лозі, і прогін має впасти швидко, а не через 6 годин.
const EMPTY_GRID_GIVE_UP = 10;
let emptyGridFailures = 0;

// "Зібрали 0 товарів" майже завжди означає, що сітка не відрендерилась, а не що
// категорія порожня — тому сторінку перепробовуємо, а не записуємо порожнечу як
// факт. Виняток, знайдений 23.09.2026: категорія з ПІДКАТЕГОРІЯМИ може справді
// не мати власних товарів (усі лежать глибше) — "Зубчасті шківи і натягувачі"
// (g104993823), єдина така з 407 вузлів, перевірено на живій сторінці. Тому:
//   - кінцева категорія (без підкатегорій) з 0 товарів — ПОМИЛКА, як і було;
//     саме цей випадок 19.09.2026 перекинув 14 "Гальмівних резисторів" у
//     батьківську категорію (docs/history.md, п. 12);
//   - категорія з підкатегоріями — лише УВАГА в лозі, без помилки прогону.
// Повторну спробу робимо в обох випадках: наперед їх не відрізнити.
async function loadListingPage(page, url, mapOut, hasSubcategories) {
  const attempts = emptyGridFailures >= EMPTY_GRID_GIVE_UP ? 1 : 2;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (!(await gotoWithRetry(page, url))) return false; // причину вже залоговано в gotoWithRetry
    await waitForProductGrid(page);
    if ((await collectProductsFromCurrentPage(page, mapOut)) > 0) return true;
    if (attempt < attempts) {
      console.warn(`  Сітка товарів порожня (спроба ${attempt}/${attempts}): ${url} — пробуємо ще раз`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  if (hasSubcategories) {
    console.warn(`  Власних товарів немає (усі в підкатегоріях): ${url}`);
    logWarn(`Сітка товарів порожня, але категорія має підкатегорії — власних товарів немає: ${url}`);
    return false;
  }
  emptyGridFailures++;
  logError(`Сітка товарів порожня після ${attempts} спроб: ${url}`);
  return false;
}

async function getDirectProducts(page, catUrl, hasSubcategories) {
  const productMap = new Map();
  const baseNoSlash = catUrl.replace(/\/$/, "");

  const ok1 = await loadListingPage(page, catUrl, productMap, hasSubcategories);
  await sleep(DELAY_MS);
  if (!ok1) return productMap;

  let maxPage = await getPagerMaxPage(page);

  let p = 2;
  while (p <= maxPage) {
    const pageUrl = `${baseNoSlash}/page_${p}`;
    const ok = await loadListingPage(page, pageUrl, productMap, hasSubcategories);
    await sleep(DELAY_MS);
    if (ok) {
      const pageMax = await getPagerMaxPage(page);
      if (pageMax > maxPage) maxPage = pageMax;
    }
    p++;
    if (p > MAX_PAGES_SAFETY) break;
  }

  return productMap;
}

async function getSiteAvailableCounter(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll('li, label, span')];
    for (const el of items) {
      const text = el.textContent || "";
      const m = text.match(/В наявності\s*(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    // Сайт повністю ховає фільтр "В наявності N" (не показує "В наявності 0"),
    // коли в категорії немає жодного товару в наявності — підтверджено на
    // "Плати керування NC-Studio (PCI)" (g156789482). Тобто відсутність тексту
    // на успішно завантаженій сторінці означає 0, а не "не вдалося визначити".
    return 0;
  }).catch(() => null); // null — лише коли саму сторінку не вдалось прочитати
}

// ==================== ЕТАП 1: ОБХІД ДЕРЕВА + КАНОНІЧНЕ ПРИЗНАЧЕННЯ КАТЕГОРІЇ ====================
// productAssignments: Map<productId, {url, categoryId, categoryName, level, path,
// isLeafCategory}>, path — рядок «Категорія / Підкатегорія / …».
// Перезаписується без умов — оскільки обхід іде вглиб, останній запис = найглибша
// (найточніша) категорія. Якщо товар ніде глибше не "приземлився" — лишається
// запис з проміжної категорії, що само по собі і є ознакою товару-сироти.
async function crawlTree(page, url, name, depth, path, productAssignments, treeOut) {
  const ok = await gotoWithRetry(page, url);
  await sleep(DELAY_MS);
  if (!ok) {
    console.error(`  Не вдалось зайти в категорію: ${url} — пропущено`);
    return;
  }
  if (!name) {
    name = await page.$eval('h1', el => el.textContent.trim()).catch(() => `Категорія ${extractCategoryIdFromUrl(url)}`);
    console.log(`Стартова категорія: ${name}`);
    logEvt('category', { id: extractCategoryIdFromUrl(url), name });
  }
  const fullPath = [...path, name];

  const subs = await getSubcategoryLinks(page, url);
  const siteCounter = await getSiteAvailableCounter(page);
  const directProducts = await getDirectProducts(page, url, subs.length > 0);
  const categoryId = extractCategoryIdFromUrl(url);
  const isLeaf = subs.length === 0 || depth >= MAX_DEPTH;

  console.log(`${"  ".repeat(depth)}[рівень ${depth}] ${name} — прямих товарів: ${directProducts.size}${siteCounter !== null ? `, лічильник сайту "в наявності": ${siteCounter}` : ""}`);

  directProducts.forEach((productUrl, id) => {
    productAssignments.set(id, {
      url: productUrl,
      categoryId,
      categoryName: name,
      level: depth,
      path: fullPath.join(" / "),
      isLeafCategory: isLeaf
    });
  });

  if (treeOut) {
    treeOut.categoryId = categoryId;
    treeOut.categoryName = name;
    treeOut.url = url;
    treeOut.level = depth;
    treeOut.isLeaf = isLeaf;
    treeOut.siteAvailableCounter = siteCounter;
    treeOut.directProductCount = directProducts.size;
    treeOut.children = [];
  }

  if (!isLeaf) {
    for (const s of subs) {
      const childNode = treeOut ? {} : null;
      if (treeOut) treeOut.children.push(childNode);
      await crawlTree(page, s.url, s.name, depth + 1, fullPath, productAssignments, childNode);
    }
  }
}

// ==================== ЕТАП 2: ПОВНІ ДАНІ ПО КОЖНОМУ УНІКАЛЬНОМУ ТОВАРУ ====================
// Хлібні крихти беруться з JSON-LD (`BreadcrumbList`), а не з DOM: цей блок
// сервер віддає вже у вихідному HTML (перевірено curl'ом), тобто чекати React
// не треба, і кожна ланка має посилання виду /ua/g<id>-<slug> — тобто ID
// категорії, а не лише назву. Саме це робить звірку точною: назви сайт міняє
// (22.09 "Фланцеві гайки" стали "Гайки (фланцеві, шестигранні, квадратні)"),
// ID — ні. DOM-крихти лишаються запасним варіантом.
function readProductPage(page) {
  return page.evaluate(() => {
    const nameEl = document.querySelector('[data-qaid="product_name"]');
    const skuEl = document.querySelector('[data-qaid="product_code"]');
    const availEl = document.querySelector('[data-qaid="presence_data"]');

    let crumbs = [];
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      if (!/BreadcrumbList/.test(el.textContent || '')) continue;
      try {
        const data = JSON.parse(el.textContent);
        crumbs = (data.itemListElement || [])
          .map(it => {
            const item = it.item || {};
            const m = String(item['@id'] || '').match(/\/g(\d+)-/);
            return m ? { id: m[1], name: String(item.name || '').trim() } : null;
          })
          .filter(Boolean);
      } catch (e) { /* побитий JSON-LD — лишаємось із DOM-варіантом нижче */ }
      if (crumbs.length) break;
    }
    if (!crumbs.length) {
      crumbs = [...document.querySelectorAll('a[data-qaid="breadcrumbs_item"]')]
        .map(a => {
          const m = (a.getAttribute('href') || '').match(/\/g(\d+)-/);
          return m ? { id: m[1], name: a.textContent.trim() } : null;
        })
        .filter(Boolean);
    }

    return {
      productName: nameEl ? nameEl.textContent.trim() : "",
      sku: skuEl ? skuEl.textContent.trim() : "",
      availabilityStatus: availEl ? availEl.textContent.trim() : "",
      crumbs
    };
  }).catch(() => ({ productName: "", sku: "", availabilityStatus: "", crumbs: [] }));
}

// Назва, код і статус товару приходять у HTML одразу з сервером (виміряно:
// усі вже в DOM на domcontentloaded), тож гонки рендеру тут немає — на відміну
// від сітки товарів на етапі 1. Сторінка без назви означає, що прочитано НЕ
// сторінку товару (заглушку/помилку сайту, яку не впіймала перевірка статусу),
// і такий рядок не можна писати в каталог: порожній статус сторінка змін сприйме
// як "зник з наявності". Тому — ще одна спроба, а якщо знову без назви — null (товар
// піде в повторний прохід наприкінці ЕТАПУ 2).
// silent: true — перший прохід, невдача ще не рахується помилкою прогону.
async function extractProductData(page, url, assignment, silent = false) {
  let data = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ok = await gotoWithRetry(page, url, { silent });
    await sleep(DELAY_MS);
    if (!ok) return null;
    data = await readProductPage(page);
    if (data.productName) break;
    if (attempt < 2) {
      console.warn(`  Сторінка товару без назви (спроба ${attempt}/2): ${url} — пробуємо ще раз`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  if (!data.productName) {
    const msg = `Сторінка товару без даних (немає назви) після 2 спроб: ${url}`;
    if (silent) console.warn(`  ${msg}`);
    else logError(msg, { msg: 'Сторінка товару відкрилась без даних після 2 спроб', items: [{ name: gridNameOf(url), url }] });
    return null;
  }

  const idMatch = url.match(/\/p(\d+)-/);
  const productId = idMatch ? idMatch[1] : "";

  return {
    productId,
    productName: data.productName,
    sku: data.sku,
    categoryId: assignment.categoryId,
    categoryName: assignment.categoryName,
    availabilityStatus: data.availabilityStatus,
    finalUrl: url,
    crumbIds: data.crumbs.map(c => c.id),
    crumbNames: data.crumbs.map(c => c.name)
  };
}

// ==================== ЗВІРКА З ХЛІБНИМИ КРИХТАМИ ====================
// Обхід дерева каже, до якої категорії товар належить за розкладкою сайту;
// крихти на сторінці товару кажуть, до якої категорії сайт відносить його сам.
// Порівнюємо ID (назви змінюються, ID — ні) і класифікуємо:
//   match      — крихти закінчуються тією самою категорією;
//   ancestor   — сайт назвав предка нашої категорії (товар лежить глибше;
//                звичайна річ на Prom, де крихти ведуть до "головної" категорії);
//   descendant — сайт назвав нащадка (наше призначення надто мілке — так
//                виглядає товар-сирота);
//   other      — зовсім інша гілка; це справжній сигнал. Саме так виглядав би
//                збій 19.09.2026, коли 14 товарів отримали категорію батька;
//   unknown    — крихт на сторінці не знайшлось.
function classifyCrumbs(crumbIds, assignedId, chainOf) {
  if (!crumbIds || crumbIds.length === 0) return "unknown";
  const crumbLeaf = crumbIds[crumbIds.length - 1];
  if (crumbLeaf === assignedId) return "match";
  const ourChain = chainOf(assignedId) || [];
  if (ourChain.includes(crumbLeaf)) return "ancestor";
  if (crumbIds.includes(assignedId)) return "descendant";
  return "other";
}

// categoryId -> ланцюг ID від кореня до цього вузла включно.
function buildChainMap(node, parents = [], out = new Map()) {
  if (!node || !node.categoryId) return out;
  const chain = [...parents, node.categoryId];
  out.set(node.categoryId, chain);
  (node.children || []).forEach(c => buildChainMap(c, chain, out));
  return out;
}

// ==================== ЗВІРКА З ЛІЧИЛЬНИКОМ САЙТУ «В НАЯВНОСТІ» ====================
// Для кожного вузла дерева зібране порівнюється з лічильником сайту "В наявності N".
// Порівнюються не лише власні прямі товари вузла, а все піддерево (лічильник сайту
// на проміжній категорії враховує і підкатегорії), тому для звірки збираються
// categoryId усіх нащадків.
function collectSubtreeCategoryIds(node, acc = new Set()) {
  if (!node || !node.categoryId) return acc;
  acc.add(node.categoryId);
  (node.children || []).forEach(c => collectSubtreeCategoryIds(c, acc));
  return acc;
}

// ВАЖЛИВО: не додавати сюди "наявн" — статус відсутності товару звучить як
// "Немає в наявності" і теж містить цей підрядок, тому широка регулярка
// хибно зараховувала і недоступні товари (перевірено: 108 з 178 "Немає в
// наявності" все одно проходили як "available", поки цей коментар не додали).
function isAvailableRow(row) {
  return /готово/i.test(row.availabilityStatus || "");
}

// ВАЖЛИВО: жодного допуску на розбіжність (раніше тут був поріг
// Math.abs(diff) <= 2, обґрунтований тим, що лічильник сайту "В наявності N"
// живий і міг змінитись на 1-2 одиниці за час обходу дерева, поки хтось
// купував/знімав товари з продажу вдень). Скрипт запускається вночі — руху
// замовлень і живих правок каталогу в цей час практично нема, тому будь-яка
// відмінність від 0 — це реальна розбіжність (загублений/задвоєний товар чи
// помилка скрапінгу), а не природний дрейф. Не повертати цей допуск назад.
function buildCategoryStats(node, allRows, depth = 0, out = []) {
  if (!node || !node.categoryId) return out;
  const subtreeIds = collectSubtreeCategoryIds(node);
  const rowsInSubtree = allRows.filter(r => subtreeIds.has(r.categoryId));
  const ourTotal = rowsInSubtree.length;
  const ourAvailable = rowsInSubtree.filter(isAvailableRow).length;
  const siteCounter = node.siteAvailableCounter;
  const hasCounter = siteCounter !== null && siteCounter !== undefined;
  const diff = hasCounter ? ourAvailable - siteCounter : null;

  out.push({ depth, name: node.categoryName, categoryId: node.categoryId, ourTotal, ourAvailable, siteCounter, diff });
  (node.children || []).forEach(c => buildCategoryStats(c, allRows, depth + 1, out));
  return out;
}


// ==================== ГОЛОВНА ЛОГІКА ====================
(async () => {
  const startTime = Date.now();
  logEvt('start', { id: START_CATEGORY_ID, url: START_URL });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.route('**/*', route => {
    const url = route.request().url();
    const type = route.request().resourceType();
    // .catch() тут обов'язковий: якщо сторінка навігує, поки роут ще не
    // завершено, Playwright відхиляє цей проміс. Без обробника це unhandled
    // rejection, який у сучасних Node кладе процес В ОБХІД try/finally нижче —
    // тобто browser.close() не виконується і Chromium лишається сиротою.
    const done = (BLOCKED_RESOURCE_TYPES.includes(type) || BLOCKED_PATTERNS.some(p => url.includes(p)))
      ? route.abort()
      : route.continue();
    return done.catch(() => {});
  });

  let allRows = [];
  let availableCount = 0;

  try {
    console.log(`=== ЕТАП 1: обхід дерева категорій, починаючи з ${START_URL} ===`);
    const productAssignments = new Map();
    const tree = {};
    await crawlTree(page, START_URL, null, 1, [], productAssignments, tree);

    console.log(`Унікальних товарів знайдено на етапі 1: ${productAssignments.size}`);

    const orphanCount = [...productAssignments.values()].filter(a => !a.isLeafCategory).length;
    console.log(`З них товарів-сиріт (прив'язані до проміжної категорії): ${orphanCount}`);
    logEvt('stage1', { id: START_CATEGORY_ID, products: productAssignments.size, orphans: orphanCount });

    console.log(`\n=== ЕТАП 2: збір повних даних по кожному унікальному товару ===`);
    const failedUrls = [];
    const retryLater = [];
    let idx = 0;
    const total = productAssignments.size;
    for (const [id, assignment] of productAssignments) {
      idx++;
      const row = await extractProductData(page, assignment.url, assignment, true);
      if (row) allRows.push(row); else retryLater.push(assignment);
      if (idx % 20 === 0 || idx === total) console.log(`  товарів оброблено: ${idx}/${total}`);
    }

    // Повторний прохід. Збої сайту бувають пачками (18.09.2026 постраждали три
    // СУСІДНІ товари), а ретраї всередині gotoWithRetry розтягнуті лише на
    // ~12 с — пачку вони не переживають. Тому товари, що не вдались, пробуємо
    // ще раз наприкінці, після окремої паузи. Помилкою прогону (logError)
    // стає лише те, що не вдалось і вдруге.
    if (retryLater.length > 0) {
      console.log(`\n  Не вдалось з першого разу: ${retryLater.length} — повторний прохід через ${RETRY_PASS_DELAY_MS / 1000} с`);
      logEvt('retry', { id: START_CATEGORY_ID, msg: `${retryLater.length} товарів не вдалось з першого разу — повторний прохід.`, pending: retryLater.length });
      await sleep(RETRY_PASS_DELAY_MS);
      let recovered = 0;
      for (const assignment of retryLater) {
        const row = await extractProductData(page, assignment.url, assignment, false);
        if (row) { allRows.push(row); recovered++; } else failedUrls.push(assignment.url);
      }
      console.log(`  Повторний прохід: відновлено ${recovered} з ${retryLater.length}`);
      logEvt('retry', { id: START_CATEGORY_ID, msg: `повторний прохід відновив ${recovered} з ${retryLater.length}.`, recovered });
    }

    console.log(`\nВсього товарів зібрано: ${allRows.length}`);
    availableCount = allRows.filter(isAvailableRow).length;
    console.log(`З них "Готово до відправки": ${availableCount}`);
    console.log(`(Порівняйте це число з лічильником "В наявності N" на сайті для рівня 1 — див. лог ЕТАПУ 1 вище)`);

    if (failedUrls.length > 0) {
      console.warn(`Не вдалось обробити ${failedUrls.length} товарів:`, failedUrls);
      fs.writeFileSync(OUTPUT_FAILED, JSON.stringify(failedUrls, null, 2));
    } else if (fs.existsSync(OUTPUT_FAILED)) {
      // Список від попереднього прогону інакше лишився б поруч зі свіжим
      // каталогом і виглядав би як поточні збої.
      fs.unlinkSync(OUTPUT_FAILED);
    }
    logEvt('stage2', { id: START_CATEGORY_ID, got: allRows.length, ready: availableCount, failed: failedUrls.length });

    // ==================== ЕТАП 3: ЗВІРКА І ЗАПИС КАТАЛОГУ ====================
    const chains = buildChainMap(tree);
    const chainOf = id => chains.get(id);
    const crumbSummary = { match: 0, ancestor: 0, descendant: 0, other: 0, unknown: 0 };
    allRows.forEach(r => {
      r.categoryPath = chainOf(r.categoryId) || [];
      r.crumbVerdict = classifyCrumbs(r.crumbIds, r.categoryId, chainOf);
      crumbSummary[r.crumbVerdict]++;
    });
    const crumbOther = allRows.filter(r => r.crumbVerdict === 'other');
    if (crumbOther.length > 0) {
      console.warn(`  Крихти сайту вказують на іншу гілку для ${crumbOther.length} товарів`);
      logWarn(`Крихти вказують на іншу гілку для ${crumbOther.length} товарів.`, {
        items: crumbOther.map(r => ({ name: r.productName || null, url: r.finalUrl }))
      });
    }

    const stats = buildCategoryStats(tree, allRows);
    const root = stats[0] || null;
    const mismatchNodes = stats
      .filter(s => s.diff !== null && s.diff !== 0)
      .map(s => ({ categoryId: s.categoryId, name: s.name, collected: s.ourAvailable, siteCounter: s.siteCounter, diff: s.diff }));

    fs.writeFileSync(OUTPUT_CATALOG, JSON.stringify({
      categoryId: START_CATEGORY_ID,
      categoryName: tree.categoryName || null,
      url: START_URL,
      scrapedAt: new Date().toISOString(),
      tree,
      products: allRows,
      reconciliation: {
        collected: root ? root.ourTotal : allRows.length,
        available: root ? root.ourAvailable : availableCount,
        siteCounter: root ? root.siteCounter : null,
        diff: root ? root.diff : null,
        mismatchNodes
      },
      crumbSummary
    }), "utf-8");
    console.log(`Каталог збережено: ${OUTPUT_CATALOG}`);

    const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
    console.log(`\nГотово за ${elapsedMin} хв! Файл: ${OUTPUT_CATALOG}`);
    // Усе, що треба таблиці прогону, стоїть в одному записі: рядок береться
    // з нього цілком, без збирання по попередніх подіях.
    logEvt('finish', {
      id: START_CATEGORY_ID,
      name: tree.categoryName || null,
      min: +elapsedMin,
      total: allRows.length,
      ready: availableCount,
      failed: failedUrls.length,
      orphans: orphanCount,
      rec: {
        yes: root ? root.ourAvailable : null,
        site: root ? root.siteCounter : null,
        diff: root ? root.diff : null,
        nodes: mismatchNodes.length
      },
      crumbs: crumbSummary,
      errors: runErrors.length
    });
  } catch (fatalErr) {
    const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
    logError(`ФАТАЛЬНА: ${fatalErr && fatalErr.message ? fatalErr.message : fatalErr}`);
    logEvt('finish', { id: START_CATEGORY_ID, aborted: true, min: +elapsedMin, errors: runErrors.length });
    console.error('Скрапінг перервано помилкою:', fatalErr);
    process.exitCode = 1;
  } finally {
    // Пишеться в обох випадках (успіх і ПЕРЕРВАНО) — фатальна помилка теж має
    // бути видною на map.html. Порожній список видаляє файл від минулого
    // прогону, як і <id>_failed_urls.json поруч.
    try {
      if (runErrors.length > 0) fs.writeFileSync(OUTPUT_ERRORS, JSON.stringify(runErrors, null, 2), "utf-8");
      else if (fs.existsSync(OUTPUT_ERRORS)) fs.unlinkSync(OUTPUT_ERRORS);
    } catch (e) {
      console.error('Не вдалось записати список помилок прогону:', e.message);
    }
    await browser.close();
  }
})();

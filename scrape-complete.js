const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ==================== НАЛАШТУВАННЯ ====================
const BASE = "https://cncprom.ua";
const DEFAULT_START_URL = "https://cncprom.ua/ua/g1022952-istochniki-pitaniya-akkumulyatory";
const START_URL = process.argv[2] || DEFAULT_START_URL;
const MAX_DEPTH = 6;
const DELAY_MS = 700;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 6000;
const BREADCRUMB_WAIT_MS = 8000;
// Пауза перед повторним проходом по товарах, що не вдались на ЕТАПІ 2 —
// щоб короткий збій сайту встиг минути (див. кінець ЕТАПУ 2).
const RETRY_PASS_DELAY_MS = 60000;
// Скільки чекати на появу сітки товарів (її малює React уже після
// domcontentloaded). Див. waitForProductGrid — без цього очікування
// категорія тихо отримувала 0 товарів.
const GRID_WAIT_MS = 10000;
const MAX_PAGES_SAFETY = 200;

// Усі згенеровані файли (per-run і спільні) лежать поруч зі скриптом у
// output/site/, не в корені проєкту — прив'язано до __dirname, а не
// process.cwd(), тому поводиться однаково незалежно від того, звідки саме
// викликано `node`. Підпапка "site" (а не просто output/) — бо цей скрипт
// завжди виробляє дані РЕАЛЬНОГО сайту; поряд із часом з'явиться output/new/
// з кураторською таксономією (не звідси, з окремого скрипта, що читає вже
// зібрані дані сайту й перекладає в ту саму форму файлів).
const OUTPUT_DIR = path.join(__dirname, 'output', 'site');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Ім'я файлу починається з ID категорії (не з назви типу файлу) — так усі
// файли однієї категорії стоять поруч один з одним при сортуванні за іменем
// у провіднику/файловому менеджері, замість групування за типом файлу.
const START_CATEGORY_ID = (START_URL.match(/\/g(\d+)-/) || [, "unknown"])[1];
const OUTPUT_CSV = path.join(OUTPUT_DIR, `${START_CATEGORY_ID}_cncprom_complete.csv`);
const OUTPUT_MAP = path.join(OUTPUT_DIR, `${START_CATEGORY_ID}_category_map.json`);
const OUTPUT_FAILED = path.join(OUTPUT_DIR, `${START_CATEGORY_ID}_failed_urls.json`);
const OUTPUT_REPORT = path.join(OUTPUT_DIR, `${START_CATEGORY_ID}_report.md`);

const BLOCKED_PATTERNS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'facebook.net', 'facebook.com/tr', 'connect.facebook.net',
  'ringostat.com', 'hotjar.com', 'criteo.com',
  '/ptrack', '/gatrack', 'advtracking'
];
const BLOCKED_RESOURCE_TYPES = ['image', 'font', 'media', 'stylesheet'];

// ==================== ЛОГ (scrape.log — доповнюється, ніколи не перезаписується) ====================
// Один файл на весь проєкт (не per-категорія, як CSV/JSON/report), бо це історія
// запусків скрапера в часі, а не результат конкретного прогону. Лежить в output/
// разом з рештою згенерованого, а не в корені проєкту.
const LOG_FILE = path.join(OUTPUT_DIR, "scrape.log");
function nowStr() {
  const d = new Date();
  return d.toLocaleDateString('uk-UA') + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function logLine(text) {
  try { fs.appendFileSync(LOG_FILE, `[${nowStr()}] ${text}\n`, "utf-8"); } catch (e) { /* лог не критичний для роботи скрапера */ }
}
const runErrors = [];
function logError(text) {
  runErrors.push(text);
  logLine(`ПОМИЛКА: ${text}`);
}

// ==================== ДОПОМІЖНІ ФУНКЦІЇ ====================
const sleep = ms => new Promise(r => setTimeout(r, ms));

// opts.waitForBreadcrumbs — дочекатися хлібних крихт (етап 2, їх малює React);
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
      if (opts.waitForBreadcrumbs) {
        await page.waitForSelector('[data-qaid="breadcrumbs_item"]', { timeout: BREADCRUMB_WAIT_MS }).catch(() => {});
      }
      return true;
    } catch (e) {
      console.warn(`  Помилка навігації (спроба ${attempt}/${MAX_RETRIES}): ${url} — ${e.message}`);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }
  console.error(`  ПРОПУЩЕНО після ${MAX_RETRIES} спроб: ${url}`);
  if (!opts.silent) logError(`Не вдалось завантажити після ${MAX_RETRIES} спроб: ${url}`);
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

// Тільки справжня сітка товарів категорії — виключає карусельні блоки
// ("Подібні товари компанії" / "Ви переглядали" / "Ми рекомендуємо").
// Повертає кількість знайдених НА СТОРІНЦІ позицій, а не приріст мапи: саме
// вона відрізняє "сторінка порожня" від "усі ці товари вже були в мапі".
async function collectProductsFromCurrentPage(page, mapOut) {
  const items = await page.$$eval(
    'ul.cs-product-gallery > li.cs-product-gallery__item a[href]',
    (as, base) => as
      .map(a => a.getAttribute("href"))
      .filter(href => /\/ua\/p\d+-[^/]*\.html$/i.test(href))
      .map(href => new URL(href, base).href),
    BASE
  ).catch(() => []);
  items.forEach(url => {
    const m = url.match(/\/p(\d+)-/);
    if (m) mapOut.set(m[1], url);
  });
  return items.length;
}

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
// нього 403 вузли × (GRID_WAIT_MS + RETRY_DELAY_MS) додали б до нічного
// прогону кілька годин і вибили б timeout-minutes: 300 у deploy-pages.yml.
// Після такої кількості порожніх сторінок ретраї вимикаються — помилки все
// одно вже в лозі, і прогін має впасти швидко, а не через 6 годин.
const EMPTY_GRID_GIVE_UP = 10;
let emptyGridFailures = 0;

// Жоден з 403 вузлів дерева не має 0 прямих товарів (перевірено на повному
// зрізі сайту): сторінка категорії завжди показує власну сітку, навіть коли
// має підкатегорії. Тому "зібрали 0" — це не валідний стан, а ознака того,
// що сітка не відрендерилась; таку сторінку треба перепробувати, а не
// записати порожнечу як факт.
async function loadListingPage(page, url, mapOut) {
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
  emptyGridFailures++;
  logError(`Сітка товарів порожня після ${attempts} спроб: ${url}`);
  return false;
}

async function getDirectProducts(page, catUrl) {
  const productMap = new Map();
  const baseNoSlash = catUrl.replace(/\/$/, "");

  const ok1 = await loadListingPage(page, catUrl, productMap);
  await sleep(DELAY_MS);
  if (!ok1) return productMap;

  let maxPage = await getPagerMaxPage(page);

  let p = 2;
  while (p <= maxPage) {
    const pageUrl = `${baseNoSlash}/page_${p}`;
    const ok = await loadListingPage(page, pageUrl, productMap);
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
// productAssignments: Map<productId, {url, categoryId, categoryName, level, path}>
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
    logLine(`Категорія: "${name}" (id ${extractCategoryIdFromUrl(url)})`);
  }
  const fullPath = [...path, name];

  const subs = await getSubcategoryLinks(page, url);
  const siteCounter = await getSiteAvailableCounter(page);
  const directProducts = await getDirectProducts(page, url);
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
function readProductPage(page) {
  return page.evaluate(() => {
    const nameEl = document.querySelector('[data-qaid="product_name"]');
    const skuEl = document.querySelector('[data-qaid="product_code"]');
    const availEl = document.querySelector('[data-qaid="presence_data"]');
    const crumbEls = document.querySelectorAll('[data-qaid="breadcrumbs_item"]');
    const breadcrumbs = [...crumbEls].map(el => el.textContent.trim()).filter(t => t.length > 0).join(" > ");
    return {
      productName: nameEl ? nameEl.textContent.trim() : "",
      sku: skuEl ? skuEl.textContent.trim() : "",
      availabilityStatus: availEl ? availEl.textContent.trim() : "",
      breadcrumbs
    };
  }).catch(() => ({ productName: "", sku: "", availabilityStatus: "", breadcrumbs: "" }));
}

// Назва, код і статус товару приходять у HTML одразу з сервером (виміряно:
// усі вже в DOM на domcontentloaded), тож гонки рендеру тут немає — на відміну
// від сітки товарів на етапі 1. Сторінка без назви означає, що прочитано НЕ
// сторінку товару (заглушку/помилку сайту, яку не впіймала перевірка статусу),
// і такий рядок не можна писати в CSV: порожній статус diff сприйме як "зник з
// наявності". Тому — ще одна спроба, а якщо знову без назви — null (товар
// піде в повторний прохід наприкінці ЕТАПУ 2).
// silent: true — перший прохід, невдача ще не рахується помилкою прогону.
async function extractProductData(page, url, assignment, silent = false) {
  let data = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ok = await gotoWithRetry(page, url, { waitForBreadcrumbs: true, silent });
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
    if (silent) console.warn(`  ${msg}`); else logError(msg);
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
    foundAtLevel: assignment.level,
    isOrphan: !assignment.isLeafCategory, // товар прив'язаний до проміжної категорії, не до листка
    availabilityStatus: data.availabilityStatus,
    finalUrl: url,
    baseCategoryPath: assignment.path,
    breadcrumbs: data.breadcrumbs
  };
}

function csvEscape(val) {
  const s = String(val ?? "");
  if (s.includes(";") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCSV(rows) {
  const header = ["productId", "productName", "sku", "categoryId", "categoryName", "foundAtLevel", "isOrphan", "availabilityStatus", "finalUrl", "baseCategoryPath", "breadcrumbs"];
  const lines = [header.join(";")];
  for (const r of rows) lines.push(header.map(h => csvEscape(r[h])).join(";"));
  return lines.join("\n");
}

// ==================== ЕТАП 3: MD-ЗВІТ ЗІ ЗВІРКОЮ ====================
// Звіряє наші зібрані дані з лічильником сайту "В наявності N" на кожному
// вузлі дерева. Для вузла зіставляється не лише його власні прямі товари, а
// увесь піддерево (лічильник сайту на проміжній категорії враховує і
// підкатегорії), тому для звірки збираються categoryId усіх нащадків.
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
  let verdict;
  if (!hasCounter) verdict = "— (лічильник не знайдено)";
  else if (diff === 0) verdict = "✅ збігається";
  else verdict = "⚠️ РОЗБІЖНІСТЬ";

  out.push({ depth, name: node.categoryName, categoryId: node.categoryId, ourTotal, ourAvailable, siteCounter, diff, verdict });
  (node.children || []).forEach(c => buildCategoryStats(c, allRows, depth + 1, out));
  return out;
}

function mdEscape(s) {
  return String(s ?? "").replace(/\|/g, "\\|");
}

function generateReport(tree, allRows) {
  const stats = buildCategoryStats(tree, allRows);
  const root = stats[0];
  const lines = [];

  // Кореня немає у двох випадках: стартова сторінка не завантажилась (дерево
  // лишилось порожнім) або URL не містив /gNNN- і categoryId вийшов порожнім,
  // через що гард у buildCategoryStats відсік корінь. Раніше тут одразу стояв
  // root.ourTotal — тобто TypeError уже ПІСЛЯ запису порожнього CSV на диск, і
  // прогін падав у "ФІНІШ: ПЕРЕРВАНО" замість того, щоб назвати причину.
  if (!root) {
    return [
      `# Звіт по категорії "${(tree && tree.categoryName) || START_URL}"`, "",
      `## ⚠️ Дерево категорій порожнє — звіряти нема чого`, "",
      `Найімовірніша причина: стартова сторінка не завантажилась після ${MAX_RETRIES} спроб,`,
      `або URL не містить фрагмента \`/gNNN-\`, тому з нього не вдалось витягти ID категорії.`, "",
      `- Стартовий URL: ${START_URL}`,
      `- ID категорії: ${START_CATEGORY_ID}`,
      `- Товарів зібрано: ${allRows.length}`, "",
      `Подробиці — у \`scrape.log\` за цей запуск.`, ""
    ].join("\n");
  }

  lines.push(`# Звіт по категорії "${tree.categoryName}"`, "");
  lines.push(`## Підсумок`, "");
  lines.push(`| Зібрано (всього) | "В наявності" за даними скрапера | Лічильник сайту | Різниця | Висновок |`);
  lines.push(`|---|---|---|---|---|`);
  lines.push(`| ${root.ourTotal} | ${root.ourAvailable} | ${root.siteCounter ?? "н/д"} | ${root.diff ?? "—"} | ${root.verdict} |`, "");

  lines.push(`## Звірка по категоріях`, "");
  lines.push(`| Категорія | Всього зібрано | "В наявності" (дані скрапера) | Лічильник сайту | Різниця | Висновок |`);
  lines.push(`|---|---|---|---|---|---|`);
  stats.forEach(s => {
    const indent = "&nbsp;&nbsp;".repeat(s.depth) + (s.depth > 0 ? "↳ " : "");
    lines.push(`| ${indent}${mdEscape(s.name)} | ${s.ourTotal} | ${s.ourAvailable} | ${s.siteCounter ?? "н/д"} | ${s.diff ?? "—"} | ${s.verdict} |`);
  });
  lines.push("");

  const orphans = allRows.filter(r => r.isOrphan);
  lines.push(`## Товари-сироти (${orphans.length})`, "");
  if (orphans.length === 0) {
    lines.push("_Немає._");
  } else {
    lines.push(`Товари, прикріплені напряму до проміжної категорії (не до жодної з її підкатегорій):`, "");
    orphans.forEach(r => {
      lines.push(`- [${mdEscape(r.productName || r.productId)}](${r.finalUrl}) — категорія: \`${mdEscape(r.baseCategoryPath)}\``);
    });
  }
  lines.push("");

  return lines.join("\n");
}

// ==================== ГОЛОВНА ЛОГІКА ====================
(async () => {
  const startTime = Date.now();
  logLine(`СТАРТ: ${START_URL} (категорія ${START_CATEGORY_ID})`);

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

    fs.writeFileSync(OUTPUT_MAP, JSON.stringify(tree, null, 2), "utf-8");
    console.log(`Дерево збережено: ${OUTPUT_MAP}`);
    console.log(`Унікальних товарів знайдено на етапі 1: ${productAssignments.size}`);

    const orphanCount = [...productAssignments.values()].filter(a => !a.isLeafCategory).length;
    console.log(`З них товарів-сиріт (прив'язані до проміжної категорії): ${orphanCount}`);
    logLine(`ЕТАП 1 завершено: унікальних товарів ${productAssignments.size}, сиріт ${orphanCount}.`);

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
      logLine(`ЕТАП 2: ${retryLater.length} товарів не вдалось з першого разу — повторний прохід.`);
      await sleep(RETRY_PASS_DELAY_MS);
      let recovered = 0;
      for (const assignment of retryLater) {
        const row = await extractProductData(page, assignment.url, assignment, false);
        if (row) { allRows.push(row); recovered++; } else failedUrls.push(assignment.url);
      }
      console.log(`  Повторний прохід: відновлено ${recovered} з ${retryLater.length}`);
      logLine(`ЕТАП 2: повторний прохід відновив ${recovered} з ${retryLater.length}.`);
    }

    console.log(`\nВсього товарів зібрано: ${allRows.length}`);
    availableCount = allRows.filter(isAvailableRow).length;
    console.log(`З них "Готово до відправки": ${availableCount}`);
    console.log(`(Порівняйте це число з лічильником "В наявності N" на сайті для рівня 1 — див. лог ЕТАПУ 1 вище)`);

    if (failedUrls.length > 0) {
      console.warn(`Не вдалось обробити ${failedUrls.length} товарів:`, failedUrls);
      fs.writeFileSync(OUTPUT_FAILED, JSON.stringify(failedUrls, null, 2));
    } else if (fs.existsSync(OUTPUT_FAILED)) {
      // Список від попереднього прогону інакше лишився б поруч зі свіжим CSV
      // і виглядав би як поточні збої.
      fs.unlinkSync(OUTPUT_FAILED);
    }
    logLine(`ЕТАП 2 завершено: зібрано ${allRows.length}, "Готово до відправки" ${availableCount}, не вдалось обробити ${failedUrls.length}.`);

    const csv = toCSV(allRows);
    fs.writeFileSync(OUTPUT_CSV, "\uFEFF" + csv, "utf-8");

    const report = generateReport(tree, allRows);
    fs.writeFileSync(OUTPUT_REPORT, report, "utf-8");
    console.log(`\u0417\u0432\u0456\u0442 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E: ${OUTPUT_REPORT}`);

    const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
    console.log(`\nГотово за ${elapsedMin} хв! Файл: ${OUTPUT_CSV}`);
    logLine(`ФІНІШ: успішно за ${elapsedMin} хв. Товарів: ${allRows.length} (в наявності: ${availableCount}). ` +
      (runErrors.length > 0 ? `Помилок за запуск: ${runErrors.length} (див. вище в цьому лозі).` : `Без помилок.`));
  } catch (fatalErr) {
    const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
    logError(`ФАТАЛЬНА: ${fatalErr && fatalErr.message ? fatalErr.message : fatalErr}`);
    logLine(`ФІНІШ: ПЕРЕРВАНО через помилку після ${elapsedMin} хв. Помилок за запуск: ${runErrors.length}.`);
    console.error('Скрапінг перервано помилкою:', fatalErr);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

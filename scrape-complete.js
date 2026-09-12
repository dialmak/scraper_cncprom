const { chromium } = require('playwright');
const fs = require('fs');

// ==================== НАЛАШТУВАННЯ ====================
const BASE = "https://cncprom.ua";
const DEFAULT_START_URL = "https://cncprom.ua/ua/g1022952-istochniki-pitaniya-akkumulyatory";
const START_URL = process.argv[2] || DEFAULT_START_URL;
const MAX_DEPTH = 6;
const DELAY_MS = 700;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 6000;
const BREADCRUMB_WAIT_MS = 8000;
const MAX_PAGES_SAFETY = 200;

const START_CATEGORY_ID = (START_URL.match(/\/g(\d+)-/) || [, "unknown"])[1];
const OUTPUT_CSV = `cncprom_complete_${START_CATEGORY_ID}.csv`;
const OUTPUT_MAP = `category_map_${START_CATEGORY_ID}.json`;
const OUTPUT_FAILED = `failed_urls_${START_CATEGORY_ID}.json`;
const OUTPUT_REPORT = `report_${START_CATEGORY_ID}.md`;

const BLOCKED_PATTERNS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'facebook.net', 'facebook.com/tr', 'connect.facebook.net',
  'ringostat.com', 'hotjar.com', 'criteo.com',
  '/ptrack', '/gatrack', 'advtracking'
];
const BLOCKED_RESOURCE_TYPES = ['image', 'font', 'media', 'stylesheet'];

// ==================== ДОПОМІЖНІ ФУНКЦІЇ ====================
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gotoWithRetry(page, url, waitForBreadcrumbs = false) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (waitForBreadcrumbs) {
        await page.waitForSelector('[data-qaid="breadcrumbs_item"]', { timeout: BREADCRUMB_WAIT_MS }).catch(() => {});
      }
      return true;
    } catch (e) {
      console.warn(`  Помилка навігації (спроба ${attempt}/${MAX_RETRIES}): ${url} — ${e.message}`);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }
  console.error(`  ПРОПУЩЕНО після ${MAX_RETRIES} спроб: ${url}`);
  return false;
}

function extractCategoryIdFromUrl(url) {
  const m = url.match(/\/g(\d+)-/);
  return m ? m[1] : "";
}

async function getSubcategoryLinks(page) {
  return page.$$eval(
    "ul.cs-product-groups-list > li.cs-product-groups-list__item",
    (items, base) => items.map(li => {
      const a = li.querySelector("a.cs-product-groups-list__title") || li.querySelector("a.cs-product-groups-list__image-link");
      return { url: new URL(a.getAttribute("href"), base).href, name: a.textContent.trim() };
    }),
    BASE
  );
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
// ("Подібні товари компанії" / "Ви переглядали" / "Ми рекомендуємо")
async function collectProductsFromCurrentPage(page, mapOut) {
  const items = await page.$$eval(
    'ul.cs-product-gallery > li.cs-product-gallery__item a[href]',
    (as, base) => as
      .map(a => a.getAttribute("href"))
      .filter(href => /\/ua\/p\d+-[^/]*\.html$/i.test(href))
      .map(href => new URL(href, base).href),
    BASE
  );
  items.forEach(url => {
    const m = url.match(/\/p(\d+)-/);
    if (m) mapOut.set(m[1], url);
  });
}

async function getDirectProducts(page, catUrl) {
  const productMap = new Map();
  const baseNoSlash = catUrl.replace(/\/$/, "");

  const ok1 = await gotoWithRetry(page, catUrl);
  await sleep(DELAY_MS);
  if (!ok1) return productMap;

  await collectProductsFromCurrentPage(page, productMap);
  let maxPage = await getPagerMaxPage(page);

  let p = 2;
  while (p <= maxPage) {
    const pageUrl = `${baseNoSlash}/page_${p}`;
    const ok = await gotoWithRetry(page, pageUrl);
    await sleep(DELAY_MS);
    if (ok) {
      await collectProductsFromCurrentPage(page, productMap);
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
  }
  const fullPath = [...path, name];

  const subs = await getSubcategoryLinks(page);
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
async function extractProductData(page, url, assignment) {
  const ok = await gotoWithRetry(page, url, true);
  await sleep(DELAY_MS);
  if (!ok) return null;

  const idMatch = url.match(/\/p(\d+)-/);
  const productId = idMatch ? idMatch[1] : "";

  const data = await page.evaluate(() => {
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
  });

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
  else if (Math.abs(diff) <= 2) verdict = "✅ збігається";
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

  lines.push(`# Звіт по категорії "${tree.categoryName}"`, "");
  lines.push(`## Підсумок`, "");
  lines.push(`| Зібрано (всього) | "В наявності" за нашими даними | Лічильник сайту | Різниця | Висновок |`);
  lines.push(`|---|---|---|---|---|`);
  lines.push(`| ${root.ourTotal} | ${root.ourAvailable} | ${root.siteCounter ?? "н/д"} | ${root.diff ?? "—"} | ${root.verdict} |`, "");

  lines.push(`## Звірка по категоріях`, "");
  lines.push(`| Категорія | Всього зібрано | "В наявності" (наші дані) | Лічильник сайту | Різниця | Висновок |`);
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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.route('**/*', route => {
    const url = route.request().url();
    const type = route.request().resourceType();
    if (BLOCKED_RESOURCE_TYPES.includes(type)) return route.abort();
    if (BLOCKED_PATTERNS.some(p => url.includes(p))) return route.abort();
    route.continue();
  });

  console.log(`=== ЕТАП 1: обхід дерева категорій, починаючи з ${START_URL} ===`);
  const productAssignments = new Map();
  const tree = {};
  await crawlTree(page, START_URL, null, 1, [], productAssignments, tree);

  fs.writeFileSync(OUTPUT_MAP, JSON.stringify(tree, null, 2), "utf-8");
  console.log(`Дерево збережено: ${OUTPUT_MAP}`);
  console.log(`Унікальних товарів знайдено на етапі 1: ${productAssignments.size}`);

  const orphanCount = [...productAssignments.values()].filter(a => !a.isLeafCategory).length;
  console.log(`З них товарів-сиріт (прив'язані до проміжної категорії): ${orphanCount}`);

  console.log(`\n=== ЕТАП 2: збір повних даних по кожному унікальному товару ===`);
  const allRows = [];
  const failedUrls = [];
  let idx = 0;
  const total = productAssignments.size;
  for (const [id, assignment] of productAssignments) {
    idx++;
    const row = await extractProductData(page, assignment.url, assignment);
    if (row) allRows.push(row); else failedUrls.push(assignment.url);
    if (idx % 20 === 0 || idx === total) console.log(`  товарів оброблено: ${idx}/${total}`);
  }

  console.log(`\nВсього товарів зібрано: ${allRows.length}`);
  const availableCount = allRows.filter(isAvailableRow).length;
  console.log(`З них "Готово до відправки": ${availableCount}`);
  console.log(`(Порівняйте це число з лічильником "В наявності N" на сайті для рівня 1 — див. лог ЕТАПУ 1 вище)`);

  if (failedUrls.length > 0) {
    console.warn(`Не вдалось обробити ${failedUrls.length} товарів:`, failedUrls);
    fs.writeFileSync(OUTPUT_FAILED, JSON.stringify(failedUrls, null, 2));
  }

  const csv = toCSV(allRows);
  fs.writeFileSync(OUTPUT_CSV, "\uFEFF" + csv, "utf-8");

  const report = generateReport(tree, allRows);
  fs.writeFileSync(OUTPUT_REPORT, report, "utf-8");
  console.log(`\u0417\u0432\u0456\u0442 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E: ${OUTPUT_REPORT}`);

  const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\nГотово за ${elapsedMin} хв! Файл: ${OUTPUT_CSV}`);

  await browser.close();
})();

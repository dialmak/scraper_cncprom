const { chromium } = require('playwright');
const fs = require('fs');

// ==================== НАЛАШТУВАННЯ ====================
const BASE = "https://cncprom.ua";
const START_URL = "https://cncprom.ua/ua/g1022952-istochniki-pitaniya-akkumulyatory";
const MAX_DEPTH = 6;           // максимальна глибина вкладеності категорій
const DELAY_MS = 700;          // пауза між запитами (навантаження на сервер)
const MAX_RETRIES = 3;         // скільки разів повторити невдалий запит
const RETRY_DELAY_MS = 6000;   // фіксована пауза між повторними спробами
const BREADCRUMB_WAIT_MS = 8000; // скільки чекати появи breadcrumbs у DOM

const OUTPUT_CSV = "cncprom_batteries_products.csv";
const OUTPUT_FAILED = "failed_urls.json";

// Домени/патерни трекерів та аналітики — блокуємо, щоб не гальмували завантаження
const BLOCKED_PATTERNS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'facebook.net', 'facebook.com/tr', 'connect.facebook.net',
  'ringostat.com', 'hotjar.com', 'criteo.com',
  '/ptrack', '/gatrack', 'advtracking'
];

// Типи ресурсів, які не потрібні для парсингу тексту/структури
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

async function getProductUrls(page, catUrl) {
  const urls = new Set();
  let pageNum = 1;
  while (true) {
    const pageUrl = pageNum === 1 ? catUrl : `${catUrl}?page=${pageNum}`;
    const ok = await gotoWithRetry(page, pageUrl, false);
    await sleep(DELAY_MS);
    if (!ok) break;

    const links = await page.$$eval(
      'a[href*="/ua/p"][href$=".html"]',
      (as, base) => as.map(a => new URL(a.getAttribute("href"), base).href),
      BASE
    );
    if (links.length === 0) break;
    links.forEach(u => urls.add(u));

    const hasNext = await page.$$eval(
      "a",
      (as, pn) => as.some(a => a.getAttribute("href")?.includes(`page=${pn + 1}`)),
      pageNum
    );
    if (!hasNext) break;
    pageNum++;
    if (pageNum > 50) break;
  }
  return [...urls];
}

function extractCategoryIdFromUrl(url) {
  const m = url.match(/\/g(\d+)-/);
  return m ? m[1] : "";
}

async function crawlTree(page, url, name, depth = 1, path = []) {
  const fullPath = [...path, name];
  const ok = await gotoWithRetry(page, url, false);
  await sleep(DELAY_MS);
  if (!ok) {
    console.error(`  Не вдалось зайти в категорію: ${name} (${url}) — пропущено`);
    return [];
  }
  const subs = await getSubcategoryLinks(page);

  const leaves = [];
  if (subs.length === 0 || depth >= MAX_DEPTH) {
    leaves.push({
      categoryId: extractCategoryIdFromUrl(url),
      categoryName: name,
      categoryUrl: url,
      baseCategoryPath: fullPath.join(" / ")
    });
  } else {
    for (const s of subs) {
      const childLeaves = await crawlTree(page, s.url, s.name, depth + 1, fullPath);
      leaves.push(...childLeaves);
    }
  }
  return leaves;
}

async function extractProductData(page, url, categoryId, categoryName, baseCategoryPath) {
  const ok = await gotoWithRetry(page, url, true); // тут чекаємо breadcrumbs
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
    categoryId,
    categoryName,
    availabilityStatus: data.availabilityStatus,
    finalUrl: url,
    baseCategoryPath,
    breadcrumbs: data.breadcrumbs
  };
}

function csvEscape(val) {
  const s = String(val ?? "");
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSV(rows) {
  const header = ["productId", "productName", "sku", "categoryId", "categoryName", "availabilityStatus", "finalUrl", "baseCategoryPath", "breadcrumbs"];
  const lines = [header.join(";")];
  for (const r of rows) lines.push(header.map(h => csvEscape(r[h])).join(";"));
  return lines.join("\n");
}

// ==================== ГОЛОВНА ЛОГІКА ====================
(async () => {
  const startTime = Date.now();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Фільтрація зайвих ресурсів — прискорює кожен перехід
  await page.route('**/*', route => {
    const url = route.request().url();
    const type = route.request().resourceType();
    if (BLOCKED_RESOURCE_TYPES.includes(type)) return route.abort();
    if (BLOCKED_PATTERNS.some(p => url.includes(p))) return route.abort();
    route.continue();
  });

  console.log("Крок 1: будую дерево категорій...");
  const leaves = await crawlTree(page, START_URL, "Джерела живлення та акумулятори");
  console.log(`Знайдено ${leaves.length} листкових категорій`);

  const allRows = [];
  const failedUrls = [];
  let leafIdx = 0;
  for (const leaf of leaves) {
    leafIdx++;
    console.log(`[${leafIdx}/${leaves.length}] ${leaf.categoryName}...`);
    const productUrls = await getProductUrls(page, leaf.categoryUrl);
    let prodIdx = 0;
    for (const purl of productUrls) {
      prodIdx++;
      const row = await extractProductData(page, purl, leaf.categoryId, leaf.categoryName, leaf.baseCategoryPath);
      if (row) allRows.push(row); else failedUrls.push(purl);
      if (prodIdx % 10 === 0) console.log(`  товарів оброблено: ${prodIdx}/${productUrls.length}`);
    }
  }

  console.log(`Всього товарів зібрано: ${allRows.length}`);
  if (failedUrls.length > 0) {
    console.warn(`Не вдалось обробити ${failedUrls.length} товарів:`, failedUrls);
    fs.writeFileSync(OUTPUT_FAILED, JSON.stringify(failedUrls, null, 2));
  }

  const csv = toCSV(allRows);
  fs.writeFileSync(OUTPUT_CSV, "\uFEFF" + csv, "utf-8");

  const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`Готово за ${elapsedMin} хв! Файл: ${OUTPUT_CSV}`);

  await browser.close();
})();

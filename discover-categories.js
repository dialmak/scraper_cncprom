// discover-categories.js — читає з головної сторінки cncprom.ua повний список
// категорій 1 рівня (ID, назва, URL) і для кожної робить один швидкий заїзд
// на її кореневу сторінку, щоб оцінити орієнтовний час майбутнього повного
// скрапінгу (scrapingTime, у хвилинах). Результат — output/site/categories-site.csv.
//
// Список категорій 1 рівня не захардкоджений ніде в проєкті (сайт може додати/
// прибрати категорію в будь-який момент) — цей скрипт це і вирішує: перечитує
// його з сайту щоразу заново, а не покладається на список, зафіксований у
// минулому запуску.
//
// Використання:
//   node discover-categories.js
//
// Результат: output/site/categories-site.csv (UTF-8 з BOM, роздільник ";"),
// колонки: number, categoryId, categoryName, categoryUrl, scrapingTime.
// Рядки відсортовані за scrapingTime (від найменшого до найбільшого), а
// number — просто порядковий номер після сортування, 1..N.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = "https://cncprom.ua";
const HOMEPAGE_URL = "https://cncprom.ua/ua/";
// output/site/ — цей скрипт завжди про реальний сайт (немає "custom"-варіанту
// списку категорій 1 рівня, на відміну від render-map.js/build-maps.js нижче).
const OUTPUT_DIR = path.join(__dirname, 'output', 'site');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const OUTPUT_CSV = path.join(OUTPUT_DIR, 'categories-site.csv');

const DELAY_MS = 700;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 6000;

// ==================== КАЛІБРУВАННЯ ОЦІНКИ ЧАСУ (швидкий, приблизний метод) ====================
// Свідомий вибір користувача: швидкий метод (один заїзд на кореневу сторінку
// категорії — без обходу всього дерева) замість точного (повний ЕТАП 1
// scrape-complete.js на кожну категорію, ~30 хв на весь каталог). Ціна цього
// вибору — точність: коефіцієнт нижче калібрований на 9 реально
// відскрапованих категоріях 1 рівня (сесія 2026-09-12) і коливається в них
// від 1.17х до 2.54х (тобто оцінка може помилятись у ~2 рази на окремій
// категорії) — це відомий і прийнятий компроміс, не забутий недогляд.
//   total_products / site_available_counter:
//     1022485→2.54, 1022553→1.35, 1022837→1.80, 1022952→2.32, 1261329→1.55,
//     17662477→1.54, 18556308→1.17, 92857157→1.38, 96572435→2.40
//     середнє ≈ 1.78
// ЕТАП 2 (сторінка кожного товару) — стабільно ~2.6-3.1с/товар на тих самих
// 9 категоріях, середнє 2.85с (розкид лише ~15% — набагато надійніше, тому
// саме ця складова оцінки точна, а не приблизна).
// ЕТАП 1 (обхід дерева) — груба апроксимація через кількість підкатегорій
// 1-го рівня (те, що видно з тієї самої кореневої сторінки безкоштовно):
// ~10.5с/підкатегорію, теж дуже приблизно (розкид 4.5-23с на тих 9 категоріях).
const AVAILABLE_TO_TOTAL_RATIO = 1.78;
const SEC_PER_PRODUCT = 2.85;
const SEC_PER_SUBCATEGORY = 10.5;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gotoWithRetry(page, url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
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

// Той самий селектор, що й getSubcategoryLinks у scrape-complete.js — тут
// застосований на головній сторінці, де він так само видає плитки категорій
// (у цьому випадку — 1 рівня).
async function getLevel1Categories(page) {
  const ok = await gotoWithRetry(page, HOMEPAGE_URL);
  await sleep(DELAY_MS);
  if (!ok) return [];
  return page.$$eval(
    "ul.cs-product-groups-list > li.cs-product-groups-list__item",
    (items, base) => items.map(li => {
      const a = li.querySelector("a.cs-product-groups-list__title") || li.querySelector("a.cs-product-groups-list__image-link");
      if (!a) return null;
      return { url: new URL(a.getAttribute("href"), base).href, name: a.textContent.trim() };
    }).filter(Boolean),
    BASE
  ).catch(() => []);
}

// Один заїзд на кореневу сторінку категорії дає одразу дві безкоштовні цифри:
// кількість підкатегорій (той самий контейнер, що й на головній) і лічильник
// сайту "В наявності N" (та сама регулярка, що й getSiteAvailableCounter в
// scrape-complete.js, з тим самим припущенням: відсутність тексту на успішно
// завантаженій сторінці означає 0, а не "невідомо").
async function probeCategory(page, url) {
  const ok = await gotoWithRetry(page, url);
  await sleep(DELAY_MS);
  if (!ok) return { subCount: null, siteCounter: null };

  const subCount = await page.$$eval(
    "ul.cs-product-groups-list > li.cs-product-groups-list__item", els => els.length
  ).catch(() => 0);

  const siteCounter = await page.evaluate(() => {
    const items = [...document.querySelectorAll('li, label, span')];
    for (const el of items) {
      const m = (el.textContent || "").match(/В наявності\s*(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    return 0;
  }).catch(() => null);

  return { subCount, siteCounter };
}

function estimateMinutes(subCount, siteCounter) {
  if (siteCounter === null || subCount === null) return null;
  const productEstimate = siteCounter * AVAILABLE_TO_TOTAL_RATIO;
  const stage1EstimateSec = subCount * SEC_PER_SUBCATEGORY;
  const totalSec = stage1EstimateSec + productEstimate * SEC_PER_PRODUCT;
  return totalSec / 60;
}

function csvEscape(val) {
  const s = String(val ?? "");
  if (s.includes(";") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.route('**/*', route => {
    const type = route.request().resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(type)) return route.abort();
    route.continue();
  });

  console.log("Зчитую категорії 1 рівня з головної сторінки...");
  const categories = await getLevel1Categories(page);
  console.log(`Знайдено ${categories.length} категорій.\n`);

  const rows = [];
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const id = extractCategoryIdFromUrl(cat.url);
    const { subCount, siteCounter } = await probeCategory(page, cat.url);
    const scrapingTime = estimateMinutes(subCount, siteCounter);
    console.log(`[${i + 1}/${categories.length}] ${cat.name} (${id}) — підкатегорій: ${subCount}, ` +
      `в наявності: ${siteCounter}, оцінка: ${scrapingTime !== null ? scrapingTime.toFixed(1) + ' хв' : 'н/д'}`);
    rows.push({
      id,
      name: cat.name,
      url: cat.url,
      scrapingTimeValue: scrapingTime, // число (для сортування) — null, якщо оцінити не вдалось
      scrapingTime: scrapingTime !== null ? scrapingTime.toFixed(1) : ""
    });
  }

  // Сортування за scrapingTime, від найменшого до найбільшого — так
  // scrape-all-categories.js потім просто йде по стовпцю number 1..N, без
  // жодної власної логіки сортування (і користувач може вручну відредагувати
  // CSV — переставити/видалити рядки/перенумерувати — щоб скрапити не все,
  // а вибірково чи в іншому порядку). Рядки без оцінки (scrapingTimeValue
  // === null) — в кінці, в порядку виявлення на сайті.
  rows.sort((a, b) => {
    if (a.scrapingTimeValue === null && b.scrapingTimeValue === null) return 0;
    if (a.scrapingTimeValue === null) return 1;
    if (b.scrapingTimeValue === null) return -1;
    return a.scrapingTimeValue - b.scrapingTimeValue;
  });

  const header = ["number", "categoryId", "categoryName", "categoryUrl", "scrapingTime"];
  const lines = [header.join(";")];
  rows.forEach((r, i) => lines.push([i + 1, r.id, csvEscape(r.name), r.url, r.scrapingTime].join(";")));
  fs.writeFileSync(OUTPUT_CSV, "﻿" + lines.join("\n"), "utf-8");

  console.log(`\nЗбережено: ${OUTPUT_CSV} (${rows.length} категорій, відсортовано за scrapingTime)`);

  await browser.close();
})();

// scrape-site.js — весь скрапінг сайту одним скриптом: спершу розвідка
// категорій 1 рівня з головної сторінки, потім послідовний прогін
// scrape-complete.js по кожній з них.
//
// Замінив пару discover-categories.js + scrape-all-categories.js (23.09.2026):
// вони завжди запускались підряд і обидва існували лише заради
// categories-site.csv між ними; список категорій тепер
// output/site/categories.json (див. lib/categories.js).
//
// Використання:
//   node scrape-site.js                  розвідка + скрапінг усіх категорій
//   node scrape-site.js --discover-only  лише оновити categories.json
//   node scrape-site.js --skip-discover  скрапити за наявним categories.json
//
// --skip-discover — це сценарій "поправити список і догнати частину": можна
// відредагувати categories.json руками (лишити потрібні рядки, змінити
// number) і прогнати саме їх, не чіпаючи розвідку.

const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const { sleep, blockAssets } = require('./lib/browser');
const { readCategoriesOrExit, writeCategories, filePath } = require('./lib/categories');

const BASE = 'https://cncprom.ua';
const HOMEPAGE_URL = 'https://cncprom.ua/ua/';
const ROOT_DIR = __dirname;
const SITE_DIR = path.join(ROOT_DIR, 'output', 'site');

const DELAY_MS = 700;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 6000;

// Стеля на одну категорію. Найдовша реальна ("Передачі", 96553590) — 33.5 хв,
// тож 90 хв це ~2.7x запасу і водночас гарантія, що зависла категорія не
// з'їсть увесь timeout-minutes: 300 у deploy-pages.yml, лишивши чергу
// недокрученою. Перевищення приходить сюди як res.error від spawnSync.
const CATEGORY_TIMEOUT_MS = 90 * 60 * 1000;

// ==================== ОЦІНКА ЧАСУ (швидкий, приблизний метод) ====================
// Свідомий вибір користувача: швидкий метод (один заїзд на кореневу сторінку
// категорії — без обходу всього дерева) замість точного (повний ЕТАП 1
// scrape-complete.js на кожну категорію, ~30 хв на весь каталог). Ціна цього
// вибору — точність: коефіцієнт нижче калібрований на 9 реально
// відскрапованих категоріях 1 рівня (сесія 2026-09-12) і коливається в них
// від 1.17x до 2.54x (тобто оцінка може помилятись у ~2 рази на окремій
// категорії) — це відомий і прийнятий компроміс, не забутий недогляд.
//   total_products / site_available_counter:
//     1022485->2.54, 1022553->1.35, 1022837->1.80, 1022952->2.32, 1261329->1.55,
//     17662477->1.54, 18556308->1.17, 92857157->1.38, 96572435->2.40
//     середнє ~ 1.78
// ЕТАП 2 (сторінка кожного товару) — стабільно ~2.6-3.1с/товар на тих самих
// 9 категоріях, середнє 2.85с (розкид лише ~15% — саме ця складова оцінки
// надійна, а не приблизна).
// ЕТАП 1 (обхід дерева) — груба апроксимація через кількість підкатегорій
// 1-го рівня (те, що видно з тієї самої кореневої сторінки безкоштовно):
// ~10.5с/підкатегорію, теж дуже приблизно (розкид 4.5-23с на тих 9 категоріях).
const AVAILABLE_TO_TOTAL_RATIO = 1.78;
const SEC_PER_PRODUCT = 2.85;
const SEC_PER_SUBCATEGORY = 10.5;

// ==================== РОЗВІДКА ====================
// Власний gotoWithRetry, простіший за той, що в scrape-complete.js: там
// невдала навігація — це помилка прогону (logError, лічильник у ФІНІШі), тут
// просто "оцінити не вдалось".
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
  const m = String(url || '').match(/\/g(\d+)-/);
  return m ? m[1] : '';
}

// Той самий селектор, що й getSubcategoryLinks у scrape-complete.js — тут
// застосований на головній сторінці, де він так само видає плитки категорій
// (у цьому випадку — 1 рівня). Список категорій 1 рівня не захардкоджений
// ніде в проєкті: сайт може додати/прибрати категорію будь-коли.
async function getLevel1Categories(page) {
  const ok = await gotoWithRetry(page, HOMEPAGE_URL);
  await sleep(DELAY_MS);
  if (!ok) return [];
  return page.$$eval(
    'ul.cs-product-groups-list > li.cs-product-groups-list__item',
    (items, base) => items.map(li => {
      const a = li.querySelector('a.cs-product-groups-list__title') || li.querySelector('a.cs-product-groups-list__image-link');
      if (!a) return null;
      return { url: new URL(a.getAttribute('href'), base).href, name: a.textContent.trim() };
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
    'ul.cs-product-groups-list > li.cs-product-groups-list__item', els => els.length
  ).catch(() => 0);

  const siteCounter = await page.evaluate(() => {
    const items = [...document.querySelectorAll('li, label, span')];
    for (const el of items) {
      const m = (el.textContent || '').match(/В наявності\s*(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    return 0;
  }).catch(() => null);

  return { subCount, siteCounter };
}

function estimateMinutes(subCount, siteCounter) {
  if (siteCounter === null || subCount === null) return null;
  const totalSec = subCount * SEC_PER_SUBCATEGORY + siteCounter * AVAILABLE_TO_TOTAL_RATIO * SEC_PER_PRODUCT;
  return totalSec / 60;
}

async function discover() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await blockAssets(page);
  try {
    console.log('Зчитую категорії 1 рівня з головної сторінки...');
    const found = await getLevel1Categories(page);
    console.log(`Знайдено ${found.length} категорій.\n`);

    const rows = [];
    for (let i = 0; i < found.length; i++) {
      const cat = found[i];
      const id = extractCategoryIdFromUrl(cat.url);
      const { subCount, siteCounter } = await probeCategory(page, cat.url);
      const scrapingTime = estimateMinutes(subCount, siteCounter);
      console.log(`[${i + 1}/${found.length}] ${cat.name} (${id}) — підкатегорій: ${subCount}, ` +
        `в наявності: ${siteCounter}, оцінка: ${scrapingTime !== null ? scrapingTime.toFixed(1) + ' хв' : 'н/д'}`);
      rows.push({
        categoryId: id,
        categoryName: cat.name,
        categoryUrl: cat.url,
        scrapingTime: scrapingTime === null ? null : +scrapingTime.toFixed(1),
      });
    }

    // Сортування за scrapingTime, від найменшого до найбільшого — далі черга
    // просто йде по number 1..N, без жодної власної логіки сортування.
    // Рядки без оцінки — в кінці, в порядку виявлення на сайті.
    rows.sort((a, b) => {
      if (a.scrapingTime === null && b.scrapingTime === null) return 0;
      if (a.scrapingTime === null) return 1;
      if (b.scrapingTime === null) return -1;
      return a.scrapingTime - b.scrapingTime;
    });
    const ordered = rows.map((r, i) => ({
      number: i + 1,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      categoryUrl: r.categoryUrl,
      scrapingTime: r.scrapingTime,
    }));

    if (ordered.length === 0) {
      // Порожній список означає, що розмітка головної змінилась. Перезаписати
      // ним наявний файл — найгірше, що можна зробити: далі впаде вся черга,
      // а потім і знімок.
      console.error('Не знайдено жодної категорії — лишаю попередній categories.json без змін.');
      process.exitCode = 1;
      return null;
    }
    const written = writeCategories(SITE_DIR, ordered);
    console.log(`\nЗбережено: ${written} (${ordered.length} категорій, за оцінкою часу)`);
    return ordered;
  } finally {
    // Без try/finally будь-який кидок між launch() і close() (недоступний для
    // запису файл, зміна розмітки головної) лишає Chromium живим після виходу.
    await browser.close();
  }
}

// ==================== ЧЕРГА ====================
function scrapeAll(queue) {
  console.log(`\nЧерга скрапінгу (${queue.length} категорій, за number з ${path.basename(filePath(SITE_DIR))}):`);
  queue.forEach(r => console.log(`  ${r.number}. ${r.categoryName} (${r.categoryId}) — ${r.scrapingTime == null ? '?' : r.scrapingTime} хв`));

  // spawnSync (не паралельно) — навмисно один прогін scrape-complete.js за
  // раз: паралельні скрапінги того самого сайту небажані (навантаження, і
  // спільний scrape.jsonl має лишатись послідовною історією). Помилка однієї
  // категорії не зупиняє чергу — scrape-complete.js сам логує причину.
  // Один id на всю чергу: кожна категорія — окремий процес, і без цього 23
  // категорії однієї ночі виглядали б у лозі як 23 різні прогони. Передається
  // через середовище; поодинокий запуск scrape-complete.js робить собі свій.
  const runId = process.env.SCRAPE_RUN_ID || new Date().toISOString();
  let ok = 0;
  let failed = 0;
  const failures = [];
  for (let i = 0; i < queue.length; i++) {
    const r = queue[i];
    console.log(`\n=== [${i + 1}/${queue.length}] ${r.categoryName} (${r.categoryId}) ===`);

    // Порожній categoryUrl раніше проходив мовчки й НАЙГІРШИМ чином: argv[2]
    // ставав порожнім рядком, scrape-complete.js брав свій DEFAULT_START_URL і
    // перескрапував зовсім іншу категорію, перезаписуючи її власні файли.
    if (!r.categoryUrl || !/^https?:\/\//i.test(r.categoryUrl)) {
      failed++;
      failures.push(`${r.categoryId} (${r.categoryName}): порожній або некоректний categoryUrl`);
      console.error(`Категорія ${r.categoryId}: некоректний URL "${r.categoryUrl}" — пропускаємо, щоб не скрапити чужу категорію.`);
      continue;
    }

    const res = spawnSync('node', ['scrape-complete.js', r.categoryUrl], {
      cwd: ROOT_DIR, stdio: 'inherit', timeout: CATEGORY_TIMEOUT_MS,
      env: Object.assign({}, process.env, { SCRAPE_RUN_ID: runId }),
    });

    // res.error — це "процес не вдалось запустити взагалі" (немає node в PATH)
    // або "вбито по timeout": status при цьому null, тобто без цієї перевірки
    // такий випадок не відрізнити від звичайної невдачі.
    if (res.error) {
      failed++;
      failures.push(`${r.categoryId} (${r.categoryName}): ${res.error.message}`);
      console.error(`Категорія ${r.categoryId}: процес не завершився штатно — ${res.error.message}`);
    } else if (res.status === 0) {
      ok++;
    } else {
      failed++;
      failures.push(`${r.categoryId} (${r.categoryName}): код виходу ${res.status}${res.signal ? `, сигнал ${res.signal}` : ''}`);
      console.warn(`Категорія ${r.categoryId} завершилась з кодом ${res.status} — продовжуємо чергу далі.`);
    }
  }

  console.log(`\nГотово: ${ok} успішно, ${failed} з помилками, разом ${queue.length}.`);
  if (failures.length > 0) {
    console.error('\nКатегорії з помилками:');
    failures.forEach(f => console.error(`  - ${f}`));
  }

  // Ненульовий код — ЛИШЕ для катастрофічного прогону (не вдалась жодна або
  // впала більшість). Окрема невдала категорія свідомо лишає код 0: інакше
  // крок скрапінгу в deploy-pages.yml падає, і разом з ним зникає весь нічний
  // результат — знімок і деплой — через одну категорію з 23.
  // А от коли впала більшість, продовжувати не можна: generate-snapshot.js
  // запише вкорочений знімок, і сторінка змін оформить це як "видалено ~4000
  // товарів", отруївши базу й на наступний день.
  if (ok === 0 || failed > ok) {
    console.error(`\nКАТАСТРОФІЧНИЙ ПРОГІН: успішних ${ok} з ${queue.length}.`);
    console.error('Зупиняємо конвеєр, щоб зіпсовані дані не потрапили в гілку data.');
    process.exit(1);
  }
}

// ==================== ЗАПУСК ====================
(async () => {
  const args = process.argv.slice(2);
  const discoverOnly = args.includes('--discover-only');
  const skipDiscover = args.includes('--skip-discover');
  const unknown = args.filter(a => !['--discover-only', '--skip-discover'].includes(a));
  if (unknown.length) {
    console.error(`Невідомі аргументи: ${unknown.join(' ')}`);
    console.error('Використання: node scrape-site.js [--discover-only | --skip-discover]');
    process.exit(1);
  }

  let categories = null;
  if (!skipDiscover) {
    categories = await discover();
    if (!categories) return; // розвідка не вдалась — код виходу вже виставлено
  }
  if (discoverOnly) return;

  const list = categories || readCategoriesOrExit(SITE_DIR);
  const queue = [...list].sort((a, b) => (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0));
  scrapeAll(queue);
})().catch(e => { console.error(e.stack || e.message || e); process.exit(1); });

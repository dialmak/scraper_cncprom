// Завантажує в output/site/ дані ОСТАННЬОГО опублікованого нічного прогону з
// GitHub Pages — щоб перебудувати мапи й сторінку змін новим кодом без
// трьохгодинного скрапінгу. Використовується:
//   - deploy-pages.yml у ручному запуску з rebuild_only=true;
//   - локально, щоб оновити застарілий output/site/ до стану сайту.
//
// Завантажує categories.json і для кожної категорії <id>_catalog.json
// (дерево + товари + звірка в одному файлі), а також <id>_errors.json і
// <id>_failed_urls.json, якщо вони є; якщо їх нема — видаляє локальні, щоб не
// лишились чужі. Логи (scrape.jsonl, map.jsonl, scrape.log, map.log) — лише якщо локально їх немає.
//
// node fetch-published.js [pagesUrl]               (за замовчуванням — PAGES_URL нижче)
// node fetch-published.js --logs-only [pagesUrl]   лише логи — для нічного прогону
//
// --logs-only з'явився 26.09.2026 разом із scrape.jsonl: нічний прогін у CI бере
// чистий чекаут із порожнім output/, і без цього кроку лог щоночі починався
// з нуля — історія прогонів була лише на локальній машині. Недоступний сайт тут
// НЕ помилка: історія — бажана, але скрапінг через неї зупинятись не має.

const fs = require('fs');
const path = require('path');

const LOGS_ONLY = process.argv.includes('--logs-only');
const ARGS = process.argv.slice(2).filter(a => a !== '--logs-only');
// Власний домен з 22.09.2026 (Settings → Pages → Custom domain); стара адреса
// dialmak.github.io/scraper_cncprom/ перенаправляє сюди.
const PAGES_URL = (ARGS[0] || 'https://map.cncprom.pp.ua/').replace(/\/?$/, '/');
// Сайт публікує output/site/ у корені (з 22.09.2026); до того все лежало під
// site/. База визначається на старті: корінь, а якщо там нема списку
// категорій — стара розкладка site/.
let BASE = PAGES_URL;
const DIR = path.join(__dirname, 'output', 'site');

async function get(name) {
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// Список категорій: categories.json (з 23.09.2026), із запасним варіантом на
// categories-site.csv — на сайті ще може лежати прогін у старому форматі, і
// саме таким прогоном цей скрипт і підхоплює новий код.
async function getCategoryList() {
  for (const base of [PAGES_URL, PAGES_URL + 'site/']) {
    BASE = base;
    try {
      const buf = await get('categories.json');
      const data = JSON.parse(buf.toString('utf8'));
      const list = Array.isArray(data) ? data : (data.categories || []);
      const ids = list.map(c => String(c.categoryId)).filter(x => /^\d+$/.test(x));
      if (ids.length) { fs.writeFileSync(path.join(DIR, 'categories.json'), buf); return ids; }
    } catch (e) { /* пробуємо CSV нижче */ }
    try {
      const csv = await get('categories-site.csv');
      const ids = csv.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1)
        .map(l => l.split(';')[1]).filter(x => /^\d+$/.test(x || ''));
      if (ids.length) {
        // Перекладаємо на теперішній формат одразу — build-maps.js CSV уже не читає.
        const rows = csv.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean)
          .map(l => l.split(';'))
          .map((c, i) => ({ number: i + 1, categoryId: c[1], categoryName: (c[2] || '').replace(/^"|"$/g, ''), categoryUrl: c[3], scrapingTime: c[4] ? +c[4] : null }))
          .filter(r => /^\d+$/.test(r.categoryId || ''));
        fs.writeFileSync(path.join(DIR, 'categories.json'),
          JSON.stringify({ discoveredAt: new Date().toISOString(), categories: rows }, null, 2), 'utf-8');
        console.log('  (на сайті ще старий categories-site.csv — перекладено в categories.json)');
        return ids;
      }
    } catch (e) { /* спробуємо наступну базу */ }
  }
  throw new Error(`Не знайдено списку категорій ні в ${PAGES_URL}, ні в ${PAGES_URL}site/`);
}

// Логи — append-only історія за всі прогони, а не результат одного. У CI чекаут
// свіжий, output/ порожній — і без цього кроку збірка публікувала сайт із
// порожнім логом, стираючи історію (знайдено 25.09.2026 — користувач побачив
// порожній лог). Тільки коли файла немає: локальну історію перезаписувати
// чужою не можна. Старі текстові scrape.log і map.log — архіви до 26.09.2026:
// їх теж несемо далі, інакше перша ж публікація їх би загубила.
async function fetchLogs() {
  for (const name of ['scrape.jsonl', 'map.jsonl', 'scrape.log', 'map.log']) {
    const lp = path.join(DIR, name);
    if (fs.existsSync(lp)) { console.log(`  ${name}: лишаємо локальний`); continue; }
    try {
      const buf = await get(name);
      fs.writeFileSync(lp, buf);
      console.log(`  ${name}: завантажено (${buf.length} байт)`);
    } catch (e) {
      console.warn(`  ${name}: немає на сайті (${e.message})`);
    }
  }
}

(async () => {
  if (LOGS_ONLY) {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    console.log(`Логи з ${BASE}:`);
    await fetchLogs();
    return;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const ids = await getCategoryList();
  console.log(`${BASE}: категорій ${ids.length}`);

  let ok = 0;
  for (const id of ids) {
    let buf, summary;
    try {
      buf = await get(`${id}_catalog.json`);
      summary = JSON.parse((await get(`${id}_map.summary.json`)).toString('utf8'));
    } catch (e) {
      // Категорія на сайті без мапи (not_scraped/stale) — нема що брати; build-maps
      // покаже для неї заглушку, як і в звичайному прогоні.
      console.warn(`  ${id}: пропущено (${e.message})`);
      continue;
    }
    fs.writeFileSync(path.join(DIR, `${id}_catalog.json`), buf);

    // Побічні файли прогону: є на сайті — беремо, нема — прибираємо локальні.
    const extras = [];
    for (const name of [`${id}_errors.json`, `${id}_failed_urls.json`]) {
      const p = path.join(DIR, name);
      const r = await fetch(BASE + name);
      if (r.ok) { fs.writeFileSync(p, Buffer.from(await r.arrayBuffer())); extras.push(name.replace(`${id}_`, '')); }
      else if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    ok++;
    console.log(`  ${id}: скрапінг ${summary.scraped_at}${extras.length ? ', є ' + extras.join(', ') : ''}`);
  }
  await fetchLogs();

  console.log(`Завантажено категорій: ${ok} з ${ids.length}`);
  if (ok === 0) process.exit(1);
})().catch(e => { console.error(e.message || e); process.exit(1); });

// Завантажує в output/site/ дані ОСТАННЬОГО опублікованого нічного прогону з
// GitHub Pages — щоб перебудувати мапи й сторінку змін новим кодом без
// трьохгодинного скрапінгу. Використовується:
//   - deploy-pages.yml у ручному запуску з rebuild_only=true;
//   - локально, щоб оновити застарілий output/site/ до стану сайту.
//
// Завантажує categories-site.csv і для кожної категорії <id>_catalog.json
// (дерево + товари + звірка в одному файлі), а також <id>_errors.json і
// <id>_failed_urls.json, якщо вони є; якщо їх нема — видаляє локальні, щоб не
// лишились чужі. scrape.log / map.log не чіпає.
//
// node fetch-published.js [pagesUrl]   (за замовчуванням — PAGES_URL нижче)

const fs = require('fs');
const path = require('path');

// Власний домен з 22.09.2026 (Settings → Pages → Custom domain); стара адреса
// dialmak.github.io/scraper_cncprom/ перенаправляє сюди.
const PAGES_URL = (process.argv[2] || 'https://map.cncprom.pp.ua/').replace(/\/?$/, '/');
// Сайт публікує output/site/ у корені (з 22.09.2026); до того все лежало під
// site/. База визначається на старті: корінь, а якщо там нема
// categories-site.csv — стара розкладка site/ (перший прогін після переходу).
let BASE = PAGES_URL;
const DIR = path.join(__dirname, 'output', 'site');

async function get(name) {
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  let csv;
  try { csv = await get('categories-site.csv'); } catch (e) { BASE = PAGES_URL + 'site/'; csv = await get('categories-site.csv'); }
  const ids = csv.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1)
    .map(l => l.split(';')[1]).filter(x => /^\d+$/.test(x || ''));
  if (ids.length === 0) throw new Error('categories-site.csv з Pages не містить жодної категорії');
  fs.writeFileSync(path.join(DIR, 'categories-site.csv'), csv);
  console.log(`${BASE}: категорій ${ids.length}`);

  let ok = 0;
  for (const id of ids) {
    const files = [`${id}_catalog.json`];
    let bufs, summary;
    try {
      bufs = await Promise.all(files.map(get));
      summary = JSON.parse((await get(`${id}_map.summary.json`)).toString('utf8'));
    } catch (e) {
      // Категорія на сайті без мапи (not_scraped/stale) — нема що брати; build-maps
      // покаже для неї заглушку, як і в звичайному прогоні.
      console.warn(`  ${id}: пропущено (${e.message})`);
      continue;
    }
    files.forEach((f, i) => fs.writeFileSync(path.join(DIR, f), bufs[i]));

    // Побічні файли прогону: є на сайті — беремо, нема — прибираємо локальні.
    const extras = [];
    for (const name of [`${id}_errors.json`, `${id}_failed_urls.json`]) {
      const p = path.join(DIR, name);
      const r = await fetch(BASE + name);
      if (r.ok) { fs.writeFileSync(p, Buffer.from(await r.arrayBuffer())); extras.push(name.replace(`${id}_`, '')); }
      else if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    ok++;
    console.log(`  ${id}: скрапінг ${summary.scraped_at} UTC${extras.length ? ', є ' + extras.join(', ') : ''}`);
  }
  console.log(`Завантажено категорій: ${ok} з ${ids.length}`);
  if (ok === 0) process.exit(1);
})().catch(e => { console.error(e.message || e); process.exit(1); });

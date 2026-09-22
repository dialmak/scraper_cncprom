// Завантажує в output/site/ дані ОСТАННЬОГО опублікованого нічного прогону з
// GitHub Pages — щоб перебудувати мапи й сторінку змін новим кодом без
// трьохгодинного скрапінгу. Використовується:
//   - deploy-pages.yml у ручному запуску з rebuild_only=true;
//   - локально, щоб оновити застарілий output/site/ до стану сайту.
//
// Завантажує categories-site.csv і для кожної категорії _category_map.json,
// _cncprom_complete.csv, _report.md (+ _failed_urls.json, якщо є; якщо нема —
// видаляє локальний, щоб не лишився чужий). mtime json/csv виставляється на
// час скрапінгу з опублікованого _map.summary.json (CI працює в UTC) —
// render-map.js бере "Мапа розділу · <дата>" саме з mtime, і без цього мапи
// показували б час завантаження. scrape.log / map.log не чіпає.
//
// node fetch-published.js [pagesUrl]   (за замовчуванням — PAGES_URL нижче)

const fs = require('fs');
const path = require('path');

const PAGES_URL = (process.argv[2] || 'https://dialmak.github.io/scraper_cncprom/').replace(/\/?$/, '/');
const BASE = PAGES_URL + 'site/';
const DIR = path.join(__dirname, 'output', 'site');

async function get(name) {
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// "22.09.2026 00:42" — так render-map.js форматує scraped_at у CI (часовий пояс UTC).
function parseUtc(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(s || '');
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5])) : null;
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const csv = await get('categories-site.csv');
  const ids = csv.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1)
    .map(l => l.split(';')[1]).filter(x => /^\d+$/.test(x || ''));
  if (ids.length === 0) throw new Error('categories-site.csv з Pages не містить жодної категорії');
  fs.writeFileSync(path.join(DIR, 'categories-site.csv'), csv);
  console.log(`${PAGES_URL}: категорій ${ids.length}`);

  let ok = 0;
  for (const id of ids) {
    const files = [`${id}_category_map.json`, `${id}_cncprom_complete.csv`, `${id}_report.md`];
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
    const when = parseUtc(summary.scraped_at);
    files.forEach((f, i) => {
      const p = path.join(DIR, f);
      fs.writeFileSync(p, bufs[i]);
      if (when) fs.utimesSync(p, when, when);
    });
    const fu = `${id}_failed_urls.json`, fuPath = path.join(DIR, fu);
    const r = await fetch(BASE + fu);
    if (r.ok) fs.writeFileSync(fuPath, Buffer.from(await r.arrayBuffer()));
    else if (fs.existsSync(fuPath)) fs.unlinkSync(fuPath);
    ok++;
    console.log(`  ${id}: скрапінг ${summary.scraped_at} UTC${r.ok ? ', є failed_urls' : ''}`);
  }
  console.log(`Завантажено категорій: ${ok} з ${ids.length}`);
  if (ok === 0) process.exit(1);
})().catch(e => { console.error(e.message || e); process.exit(1); });

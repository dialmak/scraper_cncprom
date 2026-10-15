// Перевірка доступності медіа каталогу: чи відкриваються фото галерей, картинки й
// файли в описах, PDF зі «Специфікації», плитки категорій і відео YouTube.
// Працює з уже зібраними каталогами (output/site/<id>_catalog.json), без браузера й
// без скрапінгу; кожна різна адреса перевіряється один раз, хоч би в скількох
// товарах вона стояла.
//
// node check-media.js
//
// Результат — output/site/media-check.json:
//   { checkedAt, results: { <адреса>: { k, s, c, n, since?, size?, etag?, lm?, t? } } }
//   k — вид (image | file | video | link); s — ok | fail | unk; c — код відповіді або
//   причина (ENOTFOUND, timeout…); n — скільки перевірок поспіль адреса не
//   відкривається (0 — відкривається); since — час першої з них.
// fail — відповідь «немає» (404, 410, 403, 401, домену не існує): файл точно не
// відкривається зараз. unk — хостинг не відповів, обмежив частоту, помилка сервера:
// перевірити не вдалося. Недоступним файл вважаємо лише з другої перевірки поспіль
// (n ≥ 2), щоб нічний збій хостингу не давав хибних тривог.
// link — сторінки за посиланнями в описах (16.10.2026): лише ті, що потребують запиту —
// сторонні сайти й товари чи розділи магазину, яких немає в каталозі (collectLinks у
// lib/media.js). Помилку в самій адресі видно без запиту, її сюди не пишемо. Для сторінки
// 401/403 — «не перевірено», а не «немає»: сайти з захистом від ботів так відповідають
// скрипту, а покупцю сторінку показують. t — назва відео з YouTube (oEmbed).
const fs = require('fs');
const path = require('path');
const { readCategoriesOrExit } = require('./lib/categories');
const { collectMedia, collectLinks, knownIds, youtubeId, youtubeCheckUrl, hostOf, isPromHost } = require('./lib/media');

const DIR = path.join(__dirname, 'output', 'site');
const OUT = path.join(DIR, 'media-check.json');
const TIMEOUT_MS = 15000;
const RETRY_TIMEOUT_MS = 30000;
const PER_HOST = 6;      // одночасних запитів до одного хостингу
const PER_HOST_PROM = 12; // сервери Prom витримують більше
const PER_HOST_RETRY = 2; // другий прохід — повільно: ImgBB під навантаженням не встигає відповісти
const TOTAL = 32;        // одночасних запитів усього
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Один запит: GET першого байта (сховище PDF Prom не приймає HEAD), тіло одразу
// закривається. Покупець бачить картинку з cncprom.ua, тож і Referer такий.
async function probe(url, kind, timeout) {
  const target = kind === 'video' ? youtubeCheckUrl(youtubeId(url)) : url;
  try {
    // Відео: oEmbed — маленький JSON з назвою, його читаємо цілим (Range дав би обрізаний).
    const headers = { 'User-Agent': UA, Referer: 'https://cncprom.ua/' };
    if (kind !== 'video') headers.Range = 'bytes=0-0';
    const res = await fetch(target, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    });
    let title;
    if (kind === 'video' && res.ok) { try { title = (await res.json()).title; } catch (e) { /* без назви */ } }
    else if (res.body) res.body.cancel().catch(() => {});
    const st = res.status;
    // Закритий файл Google Drive веде на сторінку входу (200): покупець його не відкриє.
    if (/^accounts\.google\./.test(new URL(res.url || target).host)) return { s: 'fail', c: 'login' };
    const range = res.headers.get('content-range') || '';
    const size = Number((range.match(/\/(\d+)$/) || [])[1]) || (st === 200 ? Number(res.headers.get('content-length')) || 0 : 0);
    const meta = { size: size || undefined, etag: res.headers.get('etag') || undefined, lm: res.headers.get('last-modified') || undefined };
    if (st >= 200 && st < 300) return Object.assign({ s: 'ok', c: st, t: title }, meta);
    if (kind === 'link' && (st === 401 || st === 403)) return { s: 'unk', c: st };
    if ([401, 403, 404, 410].includes(st)) return { s: 'fail', c: st };
    return { s: 'unk', c: st };  // 429, 5xx тощо
  } catch (e) {
    const code = (e.cause && e.cause.code) || (e.name === 'TimeoutError' ? 'timeout' : e.name);
    // Домену не існує — хостинг зник; недійсний сертифікат — браузер покупця картинку
    // теж не покаже. Обидва — не тимчасовий збій.
    if (code === 'ENOTFOUND' || /CERT|TLS/.test(code)) return { s: 'fail', c: code };
    return { s: 'unk', c: code };
  }
}

// Обмеження одночасних запитів: усього й на кожен хостинг.
function makeLimiter(perHostOf) {
  let active = 0;
  const perHost = new Map();
  const queue = [];
  const next = () => {
    for (let i = 0; i < queue.length && active < TOTAL; i++) {
      const job = queue[i];
      const h = perHost.get(job.host) || 0;
      if (h >= perHostOf(job.host)) continue;
      queue.splice(i--, 1);
      active++;
      perHost.set(job.host, h + 1);
      job.run().finally(() => {
        active--;
        perHost.set(job.host, perHost.get(job.host) - 1);
        next();
      });
    }
  };
  return (host, fn) => new Promise((resolve, reject) => {
    queue.push({ host, run: () => fn().then(resolve, reject) });
    next();
  });
}

async function main() {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  const urls = new Map();   // адреса → вид
  const catalogs = [];
  for (const c of readCategoriesOrExit(DIR)) {
    const file = path.join(DIR, c.categoryId + '_catalog.json');
    if (!fs.existsSync(file)) { console.log(`  ${c.categoryId}: немає каталогу, пропускаю`); continue; }
    catalogs.push(JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  const known = knownIds(catalogs);
  for (const cat of catalogs) {
    for (const m of collectMedia(cat)) if (!urls.has(m.url)) urls.set(m.url, m.kind);
    for (const l of collectLinks(cat, known)) if (l.check && !urls.has(l.check)) urls.set(l.check, 'link');
  }
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).results || {}; } catch (e) { /* перша перевірка */ }

  console.log(`Перевірка медіа: ${urls.size} різних адрес`);
  // Перший прохід — швидкий, одна спроба на адресу.
  const first = new Map();
  const okHosts = new Set();
  const fast = makeLimiter(h => isPromHost(h) ? PER_HOST_PROM : PER_HOST);
  let done = 0;
  await Promise.all([...urls].map(([url, kind]) => fast(hostOf(url), async () => {
    const r = await probe(url, kind, TIMEOUT_MS);
    first.set(url, r);
    if (r.s === 'ok') okHosts.add(hostOf(url));
    if (++done % 2000 === 0) console.log(`  ${done} / ${urls.size}`);
  })));
  // Другий прохід — повільно й з довшим очікуванням, для всього, що не відкрилось.
  // Хостинг, який не відкрив жодного файлу й лише мовчить (ipic.su), не чекаємо
  // вдруге: ще 100 очікувань по 30 с нічого не змінять.
  const again = [...first].filter(([url, r]) => r.s !== 'ok' && !(r.s === 'unk' && !okHosts.has(hostOf(url))));
  console.log(`  другий прохід: ${again.length} адрес`);
  const slow = makeLimiter(() => PER_HOST_RETRY);
  await Promise.all(again.map(([url]) => slow(hostOf(url), async () => {
    await sleep(1000);
    first.set(url, await probe(url, urls.get(url), RETRY_TIMEOUT_MS));
  })));

  const results = {};
  for (const [url, r] of first) {
    const kind = urls.get(url);
    const p = prev[url];
    const bad = r.s !== 'ok';
    const rec = { k: kind, s: r.s, c: r.c, n: bad ? (p && p.n ? p.n + 1 : 1) : 0 };
    if (bad) rec.since = p && p.n ? p.since : checkedAt;
    if (r.size) rec.size = r.size;
    if (r.etag) rec.etag = r.etag;
    if (r.lm) rec.lm = r.lm;
    if (r.t) rec.t = r.t;
    results[url] = rec;
  }

  fs.writeFileSync(OUT, JSON.stringify({ checkedAt, results }));
  const sum = {};
  for (const r of Object.values(results)) {
    const k = r.k + ' ' + r.s;
    sum[k] = (sum[k] || 0) + 1;
  }
  console.log(`Готово за ${Math.round((Date.now() - started) / 1000)} с:`, JSON.stringify(sum));
}

main().catch(e => { console.error(e); process.exit(1); });

// Розбір сирого HTML опису в збиранні сайту (build-maps.js, generate-snapshot.js),
// без браузера.
//
// Скрапер зберігає опис таким, як його віддав сайт (рішення користувача 01.10.2026:
// знімок «слово в слово», порівняння ночей до знака). Усе, що з нього виводиться —
// текст, очищений HTML для вікна «Опис», комплект постачання, список супутніх товарів —
// рахується тут, під час збирання. Правила показу міняються без нового скрапінгу, а
// історія в гілці data не «змінюється» від наших правок.
//
// Сам розбір — readDescription з lib/desc-dom.js, той самий код, що писався для
// браузера: тут він виконується над документом jsdom (parse5 розбирає й серіалізує
// HTML за тим самим стандартом, що й Chrome). Перевірка 01.10.2026: на 120 живих
// сторінках результат у браузері й тут збігся до знака. Швидший linkedom дав інший
// HTML у 109 описах зі 119 — не годиться.
//
// jsdom повільний: ~50 мс на опис, майже 4 хв на весь сайт одним потоком. Тому
// parseMany ділить роботу між потоками й тримає кеш на диску (тимчасова тека,
// ключ — версія розбору + адреса + сирий HTML): повторна збірка тим самим кодом і
// знімок дня одразу після збирання нічого не розбирають заново.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { JSDOM } = require('jsdom');
const { readDescription } = require('./desc-dom');

const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
// Версія розбору — відбиток самого коду й версії jsdom: змінились правила чи розбирач
// HTML — кеш не підходить. Вона ж пишеться у знімок дня (поле parser): textHash різних
// версій порівнювати не можна.
const VERSION = sha1(readDescription.toString() + '\n' + require('jsdom/package.json').version).slice(0, 12);
const CACHE_ROOT = path.join(os.tmpdir(), 'cncprom-desc-cache');
const CACHE_DIR = path.join(CACHE_ROOT, VERSION);
const EMPTY = () => ({ text: '', html: '', kit: [], xsell: [] });

// Один документ на потік: створення JSDOM дороге, заміна вмісту — ні.
let dom = null;
let run = null;

// { text, html, kit, xsell } — як readDescription у браузері.
function parseDescription(rawHtml, url) {
  if (typeof rawHtml !== 'string') return null;
  if (!dom) {
    dom = new JSDOM('<!doctype html><html><body><div data-qaid="product_description"></div></body></html>',
      { url: 'https://cncprom.ua/ua/' });
    const w = dom.window;
    // readDescription звертається до document, location, NodeFilter і URL як до
    // глобальних — даємо їх з вікна jsdom.
    run = new Function('document', 'location', 'NodeFilter', 'URL',
      'return (' + readDescription.toString() + ')();').bind(null, w.document, w.location, w.NodeFilter, w.URL);
  }
  // Відносні посилання й картинки розв'язуються від адреси сторінки.
  if (url) dom.reconfigure({ url });
  dom.window.document.querySelector('[data-qaid="product_description"]').innerHTML = rawHtml;
  return run();
}

// Один опис, який не розібрався, не має валити збірку всього сайту й знімок дня:
// порожній результат і рядок у консолі. У кеш такий результат не пишеться.
function parseSafe(rawHtml, url) {
  try { return parseDescription(rawHtml, url); }
  catch (e) {
    console.warn(`Опис не розібрано (${url || 'без адреси'}): ${e.message}`);
    return Object.assign(EMPTY(), { failed: true });
  }
}

// list: [{ key, raw, url }] → Map key → { text, html, kit, xsell }. Порожній raw —
// порожній результат без розбору.
async function parseMany(list) {
  const out = new Map();
  const todo = [];
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Кеш старих версій розбору більше не знадобиться.
  try {
    fs.readdirSync(CACHE_ROOT).filter(d => d !== VERSION)
      .forEach(d => fs.rmSync(path.join(CACHE_ROOT, d), { recursive: true, force: true }));
  } catch (e) { /* кеш — зручність, не результат */ }
  for (const it of list) {
    if (!it.raw) { out.set(it.key, EMPTY()); continue; }
    const file = path.join(CACHE_DIR, sha1((it.url || '') + '\n' + it.raw) + '.json');
    try { out.set(it.key, JSON.parse(fs.readFileSync(file, 'utf-8'))); }
    catch (e) { todo.push({ key: it.key, raw: it.raw, url: it.url, file }); }
  }
  if (!todo.length) return out;
  const save = (it, res) => {
    if (res.failed) { out.set(it.key, EMPTY()); return; }
    out.set(it.key, res);
    try { fs.writeFileSync(it.file, JSON.stringify(res), 'utf-8'); } catch (e) { /* кеш — зручність, не результат */ }
  };
  // Мало роботи — у цьому ж потоці: запуск потоку з jsdom коштує ~0.5 с.
  const threads = todo.length < 60 ? 1 : Math.min(os.availableParallelism ? os.availableParallelism() : os.cpus().length, 8, Math.ceil(todo.length / 30));
  if (threads <= 1) {
    todo.forEach(it => save(it, parseSafe(it.raw, it.url)));
    return out;
  }
  const chunks = Array.from({ length: threads }, () => []);
  todo.forEach((it, i) => chunks[i % threads].push(it));
  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: chunk.map(it => ({ raw: it.raw, url: it.url })) });
    w.once('message', results => { results.forEach((res, i) => save(chunk[i], res)); resolve(); });
    w.once('error', reject);
    w.once('exit', code => { if (code !== 0) reject(new Error(`Потік розбору описів завершився з кодом ${code}`)); });
  })));
  return out;
}

if (!isMainThread && workerData) {
  parentPort.postMessage(workerData.map(it => parseSafe(it.raw, it.url)));
}

module.exports = { parseDescription, parseMany, VERSION };

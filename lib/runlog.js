// Таблиці панелей «Лог скрапінгу» (scrape.jsonl) і «Лог збірки» (map.jsonl) на
// map.html. Записи — по JSON-об'єкту на рядок (див. lib/log.js); числа лежать у
// самому записі, тож розбирати формулювання не треба, і зміна слова в
// повідомленні таблицю не ламає. Стилі .rl-* — у вбудованому <style> build-maps.js.

const { fmtDate, fmtTime } = require('./time');
const { escapeHtmlOuter } = require('./html');
const { ICONS } = require('./icons');

// Прогін = усі записи з одним run. scrape-site.js дає всій черзі один id, тож
// 23 категорії однієї ночі — це один прогін, а не 23. Записи, перенесені з
// текстового лога, run не мають — там прогоном вважається календарна дата.
function groupRuns(events) {
  const byRun = new Map();
  for (const e of events) {
    const key = e.run || e.t.slice(0, 10);
    if (!byRun.has(key)) byRun.set(key, []);
    byRun.get(key).push(e);
  }
  const runs = [];
  for (const [key, evs] of byRun) {
    const cats = new Map();
    const loose = [];
    for (const e of evs) {
      if (!e.id) { loose.push(e); continue; }
      if (!cats.has(e.id)) cats.set(e.id, { id: e.id, notes: [] });
      const c = cats.get(e.id);
      if (e.ev === 'start') c.start = e.t;
      else if (e.ev === 'category') c.name = e.name;
      else if (e.ev === 'stage1') c.orphans = e.orphans;
      else if (e.ev === 'stage2') { c.got = e.got; c.ready = e.ready; c.failed = e.failed; }
      else if (e.ev === 'finish') Object.assign(c, {
        end: e.t, min: e.min, total: e.total, aborted: !!e.aborted,
        ready: e.ready != null ? e.ready : c.ready,
        failed: e.failed != null ? e.failed : c.failed,
        orphans: e.orphans != null ? e.orphans : c.orphans,
        rec: e.rec, crumbs: e.crumbs, errors: e.errors, name: e.name || c.name
      });
      else if (e.ev === 'warn' || e.ev === 'error') c.notes.push({ kind: e.ev, msg: e.msg, items: e.items });
    }
    const list = [...cats.values()].sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
    const times = evs.map(e => e.t).sort();
    runs.push({ key, from: times[0], to: times[times.length - 1], categories: list, loose });
  }
  // Найсвіжіший прогін зверху — його й дивляться; старі лежать нижче згорнутими.
  runs.sort((a, b) => String(b.from).localeCompare(String(a.from)));
  return runs;
}

const sum = (list, f) => list.reduce((n, c) => n + (f(c) || 0), 0);
// У заголовку прогону число буває й одиницею: поодинокий запуск однієї категорії.
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
// Повідомлення без адрес: у таблиці URL лише розтягує рядок (користувач просив
// без URL). Адресу категорії просто забираємо — примітка й так стоїть під рядком
// своєї категорії. Адресу товару замінюємо на «товар <id>», інакше лишилось би
// незрозуміло, який саме. Запис у файлі не змінюється.
const plainMsg = msg => String(msg)
  .replace(/:?\s*https?:\/\/\S*?\/g\d+[^\s)]*/g, '')
  .replace(/https?:\/\/\S*?\/p(\d+)[^\s)]*/g, 'товар $1')
  .replace(/\s*\(?(перший: )?https?:\/\/[^\s)]+\)?/g, '')
  .replace(/:\s*$/, '')
  .trim();
// Записи до 26.09.2026 (перенесені з текстового лога) списку items не мають — адреса
// товару там сидить у самому тексті. Зводимо їх до того ж вигляду, що й нові: фраза без
// адреси + посилання на товар. «Перший: …» у старому рядку про крихти просто прибираємо:
// один товар із кількох у списку читався б як увесь список.
function normalizeNote(n) {
  if (n.items && n.items.length) return { msg: plainMsg(n.msg), items: n.items };
  const msg = String(n.msg || '');
  let m;
  if ((m = msg.match(/^Не вдалось завантажити після (\d+) спроб: (https?:\/\/\S*\/p\d+\S*)/))) {
    return { msg: `Не вдалось завантажити товар після ${m[1]} спроб`, items: [{ url: m[2] }] };
  }
  if ((m = msg.match(/^Сторінка товару без даних.*?(\d+) спроб: (https?:\/\/\S+)/))) {
    return { msg: `Сторінка товару відкрилась без даних після ${m[1]} спроб`, items: [{ url: m[2] }] };
  }
  if ((m = msg.match(/^(Крихти вказують на іншу гілку для \d+ товарів)/))) {
    return { msg: m[1] + '.', items: [] };
  }
  if ((m = msg.match(/^Не вдалось завантажити після (\d+) спроб: https?:\/\/\S*\/g\d+/))) {
    return { msg: `Не вдалось завантажити сторінку категорії після ${m[1]} спроб`, items: [] };
  }
  return { msg: plainMsg(msg), items: [] };
}

// Примітка: фраза, а під нею — по рядку на товар: назва-посилання на сайт.
// Назви може не бути (сторінка не відкрилась, а в сітці її не знайшлось) — тоді
// текстом посилання стає «товар <id>». Зовнішнє посилання — у новій вкладці.
function noteHtml(raw) {
  const n = normalizeNote(raw);
  const items = (n.items || []).map(i => {
    const idm = String(i.url || '').match(/\/p(\d+)-/);
    const label = i.name || (idm ? `товар ${idm[1]}` : 'сторінка');
    return `<div class="rl-item"><a href="${escapeHtmlOuter(i.url)}" target="_blank" rel="noopener">${escapeHtmlOuter(label)}</a></div>`;
  }).join('');
  return `<div class="rl-note"><span class="rl-br">└─</span> ${escapeHtmlOuter(n.msg)}${items}</div>`;
}

const cell = (v, warn) => (v ? `<td class="rl-n${warn ? ' rl-bad' : ''}">${v}</td>` : '<td class="rl-n rl-zero">·</td>');

function runHeadText(run) {
  const cats = run.categories;
  const done = cats.filter(c => c.end);
  return `${fmtDate(new Date(run.from))}  ·  Час скрапінгу ${fmtTime(new Date(run.from))}–${fmtTime(new Date(run.to))}` +
    `  ·  ${cats.length} ${plural(cats.length, 'категорія', 'категорії', 'категорій')}` +
    `  ·  ${sum(done, c => c.total)} ${plural(sum(done, c => c.total), 'товар', 'товари', 'товарів')}` +
    `  ·  ${sum(done, c => c.ready)} готово до відправки`;
}

function runTableHtml(run, mapIds) {
  const rows = run.categories.map(c => {
    const rec = c.rec || {};
    const cr = c.crumbs || {};
    const diff = rec.diff == null ? 0 : rec.diff;
    const dirty = diff || c.errors || c.failed || cr.other || cr.unknown || c.aborted;
    const notes = c.notes.slice();
    if (c.aborted) notes.unshift({ kind: 'error', msg: 'прогін категорії перервано' });
    if (!c.end && !c.aborted) notes.unshift({ kind: 'error', msg: 'категорія не завершилась' });
    // Кожна категорія — свій <tbody>: рядок і примітка під ним підсвічуються разом.
    return `
          <tbody class="rl-grp">
            <tr${dirty ? ' class="rl-dirty"' : ''}>
              <td class="rl-t">${c.start ? fmtTime(new Date(c.start)) : '—'}</td>
              <td class="rl-name">${mapIds && mapIds.has(String(c.id))
                ? `<a class="rl-cat" href="${escapeHtmlOuter(c.id)}_map.html">${escapeHtmlOuter(c.name || c.id)}</a>`
                : escapeHtmlOuter(c.name || c.id)}</td>
              ${cell(c.errors, true)}${cell(c.failed, true)}${cell(diff, true)}${cell(cr.other, true)}${cell(cr.unknown, true)}${cell(c.orphans, false)}
            </tr>` +
      (notes.length ? `
            <tr class="rl-det"><td></td><td colspan="7">${notes
        .map(noteHtml).join('')}</td></tr>` : '') + `
          </tbody>`;
  }).join('');

  const loose = run.loose.filter(e => e.ev === 'warn' || e.ev === 'error');
  const cats = run.categories;
  return `
        <table class="rl-tab">
          <thead><tr>
            <th>Час</th><th>Категорія</th>
            <th class="rl-n">Помилки</th><th class="rl-n">Не<br>оброблено</th><th class="rl-n">Розбіжності<br>звірки</th>
            <th class="rl-n">Не збігається<br>з крихтами</th><th class="rl-n">Крихти без<br>категорії</th><th class="rl-n">Товари поза<br>категоріями</th>
          </tr></thead>
          ${rows}${run.categories.some(c => c.end) ? `
          <tbody class="rl-end">
            <tr><td class="rl-t">${fmtTime(new Date(run.to))}</td><td colspan="7">Фініш скрапінгу</td></tr>
          </tbody>` : ''}
          <tfoot><tr>
            <td></td><td>Разом</td>
            <td class="rl-n">${sum(cats, c => c.errors)}</td><td class="rl-n">${sum(cats, c => c.failed)}</td>
            <td class="rl-n">${sum(cats, c => (c.rec ? c.rec.diff : 0))}</td>
            <td class="rl-n">${sum(cats, c => (c.crumbs ? c.crumbs.other : 0))}</td>
            <td class="rl-n">${sum(cats, c => (c.crumbs ? c.crumbs.unknown : 0))}</td>
            <td class="rl-n">${sum(cats, c => c.orphans)}</td>
          </tr></tfoot>
        </table>${loose.length ? `
        <div class="rl-loose">${loose.map(noteHtml).join('')}</div>` : ''}`;
}

// Найсвіжіший прогін розгорнутий, решта — згорнуті <details>, які працюють без JS.
// opts.mapIds — id категорій, для яких є <id>_map.html: лише їхні назви стають
// посиланнями — категорія зі старого прогону, якої більше немає на сайті, дала б 404.
function runLogHtml(events, opts = {}) {
  const runs = groupRuns(events);
  if (!runs.length) {
    return '<p class="failed-note">Лог порожній: жодного прогону скрапера ще не записано.</p>';
  }
  const blocks = runs.map((run, i) => `
      <details class="rl-run"${i === 0 ? ' open' : ''}>
        <summary>${escapeHtmlOuter(runHeadText(run))}</summary>
        ${runTableHtml(run, opts.mapIds)}
      </details>`).join('');
  return `
      <div class="rl-wrap">${blocks}
      </div>`;
}

// ==================== ЛОГ ЗБІРКИ (map.jsonl) ====================
// Та сама таблиця, що в лога скрапінгу, але рядок — одна збірка сторінок, а
// блок — один день (за Києвом). Колонки (формулювання користувача, 26.09.2026):
// Час · Збірка · Помилки · Оброблено категорій (N з M) · Тривалість · Статус.
// Збій рендеру чи XLSX — це просто помилка, а категорії без свіжої мапи — різниця
// між N і M.
const BUILD_KINDS = { nightly: 'Нічна', rebuild: 'Перезбірка', manual: 'Ручний прогін', local: 'Локальна' };

function groupBuilds(events) {
  const byBuild = new Map();
  for (const e of events) {
    if (!e.build) continue;
    if (!byBuild.has(e.build)) byBuild.set(e.build, { id: e.build, kind: e.kind, errors: [] });
    const b = byBuild.get(e.build);
    if (e.ev === 'build-start') { b.start = e.t; b.total = e.total; }
    else if (e.ev === 'build-finish') Object.assign(b, { end: e.t, total: e.total, ok: e.ok, sec: e.sec, stale: e.stale, noData: e.noData });
    else if (e.ev === 'error') b.errors.push(e.msg);
  }
  const days = new Map();
  for (const b of [...byBuild.values()].sort((x, y) => String(y.start).localeCompare(String(x.start)))) {
    const d = fmtDate(new Date(b.start));
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(b);
  }
  return [...days].map(([date, builds]) => ({ date, builds }));
}

// Статус збірки — ті самі три іконки й слова, що в колонці «Статус» на map.html
// (statusBadgeHtml), але для всієї збірки: найгірше з її категорій. Про мапи, а не про інше —
// збій XLSX показує колонка «Помилки». У записах, перенесених зі старого map.log, складу
// немає — там різниця ok/total читається як «застаріло».
function buildStatusHtml(b) {
  if (b.end == null) return `<span class="count-no" data-tip="Збірка не завершилась.">${ICONS.stale}</span>`;
  const stale = b.stale != null ? b.stale : Math.max(0, b.total - b.ok);
  const noData = b.noData || 0;
  if (stale) return `<span class="count-no" data-tip="Застаріло: для ${stale} ${plural(stale, 'категорії', 'категорій', 'категорій')} мапу не побудовано, замість неї заглушка.">${ICONS.stale}</span>`;
  if (noData) return `<span class="stock-badge neutral" data-tip="Немає даних: ${noData} ${plural(noData, 'категорію', 'категорії', 'категорій')} скрапер ще не обробляв.">${ICONS.nodata}</span>`;
  return `<span class="count-yes" data-tip="Актуально: усі мапи побудовані на базі свіжих даних.">${ICONS.ok}</span>`;
}

function buildLogHtml(events) {
  const days = groupBuilds(events);
  if (!days.length) return '<p class="failed-note">Лог порожній: жодної збірки ще не записано.</p>';
  const blocks = days.map((day, i) => {
    const n = day.builds.length;
    const cats = day.builds[0].total;
    const head = `${day.date}  ·  ${n} ${plural(n, 'збірка', 'збірки', 'збірок')}` +
      (cats != null ? `  ·  ${cats} ${plural(cats, 'категорія', 'категорії', 'категорій')}` : '');
    const rows = day.builds.map(b => {
      const done = b.end != null;
      const short = done && b.ok < b.total;
      const notes = b.errors.slice();
      if (!done) notes.unshift('збірка не завершилась');
      const dirty = notes.length || short;
      return `
          <tbody class="rl-grp">
            <tr${dirty ? ' class="rl-dirty"' : ''}>
              <td class="rl-t">${b.start ? fmtTime(new Date(b.start)) : '—'}</td>
              <td class="rl-name">${escapeHtmlOuter(BUILD_KINDS[b.kind] || b.kind || '—')}</td>
              ${cell(b.errors.length, true)}
              <td class="rl-n${short ? ' rl-bad' : ''}">${done ? `${b.ok} з ${b.total}` : '—'}</td>
              <td class="rl-n">${done ? `${b.sec} сек` : '—'}</td>
              <td class="rl-st">${buildStatusHtml(b)}</td>
            </tr>${notes.length ? `
            <tr class="rl-det"><td></td><td colspan="5">${notes
        .map(m => `<div class="rl-note"><span class="rl-br">└─</span> ${escapeHtmlOuter(m)}</div>`).join('')}</td></tr>` : ''}
          </tbody>`;
    }).join('');
    return `
      <details class="rl-run"${i === 0 ? ' open' : ''}>
        <summary>${escapeHtmlOuter(head)}</summary>
        <table class="rl-tab">
          <thead><tr>
            <th>Час</th><th>Збірка</th><th class="rl-n">Помилки</th><th class="rl-n">Оброблено категорій</th><th class="rl-n">Тривалість</th>
            <th class="rl-st" data-tip="${ICONS.ok} Актуально
${ICONS.stale} Застаріло
${ICONS.nodata} Немає даних">Статус</th>
          </tr></thead>${rows}
        </table>
      </details>`;
  }).join('');
  return `
      <div class="rl-wrap">${blocks}
      </div>`;
}

module.exports = { groupRuns, runLogHtml, runHeadText, plainMsg, normalizeNote, groupBuilds, buildLogHtml };

// Дрібниці для двох скриптів, що піднімають Chromium: scrape-complete.js бере
// sleep і список типів ресурсів (обробник маршрутів у нього свій — він ще й
// ріже трекери), scrape-site.js — sleep і blockAssets.
//
// gotoWithRetry свідомо НЕ тут: у скрапері він рахує помилки прогону через
// logError і має режим silent (перший прохід етапу 2 — ще не остаточна
// невдача), а в розвідці категорій просто повертає false. Спільна сигнатура
// вийшла б складнішою за обидві копії разом.

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Картинки/шрифти/відео/стилі для розбору DOM не потрібні — без них сторінки
// вантажаться помітно швидше й сайт менше навантажується.
const BLOCKED_RESOURCE_TYPES = ['image', 'font', 'media', 'stylesheet'];

// .catch() обов'язковий: відхилений роут під час навігації інакше стає
// unhandled rejection і кладе процес в обхід try/finally у викликача.
function blockAssets(page, types = BLOCKED_RESOURCE_TYPES) {
  return page.route('**/*', route => {
    const done = types.includes(route.request().resourceType()) ? route.abort() : route.continue();
    return done.catch(() => {});
  });
}

module.exports = { sleep, blockAssets, BLOCKED_RESOURCE_TYPES };

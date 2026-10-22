// Версія спільних файлів у посиланні: map-common.css/.js лежать поруч із
// усіма сторінками й змінюються з кожним деплоєм, а HTML і CSS кешуються
// браузером незалежно. 25.09.2026 це вистрілило: стилі меню переїхали з
// вбудованого <style> у map-common.css, і браузер із новим HTML та старим
// (кешованим) CSS показав усі три дропдауни розгорнутими без оформлення.
// Хеш від вмісту, а не час збірки: посилання змінюється лише тоді, коли
// файл справді інший, і нічний прогін не скидає кеш дарма.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Версія за вмістом, який ще тільки буде записано: коли сторінку збирають
// раніше за файл, на який вона посилається (build-reports.js).
function contentVer(content) {
  return '?v=' + crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

function assetVer(file) {
  try {
    return contentVer(fs.readFileSync(file));
  } catch (e) {
    // Файла ще немає (перша збірка без жодної скрапленої категорії) —
    // посилання без версії робоче, просто кешується як раніше.
    return '';
  }
}

// Фавікон (22.10.2026, варіант «Траєкторія» вибрав користувач з макета).
// Файли лежать у static/ і build-maps.js копіює їх у корінь сайту, тож шляхи
// від кореня: так однаково працює і reports/index.html. Версія — від файлу в
// static/: копія в output/site з'являється лише в кінці build-maps.js, пізніше
// за сторінки. ICO — для браузерів без SVG і для запиту /favicon.ico без
// <link> (банери в static/), apple-touch — іконка на телефоні.
const STATIC_DIR = path.join(__dirname, '..', 'static');
function faviconLinks() {
  const v = f => assetVer(path.join(STATIC_DIR, f));
  return `<link rel="icon" href="/favicon.ico${v('favicon.ico')}" sizes="any">
<link rel="icon" href="/favicon.svg${v('favicon.svg')}" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png${v('apple-touch-icon.png')}">`;
}

module.exports = { assetVer, contentVer, faviconLinks };

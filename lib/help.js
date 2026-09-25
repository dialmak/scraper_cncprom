// Довідка як меню-дропдаун: «Що це таке», «Що означають цифри та позначки»
// (панель кожної сторінки своя) і «Подяки». Живе тут, а не в кожному зі
// скриптів-генераторів, бо однакове на трьох сторінках — map.html, мапі
// розділу й історії змін; три копії розійшлись би.
//
// base — префікс шляху до кореня сайту: '' для сторінок у корені,
// '../' для reports/index.html. Логотипи лежать одним набором у logos/.
const fs = require('fs');
const path = require('path');
const { ICONS } = require('./icons');
const { escapeHtmlOuter } = require('./html');

const LOGO_SRC = path.join(__dirname, 'logos');

// Рядок меню без числа — така сама розмітка, як у рядків «Звіту скрапера»
// (.check-row описаний у map-common.css). build-maps.js будує з нього свої
// logRow, щоб розмітка рядка була одна на всі меню.
const menuRow = (icon, name, overlayId, tip) => `
          <div class="check-row">
            <span>${icon}</span><span class="nm"${tip ? ` data-tip="${escapeHtmlOuter(tip)}"` : ''}>${escapeHtmlOuter(name)}</span>
            <span class="val"></span>
            <button class="act" data-open="${overlayId}">відкрити</button>
          </div>`;

// Кнопка «Довідка» в правій групі шапки: дропдаун відкривається вліво
// (.right), інакше вилазить за екран.
const helpMenuHtml = (termsTip) => `
      <div class="hdr-menu">
        <button id="btn-help" class="btn-theme-toggle hdr-menu-btn" data-tip="Про проєкт, пояснення до цифр і подяки">${ICONS.help} Довідка</button>
        <div class="hdr-dropdown right" id="help-dropdown">
          <h3>Опис проєкту, довідка та подяки</h3>
          <div>${menuRow(ICONS.about, 'Навіщо це', 'about-overlay', 'Що це за проєкт і як він працює')}${menuRow(ICONS.legend, 'Що означають цифри та позначки', 'help-overlay', termsTip)}${menuRow(ICONS.credits, 'Про проєкт і подяки', 'credits-overlay', 'Хто зробив і на чому все це зроблено')}
          </div>
        </div>
      </div>`;

const aboutPanelHtml = () => `
  <div class="help-overlay" id="about-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Навіщо це</h3>
        <button class="btn-help-close" id="btn-about-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Цей проєкт збирає дані про товари інтернет-магазину cncprom.ua, й потім створює зручну мапу каталогу та звіти про зміни.</p>
        <div class="help-term">
          <div class="help-term-label">Як формується мапа каталогу магазину cncprom.ua</div>
          <div class="help-term-desc">Щоночі скрапер обходить увесь сайт і складає з нього мапу: які є категорії, що в них лежить, скільки товарів у наявності і що змінилося з учора. Сам магазин такого не показує: там видно окрему категорію, але не каталог цілком.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Скрапер</div>
          <div class="help-term-desc">Програма, яка відкриває сторінки сайту так само, як браузер, і зчитує з них дані. Це справжній браузер без вікна, який ходить по сторінках категорій і товарів. До REST API сайту немає доступу, тож усе зібрано зі сторінок сайту.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Хлібні крихти</div>
          <div class="help-term-desc">Це навігаційний шлях дерева мапи угорі сторінки товару: «Товари та послуги › Категорія › Підкатегорія › Товар». Скрапер порівнює цей шлях з тим, де знайшов товар. Збіг — усе гаразд. Якщо товар в іншій гілці дерева мапи — це сигнал, що десь помилка.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Як працює скрапінг</div>
          <div class="help-term-desc">Спершу обхід дерева категорій з усіма сторінками пагінації. Далі сторінка кожного знайденого товару: назва, код, наявність, хлібні крихти. Наприкінці звірка з самим сайтом і знімок дня, який лишається назавжди, саме з цих знімків будується «Історія змін».</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Звірки</div>
          <div class="help-term-desc">Фіксуються знайдені товари, які не входять до підкатегорій. Реєструються розбіжності звірки «Готово до відправки» з лічильником сайту «В наявності». Виконується звірка хлібних крихт сайту з деревом категорій скрапінгу.</div>
        </div>
      </div>
    </div>
  </div>`;

// Кожна картка — посилання на сайт компонента; зовнішні посилання
// відкриваються в новій вкладці, як і всюди на цих сторінках.
// invert: логотип GitHub чорний, і в темній темі його не видно —
// у map-common.css для нього є інверсія саме в темній.
const CREDITS = [
  { logo: 'nodejs.svg', name: 'Node.js', url: 'https://nodejs.org',
    desc: 'середовище, у якому працює скрапер і збираються ці сторінки' },
  { logo: 'playwright.svg', name: 'Playwright', url: 'https://playwright.dev',
    desc: 'браузер під керуванням програми — ним скрапер ходить по сайту' },
  { logo: 'github.svg', name: 'GitHub', url: 'https://github.com/dialmak/scraper_cncprom', invert: true,
    desc: 'Actions запускає прогін щоночі, Pages роздає готові сторінки, код теж тут' },
  { logo: 'npm.svg', name: 'ExcelJS', url: 'https://github.com/exceljs/exceljs',
    desc: 'npm-пакет, яким пишеться XLSX з мапою категорій' },
  { logo: 'googlefonts.svg', name: 'Google Fonts', url: 'https://fonts.google.com',
    desc: 'шрифти Inter і JetBrains Mono' },
  { logo: 'claude.svg', name: 'Claude Code', url: 'https://claude.com/claude-code',
    desc: 'із ним написано код цього проєкту' }
];

// Картка автора — така сама, як у компонентів, але посилання веде в Viber, а не
// на сайт. viber://chat — штатна схема додатка; на машині без Viber браузер
// просто нічого не відкриє, тому номер написаний текстом — його можна скопіювати.
// target="_blank" тут не ставимо: це не сторінка, а запуск додатка, і порожня
// вкладка після нього виглядала б як помилка.
const AUTHOR = {
  logo: 'support.svg',
  name: 'Остапчук Віктор',
  desc: 'Технічна підтримка cncprom.ua · Viber +380988212590',
  url: 'viber://chat?number=%2B380988212590'
};

const creditsPanelHtml = (base = '') => `
  <div class="help-overlay" id="credits-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Про проєкт і подяки</h3>
        <button class="btn-help-close" id="btn-credits-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <div class="credit-list">
          <a class="credit" href="${AUTHOR.url}">
            <img class="credit-logo" src="${base}logos/${AUTHOR.logo}" alt="" width="30" height="30" loading="lazy">
            <span class="credit-text"><b>${escapeHtmlOuter(AUTHOR.name)}</b><span>${escapeHtmlOuter(AUTHOR.desc)}</span></span>
          </a>
        </div>
        <p class="failed-note">Велика подяка розробникам використаних компонентів</p>
        <div class="credit-list">${CREDITS.map(c => `
          <a class="credit" href="${c.url}" target="_blank" rel="noopener">
            <img class="credit-logo${c.invert ? ' invert' : ''}" src="${base}logos/${c.logo}" alt="" width="30" height="30" loading="lazy">
            <span class="credit-text"><b>${escapeHtmlOuter(c.name)}</b><span>${escapeHtmlOuter(c.desc)}</span></span>
          </a>`).join('')}
        </div>
        <p class="failed-note">Дані зібрані з каталогу магазину cncprom.ua на платформі prom.ua.<br>Проєкт нічого не змінює на сайті, лише читає сторінки, як звичайний відвідувач.</p>
      </div>
    </div>
  </div>`;

// Логотипи копіюються в output/site/logos/ один раз на збірку: вони однакові
// для всіх сторінок, тож лежать окремими файлами, а не вбудовані в кожну з
// двох десятків HTML.
function writeLogos(outDir) {
  const dir = path.join(outDir, 'logos');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(LOGO_SRC)) {
    if (!name.endsWith('.svg')) continue;
    fs.copyFileSync(path.join(LOGO_SRC, name), path.join(dir, name));
  }
}

module.exports = { menuRow, helpMenuHtml, aboutPanelHtml, creditsPanelHtml, writeLogos };

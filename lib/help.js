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
          <h3>Довідка:</h3>
          <div>${menuRow(ICONS.about, 'Що це таке', 'about-overlay', 'Що це за проєкт і як він працює')}${menuRow(ICONS.legend, 'Що означають цифри та позначки', 'help-overlay', termsTip)}${menuRow(ICONS.credits, 'Подяки', 'credits-overlay', 'На чому все це зроблено')}
          </div>
        </div>
      </div>`;

const aboutPanelHtml = () => `
  <div class="help-overlay" id="about-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Що це таке</h3>
        <button class="btn-help-close" id="btn-about-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <div class="help-term">
          <div class="help-term-label">Мапа магазину cncprom.ua</div>
          <div class="help-term-desc">Щоночі програма обходить увесь сайт і складає з нього мапу: які є категорії, що в них лежить, скільки товарів у наявності — і що змінилося з учора. Сам магазин такого не показує: там видно окрему категорію, але не каталог цілком.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Скрапер</div>
          <div class="help-term-desc">Програма, яка відкриває сторінки сайту так само, як браузер, і зчитує з них дані. Тут це справжній браузер без вікна (Playwright), який ходить по сторінках категорій і товарів. API в сайту немає, тож усе зібране — зі сторінок.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Як працює прогін</div>
          <div class="help-term-desc">Спершу обхід дерева категорій — від розділу першого рівня вглиб, з усіма сторінками пагінації. Далі сторінка кожного знайденого товару: назва, код, наявність, хлібні крихти. Наприкінці — звірка з самим сайтом і знімок дня, який лишається назавжди: саме з цих знімків будується «Історія змін».</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Хлібні крихти</div>
          <div class="help-term-desc">Ланцюжок угорі сторінки товару: «Товари та послуги › Розділ › Категорія › Товар». Це шлях, яким сайт сам називає місце товару. Скрапер порівнює його з тим, де знайшов товар: збіг — усе гаразд; інша гілка — сигнал, що десь помилка.</div>
        </div>
        <div class="help-term">
          <div class="help-term-label">Дві звірки</div>
          <div class="help-term-desc">Скільки — власний лічильник сайту «В наявності» проти того, що нарахував скрапер; де — хлібні крихти проти дерева обходу. Обидві живуть у меню «Звірки» на мапі сайту; коли там «немає», перевірка відпрацювала й нічого не знайшла.</div>
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

const creditsPanelHtml = (base = '') => `
  <div class="help-overlay" id="credits-overlay">
    <div class="help-panel">
      <div class="help-panel-head">
        <h3>Подяки</h3>
        <button class="btn-help-close" id="btn-credits-close" data-tip="Закрити (Esc)">✕</button>
      </div>
      <div class="help-panel-body">
        <p class="failed-note">Проєкт стоїть на чужій праці. Ось на чиїй — назва веде на сайт компонента.</p>
        <div class="credit-list">${CREDITS.map(c => `
          <a class="credit" href="${c.url}" target="_blank" rel="noopener">
            <img class="credit-logo${c.invert ? ' invert' : ''}" src="${base}logos/${c.logo}" alt="" width="30" height="30" loading="lazy">
            <span class="credit-text"><b>${escapeHtmlOuter(c.name)}</b><span>${escapeHtmlOuter(c.desc)}</span></span>
          </a>`).join('')}
        </div>
        <p class="failed-note">Дані — з каталогу магазину cncprom.ua на платформі Prom.ua. Проєкт із ними не пов'язаний і нічого не змінює на сайті: лише читає сторінки, як звичайний відвідувач.</p>
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

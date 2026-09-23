// Список категорій 1 рівня — output/site/categories.json.
//
// До 23.09.2026 це був categories-site.csv; CSV пішов разом з
// <id>_cncprom_complete.csv (користувачеві він не потрібен, а парсер CSV
// існував у чотирьох копіях). Формат навмисно простий, щоб список так само
// можна було правити руками перед прогоном: видалити зайві категорії,
// переставити порядок, перенумерувати number — черга скрапінгу йде строго
// за number.
//
// {
//   "discoveredAt": "2026-09-23T19:20:00.000Z",
//   "categories": [
//     { "number": 1, "categoryId": "1270337", "categoryName": "Муфти…",
//       "categoryUrl": "https://cncprom.ua/ua/g1270337-…", "scrapingTime": 8.4 }
//   ]
// }
//
// scrapingTime — орієнтовна оцінка у хвилинах (null, якщо оцінити не вдалось).

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'categories.json';

function filePath(siteDir) { return path.join(siteDir, FILE_NAME); }

// Повертає масив категорій. Приймає і голий масив (якщо файл правили руками
// й лишили тільки список), і повний об'єкт — читачам однаково.
function readCategories(siteDir) {
  const p = filePath(siteDir);
  if (!fs.existsSync(p)) {
    const e = new Error(`Файл не знайдено: ${p}\nСпершу запустіть: node scrape-site.js --discover-only`);
    e.code = 'ENOCATEGORIES';
    throw e;
  }
  const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const list = Array.isArray(data) ? data : (data.categories || []);
  return list.filter(c => c && c.categoryId);
}

// Те саме, але замість винятку — зрозуміле повідомлення й вихід: так поводились
// усі читачі CSV, кожен своєю копією цих трьох рядків.
function readCategoriesOrExit(siteDir) {
  try {
    const list = readCategories(siteDir);
    if (list.length === 0) throw new Error(`${filePath(siteDir)}: жодної категорії`);
    return list;
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

function writeCategories(siteDir, categories) {
  fs.mkdirSync(siteDir, { recursive: true });
  const out = { discoveredAt: new Date().toISOString(), categories };
  fs.writeFileSync(filePath(siteDir), JSON.stringify(out, null, 2), 'utf-8');
  return filePath(siteDir);
}

module.exports = { FILE_NAME, filePath, readCategories, readCategoriesOrExit, writeCategories };

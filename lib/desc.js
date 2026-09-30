// Опис товару для перегляду на сайті (кнопка «Опис» у таблицях товарів і в
// результатах пошуку). Одне правило «чи є що показати» для render-map.js
// (CATALOG_DATA) і build-maps.js (search-index.json, файли desc/<id>.json).
//
// Опис ~20–25 МБ на весь сайт, тож він не йде ні в сторінку, ні в індекс пошуку:
// там лише id товару в полі `desc`, а сам текст — окремим файлом на товар, який
// браузер завантажує лише при кліку.

// Каталог, зібраний до 30.09.2026, опису не має зовсім (поля немає) — тоді й
// кнопки немає. '' без характеристик — опису на сайті справді немає.
function hasDescription(p) {
  return typeof p.description === 'string' && (p.description !== '' || (p.attrs || []).length > 0);
}

function descriptionJson(p) {
  return JSON.stringify({
    id: String(p.productId),
    code: p.sku || '',
    name: p.productName || '',
    url: p.finalUrl || '',
    description: p.description || '',
    attrs: p.attrs || []
  });
}

module.exports = { hasDescription, descriptionJson };

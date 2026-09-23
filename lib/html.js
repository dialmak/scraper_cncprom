// Екранування для HTML, який збирається на боці Node (render-map.js,
// build-maps.js). Клієнтський код має власні escapeHtml/escapeAttr у
// map-common.js — там вони серіалізуються через .toString() і не можуть
// require() цей модуль.
//
// Апостроф свідомо НЕ екранується: у назвах категорій і товарів він
// трапляється постійно ("Муфти з'єднувальні"), а всі місця вставки — або
// текст, або атрибут у подвійних лапках, де він безпечний. Екранування дало б
// &#39; у сотнях рядків без жодного виграшу.
function escapeHtmlOuter(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { escapeHtmlOuter };

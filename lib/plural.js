// Відмінювання іменника після числа: 1 товар, 2 товари, 5 товарів (11–14 —
// завжди «багато»). Одна копія на весь проєкт — раніше їх було дві однакові,
// у lib/runlog.js і в build-maps.js.
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

module.exports = { plural };

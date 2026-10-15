// Локальний сервер для перегляду зібраного сайту (output/site/) у браузері.
// Сторінки беруть дані через fetch() (пошук, описи, «Історія змін»), тож з
// file:// вони не працюють — потрібен http. Лише для локального перегляду:
// слухає 127.0.0.1, кеш вимкнено, щоб після перебудови було видно нове.
//
// node serve.js [порт]   → http://127.0.0.1:8080/map.html
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'output', 'site');
const PORT = Number(process.argv[2]) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jsonl': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DIR, rel);
  // Не віддаємо нічого поза output/site/ (../ в адресі).
  if (!file.startsWith(DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Немає файлу: ' + rel); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('Сайт: http://127.0.0.1:' + PORT + '/map.html  (Ctrl+C — зупинити)');
});

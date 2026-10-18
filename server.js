// Сервер без зависимостей (только встроенный Node.js). Запуск: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const PW = process.env.ADMIN_PASSWORD || 'onbadmin123';
const PORT = process.env.PORT || 3000;
const TOKEN = crypto.createHash('sha256').update('kahoot:' + PW).digest('hex');
const FILE = path.join(__dirname, 'data.json');
let store = {};
const clients = new Set(); let timer;
// Постоянное хранение: если заданы UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN (бесплатная Redis на upstash.com),
// данные лежат там и переживают перезапуски хостинга. Иначе — файл data.json.
const RURL = process.env.UPSTASH_REDIS_REST_URL, RTOK = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = cmd => fetch(RURL, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK }, body: JSON.stringify(cmd) }).then(r => r.json());
const save = () => { clearTimeout(timer); timer = setTimeout(() => {
  const s = JSON.stringify(store);
  if (RURL) redis(['SET', 'kahoot', s]).catch(e => console.error('Redis:', e.message));
  else fs.writeFile(FILE, s, () => {});
}, RURL ? 1500 : 300); };
async function load() {
  try {
    if (RURL) { const r = await redis(['GET', 'kahoot']); if (r.result) store = JSON.parse(r.result); }
    else store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) { console.error('Не удалось загрузить данные:', e.message); }
  console.log('Хранилище: ' + (RURL ? 'Upstash Redis' : 'файл data.json') + ', документов: ' + Object.keys(store).length);
}
const secret = p => p.startsWith('quizzes/');           // квизы с правильными ответами видит только админ
const push = (c, ev) => c.res.write('data:' + JSON.stringify(ev) + '\n\n');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), u = url.pathname;
  if (req.method === 'GET' && u === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const c = { res, a: url.searchParams.get('t') === TOKEN }; clients.add(c);
    for (const [p, d] of Object.entries(store)) if (!secret(p) || c.a) push(c, { p, d });
    push(c, { ready: 1 });
    const ping = setInterval(() => res.write(':\n\n'), 20000);
    req.on('close', () => { clients.delete(c); clearInterval(ping); });
    return;
  }
  if (req.method === 'POST') {
    let b = ''; req.on('data', x => { b += x; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let j; try { j = JSON.parse(b); } catch (e) { res.statusCode = 400; return res.end(); }
      if (u === '/login') {
        if (j.pw === PW) return res.end(JSON.stringify({ t: TOKEN }));
        res.statusCode = 401; return res.end();
      }
      if (u === '/op') {
        const admin = req.headers['x-token'] === TOKEN, { op, p, d } = j;
        const own = typeof p === 'string' && /^players\/[\w-]{8,40}$/.test(p);
        if (!admin && !own) { res.statusCode = 403; return res.end(); }
        if (!/^[\w\/-]{1,100}$/.test(p)) { res.statusCode = 400; return res.end(); }
        if (op === 'set' || op === 'update') {
          let v = d || {};
          if (!admin) v = { name: String(v.name || '').slice(0, 16), qi: v.qi | 0, ch: v.ch | 0, ms: v.ms | 0 };
          store[p] = op === 'set' ? v : Object.assign(store[p] || {}, v);
        } else if (op === 'delete') delete store[p];
        else { res.statusCode = 400; return res.end(); }
        const ev = { p, d: store[p] === undefined ? null : store[p] };
        for (const c of clients) if (!secret(p) || c.a) push(c, ev);
        save(); return res.end('{}');
      }
      res.statusCode = 404; res.end();
    });
    return;
  }
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res);
  }
  res.statusCode = 404; res.end('Not found');
});
const start = () => server.listen(PORT, () => {
  console.log('Kahoot-клон запущен:  http://localhost:' + PORT);
  for (const l of Object.values(os.networkInterfaces()).flat())
    if (l.family === 'IPv4' && !l.internal) console.log('Для телефонов в той же Wi‑Fi:  http://' + l.address + ':' + PORT);
});
load().then(start);

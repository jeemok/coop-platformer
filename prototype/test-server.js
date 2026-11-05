// End-to-end over real WebSockets: level choice (creator picks start level, only the host can switch).
const assert = require('assert'), http = require('http'), WebSocket = require('ws');
const { LEVELS } = require('./levels');
const PORT = 3900 + Math.floor(Math.random() * 90);
process.env.PORT = String(PORT);
const { spawn } = require('child_process');
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));
function client(room, nick, level) {
  const c = { lvls: [], ws: new WebSocket('ws://127.0.0.1:' + PORT) };
  c.ws.on('open', () => c.ws.send(JSON.stringify({ t: 'join', room, nick, level })));
  c.ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'lvl') c.lvls.push(m.n); });
  return c;
}
let ok = 0; const check = (name, fn) => { try { fn(); console.log('  ok  ', name); ok++; } catch (e) { console.error('  FAIL', name, '-', e.message); process.exitCode = 1; } };
(async () => {
  for (let i = 0; i < 40; i++) { try { await get('/levels.json'); break; } catch { await sleep(100); } }
  console.log('Level selection over real WebSockets:');
  const list = JSON.parse(await get('/levels.json'));
  check('/levels.json lists every level', () => assert.strictEqual(list.length, LEVELS.length));
  const a = client('SEL1', 'host', 4); await sleep(200);
  check('room creator picks the start level', () => assert.deepStrictEqual(a.lvls, [5]));
  const b = client('SEL1', 'guest', 0); await sleep(200);
  check('a guest joining sees the room\'s current level (their pick is ignored)', () => assert.deepStrictEqual(b.lvls, [5]));
  b.ws.send(JSON.stringify({ t: 'go', l: 1 })); await sleep(200);
  check('a guest cannot change the level', () => assert.deepStrictEqual(a.lvls, [5]));
  a.ws.send(JSON.stringify({ t: 'go', l: 7 })); await sleep(200);
  check('the host can switch level and everyone gets it', () => { assert.deepStrictEqual(a.lvls, [5, 8]); assert.deepStrictEqual(b.lvls, [5, 8]); });
  a.ws.send(JSON.stringify({ t: 'go', l: 99 })); a.ws.send(JSON.stringify({ t: 'go', l: -1 })); a.ws.send(JSON.stringify({ t: 'go', l: 'x' })); await sleep(200);
  check('out-of-range level requests are ignored', () => assert.deepStrictEqual(a.lvls, [5, 8]));
  console.log(`\n${ok} checks passed${process.exitCode ? ' (with FAILURES)' : ''}`);
  srv.kill(); process.exit(process.exitCode || 0);
})();

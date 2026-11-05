// Local mode: run the game on THIS computer so phones on the same wifi connect straight to it (no internet round trip,
// so the controls feel instant). Usage: npm run local   (or: PORT=3000 node local.js)
const { spawn } = require('child_process');
const PORT = +process.env.PORT || 3000;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
let opened = false;
server.stdout.on('data', d => {
  process.stdout.write(d);
  if (opened || !/Server running/.test(String(d))) return; opened = true;
  setTimeout(() => {
    const ips = require('./server').lanAddrs();
    console.log('\n  LOCAL MODE');
    console.log('  1. Keep this window open. Your laptop and phones must be on the SAME wifi.');
    console.log('  2. The game opens in your browser: it is the shared screen, with a QR code.');
    console.log('  3. Phones scan the QR code and hold the phone sideways.');
    if (!ips.length) console.log('  (No wifi/LAN address found: connect to a network first.)');
    else console.log(`  If a phone cannot scan: type  http://${ips[0]}:${PORT}/pad  in its browser.\n`);
    if (process.env.NO_OPEN) return;
    const url = `http://localhost:${PORT}/?mode=party&auto=1`;
    const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
    try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => console.log('  Open this on the laptop: ' + url)).unref(); } catch { console.log('  Open this on the laptop: ' + url); }
  }, 300);
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { server.kill(); process.exit(0); });
server.on('exit', c => process.exit(c || 0));

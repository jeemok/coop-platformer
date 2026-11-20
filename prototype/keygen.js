// Make Party Pack keys to email to buyers:  KEY_SECRET=... npm run key -- 3
const { makeKey } = require('./license');
const n = Math.max(1, Math.min(50, parseInt(process.argv[2], 10) || 1));
try { for (let i = 0; i < n; i++) console.log(makeKey(process.env.KEY_SECRET)); }
catch (e) { console.error(e.message + '. Use the same KEY_SECRET as the server (Render > Environment).'); process.exit(1); }

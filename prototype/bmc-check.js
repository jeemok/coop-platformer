// Look at what Buy Me a Coffee's Extras API really returns (field names only, no values):
//   BMC_TOKEN=... npm run bmc-check
const base = (process.env.BMC_API || 'https://developers.buymeacoffee.com/api/v1').replace(/\/+$/, '');
if (!process.env.BMC_TOKEN) { console.error('Set BMC_TOKEN first'); process.exit(1); }
fetch(base + '/extras?page=1', { headers: { Authorization: 'Bearer ' + process.env.BMC_TOKEN, Accept: 'application/json' } }).then(async r => {
  console.log('HTTP', r.status); const j = await r.json().catch(() => null); if (!j) return console.log('(not JSON)');
  const shape = (o, d = 0) => o && typeof o === 'object' ? (Array.isArray(o) ? '[' + (o.length ? shape(o[0], d + 1) : '') + ']' : '{' + Object.entries(o).map(([k, v]) => k + (d < 3 ? ':' + shape(v, d + 1) : '')).join(', ') + '}') : typeof o;
  console.log(shape(j));
}).catch(e => console.error(e.message));

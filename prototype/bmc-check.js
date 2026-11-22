// Look at what Buy Me a Coffee's Extras API really returns (field names only, no values):
//   BMC_TOKEN=... npm run bmc-check
const base = (process.env.BMC_API || 'https://developers.buymeacoffee.com/api/v1').replace(/\/+$/, '');
if (!process.env.BMC_TOKEN) { console.error('Set BMC_TOKEN first'); process.exit(1); }
fetch(base + '/extras?page=1', { headers: { Authorization: 'Bearer ' + process.env.BMC_TOKEN, Accept: 'application/json' } }).then(async r => {
  console.log('HTTP', r.status); const j = await r.json().catch(() => null); if (!j) return console.log('(not JSON)');
  const shape = (o, d = 0) => o && typeof o === 'object' ? (Array.isArray(o) ? '[' + (o.length ? shape(o[0], d + 1) : '') + ']' : '{' + Object.entries(o).map(([k, v]) => k + (d < 3 ? ':' + shape(v, d + 1) : '')).join(', ') + '}') : typeof o;
  console.log(shape(j));
  if (typeof j.error === 'string') console.log('error message:', j.error.slice(0, 300));
  console.log('paging:', JSON.stringify(Object.fromEntries(['current_page', 'last_page', 'per_page', 'total', 'next_page_url'].filter(k => k in j).map(k => [k, j[k]]))));
  const items = Array.isArray(j.data) ? j.data : Array.isArray(j) ? j : [];
  const dates = o => Object.entries(o || {}).filter(([k, v]) => /(date|created|updated|time|_at)$/i.test(k) && (typeof v === 'string' || typeof v === 'number')).map(([k, v]) => k + '=' + v);
  if (items.length) { console.log('first item dates:', dates(items[0]).join(' ')); console.log('last item dates: ', dates(items[items.length - 1]).join(' ')); console.log('(if the first date is older than the last, the list is oldest-first and new buyers may fall past the 10-page cap)'); }
}).catch(e => console.error(e.message));

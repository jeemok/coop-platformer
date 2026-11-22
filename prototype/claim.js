// "Claim your key" after a Buy Me a Coffee purchase, with no email sending and no database:
// the buyer types the email they paid with, we look it up in the creator's Extras purchases through
// Buy Me a Coffee's read-only API (BETA), and if there is a matching, non-refunded Party Pack purchase
// we hand back a key derived from that email. Env: BMC_TOKEN (API token), KEY_SECRET, BMC_EXTRA_TITLE
// (default "Party Pack"), BMC_API (default https://developers.buymeacoffee.com/api/v1).
// The response shape of the Extras API is not documented publicly, so fields are read defensively and the
// field NAMES of the first item are logged once (never values) to make a wrong guess easy to fix.
const { makeKey } = require('./license');
let fetchImpl = (...a) => fetch(...a);
const MAX_PAGES = 10;
const normEmail = e => String(e || '').trim().toLowerCase().slice(0, 200);
let logged = false;

const emailOf = p => normEmail(p.supporter_email || p.payer_email || p.email || (p.supporter && p.supporter.email) || (p.payer && p.payer.email));
const titlesOf = p => {
  const t = [];
  // the real API gives `extra` as an object whose title field name is not documented, so read every text value in it
  for (const x of [].concat(p.extras || [], p.extra || [], p.items || [])) if (x) { if (typeof x === 'string') t.push(x); else for (const v of Object.values(x)) if (typeof v === 'string') t.push(v); }
  for (const k of ['extra_title', 'title', 'item_title', 'name']) if (typeof p[k] === 'string') t.push(p[k]);
  return t.map(s => s.toLowerCase());
};
const refunded = p => [p.refunded, p.is_refunded, p.purchase_is_revoked, p.is_revoked, p.revoked].some(v => v === true || v === 'true' || v === 1 || v === '1') || ['refunded', 'revoked', 'canceled', 'cancelled'].includes(String(p.status || '').toLowerCase());
const itemsOf = j => Array.isArray(j) ? j : Array.isArray(j && j.data) ? j.data : Array.isArray(j && j.results) ? j.results : [];

// -> { key } | { notFound: true } | { error: '...' }
async function claim(emailRaw) {
  const token = process.env.BMC_TOKEN, secret = process.env.KEY_SECRET;
  if (!token || !secret) return { error: 'off' };
  const email = normEmail(emailRaw); if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { error: 'bad' };
  const want = (process.env.BMC_EXTRA_TITLE || 'Party Pack').toLowerCase(), base = (process.env.BMC_API || 'https://developers.buymeacoffee.com/api/v1').replace(/\/+$/, '');
  try {
    // Order of the list is not documented. Scan page 1, then (if there are more pages than the cap) the LAST pages
    // counting down, so the newest buyers are reached whether the API lists oldest or newest first.
    let last = 1, order = [1];
    for (let i = 0; i < order.length; i++) {
      const page = order[i];
      const res = await fetchImpl(base + '/extras?page=' + page, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) { console.error('claim: Buy Me a Coffee API answered', res.status); return { error: 'api' }; }
      const j = await res.json(), items = itemsOf(j);
      if (!logged && items[0] && typeof items[0] === 'object') { logged = true; const e = items[0].extra; console.log('claim: first extras item has fields:', Object.keys(items[0]).join(','), '| list keys:', Object.keys(j || {}).join(','), '| extra fields:', e && typeof e === 'object' ? Object.keys(e).join(',') : typeof e); }
      if (page === 1) {
        last = Math.max(1, parseInt(j && j.last_page, 10) || 1);
        if (last > 1) { const rest = []; if (last <= MAX_PAGES) for (let q = 2; q <= last; q++) rest.push(q); else for (let q = last; q > last - (MAX_PAGES - 1); q--) rest.push(q); order = order.concat(rest); }
      }
      for (const p of items) if (p && emailOf(p) === email && !refunded(p) && titlesOf(p).some(t => t.includes(want))) return { key: makeKey(secret, email) };
      if (!items.length && page === 1) break;
    }
    return { notFound: true };
  } catch (e) { console.error('claim: lookup failed:', e.message); return { error: 'api' }; }
}
module.exports = { claim, _setFetch: f => { fetchImpl = f; logged = false; } };

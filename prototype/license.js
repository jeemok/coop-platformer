// Paid "party pack" unlock (host pays, room cap 5 -> 10). A key is checked against Lemon Squeezy's public
// license-validation endpoint (no secret needed), and/or a static list in UNLOCK_KEYS (comma separated, for
// manual sales and testing). Env: LS_PRODUCT_ID (strongly recommended: only keys for that product count).
const STATIC_KEYS = () => new Set((process.env.UNLOCK_KEYS || '').split(',').map(s => s.trim()).filter(Boolean));
const cache = new Map(); // key -> expiry ms (valid keys only)
let fetchImpl = (...a) => fetch(...a);

async function check(key) {
  key = String(key || '').trim().slice(0, 100);
  if (!key) return false;
  if (STATIC_KEYS().has(key)) return true;
  if (cache.get(key) > Date.now()) return true;
  if (!process.env.LS_PRODUCT_ID) return false; // no provider configured
  try {
    const res = await fetchImpl('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ license_key: key }), signal: AbortSignal.timeout(6000),
    });
    const j = await res.json();
    const ok = !!(j && j.valid && j.license_key && j.license_key.status === 'active' && j.meta && String(j.meta.product_id) === String(process.env.LS_PRODUCT_ID));
    if (ok) cache.set(key, Date.now() + 10 * 60 * 1000);
    return ok;
  } catch { return false; }
}
module.exports = { check, _setFetch: f => { fetchImpl = f; cache.clear(); } };

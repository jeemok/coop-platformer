// Paid "party pack" unlock (host pays, room cap 5 -> 10). A key is checked against Polar's public
// customer-portal validation endpoint (no secret or token needed), and/or a static list in UNLOCK_KEYS
// (comma separated, for manual sales and testing).
// Env: POLAR_ORG_ID (required to enable Polar), POLAR_BENEFIT_ID (strongly recommended: only keys from that
// License Key benefit count), POLAR_API (default https://api.polar.sh; use https://sandbox-api.polar.sh to test).
const STATIC_KEYS = () => new Set((process.env.UNLOCK_KEYS || '').split(',').map(s => s.trim()).filter(Boolean));
const cache = new Map(); // key -> expiry ms (valid keys only)
let fetchImpl = (...a) => fetch(...a);

async function check(key) {
  key = String(key || '').trim().slice(0, 100);
  if (!key) return false;
  if (STATIC_KEYS().has(key)) return true;
  if (cache.get(key) > Date.now()) return true;
  const org = process.env.POLAR_ORG_ID, benefit = process.env.POLAR_BENEFIT_ID;
  if (!org) return false; // no provider configured
  try {
    // no increment_usage: validating must not use up the key
    const body = { key, organization_id: org }; if (benefit) body.benefit_id = benefit;
    const res = await fetchImpl((process.env.POLAR_API || 'https://api.polar.sh').replace(/\/+$/, '') + '/v1/customer-portal/license-keys/validate', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return false; // 404 = unknown, revoked, disabled or expired; anything else never unlocks
    const j = await res.json();
    const ok = !!(j && j.status === 'granted' && (!benefit || j.benefit_id === benefit) && (!j.expires_at || Date.parse(j.expires_at) > Date.now()));
    if (ok) cache.set(key, Date.now() + 10 * 60 * 1000);
    return ok;
  } catch { return false; }
}
module.exports = { check, _setFetch: f => { fetchImpl = f; cache.clear(); } };

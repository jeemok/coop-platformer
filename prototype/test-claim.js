// "Claim your key" lookup against Buy Me a Coffee's Extras API, with the network mocked.
const assert = require('assert'); const { claim, _setFetch } = require('./claim'); const lic = require('./license');
const ok = (n, f) => f().then(() => console.log('  ok  ', n)).catch(e => { console.error('  FAIL', n, '-', e.message); process.exitCode = 1; });
const pages = list => async (u) => { const p = +new URL(u).searchParams.get('page'); const data = list[p - 1] || []; return { ok: true, status: 200, json: async () => ({ data, current_page: p, last_page: list.length, next_page_url: p < list.length ? 'x' : null }) }; };
const buy = (email, title = 'Party Pack', extra = {}) => ({ supporter_email: email, extra: { title }, ...extra });
(async () => {
  console.log('Claim a key after buying on Buy Me a Coffee:');
  process.env.BMC_TOKEN = 't'; process.env.KEY_SECRET = 'claim-secret'; delete process.env.BMC_EXTRA_TITLE; delete process.env.UNLOCK_KEYS; delete process.env.REVOKED_KEYS;
  let calls = [];
  _setFetch(async (u, o) => { calls.push({ u, o }); return pages([[buy('a@x.com', 'Sticker')], [buy('Bob@Example.com')]])(u); });
  let r1; await ok('a purchase on the second page is found, and the key passes the real check', async () => { r1 = await claim('bob@example.com'); assert(r1.key, JSON.stringify(r1)); assert.strictEqual(await lic.check(r1.key), true); });
  await ok('the request is a bearer-token GET of /extras', async () => { assert(calls[0].u.endsWith('/api/v1/extras?page=1')); assert.strictEqual(calls[0].o.headers.Authorization, 'Bearer t'); });
  await ok('mixed case and spaces in the email still match, and the key is the same every time', async () => { const r2 = await claim('  BOB@example.COM '); assert.strictEqual(r2.key, r1.key); });
  await ok('an email with no purchase is "not found" (never cached)', async () => assert.deepStrictEqual(await claim('nobody@x.com'), { notFound: true }));
  _setFetch(pages([[buy('c@x.com', 'Sticker pack')]])); await ok('a purchase of another extra does not earn a key', async () => assert.deepStrictEqual(await claim('c@x.com'), { notFound: true }));
  _setFetch(pages([[buy('d@x.com', 'Party Pack', { purchase_is_revoked: true })]])); await ok('a revoked purchase is rejected', async () => assert.deepStrictEqual(await claim('d@x.com'), { notFound: true }));
  _setFetch(pages([[buy('e@x.com', 'Party Pack', { status: 'refunded' })]])); await ok('a refunded purchase is rejected', async () => assert.deepStrictEqual(await claim('e@x.com'), { notFound: true }));
  _setFetch(pages([[{ payer_email: 'f@x.com', extras: [{ title: 'Co-op Party Pack' }] }]])); await ok('other field names (payer_email, extras[]) are understood', async () => assert((await claim('f@x.com')).key));
  _setFetch(async () => ({ ok: false, status: 401, json: async () => ({}) })); await ok('an API error never returns a key', async () => assert.deepStrictEqual(await claim('bob@example.com'), { error: 'api' }));
  _setFetch(async () => { throw new Error('down'); }); await ok('a network failure never returns a key', async () => assert.deepStrictEqual(await claim('bob@example.com'), { error: 'api' }));
  _setFetch(pages([[buy('g@x.com')]])); await ok('a bad email is refused before any lookup', async () => assert.deepStrictEqual(await claim('not-an-email'), { error: 'bad' }));
  let n = 0; _setFetch(async () => { n++; return { ok: true, status: 200, json: async () => ({ data: [{ x: 1 }], last_page: 999 }) }; }); await ok('scanning stops after 10 pages', async () => { await claim('h@x.com'); assert.strictEqual(n, 10); });
  delete process.env.BMC_TOKEN; await ok('with no BMC_TOKEN claiming is off', async () => assert.deepStrictEqual(await claim('bob@example.com'), { error: 'off' }));
  process.env.BMC_TOKEN = 't'; delete process.env.KEY_SECRET; await ok('with no KEY_SECRET claiming is off', async () => assert.deepStrictEqual(await claim('bob@example.com'), { error: 'off' }));
})();

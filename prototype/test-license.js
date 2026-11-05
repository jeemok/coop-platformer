// Lemon Squeezy license check, with the network mocked.
const assert = require('assert'); const lic = require('./license');
const ok = (n, f) => f().then(() => console.log('  ok  ', n)).catch(e => { console.error('  FAIL', n, '-', e.message); process.exitCode = 1; });
const resp = j => async () => ({ json: async () => j });
(async () => {
  console.log('License checks:');
  process.env.LS_PRODUCT_ID = '777'; delete process.env.UNLOCK_KEYS;
  const good = { valid: true, license_key: { status: 'active' }, meta: { product_id: 777 } };
  lic._setFetch(resp(good)); await ok('a valid active key for our product is accepted', async () => assert.strictEqual(await lic.check('K1'), true));
  lic._setFetch(resp({ ...good, meta: { product_id: 1 } })); await ok('a key for another product is rejected', async () => assert.strictEqual(await lic.check('K2'), false));
  lic._setFetch(resp({ ...good, license_key: { status: 'disabled' } })); await ok('a refunded/disabled key is rejected', async () => assert.strictEqual(await lic.check('K3'), false));
  lic._setFetch(resp({ valid: false })); await ok('an invalid key is rejected', async () => assert.strictEqual(await lic.check('K4'), false));
  lic._setFetch(async () => { throw new Error('down'); }); await ok('a provider outage never unlocks', async () => assert.strictEqual(await lic.check('K5'), false));
  delete process.env.LS_PRODUCT_ID; lic._setFetch(resp(good)); await ok('with no provider configured only UNLOCK_KEYS count', async () => assert.strictEqual(await lic.check('K6'), false));
  process.env.UNLOCK_KEYS = 'A, B'; await ok('static keys work', async () => assert.strictEqual(await lic.check('B'), true));
})();

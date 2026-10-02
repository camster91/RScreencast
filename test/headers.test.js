const test = require('node:test');
const assert = require('node:assert');
const { SECURITY_HEADERS, isCrossSiteRequest } = require('../headers');

const headers = (values) => (name) => values[name];

test('cross-site browser requests are flagged', () => {
    assert.strictEqual(isCrossSiteRequest(headers({ 'sec-fetch-site': 'cross-site' })), true);
    assert.strictEqual(isCrossSiteRequest(headers({ 'sec-fetch-site': 'same-site' })), true);
});

test('same-origin and non-browser requests are allowed', () => {
    assert.strictEqual(isCrossSiteRequest(headers({ 'sec-fetch-site': 'same-origin' })), false);
    assert.strictEqual(isCrossSiteRequest(headers({ 'sec-fetch-site': 'none' })), false);
    assert.strictEqual(isCrossSiteRequest(headers({})), false);
});

test('security headers allow screen sharing but block camera and microphone', () => {
    const policy = SECURITY_HEADERS['Permissions-Policy'];
    assert.match(policy, /display-capture=\(self\)/);
    assert.match(policy, /camera=\(\)/);
    assert.match(policy, /microphone=\(\)/);
    assert.match(SECURITY_HEADERS['Content-Security-Policy'], /script-src 'self'/);
});

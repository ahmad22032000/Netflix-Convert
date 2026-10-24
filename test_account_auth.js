'use strict';

/**
 * Account-info auth detection test.
 * Run: node test_account_auth.js
 *
 * Regression target: a logged-out cookie made Netflix answer 200 with the
 * login page, and the extractor used to return 200 with a payload full of
 * "Unknown" + the support phone number. It must now return 401 (AUTH), and a
 * genuinely authenticated cookie must still parse correctly.
 *
 * global.fetch is mocked — no network is touched.
 */
const assert = require('assert');

/* ---------------- fixtures ---------------- */

// Mirrors the real login page: contains "memberSince", "profileName", "country"
// as plain substrings, which is exactly what fooled the old detection.
const LOGIN_URL = 'https://www.netflix.com/id/login?nextpage=https%3A%2F%2Fwww.netflix.com%2FYourAccount';
const LOGIN_HTML = `<!DOCTYPE html><html><head><title>Netflix</title></head><body>
<script>window.__BOOT__={"memberSince":"","profileName":"","country":"US","currentCountry":"US","emailAddress":""};</script>
<h1>Sign In</h1><p>memberSince profileName</p></body></html>`;

const ACCOUNT_HTML = `<html><body><script>
window.__APOLLO_STATE__ = {"accountInfo":{"data":{
 "emailAddress":"user@example.com",
 "phoneNumber":"+6281234567890",
 "currentPlan":{"name":"Premium"},
 "currentCountry":"ID",
 "nextBillingDate":{"fieldType":"String","value":"2026-11-24"},
 "memberSince":{"fieldType":"Numeric","value":1583020800000},
 "paymentMethod":{"fieldType":"String","value":"Visa ending 4242"}
},"type":"accountInfo"}};
</script></body></html>`;

const PROFILES_HTML = `<html><body><script>
window.__FALCOR__ = {"profiles":[
 {"GUID1":{"summary":{"$type":"atom","value":{"profileName":"Alice","guid":"GUID1","isPinLocked":true,"isKids":false,"isActive":true,"isAccountOwner":true,"maturityLevel":"ADULTS","language":"en-US"}}}},
 {"GUID2":{"summary":{"$type":"atom","value":{"profileName":"Bob","guid":"GUID2","isPinLocked":false,"isKids":true,"isActive":false,"isAccountOwner":false,"maturityLevel":"LITTLE_KIDS","language":"en-US"}}}}
]};
</script></body></html>`;

/* ---------------- fetch mock ---------------- */

let mode = 'ok';

function page(body, { status = 200, url } = {}) {
    return {
        status,
        url: url || 'https://www.netflix.com/YourAccount',
        text: async () => body
    };
}

global.fetch = async (targetUrl) => {
    const isProfiles = String(targetUrl).includes('/profiles');
    const okUrl = targetUrl;

    switch (mode) {
        case 'login':
            return page(LOGIN_HTML, { url: LOGIN_URL });
        case 'forbidden':
            return page(LOGIN_HTML, { status: 403, url: LOGIN_URL });
        case 'network':
            throw new Error('ETIMEDOUT');
        case 'unexpected':
            return page('<html><body>maintenance</body></html>', { url: okUrl });
        case 'account-only':
            if (isProfiles) throw new Error('ETIMEDOUT');
            return page(ACCOUNT_HTML, { url: okUrl });
        case 'profiles-only':
            if (!isProfiles) throw new Error('ETIMEDOUT');
            return page(PROFILES_HTML, { url: okUrl });
        case 'ok':
        default:
            return page(isProfiles ? PROFILES_HTML : ACCOUNT_HTML, { url: okUrl });
    }
};

/* ---------------- handlers under test ---------------- */

const vercelHandler = require('./api/account-info.js');
const netlifyHandler = require('./netlify/functions/account-info.js').handler;

function makeRes() {
    let finish;
    const done = new Promise(r => { finish = r; });
    const res = { headers: {}, statusCode: 0, body: '', jsonBody: null };
    res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; return res; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.body = JSON.stringify(o); res.jsonBody = o; finish(res); return res; };
    res.end = () => { finish(res); return res; };
    return { res, done };
}

async function callVercel(body) {
    const { res, done } = makeRes();
    vercelHandler({ method: 'POST', body }, res);
    return done;
}

async function callNetlify(body) {
    const r = await netlifyHandler({ httpMethod: 'POST', body: JSON.stringify(body) }, {});
    let json = null;
    try { json = JSON.parse(r.body); } catch (_) {}
    return { statusCode: r.statusCode, json, headers: r.headers };
}

/* ---------------- tests ---------------- */

const results = [];
function check(name, fn) {
    try { fn(); results.push(['PASS', name]); }
    catch (err) { results.push(['FAIL', name + ' -> ' + err.message]); }
}

(async () => {
    // 1. logged-out redirect -> 401 (the regression)
    mode = 'login';
    {
        const r = await callVercel({ cookie: 'NetflixId=expired' });
        check('vercel logged-out login page -> 401 AUTH', () => {
            assert.strictEqual(r.statusCode, 401, r.body);
            assert.ok(/rejected|expired|logged out/i.test(r.jsonBody.error), r.body);
            assert.strictEqual(r.jsonBody.email, undefined, 'no fake payload returned');
        });
    }
    {
        const r = await callNetlify({ cookie: 'NetflixId=expired' });
        check('netlify logged-out login page -> 401 AUTH', () => {
            assert.strictEqual(r.statusCode, 401, r.body);
            assert.ok(/rejected|expired|logged out/i.test(r.json.error));
        });
    }

    // 2. 403 from Netflix -> 401
    mode = 'forbidden';
    {
        const r = await callVercel({ cookie: 'NetflixId=expired' });
        check('vercel 403 from Netflix -> 401', () => {
            assert.strictEqual(r.statusCode, 401, r.body);
        });
    }

    // 3. both requests fail -> 502 NETWORK (not 401)
    mode = 'network';
    {
        const r = await callVercel({ cookie: 'NetflixId=fake' });
        check('vercel unreachable -> 502 NETWORK', () => {
            assert.strictEqual(r.statusCode, 502, r.body);
            assert.ok(/reach netflix/i.test(r.jsonBody.error), r.body);
        });
    }

    // 4. unrecognized markup -> 502 UPSTREAM (fail closed, no fake data)
    mode = 'unexpected';
    {
        const r = await callVercel({ cookie: 'NetflixId=fake' });
        check('vercel unrecognized page -> 502 UPSTREAM', () => {
            assert.strictEqual(r.statusCode, 502, r.body);
            assert.ok(/unexpected page/i.test(r.jsonBody.error), r.body);
        });
    }

    // 5. valid session -> 200 with parsed fields
    mode = 'ok';
    {
        const r = await callVercel({ cookie: 'NetflixId=good; SecureNetflixId=good' });
        check('vercel valid session -> 200 parsed account', () => {
            assert.strictEqual(r.statusCode, 200, r.body);
            const b = r.jsonBody;
            assert.strictEqual(b.authenticated, true);
            assert.strictEqual(b.partial, false);
            assert.strictEqual(b.email, 'user@example.com');
            assert.strictEqual(b.phone, '+6281234567890');
            assert.strictEqual(b.plan, 'Premium');
            assert.strictEqual(b.region, 'ID');
            assert.strictEqual(b.nextBillingDate, '2026-11-24');
            assert.strictEqual(b.memberSince, 'March 2020');
            assert.ok(b.payment.includes('Visa'), 'payment parsed: ' + b.payment);
            assert.strictEqual(b.totalProfiles, 2);
            assert.strictEqual(b.lockedProfiles, 1);
            assert.strictEqual(b.unlockedProfiles, 1);
            assert.strictEqual(b.profiles.find(p => p.guid === 'GUID1').name, 'Alice');
            assert.strictEqual(b.cookieFormat, 'header');
        });
    }

    // 6. only account page reachable -> 200 partial
    mode = 'account-only';
    {
        const r = await callVercel({ cookie: 'NetflixId=good' });
        check('vercel account page only -> 200 partial', () => {
            assert.strictEqual(r.statusCode, 200, r.body);
            assert.strictEqual(r.jsonBody.partial, true);
            assert.strictEqual(r.jsonBody.email, 'user@example.com');
            assert.strictEqual(r.jsonBody.totalProfiles, 0);
        });
    }

    // 7. only profiles page reachable -> 200 partial (no bogus account fields)
    mode = 'profiles-only';
    {
        const r = await callVercel({ cookie: 'NetflixId=good' });
        check('vercel profiles page only -> 200 partial, no bogus region', () => {
            assert.strictEqual(r.statusCode, 200, r.body);
            assert.strictEqual(r.jsonBody.partial, true);
            assert.strictEqual(r.jsonBody.region, 'Unknown');
            assert.strictEqual(r.jsonBody.totalProfiles, 2);
        });
    }

    // 8. input validation stays intact
    mode = 'ok';
    for (const [label, body, expected] of [
        ['missing cookie', {}, 400],
        ['blank cookie', { cookie: '   ' }, 400],
        ['non-string cookie', { cookie: 42 }, 400],
        ['cookie without NetflixId', { cookie: 'foo=bar' }, 400],
        ['unparseable format', { cookie: null }, 400]
    ]) {
        const r = await callVercel(body);
        check(`vercel ${label} -> ${expected}`, () => {
            assert.strictEqual(r.statusCode, expected, r.body);
        });
    }

    // 9. Netlify parity on the happy path
    mode = 'ok';
    {
        const r = await callNetlify({ cookie: 'NetflixId=good' });
        check('netlify valid session -> 200 same payload', () => {
            assert.strictEqual(r.statusCode, 200, r.body);
            assert.strictEqual(r.json.email, 'user@example.com');
            assert.strictEqual(r.json.totalProfiles, 2);
            assert.strictEqual(r.headers['Access-Control-Allow-Origin'], '*');
        });
    }
    {
        const r = await callNetlify({ cookie: 'foo=bar' });
        check('netlify no NetflixId -> 400', () => assert.strictEqual(r.statusCode, 400, r.body));
    }

    const failed = results.filter(r => r[0] === 'FAIL');
    results.forEach(([state, name]) => console.log(`${state}  ${name}`));
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
})().catch(err => {
    console.error('Harness error:', err);
    process.exit(1);
});

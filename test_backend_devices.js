'use strict';

/**
 * Backend safety test for the device-selection change.
 * Run: node test_backend_devices.js
 *
 * Proves:
 *  - one device per request (never 3 Netflix calls)
 *  - link matches the requested button (web / mobile / tv)
 *  - unknown / non-string / missing device falls back to web (never throws)
 *  - every failure path returns a clean HTTP error, no crash
 *  - Vercel handler, Netlify handler, and the local server behave identically
 */
const assert = require('assert');
const https = require('https');
const http = require('http');
const path = require('path');
const net = require('net');
const { PassThrough } = require('stream');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

/* ---------------- https mock (for in-process handlers) ---------------- */

let netflixCalls = 0;
let netflixMode = 'ok';

const BODIES = {
    ok: JSON.stringify({ value: { account: { token: { default: { token: 'TOKEN_FAKE' } } } } }),
    error: JSON.stringify({ error: { code: 'E_LOGIN', message: 'Session expired' } }),
    garbage: '<html>upstream failure</html>',
    empty: JSON.stringify({ value: { account: {} } })
};

https.request = (targetUrl, options, cb) => {
    netflixCalls++;
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.end = () => {
        process.nextTick(() => {
            const res = new PassThrough();
            res.statusCode = 200;
            cb(res);
            res.end(BODIES[netflixMode]);
        });
    };
    return req;
};

const vercelHandler = require('./api/generate.js');
const netlifyHandler = require('./netlify/functions/generate.js').handler;

/* ---------------- helpers ---------------- */

function makeRes() {
    let finish;
    const done = new Promise(r => { finish = r; });

    const res = { headers: {}, statusCode: 0, body: '', jsonBody: null };
    res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; return res; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => {
        res.body = JSON.stringify(o);
        res.jsonBody = o;
        finish(res);
        return res;
    };
    res.end = () => { finish(res); return res; };

    return { res, done };
}

function callVercel({ method = 'POST', body = {} } = {}) {
    const { res, done } = makeRes();
    vercelHandler({ method, body }, res);
    return done;
}

const COOKIE = 'NetflixId=fake; SecureNetflixId=fake';
const results = [];
function check(name, fn) {
    try {
        fn();
        results.push(['PASS', name]);
    } catch (err) {
        results.push(['FAIL', name + ' -> ' + err.message]);
    }
}

/* ---------------- Vercel handler ---------------- */

(async () => {
    // OPTIONS preflight
    {
        netflixCalls = 0;
        const r = await callVercel({ method: 'OPTIONS' });
        check('vercel OPTIONS -> 204 + CORS', () => {
            assert.strictEqual(r.statusCode, 204);
            assert.strictEqual(r.headers['access-control-allow-origin'], '*');
            assert.strictEqual(netflixCalls, 0);
        });
    }

    // Wrong method
    {
        const r = await callVercel({ method: 'GET' });
        check('vercel GET -> 405, no upstream call', () => {
            assert.strictEqual(r.statusCode, 405);
            assert.strictEqual(netflixCalls, 0);
        });
    }

    // Missing / blank cookie
    for (const [label, body] of [
        ['missing cookie', {}],
        ['blank cookie', { cookie: '    ' }],
        ['null body', null],
        ['cookie not a string-safe value', { cookie: 12345 }]
    ]) {
        const r = await callVercel({ body });
        check(`vercel ${label} -> 400 without crash`, () => {
            assert.strictEqual(r.statusCode, 400, 'got ' + r.statusCode + ' ' + r.body);
            assert.ok(r.jsonBody && r.jsonBody.error, 'error message present');
            assert.strictEqual(netflixCalls, 0);
        });
    }

    // One device per request, link matches device
    for (const [requested, expectedDevice, expectedLink] of [
        [undefined, 'web', 'https://netflix.com/?nftoken=TOKEN_FAKE'],
        ['web', 'web', 'https://netflix.com/?nftoken=TOKEN_FAKE'],
        ['mobile', 'mobile', 'https://netflix.com/unsupported?nftoken=TOKEN_FAKE'],
        ['tv', 'tv', 'https://netflix.com/tv2?nftoken=TOKEN_FAKE'],
        ['MOBILE', 'mobile', 'https://netflix.com/unsupported?nftoken=TOKEN_FAKE'],
        [' tv ', 'tv', 'https://netflix.com/tv2?nftoken=TOKEN_FAKE'],
        ['bogus', 'web', 'https://netflix.com/?nftoken=TOKEN_FAKE'],
        ['', 'web', 'https://netflix.com/?nftoken=TOKEN_FAKE'],
        [42, 'web', 'https://netflix.com/?nftoken=TOKEN_FAKE'],
        [{ nested: true }, 'web', 'https://netflix.com/?nftoken=TOKEN_FAKE']
    ]) {
        netflixCalls = 0;
        netflixMode = 'ok';
        const r = await callVercel({ body: { cookie: COOKIE, device: requested } });
        check(`vercel device=${JSON.stringify(requested)} -> ${expectedDevice}`, () => {
            assert.strictEqual(r.statusCode, 200, 'got ' + r.statusCode + ' ' + r.body);
            assert.strictEqual(r.jsonBody.device, expectedDevice);
            assert.strictEqual(r.jsonBody.token, 'TOKEN_FAKE');
            assert.strictEqual(r.jsonBody.link, expectedLink);
            assert.strictEqual(netflixCalls, 1, 'exactly one Netflix call per generate, got ' + netflixCalls);
        });
    }

    // Cookie format variants still work
    {
        netflixCalls = 0;
        const r = await callVercel({
            body: {
                cookie: JSON.stringify([{ name: 'NetflixId', value: 'abc' }, { name: 'SecureNetflixId', value: 'def' }]),
                device: 'tv'
            }
        });
        check('vercel JSON cookie -> 200 tv link', () => {
            assert.strictEqual(r.statusCode, 200, r.body);
            assert.strictEqual(r.jsonBody.cookieFormat, 'json');
            assert.strictEqual(r.jsonBody.link, 'https://netflix.com/tv2?nftoken=TOKEN_FAKE');
        });
    }

    {
        netflixCalls = 0;
        const r = await callVercel({
            body: {
                cookie: '.netflix.com\tTRUE\t/\tTRUE\t1893456000\tNetflixId\tabc',
                device: 'mobile'
            }
        });
        check('vercel Netscape cookie -> 200 mobile link', () => {
            assert.strictEqual(r.statusCode, 200, r.body);
            assert.strictEqual(r.jsonBody.cookieFormat, 'netscape');
            assert.strictEqual(r.jsonBody.link, 'https://netflix.com/unsupported?nftoken=TOKEN_FAKE');
        });
    }

    // Upstream failures -> clean 500, no crash
    for (const mode of ['error', 'garbage', 'empty']) {
        netflixCalls = 0;
        netflixMode = mode;
        const r = await callVercel({ body: { cookie: COOKIE, device: 'tv' } });
        check(`vercel upstream ${mode} -> 500 with message`, () => {
            assert.strictEqual(r.statusCode, 500, r.body);
            assert.ok(r.jsonBody.error && r.jsonBody.error.length > 0);
        });
    }
    netflixMode = 'ok';

    /* ---------------- Netlify handler ---------------- */

    {
        const r = await netlifyHandler({ httpMethod: 'OPTIONS' }, {});
        check('netlify OPTIONS -> 204', () => assert.strictEqual(r.statusCode, 204));
    }

    {
        const r = await netlifyHandler({ httpMethod: 'GET' }, {});
        check('netlify GET -> 405', () => assert.strictEqual(r.statusCode, 405));
    }

    for (const [label, body] of [
        ['undefined body', undefined],
        ['null json body', 'null'],
        ['blank body', ''],
        ['no cookie key', '{}']
    ]) {
        netflixCalls = 0;
        const r = await netlifyHandler({ httpMethod: 'POST', body }, {});
        check(`netlify ${label} -> 400`, () => {
            assert.strictEqual(r.statusCode, 400, r.body);
            assert.strictEqual(netflixCalls, 0);
        });
    }

    {
        const r = await netlifyHandler({ httpMethod: 'POST', body: '{broken' }, {});
        check('netlify broken JSON -> 500 without crash', () => {
            assert.strictEqual(r.statusCode, 500);
            assert.ok(JSON.parse(r.body).error);
        });
    }

    for (const [device, link] of [
        ['web', 'https://netflix.com/?nftoken=TOKEN_FAKE'],
        ['mobile', 'https://netflix.com/unsupported?nftoken=TOKEN_FAKE'],
        ['tv', 'https://netflix.com/tv2?nftoken=TOKEN_FAKE'],
        ['bogus', 'https://netflix.com/?nftoken=TOKEN_FAKE']
    ]) {
        netflixCalls = 0;
        const r = await netlifyHandler({ httpMethod: 'POST', body: JSON.stringify({ cookie: COOKIE, device }) }, {});
        check(`netlify device=${device} -> single link`, () => {
            assert.strictEqual(r.statusCode, 200, r.body);
            const body = JSON.parse(r.body);
            assert.strictEqual(body.link, link);
            assert.strictEqual(netflixCalls, 1);
            assert.strictEqual(r.headers['Access-Control-Allow-Origin'], '*');
        });
    }

    /* ---------------- Local server end-to-end ---------------- */

    await runServerTests();

    /* ---------------- summary ---------------- */

    const failed = results.filter(r => r[0] === 'FAIL');
    results.forEach(([state, name]) => console.log(`${state}  ${name}`));
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) process.exit(1);
    process.exit(0);
})().catch(err => {
    console.error('Harness error:', err);
    process.exit(1);
});

/* ---------------- local server (mocked upstream) ---------------- */

function waitForPort(port, timeoutMs) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        (function probe() {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => { socket.destroy(); resolve(); });
            socket.once('error', () => {
                socket.destroy();
                if (Date.now() - started > timeoutMs) return reject(new Error('server did not start'));
                setTimeout(probe, 200);
            });
        })();
    });
}

function request({ method = 'POST', path: p, body, port = 3000 }) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: p,
            method,
            headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(data); } catch (_) {}
                resolve({ status: res.statusCode, body: data, json });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function startServer(env) {
    return spawn(process.execPath, ['-r', path.join(__dirname, 'test', 'mock_netflix_https.js'), 'server.js'], {
        cwd: __dirname,
        env: Object.assign({}, process.env, env || {}),
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

async function runServerTests() {
    // --- happy path ---
    let child = startServer({ MOCK_NETFLIX_MODE: 'ok' });
    let logs = '';
    child.stdout.on('data', d => logs += d);
    child.stderr.on('data', d => logs += d);

    try {
        await waitForPort(3000, 15000);

        const tv = await request({ path: '/api/generate', body: { cookie: COOKIE, device: 'tv' } });
        check('server tv -> 200 single tv link', () => {
            assert.strictEqual(tv.status, 200, tv.body);
            assert.strictEqual(tv.json.device, 'tv');
            assert.strictEqual(tv.json.link, 'https://netflix.com/tv2?nftoken=TOKEN_FAKE');
        });

        const def = await request({ path: '/api/generate', body: { cookie: COOKIE } });
        check('server default -> web link', () => {
            assert.strictEqual(def.status, 200, def.body);
            assert.strictEqual(def.json.device, 'web');
            assert.strictEqual(def.json.link, 'https://netflix.com/?nftoken=TOKEN_FAKE');
        });

        const bogus = await request({ path: '/api/generate', body: { cookie: COOKIE, device: 'nope' } });
        check('server unknown device -> web fallback', () => {
            assert.strictEqual(bogus.status, 200, bogus.body);
            assert.strictEqual(bogus.json.device, 'web');
        });

        const noCookie = await request({ path: '/api/generate', body: {} });
        check('server no cookie -> 400', () => assert.strictEqual(noCookie.status, 400));

        const badJson = await request({ path: '/api/generate', body: '{oops' });
        check('server broken JSON -> 400', () => assert.strictEqual(badJson.status, 400));

        const nullJson = await request({ path: '/api/generate', body: 'null' });
        check('server null JSON -> 400', () => assert.strictEqual(nullJson.status, 400));

        const getApi = await request({ method: 'GET', path: '/api/generate' });
        check('server GET /api/generate -> 404 (no crash)', () => assert.strictEqual(getApi.status, 404));

        const page = await request({ method: 'GET', path: '/' });
        check('server / -> 200 page with 3 device buttons', () => {
            assert.strictEqual(page.status, 200);
            assert.strictEqual((page.body.match(/class="device-btn/g) || []).length, 3);
            assert.strictEqual((page.body.match(/class="link-card/g) || []).length, 1, 'only one result card');
        });

        check('server still alive after all edge cases', () => assert.strictEqual(child.exitCode, null));
    } finally {
        child.kill();
        await new Promise(r => setTimeout(r, 300));
    }

    // --- upstream failure modes ---
    for (const mode of ['error', 'garbage', 'empty']) {
        const c = startServer({ MOCK_NETFLIX_MODE: mode });
        try {
            await waitForPort(3000, 15000);
            const r = await request({ path: '/api/generate', body: { cookie: COOKIE, device: 'web' } });
            check(`server upstream ${mode} -> 500 with message`, () => {
                assert.strictEqual(r.status, 500, r.body);
                assert.ok(r.json && typeof r.json.error === 'string' && r.json.error.length > 0);
            });
            check(`server alive after upstream ${mode}`, () => assert.strictEqual(c.exitCode, null));
        } finally {
            c.kill();
            await new Promise(r => setTimeout(r, 300));
        }
    }

    /* ---------------- account-info auth detection over HTTP ---------------- */

    // logged-out cookie: Netflix answers 200 + login page -> must be 401
    {
        const c = startServer({ MOCK_NETFLIX_MODE: 'ok', MOCK_ACCOUNT_MODE: 'login' });
        try {
            await waitForPort(3000, 15000);
            const r = await request({ path: '/api/account-info', body: { cookie: 'NetflixId=expired' } });
            check('server account-info logged-out -> 401', () => {
                assert.strictEqual(r.status, 401, r.body);
                assert.ok(/rejected|expired|logged out/i.test(r.json.error), r.body);
                assert.strictEqual(r.json.email, undefined, 'no fake payload');
            });
        } finally {
            c.kill();
            await new Promise(r => setTimeout(r, 300));
        }
    }

    // genuinely authenticated cookie -> 200 with parsed data
    {
        const c = startServer({ MOCK_NETFLIX_MODE: 'ok', MOCK_ACCOUNT_MODE: 'ok' });
        try {
            await waitForPort(3000, 15000);
            const r = await request({ path: '/api/account-info', body: { cookie: 'NetflixId=good' } });
            check('server account-info valid cookie -> 200 parsed', () => {
                assert.strictEqual(r.status, 200, r.body);
                assert.strictEqual(r.json.email, 'user@example.com');
                assert.strictEqual(r.json.plan, 'Premium');
                assert.strictEqual(r.json.totalProfiles, 2);
                assert.strictEqual(r.json.authenticated, true);
            });
        } finally {
            c.kill();
            await new Promise(r => setTimeout(r, 300));
        }
    }

    // Netflix unreachable -> 502
    {
        const c = startServer({ MOCK_NETFLIX_MODE: 'ok', MOCK_ACCOUNT_MODE: 'network' });
        try {
            await waitForPort(3000, 15000);
            const r = await request({ path: '/api/account-info', body: { cookie: 'NetflixId=good' } });
            check('server account-info unreachable -> 502', () => {
                assert.strictEqual(r.status, 502, r.body);
            });
        } finally {
            c.kill();
            await new Promise(r => setTimeout(r, 300));
        }
    }
}

'use strict';

/**
 * Preload module (node -r ./test/mock_netflix_https.js server.js).
 *
 * Replaces https.get / https.request with a fake Netflix endpoint so the
 * server can be exercised end-to-end without hitting the network.
 *
 * MOCK_NETFLIX_MODE:
 *   ok      -> valid token payload (default)
 *   error   -> Netflix error envelope
 *   garbage -> non-JSON body
 *   empty   -> JSON without a token
 */
const https = require('https');
const { PassThrough } = require('stream');
const { EventEmitter } = require('events');

const MODE = process.env.MOCK_NETFLIX_MODE || 'ok';

const BODIES = {
    ok: JSON.stringify({ value: { account: { token: { default: { token: 'TOKEN_FAKE' } } } } }),
    error: JSON.stringify({ error: { code: 'E_LOGIN', message: 'Session expired' } }),
    garbage: '<html>upstream failure</html>',
    empty: JSON.stringify({ value: { account: {} } })
};

function fakeRequest(cb) {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.end = () => {};

    process.nextTick(() => {
        if (typeof cb !== 'function') return;
        const res = new PassThrough();
        res.statusCode = 200;
        cb(res);
        res.end(BODIES[MODE] !== undefined ? BODIES[MODE] : BODIES.ok);
    });

    return req;
}

https.get = (url, opts, cb) => fakeRequest(typeof opts === 'function' ? opts : cb);
https.request = (url, opts, cb) => fakeRequest(typeof opts === 'function' ? opts : cb);

/* ---------------- optional global fetch mock (account page) ---------------- */

const ACCOUNT_MODE = process.env.MOCK_ACCOUNT_MODE;

if (ACCOUNT_MODE) {
    const LOGIN_URL = 'https://www.netflix.com/id/login?nextpage=https%3A%2F%2Fwww.netflix.com%2FYourAccount';
    const LOGIN_HTML = '<!DOCTYPE html><html><body><script>window.__BOOT__={"memberSince":"","profileName":"","country":"US","currentCountry":"US"};</script><h1>Sign In</h1></body></html>';
    const ACCOUNT_HTML = '<html><body><script>window.__APOLLO_STATE__={"accountInfo":{"data":{"emailAddress":"user@example.com","phoneNumber":"+6281234567890","currentPlan":{"name":"Premium"},"currentCountry":"ID","nextBillingDate":{"fieldType":"String","value":"2026-11-24"},"memberSince":{"fieldType":"Numeric","value":1583020800000}},"type":"accountInfo"}};</script></body></html>';
    const PROFILES_HTML = '<html><body><script>{"profiles":[{"GUID1":{"summary":{"$type":"atom","value":{"profileName":"Alice","guid":"GUID1","isPinLocked":true,"isKids":false,"isActive":true,"isAccountOwner":true}}}},{"GUID2":{"summary":{"$type":"atom","value":{"profileName":"Bob","guid":"GUID2","isPinLocked":false,"isKids":true,"isActive":false,"isAccountOwner":false}}}}]};</script></body></html>';

    const fakePage = (body, url) => ({ status: 200, url, text: async () => body });

    globalThis.fetch = async (targetUrl) => {
        const isProfiles = String(targetUrl).includes('/profiles');
        if (ACCOUNT_MODE === 'login') return fakePage(LOGIN_HTML, LOGIN_URL);
        if (ACCOUNT_MODE === 'network') throw new Error('ETIMEDOUT');
        if (ACCOUNT_MODE === 'ok') return fakePage(isProfiles ? PROFILES_HTML : ACCOUNT_HTML, targetUrl);
        return fakePage('<html>maintenance</html>', targetUrl);
    };
}

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

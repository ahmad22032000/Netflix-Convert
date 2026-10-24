/**
 * Netflix nftoken generator — single implementation shared by api/, netlify/
 * and the local server.
 *
 * The token endpoint answers HTTP 200 even for a dead cookie; it simply returns
 * an empty session (`{"value":{},"paths":[...]}`). That used to surface as a
 * vague "Token not found (HTTP 200)" message, so every failure now carries a
 * classified code plus cookie diagnostics (names and lengths only — never
 * values) that the UI can show to the user.
 */

'use strict';

const https = require('https');
const qs = require('querystring');

const ESN = 'NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200';

const QUERY_PARAMS = {
    appVersion: '15.48.1',
    device_type: 'NFAPPL-02-',
    esn: ESN,
    idiom: 'phone',
    iosVersion: '15.8.5',
    isTablet: 'false',
    languages: 'en-US',
    locale: 'en-US',
    maxDeviceWidth: '375',
    model: 'saget',
    modelType: 'IPHONE8-1',
    odpAware: 'true',
    path: '["account","token","default"]',
    pathFormat: 'graph',
    pixelDensity: '2.0',
    progressive: 'false',
    responseFormat: 'json'
};

const TARGET_URL = 'https://ios.prod.ftl.netflix.com/iosui/user/15.48?' + qs.stringify(QUERY_PARAMS);
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Describe the cookie without leaking values.
 * @returns {{names:string[],count:number,hasNetflixId:boolean,hasSecureNetflixId:boolean,
 *            netflixIdLength:number,secureNetflixIdLength:number,totalLength:number}}
 */
function cookieDiagnostics(cookieStr) {
    const raw = String(cookieStr == null ? '' : cookieStr);
    const pairs = raw
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const i = part.indexOf('=');
            return i === -1
                ? { name: part, value: '' }
                : { name: part.slice(0, i), value: part.slice(i + 1) };
        });

    const byName = new Map();
    for (const p of pairs) byName.set(p.name, p.value);

    return {
        names: pairs.map(p => p.name),
        count: pairs.length,
        hasNetflixId: byName.has('NetflixId'),
        hasSecureNetflixId: byName.has('SecureNetflixId'),
        netflixIdLength: (byName.get('NetflixId') || '').length,
        secureNetflixIdLength: (byName.get('SecureNetflixId') || '').length,
        totalLength: raw.length
    };
}

/** Human-readable hint based on what is present in the cookie. */
function hintFor(diag) {
    if (!diag.hasNetflixId && !diag.hasSecureNetflixId) {
        return 'No NetflixId or SecureNetflixId found — export the netflix.com cookies again (Cookie-Editor → Export → JSON).';
    }
    if (!diag.hasNetflixId) {
        return 'NetflixId is missing from the pasted cookie. Both NetflixId and SecureNetflixId are required.';
    }
    if (!diag.hasSecureNetflixId) {
        return 'SecureNetflixId is missing. Export the full netflix.com cookie set, not just NetflixId.';
    }
    if (diag.netflixIdLength < 100) {
        return `NetflixId looks truncated (${diag.netflixIdLength} chars). Re-export without line breaks or truncation.`;
    }
    return 'Cookie is present but Netflix no longer treats it as a live session — it expired or was signed out. Re-export a fresh cookie from a logged-in browser.';
}

function tokenFrom(json) {
    try {
        return json.value.account.token.default.token || null;
    } catch (_) {
        return null;
    }
}

/**
 * Generate an nftoken for a normalized cookie string.
 * @param {string} cookieStr normalized "name=value; ..." header
 * @returns {Promise<string>} token
 * @throws {Error} code=AUTH (session rejected), NETWORK (unreachable), UPSTREAM (bad response)
 */
function generateToken(cookieStr) {
    const diag = cookieDiagnostics(cookieStr);

    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            headers: {
                'User-Agent': 'Argo/15.48.1 (iPhone; iOS 15.8.5; Scale/2.00)',
                'Accept': '*/*',
                'Cookie': cookieStr,
                'x-netflix.request.routing': JSON.stringify({ path: '/nq/mobile/nqios/~15.48.0/user', control_tag: 'iosui_argo' }),
                'x-netflix.client.type': 'argo',
                'x-netflix.client.ftl.esn': ESN
            },
            timeout: REQUEST_TIMEOUT_MS
        };

        const req = https.request(TARGET_URL, options, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                let json = null;
                try {
                    json = JSON.parse(data);
                } catch (_) {
                    const err = new Error(`Netflix returned an unreadable response (HTTP ${response.statusCode}). Try again in a moment.`);
                    err.code = 'UPSTREAM';
                    err.details = diag;
                    err.hint = hintFor(diag);
                    return reject(err);
                }

                const token = tokenFrom(json);
                if (token) return resolve(token);

                const payloadError = json && (json.error || json.errors);
                const emptySession = json && json.value && typeof json.value === 'object'
                    && Object.keys(json.value).length === 0;

                const err = new Error(
                    payloadError
                        ? 'Netflix rejected the token request: ' + JSON.stringify(payloadError).slice(0, 300)
                        : emptySession
                            ? 'Netflix rejected this cookie (empty session). The cookie is invalid, expired, or truncated.'
                            : `Netflix answered HTTP ${response.statusCode} without a token. The cookie is probably expired.`
                );
                err.code = payloadError ? 'UPSTREAM' : 'AUTH';
                err.details = diag;
                err.hint = hintFor(diag);
                err.httpStatus = response.statusCode;
                err.bodyBytes = data.length;
                reject(err);
            });
        });

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy();
            const err = new Error('Request to Netflix timed out. Try again in a moment.');
            err.code = 'NETWORK';
            err.details = diag;
            reject(err);
        });

        req.on('error', (e) => {
            const err = new Error('Network error reaching Netflix: ' + e.message);
            err.code = 'NETWORK';
            err.details = diag;
            reject(err);
        });

        req.end();
    });
}

module.exports = { generateToken, cookieDiagnostics, hintFor };

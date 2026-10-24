const { normalizeCookie } = require('../../lib/cookie');
const { resolveDevice, buildLink } = require('../../lib/devices');
const { generateToken, cookieDiagnostics } = require('../../lib/token');

/** Map a token error code to an HTTP status. */
function statusForError(e) {
    if (e && e.code === 'AUTH') return 401;
    if (e && (e.code === 'NETWORK' || e.code === 'UPSTREAM')) return 502;
    return 500;
}

exports.handler = async (event, context) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const parsed = JSON.parse(event.body || '{}') || {};
        const raw = typeof parsed.cookie === 'string' ? parsed.cookie.trim() : '';

        if (!raw) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Missing cookie in request body' })
            };
        }

        const { cookie: cookieStr, format } = normalizeCookie(raw);

        if (!cookieStr) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({
                    error: 'Unsupported cookie format. Accepted: header string, Cookie-Editor JSON, or Netscape cookies.txt.'
                })
            };
        }

        const diag = cookieDiagnostics(cookieStr);
        if (!diag.hasNetflixId) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({
                    error: 'Cookie parsed but no NetflixId found. Make sure you exported the netflix.com cookies (NetflixId is required).',
                    hint: 'Export both NetflixId and SecureNetflixId from netflix.com.',
                    diagnostics: diag
                })
            };
        }

        // One device per request (web | mobile | tv); unknown values fall back.
        const device = resolveDevice(parsed && parsed.device);

        const token = await generateToken(cookieStr);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                token: token,
                device: device,
                link: buildLink(device, token),
                cookieFormat: format
            })
        };
    } catch (e) {
        return {
            statusCode: statusForError(e),
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                error: (e && e.message) || 'Failed to generate token',
                hint: e && e.hint,
                diagnostics: e && e.details
            })
        };
    }
};

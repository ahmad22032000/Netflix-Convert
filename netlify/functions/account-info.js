const { normalizeCookie } = require('../../lib/cookie');
const { fetchAccountInfo } = require('../../lib/account');

/** Map a fetchAccountInfo error code to an HTTP status. */
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

        if (!/(^|;\s*)NetflixId=/.test(cookieStr)) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({
                    error: 'Cookie parsed but no NetflixId found. Make sure you exported the netflix.com cookies (NetflixId is required).'
                })
            };
        }

        const info = await fetchAccountInfo(cookieStr, format);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            body: JSON.stringify(info)
        };
    } catch (e) {
        const status = statusForError(e);
        return {
            statusCode: status,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: (e && e.message) || 'Failed to fetch account info' })
        };
    }
};

const { normalizeCookie } = require('../../lib/cookie');
const { fetchAccountInfo } = require('../../lib/account');

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
        const parsed = JSON.parse(event.body);
        const raw = parsed.cookie ? String(parsed.cookie).trim() : '';

        if (!raw) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing cookie in request body' }) };
        }

        const { cookie: cookieStr, format } = normalizeCookie(raw);

        if (!cookieStr) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Unsupported cookie format. Accepted: header string, Cookie-Editor JSON, or Netscape cookies.txt.'
                })
            };
        }

        if (!cookieStr.includes('NetflixId=')) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Cookie parsed but no NetflixId found. Make sure you exported the netflix.com cookies (NetflixId is required).'
                })
            };
        }

        const info = await fetchAccountInfo(cookieStr, format);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(info)
        };
    } catch (e) {
        const status = e.code === 'AUTH' ? 401 : e.code === 'NETWORK' ? 502 : 500;
        return {
            statusCode: status,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: e.message || 'Failed to fetch account info' })
        };
    }
};

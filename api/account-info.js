const { normalizeCookie } = require('../lib/cookie');
const { fetchAccountInfo } = require('../lib/account');

/** Map a fetchAccountInfo error code to an HTTP status. */
function statusForError(e) {
    if (e && e.code === 'AUTH') return 401;
    if (e && (e.code === 'NETWORK' || e.code === 'UPSTREAM')) return 502;
    return 500;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const raw = typeof body.cookie === 'string' ? body.cookie.trim() : '';

        if (!raw) {
            return res.status(400).json({ error: 'Missing cookie in request body' });
        }

        const { cookie: cookieStr, format } = normalizeCookie(raw);

        if (!cookieStr) {
            return res.status(400).json({
                error: 'Unsupported cookie format. Accepted: header string, Cookie-Editor JSON, or Netscape cookies.txt.'
            });
        }

        if (!/(^|;\s*)NetflixId=/.test(cookieStr)) {
            return res.status(400).json({
                error: 'Cookie parsed but no NetflixId found. Make sure you exported the netflix.com cookies (NetflixId is required).'
            });
        }

        const info = await fetchAccountInfo(cookieStr, format);
        return res.status(200).json(info);
    } catch (e) {
        return res.status(statusForError(e)).json({ error: (e && e.message) || 'Failed to fetch account info' });
    }
};

module.exports.statusForError = statusForError;

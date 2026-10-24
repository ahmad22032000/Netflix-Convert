const { normalizeCookie } = require('../lib/cookie');
const { fetchAccountInfo } = require('../lib/account');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const raw = req.body && req.body.cookie ? String(req.body.cookie).trim() : '';

        if (!raw) {
            return res.status(400).json({ error: 'Missing cookie in request body' });
        }

        const { cookie: cookieStr, format } = normalizeCookie(raw);

        if (!cookieStr) {
            return res.status(400).json({
                error: 'Unsupported cookie format. Accepted: header string, Cookie-Editor JSON, or Netscape cookies.txt.'
            });
        }

        if (!cookieStr.includes('NetflixId=')) {
            return res.status(400).json({
                error: 'Cookie parsed but no NetflixId found. Make sure you exported the netflix.com cookies (NetflixId is required).'
            });
        }

        const info = await fetchAccountInfo(cookieStr, format);
        return res.status(200).json(info);
    } catch (e) {
        const status = e.code === 'AUTH' ? 401 : e.code === 'NETWORK' ? 502 : 500;
        return res.status(status).json({ error: e.message || 'Failed to fetch account info' });
    }
};

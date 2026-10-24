const { normalizeCookie } = require('../lib/cookie');
const { resolveDevice, buildLink } = require('../lib/devices');
const { generateToken, cookieDiagnostics } = require('../lib/token');

/** Map a token error code to an HTTP status. */
function statusForError(e) {
    if (e && e.code === 'AUTH') return 401;
    if (e && (e.code === 'NETWORK' || e.code === 'UPSTREAM')) return 502;
    return 500;
}

module.exports = (req, res) => {
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

        // Reject a cookie that cannot possibly authenticate before calling Netflix.
        const diag = cookieDiagnostics(cookieStr);
        if (!diag.hasNetflixId) {
            return res.status(400).json({
                error: 'Cookie parsed but no NetflixId found. Make sure you exported the netflix.com cookies (NetflixId is required).',
                hint: 'Export both NetflixId and SecureNetflixId from netflix.com.',
                diagnostics: diag
            });
        }

        // One device per request (web | mobile | tv); unknown values fall back.
        const device = resolveDevice(body.device);

        generateToken(cookieStr)
            .then(token => {
                res.status(200).json({
                    token: token,
                    device: device,
                    link: buildLink(device, token),
                    cookieFormat: format
                });
            })
            .catch(err => {
                res.status(statusForError(err)).json({
                    error: err.message || 'Failed to generate token',
                    hint: err.hint,
                    diagnostics: err.details
                });
            });
    } catch (e) {
        res.status(400).json({ error: 'Invalid request payload' });
    }
};

module.exports.statusForError = statusForError;

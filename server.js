const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { normalizeCookie } = require('./lib/cookie');
const { fetchAccountInfo } = require('./lib/account');
const { resolveDevice, buildLink } = require('./lib/devices');
const { generateToken, cookieDiagnostics } = require('./lib/token');

const PORT = 3000;

function statusForError(e) {
    if (e && e.code === 'AUTH') return 401;
    if (e && (e.code === 'NETWORK' || e.code === 'UPSTREAM')) return 502;
    return 500;
}

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
};

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    // API Endpoint for generating nftoken
    if (parsedUrl.pathname === '/api/generate') {
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            return res.end();
        }

        if (req.method === 'POST') {
            let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body) || {};
                let raw = typeof data.cookie === 'string' ? data.cookie.trim() : '';

                if (!raw) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Cookie is required' }));
                }

                const { cookie: cookieStr, format } = normalizeCookie(raw);
                if (!cookieStr) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Unsupported cookie format. Accepted: header string, Cookie-Editor JSON, or Netscape cookies.txt.' }));
                }

                // Reject a cookie that cannot authenticate before calling Netflix.
                const diag = cookieDiagnostics(cookieStr);
                if (!diag.hasNetflixId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        error: 'Cookie parsed but no NetflixId found. Make sure you exported the netflix.com cookies (NetflixId is required).',
                        hint: 'Export both NetflixId and SecureNetflixId from netflix.com.',
                        diagnostics: diag
                    }));
                }

                generateToken(cookieStr)
                    .then(token => {
                        // Only one device is generated per request (web | mobile | tv).
                        const device = resolveDevice(data.device);
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        });
                        res.end(JSON.stringify({
                            token: token,
                            device: device,
                            link: buildLink(device, token),
                            cookieFormat: format
                        }));
                    })
                    .catch(err => {
                        res.writeHead(statusForError(err), {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        });
                        res.end(JSON.stringify({
                            error: err.message || 'Failed to generate token',
                            hint: err.hint,
                            diagnostics: err.details
                        }));
                    });
            } catch (e) {
                res.writeHead(400, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(JSON.stringify({ error: 'Invalid request payload' }));
            }
        });
        return;
        } // Close if (req.method === 'POST')
    } // Close if (parsedUrl.pathname === '/api/generate')

    if (parsedUrl.pathname === '/api/account-info') {
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            return res.end();
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const parsed = JSON.parse(body) || {};
                    let raw = typeof parsed.cookie === 'string' ? parsed.cookie.trim() : '';

                    if (!raw) {
                        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        return res.end(JSON.stringify({ error: 'Missing cookie in request body' }));
                    }

                    const { cookie: cookieStr, format } = normalizeCookie(raw);
                    if (!cookieStr) {
                        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        return res.end(JSON.stringify({ error: 'Unsupported cookie format. Accepted: header string, Cookie-Editor JSON, or Netscape cookies.txt.' }));
                    }

                    if (!/(^|;\s*)NetflixId=/.test(cookieStr)) {
                        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        return res.end(JSON.stringify({ error: 'Cookie parsed but no NetflixId found. Make sure you exported the netflix.com cookies (NetflixId is required).' }));
                    }

                    const info = await fetchAccountInfo(cookieStr, format);

                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify(info));
                } catch (e) {
                    const status = e.code === 'AUTH' ? 401 : (e.code === 'NETWORK' || e.code === 'UPSTREAM') ? 502 : 500;
                    res.writeHead(status, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
    }

    // Serve static files
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    const extname = String(path.extname(filePath)).toLowerCase();
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
        } else {
            const contentType = MIME_TYPES[extname] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n=============================================`);
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`=============================================\n`);
});

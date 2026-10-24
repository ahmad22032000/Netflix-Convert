const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { normalizeCookie } = require('./lib/cookie');
const { fetchAccountInfo } = require('./lib/account');
const { resolveDevice, buildLink } = require('./lib/devices');

const PORT = 3000;

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
                        res.writeHead(500, {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        });
                        res.end(JSON.stringify({ error: err.message || 'Failed to generate token' }));
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
                    const parsed = JSON.parse(body);
                    let raw = parsed.cookie ? parsed.cookie.trim() : '';

                    if (!raw) {
                        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        return res.end(JSON.stringify({ error: 'Missing cookie in request body' }));
                    }

                    const { cookie: cookieStr, format } = normalizeCookie(raw);
                    if (!cookieStr) {
                        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        return res.end(JSON.stringify({ error: 'Unsupported cookie format. Accepted: header string, Cookie-Editor JSON, or Netscape cookies.txt.' }));
                    }

                    if (!cookieStr.includes('NetflixId=')) {
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
                    const status = e.code === 'AUTH' ? 401 : e.code === 'NETWORK' ? 502 : 500;
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

function generateToken(cookieStr) {
    return new Promise((resolve, reject) => {
        const queryParams = new URLSearchParams({
            "appVersion": "15.48.1",
            "device_type": "NFAPPL-02-",
            "esn": "NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200",
            "idiom": "phone",
            "iosVersion": "15.8.5",
            "isTablet": "false",
            "languages": "en-US",
            "locale": "en-US",
            "maxDeviceWidth": "375",
            "model": "saget",
            "modelType": "IPHONE8-1",
            "odpAware": "true",
            "path": '["account","token","default"]',
            "pathFormat": "graph",
            "pixelDensity": "2.0",
            "progressive": "false",
            "responseFormat": "json"
        });

        const targetUrl = 'https://ios.prod.ftl.netflix.com/iosui/user/15.48?' + queryParams.toString();

        const headers = {
            "User-Agent": "Argo/15.48.1 (iPhone; iOS 15.8.5; Scale/2.00)",
            "Accept": "*/*",
            "Cookie": cookieStr,
            "x-netflix.request.routing": '{"path":"/nq/mobile/nqios/~15.48.0/user","control_tag":"iosui_argo"}',
            "x-netflix.client.type": "argo",
            "x-netflix.client.ftl.esn": "NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200"
        };

        const req = https.get(targetUrl, { headers, timeout: 15000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json && json.value && json.value.account && json.value.account.token && json.value.account.token.default && json.value.account.token.default.token) {
                        resolve(json.value.account.token.default.token);
                    } else if (json.error) {
                        reject(new Error("Netflix API Error: " + JSON.stringify(json.error)));
                    } else {
                        reject(new Error("Token not found in response. Your cookie might be invalid or expired."));
                    }
                } catch(e) {
                    reject(new Error("Invalid JSON response from Netflix"));
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request to Netflix timed out'));
        });
    });
}

server.listen(PORT, () => {
    console.log(`\n=============================================`);
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`=============================================\n`);
});

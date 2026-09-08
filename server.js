const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

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
                const data = JSON.parse(body);
                let cookieStr = data.cookie.trim();

                // Auto-convert Cookie-Editor JSON format to a string
                if (cookieStr.startsWith('[') && cookieStr.endsWith(']')) {
                    try {
                        const cookieArr = JSON.parse(cookieStr);
                        if (Array.isArray(cookieArr)) {
                            cookieStr = cookieArr
                                .filter(c => c.name && c.value)
                                .map(c => `${c.name}=${c.value}`)
                                .join('; ');
                        }
                    } catch(err) {
                        // Ignore JSON parse errors and just use the raw string
                    }
                }

                if (!cookieStr) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Cookie is required' }));
                }

                generateToken(cookieStr)
                    .then(token => {
                        res.writeHead(200, { 
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        });
                        res.end(JSON.stringify({ token: token }));
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
                    let cookieStr = parsed.cookie.trim();
                    
                    // Auto-convert Cookie-Editor JSON format to a string
                    if (cookieStr.startsWith('[') && cookieStr.endsWith(']')) {
                        try {
                            const cookieArr = JSON.parse(cookieStr);
                            if (Array.isArray(cookieArr)) {
                                cookieStr = cookieArr
                                    .filter(c => c.name && c.value)
                                    .map(c => `${c.name}=${c.value}`)
                                    .join('; ');
                            }
                        } catch(err) {
                            // Ignore JSON parse errors and just use the raw string
                        }
                    }
                    
                    const fetchRes = await fetch('https://www.netflix.com/YourAccount', {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Cookie': cookieStr,
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.9'
                        }
                    });
                    
                    const html = await fetchRes.text();
                    
                    // Helper to decode hex and unicode escapes from Netflix HTML
                    const decodeNetflixStr = (str) => {
                        if (!str) return 'Unknown';
                        return str.replace(/\\x([0-9A-Fa-f]{2})/g, (match, p1) => String.fromCharCode(parseInt(p1, 16)))
                                  .replace(/\\u([0-9A-Fa-f]{4})/g, (match, p1) => String.fromCharCode(parseInt(p1, 16)));
                    };

                    // Extract email
                    const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
                    const emails = Array.from(new Set(html.match(emailRegex) || []));
                    let email = emails.find(e => e.includes('@') && !e.includes('.png') && !e.includes('.jpg')) || 'Unknown';
                    email = decodeNetflixStr(email);
                    
                    // Extract plan
                    const planRegex = /"name":"(Premium|Standard|Basic|Mobile)"/i;
                    const planMatch = html.match(planRegex);
                    const plan = planMatch ? decodeNetflixStr(planMatch[1]) : 'Unknown';
                    
                    // Extract phone
                    const phoneRegex = /"phoneNumber":"([^"]+)"/;
                    const phoneMatch = html.match(phoneRegex);
                    const phone = phoneMatch ? decodeNetflixStr(phoneMatch[1]) : 'Unknown';
                    
                    // Extract payment
                    const paymentType = html.match(/"type":\{"fieldType":"String","value":"([^"]+)"\}/);
                    const paymentMethod = html.match(/"paymentMethod":\{"fieldType":"String","value":"([^"]+)"\}/);
                    const paymentText = html.match(/"displayText":\{"fieldType":"String","value":"([^"]+)"\}/);
                    
                    let paymentStr = 'Unknown';
                    if (paymentMethod || paymentType || paymentText) {
                        paymentStr = [
                            paymentMethod ? decodeNetflixStr(paymentMethod[1]) : '',
                            paymentType ? decodeNetflixStr(paymentType[1]) : '',
                            paymentText ? decodeNetflixStr(paymentText[1]) : ''
                        ].filter(Boolean).join(' ');
                    }
                    // Extract Region
                    const regionRegex = /"currentCountry":"([^"]+)"/;
                    const regionMatch = html.match(regionRegex);
                    const region = regionMatch ? decodeNetflixStr(regionMatch[1]) : 'Unknown';
                    
                    // Extract Profiles Count
                    const profileRegex = /"guid":"([^"]+)","maturityRating"/g;
                    const profilesMatch = html.match(profileRegex);
                    const totalProfiles = profilesMatch ? profilesMatch.length : 0;

                    res.writeHead(200, { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(JSON.stringify({ 
                        email: email,
                        phone: phone,
                        plan: plan,
                        payment: paymentStr,
                        region: region,
                        totalProfiles: totalProfiles,
                        lockedProfiles: "N/A",
                        unlockedProfiles: "N/A"
                    }));
                } catch (e) {
                    res.writeHead(500, { 
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

        const req = https.get(targetUrl, { headers }, (res) => {
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
    });
}

server.listen(PORT, () => {
    console.log(`\n=============================================`);
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`=============================================\n`);
});

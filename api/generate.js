const https = require('https');
const qs = require('querystring');

module.exports = (req, res) => {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        let cookieStr = req.body.cookie ? req.body.cookie.trim() : '';

        if (!cookieStr) {
            return res.status(400).json({ error: 'Missing cookie in request body' });
        }

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
                // Ignore JSON parse errors
            }
        }

        generateToken(cookieStr)
            .then(token => {
                res.status(200).json({ token: token });
            })
            .catch(err => {
                res.status(500).json({ error: err.message || 'Failed to generate token' });
            });

    } catch (e) {
        res.status(400).json({ error: 'Invalid request payload' });
    }
};

function generateToken(cookieStr) {
    return new Promise((resolve, reject) => {
        const queryParams = {
            appVersion: '15.48.1',
            device_type: 'NFAPPL-02-',
            esn: 'NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200',
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

        const targetUrl = 'https://ios.prod.ftl.netflix.com/iosui/user/15.48?' + qs.stringify(queryParams);

        const options = {
            method: 'GET',
            headers: {
                'User-Agent': 'Argo/15.48.1 (iPhone; iOS 15.8.5; Scale/2.00)',
                'Accept': '*/*',
                'Cookie': cookieStr,
                'x-netflix.request.routing': JSON.stringify({"path":"/nq/mobile/nqios/~15.48.0/user","control_tag":"iosui_argo"}),
                'x-netflix.client.type': 'argo',
                'x-netflix.client.ftl.esn': 'NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200'
            },
            timeout: 15000
        };

        const req = https.request(targetUrl, options, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json && json.value && json.value.account && json.value.account.token && json.value.account.token.default && json.value.account.token.default.token) {
                        resolve(json.value.account.token.default.token);
                    } else if (json.error) {
                        reject(new Error("Netflix API Error: " + JSON.stringify(json.error)));
                    } else {
                        reject(new Error(`Token not found (HTTP ${response.statusCode}). Cookie might be invalid or expired.`));
                    }
                } catch (e) {
                    reject(new Error(`Failed to parse Netflix response (HTTP ${response.statusCode})`));
                }
            });
        });

        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Request to Netflix timed out'));
        });

        req.on('error', (err) => {
            reject(new Error('Network error: ' + err.message));
        });

        req.end();
    });
}

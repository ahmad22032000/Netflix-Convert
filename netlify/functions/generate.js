const https = require('https');
const qs = require('querystring');

exports.handler = async (event, context) => {
    // Handle CORS Preflight requests
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

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const parsed = JSON.parse(event.body);
        let cookieStr = parsed.cookie ? parsed.cookie.trim() : '';
        
        if (!cookieStr) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing cookie in request body' })
            };
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
                // Ignore JSON parse errors and just use the raw string
            }
        }

        const token = await generateToken(cookieStr);
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ token: token })
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: error.message || 'Failed to generate token' })
        };
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

        const req = https.request(targetUrl, options, (res) => {
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
                        reject(new Error(`Token not found in response (HTTP ${res.statusCode}). Cookie might be invalid or expired.`));
                    }
                } catch (e) {
                    reject(new Error(`Failed to parse Netflix response (HTTP ${res.statusCode}): ${data.substring(0, 200)}`));
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

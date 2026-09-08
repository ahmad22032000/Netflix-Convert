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

        // Extract Next Billing Date
        const billingRegex = /"nextBillingDate":\{"fieldType":"String","value":"([^"]+)"\}/;
        const billingMatch = html.match(billingRegex);
        const nextBillingDate = billingMatch ? decodeNetflixStr(billingMatch[1]) : 'Unknown';

        // Extract Member Since (Unix timestamp in ms)
        const memberSinceRegex = /"memberSince":\{"fieldType":"Numeric","value":(\d+)\}/;
        const memberSinceMatch = html.match(memberSinceRegex);
        let memberSince = 'Unknown';
        if (memberSinceMatch) {
            const ts = parseInt(memberSinceMatch[1], 10);
            const date = new Date(ts);
            const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            memberSince = `${months[date.getMonth()]} ${date.getFullYear()}`;
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                email: email,
                phone: phone,
                plan: plan,
                payment: paymentStr,
                region: region,
                totalProfiles: totalProfiles,
                lockedProfiles: "N/A",
                unlockedProfiles: "N/A",
                nextBillingDate: nextBillingDate,
                memberSince: memberSince
            })
        };
    } catch (e) {
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: e.message || 'Failed to fetch account info' })
        };
    }
};

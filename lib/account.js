/**
 * Shared Netflix account + profile fetcher.
 *
 * Given a normalized cookie string, fetches /YourAccount and /profiles
 * concurrently from netflix.com and returns a merged object containing
 * account fields (email, plan, billing, ...) and a per-profile list with
 * PIN-lock status, kids flag, owner flag, maturity labels, and avatars.
 *
 * Used by all three deployment targets (Vercel api/, Netlify functions/,
 * local server.js) so the extraction logic lives in exactly one place.
 */

'use strict';

const {
    extractProfilesFromProfilesPage,
    extractProfilesFromAccountPage,
    mergeProfiles
} = require('./profiles');

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

function decodeNetflixStr(str) {
    if (!str) return 'Unknown';
    return String(str)
        .replace(/\\x([0-9A-Fa-f]{2})/g, (m, p1) => String.fromCharCode(parseInt(p1, 16)))
        .replace(/\\u([0-9A-Fa-f]{4})/g, (m, p1) => String.fromCharCode(parseInt(p1, 16)));
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/**
 * Fetch both Netflix pages and return the merged account/profile payload.
 * @param {string} cookieStr  normalized "name=value; ..." cookie header
 * @param {string} format     detected input format (header|json|netscape)
 * @returns {Promise<object>}  account + profiles object
 * @throws {Error}             with a user-facing message on auth/network failure
 */
async function fetchAccountInfo(cookieStr, format) {
    const headers = { ...BROWSER_HEADERS, 'Cookie': cookieStr };

    const [accountRes, profilesRes] = await Promise.allSettled([
        fetch('https://www.netflix.com/YourAccount', { headers, redirect: 'follow' }),
        fetch('https://www.netflix.com/profiles', { headers, redirect: 'follow' })
    ]);

    let accountHtml = '';
    let profilesHtml = '';

    if (accountRes.status === 'fulfilled') {
        accountHtml = await accountRes.value.text();
    }
    if (profilesRes.status === 'fulfilled') {
        profilesHtml = await profilesRes.value.text();
    }

    if (!accountHtml && !profilesHtml) {
        const err = new Error('Could not reach Netflix. Try again in a moment.');
        err.code = 'NETWORK';
        throw err;
    }

    // Detect logged-out state: neither page carries the expected markers.
    if (
        !accountHtml.includes('memberSince') &&
        !accountHtml.includes('accountInfo') &&
        !profilesHtml.includes('"isPinLocked"') &&
        !profilesHtml.includes('profileName')
    ) {
        const err = new Error('Cookie rejected by Netflix (session expired or logged out). Re-export a fresh netflix.com cookie.');
        err.code = 'AUTH';
        throw err;
    }

    // ---------- Account fields from /YourAccount ----------
    const accountInfoBlock = accountHtml.match(/"accountInfo":\{"data":\{([\s\S]{0,1200}?)\},"type"/);
    const accountBlock = accountInfoBlock ? accountInfoBlock[1] : accountHtml;

    let email = 'Unknown';
    const emailFieldMatch = accountBlock.match(/"emailAddress":"((?:[^"\\]|\\.)*)"/);
    if (emailFieldMatch) {
        email = decodeNetflixStr(emailFieldMatch[1]);
    } else {
        const emails = Array.from(new Set(accountHtml.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi) || []));
        email = decodeNetflixStr(emails.find(e => !e.includes('.png') && !e.includes('.jpg')) || 'Unknown');
    }

    const phoneMatch = accountBlock.match(/"phoneNumber":"((?:[^"\\]|\\.)*)"/) ||
                       accountHtml.match(/"csPhoneNumber":"((?:[^"\\]|\\.)*)"/);
    const phone = phoneMatch ? decodeNetflixStr(phoneMatch[1]) : 'Unknown';

    const planMatch = accountHtml.match(/"name":"(Premium|Standard|Basic|Mobile)"/i) ||
                      accountHtml.match(/"planName":"([^"]+)"/i) ||
                      accountHtml.match(/"currentPlan":\{"[^}]*?"name":"([^"]+)"/i);
    const plan = planMatch ? decodeNetflixStr(planMatch[1]) : 'Unknown';

    const paymentType = accountHtml.match(/"type":\{"fieldType":"String","value":"([^"]+)"\}/);
    const paymentMethod = accountHtml.match(/"paymentMethod":\{"fieldType":"String","value":"([^"]+)"\}/);
    const paymentText = accountHtml.match(/"displayText":\{"fieldType":"String","value":"([^"]+)"\}/);
    let paymentStr = 'Unknown';
    if (paymentMethod || paymentType || paymentText) {
        paymentStr = [
            paymentMethod ? decodeNetflixStr(paymentMethod[1]) : '',
            paymentType ? decodeNetflixStr(paymentType[1]) : '',
            paymentText ? decodeNetflixStr(paymentText[1]) : ''
        ].filter(Boolean).join(' ');
    }

    const regionMatch = accountHtml.match(/"currentCountry":"([^"]+)"/) ||
                        accountHtml.match(/"country":"([^"]+)"/);
    const region = regionMatch ? decodeNetflixStr(regionMatch[1]) : 'Unknown';

    const billingMatch = accountHtml.match(/"nextBillingDate":\{"fieldType":"String","value":"([^"]+)"\}/);
    const nextBillingDate = billingMatch ? decodeNetflixStr(billingMatch[1]) : 'Unknown';

    const memberSinceMatch = accountHtml.match(/"memberSince":\{"fieldType":"Numeric","value":(\d+)\}/);
    let memberSince = 'Unknown';
    if (memberSinceMatch) {
        const date = new Date(parseInt(memberSinceMatch[1], 10));
        memberSince = `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    }

    // ---------- Profiles: merge both pages ----------
    const acctProfiles = extractProfilesFromAccountPage(accountHtml);
    const profProfiles = profilesHtml ? extractProfilesFromProfilesPage(profilesHtml) : { profiles: [] };
    const profiles = mergeProfiles(acctProfiles.profiles, profProfiles.profiles);

    const pinLockedCount = profiles.filter(p => p.isPinLocked === true).length;
    const unlockedCount = profiles.filter(p => p.isPinLocked === false).length;

    return {
        email: email,
        phone: phone,
        plan: plan,
        payment: paymentStr,
        region: region,
        totalProfiles: profiles.length,
        lockedProfiles: pinLockedCount,
        unlockedProfiles: unlockedCount,
        profiles: profiles,
        nextBillingDate: nextBillingDate,
        memberSince: memberSince,
        cookieFormat: format
    };
}

module.exports = { fetchAccountInfo };

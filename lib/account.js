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
 *
 * Auth detection is deliberately strict: a logged-out cookie makes Netflix
 * answer 200 with the login page (which still contains words like
 * "memberSince", "profileName" and "country"), so raw substring checks are not
 * enough. We verify the final URL is not a login page AND that the page
 * carries a structural logged-in marker. Anything else is reported as AUTH /
 * UPSTREAM instead of silently returning a payload full of "Unknown".
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

/** Login pages live at /login, /<country>/login, /Login, ... */
const LOGIN_PATH = /(^|\/)login(\/|$)/i;

/** Structural markers that only appear on a logged-in /YourAccount page. */
const ACCOUNT_MARKERS = [
    /"accountInfo"\s*:\s*\{\s*"data"\s*:\s*\{/,
    /"memberSince"\s*:\s*\{\s*"fieldType"\s*:\s*"Numeric"/,
    /"currentPlan"\s*:\s*\{/,
    /"membershipStatus"\s*:/,
    /"paymentMethod"\s*:\s*\{\s*"fieldType"/
];

/** Structural markers that only appear on a logged-in /profiles page. */
const PROFILE_MARKERS = [
    /"isPinLocked"\s*:/,
    /"profiles"\s*:\s*\[/,
    /"accountOwnerName"\s*:/,
    /"profileGuid"\s*:/
];

function decodeNetflixStr(str) {
    if (!str) return 'Unknown';
    return String(str)
        .replace(/\\x([0-9A-Fa-f]{2})/g, (m, p1) => String.fromCharCode(parseInt(p1, 16)))
        .replace(/\\u([0-9A-Fa-f]{4})/g, (m, p1) => String.fromCharCode(parseInt(p1, 16)));
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function pathOf(url) {
    try {
        return new URL(url).pathname || '';
    } catch (_) {
        return '';
    }
}

async function fetchPage(targetUrl, headers) {
    const res = await fetch(targetUrl, { headers, redirect: 'follow' });
    const html = await res.text();
    return {
        status: res.status,
        url: res.url || targetUrl,
        html: html,
        ok: res.status >= 200 && res.status < 400
    };
}

/** True when Netflix answered with a login page instead of the requested page. */
function isLoggedOut(page) {
    if (!page) return false;
    if (page.status === 401 || page.status === 403) return true;
    if (LOGIN_PATH.test(pathOf(page.url))) return true;
    // A 200 page that redirected to the marketing/auth flow carries no session.
    return /"isLoggedIn"\s*:\s*false/.test(page.html || '');
}

function hasMarkers(page, markers) {
    if (!page || !page.ok) return false;
    if (isLoggedOut(page)) return false;
    return markers.some(re => re.test(page.html || ''));
}

/**
 * Fetch both Netflix pages and return the merged account/profile payload.
 * @param {string} cookieStr  normalized "name=value; ..." cookie header
 * @param {string} format     detected input format (header|json|netscape)
 * @returns {Promise<object>}  account + profiles object
 * @throws {Error}             code=AUTH (cookie rejected), NETWORK (unreachable),
 *                             UPSTREAM (Netflix answered but markup unrecognized)
 */
async function fetchAccountInfo(cookieStr, format) {
    const headers = { ...BROWSER_HEADERS, 'Cookie': cookieStr };

    const [accountRes, profilesRes] = await Promise.allSettled([
        fetchPage('https://www.netflix.com/YourAccount', headers),
        fetchPage('https://www.netflix.com/profiles', headers)
    ]);

    const accountPage = accountRes.status === 'fulfilled' ? accountRes.value : null;
    const profilesPage = profilesRes.status === 'fulfilled' ? profilesRes.value : null;

    if (!accountPage && !profilesPage) {
        const err = new Error('Could not reach Netflix. Try again in a moment.');
        err.code = 'NETWORK';
        throw err;
    }

    const accountValid = hasMarkers(accountPage, ACCOUNT_MARKERS);
    const profilesValid = hasMarkers(profilesPage, PROFILE_MARKERS);

    if (!accountValid && !profilesValid) {
        const loggedOut = isLoggedOut(accountPage) || isLoggedOut(profilesPage);

        const err = new Error(
            loggedOut
                ? 'Cookie rejected by Netflix (session expired or logged out). Re-export a fresh netflix.com cookie.'
                : 'Netflix returned an unexpected page. Try again in a moment.'
        );
        err.code = loggedOut ? 'AUTH' : 'UPSTREAM';
        throw err;
    }

    // Only parse pages that actually belong to a logged-in session.
    const accountHtml = accountValid ? accountPage.html : '';
    const profilesHtml = profilesValid ? profilesPage.html : '';

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
        authenticated: true,
        partial: !accountValid || !profilesValid,
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

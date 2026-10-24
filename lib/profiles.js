/**
 * Netflix profile extractor — dual-source.
 *
 * Netflix exposes profile data in two different pages with two different
 * serialization formats:
 *
 *   1. /YourAccount  — Apollo GraphQL cache. Each profile is keyed by
 *      `Profile:{\"guid\":\"GUID\"}` and has fields: name, guid, isKids,
 *      maturityRating{labels}, isProfileCreationLocked, icon ref.
 *      Also has accountInfo (email, phone, plan, billing) and a
 *      contentRestrictions block with the active profile's avatar images.
 *      DOES NOT contain isPinLocked.
 *
 *   2. /profiles      — Falcor/shakti JSON. A `profiles` map keyed by guid,
 *      each entry has a `summary` atom containing: profileName, guid,
 *      isPinLocked, isKids, isActive, isAccountOwner, maturityLevel,
 *      language. An `avatars` map provides per-guid image URLs by width.
 *      DOES NOT contain plan/billing/payment info.
 *
 * To get the full picture (names + PIN status + avatars + account fields),
 * the caller fetches BOTH pages and merges. This module provides:
 *
 *   extractProfilesFromProfilesPage(html)  -> { profiles:[{name,guid,isPinLocked,...,avatar}], ... }
 *   extractProfilesFromAccountPage(html)   -> { profiles:[{name,guid,isKids,maturityLabels,...}], ... }
 *   mergeProfiles(acctList, profilesList)  -> merged array keyed by guid
 */

'use strict';

const { decodeEscapes } = require('./cookie');

function cleanStr(s) {
    if (!s) return '';
    return decodeEscapes(s).replace(/\\\//g, '/');
}

/**
 * Extract profiles from the /profiles (switch profile) page.
 * Source shape:
 *   "profiles":{"GUID":{"summary":{"$type":"atom","value":{
 *     "profileName":"Lizeth","guid":"...","isPinLocked":false,
 *     "isKids":false,"isActive":true,"isAccountOwner":true,
 *     "maturityLevel":"ADULTS","language":"en-JP", ...}}}}
 *   "avatars":{"nf":{"GUID":{"images":{"byWidth":{"32":{...value:"url"},"320":{...}}}}}}
 */
function extractProfilesFromProfilesPage(html) {
    const profiles = [];
    const seen = new Set();

    // Match each summary atom value. Netflix escapes "$" as \x24 inside the HTML,
    // and profileName always precedes guid in the serialization.
    const summaryRe = /"profileName":"((?:[^"\\]|\\.)*)"\s*,\s*"guid":"([^"]+)"([\s\S]{0,1500}?)\}/g;

    let m;
    while ((m = summaryRe.exec(html)) !== null) {
        const [, rawName, guid, tail] = m;
        if (!guid || seen.has(guid)) continue;
        seen.add(guid);

        const pin = tail.match(/"isPinLocked":(true|false)/);
        const kids = tail.match(/"isKids":(true|false)/);
        const active = tail.match(/"isActive":(true|false)/);
        const owner = tail.match(/"isAccountOwner":(true|false)/);
        const maturity = tail.match(/"maturityLevel":"([^"]+)"/);
        const lang = tail.match(/"language":"([^"]+)"/);

        profiles.push({
            name: cleanStr(rawName),
            guid,
            isPinLocked: pin ? pin[1] === 'true' : null,
            isKids: kids ? kids[1] === 'true' : null,
            isActive: active ? active[1] === 'true' : null,
            isAccountOwner: owner ? owner[1] === 'true' : null,
            maturityLevel: maturity ? cleanStr(maturity[1]) : null,
            language: lang ? cleanStr(lang[1]) : null,
            avatar: null
        });
    }

    // Attach avatars from the avatars map.
    for (const p of profiles) {
        const guidIdx = html.indexOf('"' + p.guid + '":{"images"');
        if (guidIdx === -1) continue;
        const window = html.slice(guidIdx, guidIdx + 2400);
        let raw = null;
        for (const w of ['320', '200', '160', '128', '112', '100', '80', '64', '50', '32']) {
            const wm = window.match(new RegExp('"' + w + '":\\{"(?:\\\\x24|\\$)?type":"atom","value":"((?:[^"\\\\]|\\\\.)*)"'));
            if (wm) { raw = wm[1]; break; }
        }
        if (raw) p.avatar = cleanStr(raw);
    }

    const pinLockedCount = profiles.filter(p => p.isPinLocked === true).length;
    const unlockedCount = profiles.filter(p => p.isPinLocked === false).length;

    return { profiles, totalProfiles: profiles.length, pinLockedCount, unlockedCount };
}

/**
 * Extract profiles from the /YourAccount page (Apollo cache).
 * Source shape:
 *   "Profile:{\"guid\":\"GUID\"}":{"__typename":"Profile",
 *     "isKids":false,"guid":"GUID",
 *     "maturityRating":{"__typename":"ProfileMaturityRating",
 *       "isHighest":true,"isLowest":false,"labels":["18+"]},
 *     "name":"Lizeth","isProfileCreationLocked":false}
 *
 * Also pulls avatar URLs from the contentRestrictions block for the active
 * profile, and from any inline image URLs near each profile entry.
 */
function extractProfilesFromAccountPage(html) {
    const profiles = [];
    const seen = new Set();

    // Each Apollo profile entry is anchored by "guid":"GUID","maturityRating"
    // with "name":"..." appearing shortly after.
    const anchorRe = /"guid":"([^"]+)","maturityRating":\{"[^}]*?"labels":\[([^\]]*)\][^}]*?\},"name":"((?:[^"\\]|\\.)*)"/g;

    let m;
    while ((m = anchorRe.exec(html)) !== null) {
        const [, guid, labelsRaw, rawName] = m;
        if (!guid || seen.has(guid)) continue;
        seen.add(guid);

        // Look backwards ~400 chars for isKids in the same Profile object.
        const lookback = html.slice(Math.max(0, m.index - 400), m.index);
        const kids = lookback.match(/"isKids":(true|false)/);

        const labels = labelsRaw.match(/"([^"]+)"/g);
        const maturityLabels = labels ? labels.map(l => l.replace(/"/g, '')) : [];

        profiles.push({
            name: cleanStr(rawName),
            guid,
            isKids: kids ? kids[1] === 'true' : null,
            maturityLabels,
            avatar: null
        });
    }

    // Attach avatar from contentRestrictions.profileInfo.avatarImages (active profile only).
    const crIdx = html.indexOf('"contentRestrictions"');
    if (crIdx > -1) {
        const crWindow = html.slice(crIdx, crIdx + 4000);
        const guidM = crWindow.match(/"guid":"([^"]+)"/);
        if (guidM) {
            const activeGuid = guidM[1];
            const prof = profiles.find(p => p.guid === activeGuid);
            if (prof) {
                for (const w of ['320', '200', '160', '112', '100', '80', '64', '50', '32']) {
                    const am = crWindow.match(new RegExp('"' + w + '":"((?:[^"\\\\]|\\\\.)*)"'));
                    if (am) { prof.avatar = cleanStr(am[1]); break; }
                }
            }
        }
    }

    return { profiles };
}

/**
 * Merge two profile arrays by guid. Fields from the profiles-page extraction
 * (isPinLocked, avatar, isActive, isAccountOwner) take priority; fields from
 * the account-page extraction (maturityLabels) fill gaps.
 */
function mergeProfiles(acctList, profilesList) {
    const byGuid = new Map();

    for (const p of profilesList) {
        byGuid.set(p.guid, { ...p });
    }

    for (const p of acctList) {
        const existing = byGuid.get(p.guid);
        if (existing) {
            if (existing.maturityLevel == null && p.maturityLabels) {
                existing.maturityLabels = p.maturityLabels;
            }
            if (existing.isKids == null) existing.isKids = p.isKids;
            if (existing.avatar == null) existing.avatar = p.avatar;
        } else {
            // Profile only seen on account page (rare) — add with nulls for PIN.
            byGuid.set(p.guid, {
                name: p.name,
                guid: p.guid,
                isPinLocked: null,
                isKids: p.isKids,
                isActive: null,
                isAccountOwner: null,
                maturityLevel: null,
                maturityLabels: p.maturityLabels,
                language: null,
                avatar: p.avatar
            });
        }
    }

    return Array.from(byGuid.values());
}

module.exports = {
    extractProfilesFromProfilesPage,
    extractProfilesFromAccountPage,
    mergeProfiles
};

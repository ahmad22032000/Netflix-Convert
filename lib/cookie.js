/**
 * Netflix cookie normalizer.
 * Accepts three input formats and returns a single "name=value; name=value" string
 * suitable for use as the HTTP `Cookie` header sent to netflix.com.
 *
 * Supported formats:
 *   1. Header string         -> "NetflixId=abc; SecureNetflixId=def; ..."
 *   2. Cookie-Editor JSON    -> [{"name":"NetflixId","value":"abc",...}, ...]
 *   3. Netscape cookies.txt  -> "# Netscape HTTP Cookie File\n.netflix.com  TRUE  /  TRUE  ...  NetflixId  abc"
 *
 * Exposed API:
 *   normalizeCookie(input)   -> { cookie: "...", format: "header"|"json"|"netscape"|"unknown", count: <n> }
 */

'use strict';

/**
 * Decode Netflix-style \\xHH and \\uHHHH escapes embedded in raw cookie values.
 * Netflix sometimes emits values containing literal "\x20" sequences when copied
 * from certain exporters; this keeps them valid in the header.
 */
function decodeEscapes(str) {
    if (!str) return '';
    return String(str)
        .replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Recover cookies from a Netscape blob that lost its newlines and tabs.
 *
 * Typing/pasting a cookies.txt into a single-line context (or some chat apps)
 * flattens "\n" and "\t" into nothing. The remaining string still contains a
 * recognizable repeating pattern:
 *
 *   (?:#HttpOnly_)?<domain> TRUE|FALSE / TRUE|FALSE <digits> <name> <value>
 *
 * The domain and name never contain whitespace; the value runs until the next
 * occurrence of the pattern (or end of string). This lets us recover every
 * cookie from a flattened blob without any delimiters.
 *
 * Returns an array of {name, value} or null if the pattern does not appear.
 */
function recoverFlattenedNetscape(input) {
    // Anchor: domain chars, then the boolean flags, path "/", secure flag, expiry digits.
    // We scan for each match and use the NEXT match's start as the value terminator.
    // Two guards against false positives inside cookie values:
    //   1. Require the literal path "/" between booleans.
    //   2. Require the match to start at line-begin, or right after "#HttpOnly_"
    //      at line-begin, or after whitespace. Cookie values are URL-encoded and
    //      never contain raw whitespace, so this prevents matching inside a value.
    const anchor = /(?:#HttpOnly_)?((?:\.[A-Za-z0-9\-]+|[A-Za-z][A-Za-z0-9\-]*)\.[A-Za-z]{2,})(TRUE|FALSE)\/(TRUE|FALSE)(\d{8,})/g;

    const hits = [];
    let m;
    while ((m = anchor.exec(input)) !== null) {
        // Guard: skip matches that are clearly embedded in a cookie value.
        // A real Netscape row always has "#HttpOnly_" or nothing before the
        // domain, and cookie values never contain "TRUE/" or "FALSE/" flags.
        // The domain must contain a dot but must NOT look like "3D<digits>"
        // (a percent-decoded fragment leaking from a value).
        if (/^3D\d/i.test(m[1])) continue;
        // Reject domains whose first label is purely digits (value fragments).
        const firstLabel = m[1].replace(/^\./, '').split('.')[0];
        if (/^\d+$/.test(firstLabel)) continue;

        hits.push({ index: m.index, fullLength: m[0].length, domain: m[1], expiry: m[4] });
    }

    if (hits.length === 0) return null;

    const pairs = [];

    // Netflix cookie names are a small known set. When the blob is flattened,
    // the name and value fuse together ("SecureNetflixIdv%3D..."), so we split
    // the captured name-blob at the longest known cookie-name prefix.
    const KNOWN_NAMES = [
        'SecureNetflixId', 'NetflixId', 'nfvdid', 'gsid', 'memclid',
        'OptanonConsent', 'OptanonAlertBoxClosed', 'flxwt', 'dscm', 'clh'
    ].sort((a, b) => b.length - a.length);

    for (let i = 0; i < hits.length; i++) {
        const start = hits[i].index + hits[i].fullLength;
        const end = i + 1 < hits.length ? hits[i + 1].index : input.length;
        let nameValue = input.slice(start, end);

        // nameValue begins with the cookie name fused to its value.
        const nv = nameValue.match(/^([A-Za-z0-9_\-]+)([\s\S]*)$/);
        if (!nv) continue;

        const blob = nv[1];
        let rest = nv[2];
        let name = null;

        // Find a known name that prefixes the blob; the remainder starts the value.
        for (const known of KNOWN_NAMES) {
            if (blob === known) {
                name = blob;
                break;
            }
            if (blob.startsWith(known)) {
                name = known;
                rest = blob.slice(known.length) + rest;
                break;
            }
        }
        // Unknown cookie name — use the blob as-is only if nothing follows.
        if (!name) {
            if (rest) continue; // ambiguous fusion, skip
            name = blob;
        }

        if (!name) continue;
        // Skip the column-label row if a header slipped through.
        if (/^(domain|name|value|flag|path|secure|expiration)$/i.test(name)) continue;

        pairs.push({ name, value: rest });
    }

    if (pairs.length === 0) return null;

    return pairs;
}

/**
 * Try to parse a Netscape cookies.txt blob.
 * Format per line (tab-separated):
 *   domain  includeSubdomains  path  secure  expiration  name  value
 * Lines starting with '#' are comments. The Cookie-Editor extension uses the
 * special prefix "#HttpOnly_" on domain (not a comment) — that line IS a cookie.
 *
 * Robust to common paste damage:
 *   - tab separator preserved (preferred)
 *   - 2+ space separator (tabs collapsed to spaces by some textareas)
 *   - single-space separator
 *   - COMPLETELY flattened input (no newlines, no tabs) — recovered structurally
 *   - "#HttpOnly_" prefix stripped
 *
 * Returns null if the input does not look like a Netscape file.
 */
function parseNetscape(input) {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const lines = trimmed.split(/\r?\n/);
    let cookieLines = 0;
    const pairs = [];

    for (const rawLine of lines) {
        let line = rawLine.replace(/\r$/, '');
        if (!line) continue;
        // Skip pure comments (start with '#' but NOT '#HttpOnly_')
        if (line.startsWith('#') && !/^#HttpOnly_/i.test(line)) continue;
        // Strip the "#HttpOnly_" marker — the rest is a real cookie row
        line = line.replace(/^#HttpOnly_/i, '');

        // Split: prefer tabs; if none, fall back to runs of 2+ spaces.
        let fields = line.split('\t');
        if (fields.length < 7) {
            fields = line.split(/[ ]{2,}/);
        }
        // Last resort: split on single spaces — only valid if we end up with >= 7
        // fields AND the 6th looks like a name (alphanumeric). The value is
        // everything after the 6th space, so rejoin to preserve spaces in values.
        if (fields.length < 7) {
            const single = line.split(' ');
            if (single.length >= 7) {
                fields = single.slice(0, 6).concat([single.slice(6).join(' ')]);
            }
        }
        if (fields.length < 7) continue;

        const [domain, /*flag*/, /*path*/, /*secure*/, /*expiration*/, name, value] = fields;
        if (!name || !domain) continue;
        // Filter out header noise like "domain", "flag", "name" column labels
        if (/^(domain|flag|path|secure|expiration|name|value)$/i.test(name)) continue;

        cookieLines++;
        pairs.push({ name: name.trim(), value: value || '' });
    }

    if (cookieLines > 0) {
        return pairs.map(p => `${p.name}=${p.value}`).join('; ');
    }

    // Fallback: the whole blob was flattened into one line with no delimiters.
    const recovered = recoverFlattenedNetscape(trimmed);
    if (recovered) {
        return recovered.map(p => `${p.name}=${p.value}`).join('; ');
    }

    return null;
}

/**
 * Try to parse a Cookie-Editor / browser-export JSON array.
 * Each entry typically has {name, value, domain, path, ...}.
 * Also tolerates a single object ({name, value}) or an object with a `cookies` array.
 * Returns null if input is not JSON of this shape.
 */
function parseJsonArray(input) {
    const trimmed = input.trim();
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;

    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    } catch (_) {
        return null;
    }

    let arr = null;
    if (Array.isArray(parsed)) {
        arr = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.cookies)) {
        arr = parsed.cookies;
    } else if (parsed && typeof parsed === 'object' && parsed.name && parsed.value) {
        arr = [parsed];
    }

    if (!arr || arr.length === 0) return null;

    const pairs = arr
        .filter(c => c && c.name)
        .map(c => ({ name: String(c.name), value: c.value != null ? String(c.value) : '' }));

    if (pairs.length === 0) return null;

    return pairs.map(p => `${p.name}=${p.value}`).join('; ');
}

/**
 * Detect and normalize any supported cookie input.
 * Order of detection:
 *   1. JSON (starts with '[' or '{')  -> parseJsonArray
 *   2. Netscape (contains tab-separated 7-field rows) -> parseNetscape
 *   3. Header string (fallback)
 */
function normalizeCookie(input) {
    if (!input || typeof input !== 'string') {
        return { cookie: '', format: 'unknown', count: 0 };
    }

    const raw = input.trim();
    if (!raw) return { cookie: '', format: 'unknown', count: 0 };

    // 1. JSON
    if (raw.startsWith('[') || raw.startsWith('{')) {
        const out = parseJsonArray(raw);
        if (out) {
            return { cookie: out, format: 'json', count: out.split(';').length };
        }
    }

    // 2. Netscape — check before header string, because a cookies.txt is line-oriented
    //    and would otherwise be treated as a single weird header line.
    const netscape = parseNetscape(raw);
    if (netscape) {
        return { cookie: netscape, format: 'netscape', count: netscape.split(';').length };
    }

    // 3. Header string fallback
    const cleaned = raw
        // strip a leading "Cookie:" label if present
        .replace(/^cookie\s*:\s*/i, '')
        // collapse runs of whitespace
        .replace(/\s*;\s*/g, '; ')
        .trim();

    return { cookie: cleaned, format: 'header', count: cleaned ? cleaned.split(';').length : 0 };
}

module.exports = { normalizeCookie, decodeEscapes, parseNetscape, parseJsonArray };

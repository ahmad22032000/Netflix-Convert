/**
 * Headless test for the device-selection flow in script.js.
 * Run: node test_device_flow.js
 *
 * Mimics just enough DOM to prove:
 *  - default device is Web
 *  - only ONE device is generated per click (single /api/generate request)
 *  - the generated link matches the selected button
 *  - switching device clears the previous link (no stale/3-device output)
 *  - errors never crash the UI
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scriptSrc = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

/* ------------------------- tiny DOM ------------------------- */

class ClassList {
    constructor(el) { this.el = el; }
    _set() { return this.el._classes; }
    add(...names) { names.forEach(n => this._set().add(n)); }
    remove(...names) { names.forEach(n => this._set().delete(n)); }
    contains(n) { return this._set().has(n); }
    toggle(n, force) {
        const on = force === undefined ? !this._set().has(n) : !!force;
        if (on) this._set().add(n); else this._set().delete(n);
        return on;
    }
}

class El {
    constructor(tag, id, cls) {
        this.tagName = tag;
        this.id = id || '';
        this.dataset = {};
        this.textContent = '';
        this.innerHTML = '';
        this.hidden = false;
        this.disabled = false;
        this.value = '';
        this.style = {};
        this.attrs = {};
        this._classes = new Set((cls || '').split(/\s+/).filter(Boolean));
        this.classList = new ClassList(this);
        this._listeners = {};
        this.parentNode = null;
        this.children = [];
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k === 'id' ? this.id : (k in this.attrs ? this.attrs[k] : (k === 'class' ? [...this._classes].join(' ') : null)); }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { this.children = this.children.filter(c => c !== child); return child; }
    replaceChild(next, prev) { const i = this.children.indexOf(prev); if (i > -1) this.children[i] = next; next.parentNode = this; return prev; }
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    async dispatch(type, event) {
        for (const fn of (this._listeners[type] || [])) await fn(event || { currentTarget: this, type });
    }
    scrollIntoView() {}
}

const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const registry = new Map();
ids.forEach(id => registry.set(id, new El('div', id)));

const deviceBtns = [...html.matchAll(/<button[^>]*class="device-btn([^"]*)"[^>]*data-device="([^"]+)"/g)].map(m => {
    const el = new El('button', '', 'device-btn' + m[1]);
    el.setAttribute('data-device', m[2]);
    return el;
});
assert.strictEqual(deviceBtns.length, 3, 'expected 3 device buttons in index.html');

const actionBtns = [...html.matchAll(/<button[^>]*class="([^"]*(?:copy-btn|open-btn))"[^>]*data-target="([^"]+)"/g)]
    .map(m => { const el = new El('button', '', m[1]); el.setAttribute('data-target', m[2]); return el; });

const document = {
    _domReady: [],
    addEventListener(type, fn) { if (type === 'DOMContentLoaded') this._domReady.push(fn); },
    getElementById: (id) => registry.get(id) || null,
    createElement: (tag) => new El(tag),
    querySelectorAll: (sel) => {
        const cls = sel.replace(/^\./, '');
        if (cls === 'device-btn') return deviceBtns;
        return actionBtns.filter(b => b._classes.has(cls));
    },
    body: new El('body')
};

const window = {
    location: { protocol: 'http:' },
    open: () => {}
};

/* ------------------------- fetch mock ------------------------- */

const calls = [];
let nextGenerate = (device) => ({ token: 'TOK_' + device.toUpperCase(), link: `https://netflix.com/LINK_${device}`, device });
let generateFails = false;
let accountMode = 'fail';   // fail | ok | partial

global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body });

    if (url.endsWith('/api/generate')) {
        if (generateFails) return { ok: false, status: 500, json: async () => ({ error: 'Netflix API Error' }) };
        return { ok: true, status: 200, json: async () => nextGenerate(body.device) };
    }

    if (accountMode === 'fail') {
        return {
            ok: false,
            status: 401,
            json: async () => ({ error: 'Cookie rejected by Netflix (session expired or logged out).' })
        };
    }

    const payload = {
        email: 'user@example.com',
        phone: '+6281234567890',
        plan: 'Premium',
        region: 'ID',
        nextBillingDate: '2026-11-24',
        memberSince: 'March 2020',
        payment: 'Visa 4242',
        totalProfiles: 1,
        lockedProfiles: 1,
        unlockedProfiles: 0,
        profiles: [{ name: 'Alice', guid: 'GUID1', isPinLocked: true, isKids: false, isActive: true, isAccountOwner: true }],
        authenticated: true,
        partial: accountMode === 'partial'
    };
    return { ok: true, status: 200, json: async () => payload };
};

/* ------------------------- run script.js ------------------------- */

const fn = new Function('document', 'window', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout', 'navigator', scriptSrc + '\n//# sourceURL=script.js');
fn(document, window, global.fetch, AbortController, setTimeout, clearTimeout, { clipboard: { writeText: async () => {} } });

const run = async () => {
    for (const f of document._domReady) await f();

    const extractBtn = registry.get('extractBtn');
    const cookieInput = registry.get('cookieInput');
    const resultCard = registry.get('resultCard');
    const resultLinkText = registry.get('resultLinkText');
    const resultDeviceLabel = registry.get('resultDeviceLabel');
    const extractBtnLabel = registry.get('extractBtnLabel');
    const errorMessage = registry.get('errorMessage');
    const accountNotice = registry.get('accountNotice');
    const accEmail = registry.get('accEmail');

    // 1. initial state
    assert.strictEqual(resultCard.hidden, true, 'result card must start hidden');
    assert.strictEqual(extractBtnLabel.textContent, 'Generate Web Link');
    assert.strictEqual(deviceBtns[0].classList.contains('active'), true, 'web selected by default');

    // 2. generate with default device -> exactly one generate call, web link
    cookieInput.value = 'NetflixId=fake; SecureNetflixId=fake';
    calls.length = 0;
    await extractBtn.dispatch('click');

    const genCalls = calls.filter(c => c.url.endsWith('/api/generate'));
    assert.strictEqual(genCalls.length, 1, 'must generate exactly one device per click');
    assert.strictEqual(genCalls[0].body.device, 'web');
    assert.strictEqual(resultCard.hidden, false, 'result must be visible');
    assert.strictEqual(resultDeviceLabel.textContent, 'Web');
    assert.strictEqual(resultLinkText.dataset.fullLink, 'https://netflix.com/LINK_web');

    // 2b. account-info failed (401) -> honest placeholder + notice, no fake data
    assert.strictEqual(accEmail.textContent, '—', 'no fake email on rejected cookie');
    assert.strictEqual(accountNotice.hidden, false, 'account notice must show');
    assert.ok(/rejected|expired/i.test(accountNotice.textContent), accountNotice.textContent);

    // 3. switch to TV -> previous link cleared, no request fired
    calls.length = 0;
    await deviceBtns[2].dispatch('click');
    assert.strictEqual(calls.length, 0, 'device switch must not auto-generate');
    assert.strictEqual(resultCard.hidden, true, 'stale link must be cleared on device switch');
    assert.strictEqual(resultLinkText.dataset.fullLink, undefined);
    assert.strictEqual(extractBtnLabel.textContent, 'Generate TV Link');

    // 4. generate selected device -> link matches the selected button
    await extractBtn.dispatch('click');
    const tvCall = calls.filter(c => c.url.endsWith('/api/generate'));
    assert.strictEqual(tvCall.length, 1);
    assert.strictEqual(tvCall[0].body.device, 'tv');
    assert.strictEqual(resultDeviceLabel.textContent, 'TV');
    assert.strictEqual(resultLinkText.dataset.fullLink, 'https://netflix.com/LINK_tv');

    // 4b. account-info ok -> real data, notice hidden
    accountMode = 'ok';
    await extractBtn.dispatch('click');
    assert.strictEqual(accEmail.textContent, 'user@example.com');
    assert.strictEqual(accountNotice.hidden, true, 'notice hidden when data is complete');

    // 4c. partial payload -> notice warns instead of silently showing Unknown
    accountMode = 'partial';
    await extractBtn.dispatch('click');
    assert.strictEqual(accountNotice.hidden, false, 'partial data must raise a notice');
    assert.ok(/Limited data/i.test(accountNotice.textContent), accountNotice.textContent);
    accountMode = 'fail';

    // 5. server-side device echo wins (mismatched response cannot break UI)
    nextGenerate = () => ({ token: 'TOK_X', link: 'https://netflix.com/FROM_SERVER', device: 'mobile' });
    await deviceBtns[0].dispatch('click');
    await extractBtn.dispatch('click');
    assert.strictEqual(resultDeviceLabel.textContent, 'Mobile');
    assert.strictEqual(resultLinkText.dataset.fullLink, 'https://netflix.com/FROM_SERVER');

    // 6. incomplete payload -> token fallback still builds a link
    nextGenerate = () => ({ token: 'TOK_FALLBACK', device: 'tv' });
    await deviceBtns[2].dispatch('click');
    await extractBtn.dispatch('click');
    assert.strictEqual(resultLinkText.dataset.fullLink, 'https://netflix.com/tv2?nftoken=TOK_FALLBACK');

    // 7. API error -> banner shown, controls re-enabled, no crash
    generateFails = true;
    calls.length = 0;
    await extractBtn.dispatch('click');
    assert.strictEqual(extractBtn.disabled, false, 'button must be re-enabled after failure');
    assert.strictEqual(errorMessage.style.display, 'block', 'error banner must show');
    assert.strictEqual(resultCard.hidden, true, 'no link card on failure');
    assert.ok(/Netflix API Error/.test(errorMessage.textContent), 'error text must be surfaced');
    generateFails = false;

    // 8. empty cookie -> error, zero requests
    calls.length = 0;
    cookieInput.value = '   ';
    await extractBtn.dispatch('click');
    assert.strictEqual(calls.length, 0, 'no request without a cookie');

    console.log('PASS — device selection flow verified');
    console.log('  · one device generated per click');
    console.log('  · link matches selected button (web/mobile/tv)');
    console.log('  · switching device clears stale link, fires no request');
    console.log('  · API errors surface without crashing the UI');
};

run().catch(err => {
    console.error('FAIL —', err.message);
    process.exit(1);
});

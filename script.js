document.addEventListener('DOMContentLoaded', () => {
    const cookieInput = document.getElementById('cookieInput');
    const extractBtn = document.getElementById('extractBtn');
    const extractBtnLabel = document.getElementById('extractBtnLabel');
    const errorMessage = document.getElementById('errorMessage');
    const resultsSection = document.getElementById('resultsSection');

    // Device selector
    const deviceBtns = Array.from(document.querySelectorAll('.device-btn'));
    const deviceHint = document.getElementById('deviceHint');

    // Single result link
    const resultCard = document.getElementById('resultCard');
    const resultDeviceLabel = document.getElementById('resultDeviceLabel');
    const resultLinkText = document.getElementById('resultLinkText');
    const resultEmpty = document.getElementById('resultEmpty');

    // Account info
    const accEmail = document.getElementById('accEmail');
    const accPhone = document.getElementById('accPhone');
    const accPlan = document.getElementById('accPlan');
    const accNextPayment = document.getElementById('accNextPayment');
    const accMemberSince = document.getElementById('accMemberSince');
    const accPayment = document.getElementById('accPayment');
    const accRegion = document.getElementById('accRegion');
    const accTotalProfiles = document.getElementById('accTotalProfiles');
    const accLockedProfiles = document.getElementById('accLockedProfiles');
    const accUnlockedProfiles = document.getElementById('accUnlockedProfiles');
    const profilesGrid = document.getElementById('profilesGrid');
    const profileCountBadge = document.getElementById('profileCountBadge');
    const accountNotice = document.getElementById('accountNotice');

    const openBtns = document.querySelectorAll('.open-btn');

    // Mirror of lib/devices.js — one link per selected device.
    const DEVICES = {
        web: {
            label: 'Web',
            buildLink: (token) => `https://netflix.com/?nftoken=${token}`
        },
        mobile: {
            label: 'Mobile',
            buildLink: (token) => `https://netflix.com/unsupported?nftoken=${token}`
        },
        tv: {
            label: 'TV',
            buildLink: (token) => `https://netflix.com/tv2?nftoken=${token}`
        }
    };

    const DEFAULT_DEVICE = 'web';
    const REQUEST_TIMEOUT_MS = 25000;

    const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

    let selectedDevice = DEFAULT_DEVICE;
    let busy = false;

    /* ---------------- device selection ---------------- */

    function deviceInfo(device) {
        return DEVICES[device] || DEVICES[DEFAULT_DEVICE];
    }

    function updateDeviceUI() {
        deviceBtns.forEach(btn => {
            const isActive = btn.getAttribute('data-device') === selectedDevice;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        extractBtnLabel.textContent = `Generate ${deviceInfo(selectedDevice).label} Link`;
        deviceHint.textContent = `Selected: ${deviceInfo(selectedDevice).label} — only this device is generated.`;
    }

    deviceBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const device = btn.getAttribute('data-device');
            if (!device || !DEVICES[device] || busy) return;

            selectedDevice = device;
            updateDeviceUI();
            clearResult();       // stale link must never survive a device switch
            hideError();
        });
    });

    function setControlsDisabled(disabled) {
        busy = disabled;
        extractBtn.disabled = disabled;
        deviceBtns.forEach(btn => { btn.disabled = disabled; });
    }

    /* ---------------- result rendering ---------------- */

    function showResult(device, link) {
        const info = deviceInfo(device);
        resultDeviceLabel.textContent = info.label;
        resultLinkText.textContent = link;
        resultLinkText.dataset.fullLink = link;
        resultCard.hidden = false;
        resultEmpty.hidden = true;
        resultEmpty.textContent = 'Pick a device and press Generate to create one link.';
    }

    function clearResult() {
        delete resultLinkText.dataset.fullLink;
        resultLinkText.textContent = 'https://netflix.com/?nftoken=...';
        resultCard.hidden = true;
        resultEmpty.hidden = false;
    }

    function failResult(message) {
        clearResult();
        resultEmpty.textContent = message || 'Link generation failed.';
    }

    /* ---------------- fetch helper ---------------- */

    async function postJSON(endpoint, payload, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(apiBase + endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            let data = {};
            try {
                data = await res.json();
            } catch (e) {
                data = {};
            }

            if (!res.ok) {
                throw new Error(data.error || `Request failed (HTTP ${res.status})`);
            }

            return data;
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error('Request timed out. Please try again.');
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    /* ---------------- generate ---------------- */

    extractBtn.addEventListener('click', async () => {
        if (busy) return;

        const cookieStr = cookieInput.value.trim();

        if (!cookieStr) {
            showError("Please paste a cookie string first.");
            return;
        }

        const device = selectedDevice;

        setControlsDisabled(true);
        extractBtnLabel.textContent = 'Generating...';
        hideError();
        resultsSection.classList.remove('active');
        clearResult();

        // Reset account info loading text
        accEmail.textContent = "Loading...";
        accPhone.textContent = "Loading...";
        accPlan.textContent = "Loading...";
        accNextPayment.textContent = "Loading...";
        accMemberSince.textContent = "Loading...";
        accPayment.textContent = "Loading...";
        accRegion.textContent = "Loading...";
        accTotalProfiles.textContent = "Loading...";
        accLockedProfiles.textContent = "Loading...";
        accUnlockedProfiles.textContent = "Loading...";
        profilesGrid.innerHTML = '';
        profileCountBadge.textContent = '';
        hideAccountNotice();

        try {
            // One generate request for the selected device + account info in parallel.
            const [linkRes, infoRes] = await Promise.allSettled([
                postJSON('/api/generate', { cookie: cookieStr, device: device }, REQUEST_TIMEOUT_MS),
                postJSON('/api/account-info', { cookie: cookieStr }, REQUEST_TIMEOUT_MS)
            ]);

            let linkError = null;

            // Handle the single generated link
            if (linkRes.status === 'fulfilled') {
                const data = linkRes.value || {};
                const resolvedDevice = DEVICES[data.device] ? data.device : device;
                const token = typeof data.token === 'string' ? data.token : '';

                let link = typeof data.link === 'string' && data.link ? data.link : '';
                if (!link && token) {
                    link = DEVICES[resolvedDevice].buildLink(token);
                }

                if (link) {
                    showResult(resolvedDevice, link);
                } else {
                    linkError = 'Token response was incomplete. Cookie might be invalid or expired.';
                }
            } else {
                linkError = (linkRes.reason && linkRes.reason.message) || 'Failed to generate token.';
            }

            // Handle Account Info
            if (infoRes.status === 'fulfilled') {
                const infoData = infoRes.value || {};
                accEmail.textContent = infoData.email || 'Unknown';
                accPhone.textContent = infoData.phone || 'Unknown';
                accPlan.textContent = infoData.plan || 'Unknown';
                accNextPayment.textContent = infoData.nextBillingDate || 'Unknown';
                accMemberSince.textContent = infoData.memberSince || 'Unknown';
                accPayment.textContent = infoData.payment || 'Unknown';
                accRegion.textContent = infoData.region || 'Unknown';
                accTotalProfiles.textContent = infoData.totalProfiles !== undefined ? infoData.totalProfiles : 'Unknown';
                accLockedProfiles.textContent = infoData.lockedProfiles !== undefined ? infoData.lockedProfiles : 'Unknown';
                accUnlockedProfiles.textContent = infoData.unlockedProfiles !== undefined ? infoData.unlockedProfiles : 'Unknown';
                renderProfiles(infoData.profiles || [], infoData.totalProfiles, infoData.lockedProfiles);

                if (infoData.partial) {
                    showAccountNotice('Limited data — Netflix did not return the full account page. Some fields may show Unknown.');
                } else {
                    hideAccountNotice();
                }
            } else {
                const infoError = (infoRes.reason && infoRes.reason.message)
                    || 'Could not load account info for this cookie.';

                accEmail.textContent = "—";
                accPhone.textContent = "—";
                accPlan.textContent = "—";
                accNextPayment.textContent = "—";
                accMemberSince.textContent = "—";
                accPayment.textContent = "—";
                accRegion.textContent = "—";
                accTotalProfiles.textContent = "—";
                accLockedProfiles.textContent = "—";
                accUnlockedProfiles.textContent = "—";
                profilesGrid.innerHTML = '<div class="profile-empty">Account data unavailable.</div>';
                profileCountBadge.textContent = '';
                showAccountNotice(infoError);
            }

            if (linkError) {
                failResult(linkError);
                showError(linkError);
            }

            if (linkRes.status === 'fulfilled' || infoRes.status === 'fulfilled') {
                resultsSection.classList.add('active');
                setTimeout(() => {
                    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            } else {
                throw new Error(linkError || 'Request failed. Check your cookie and try again.');
            }

        } catch (error) {
            showError(error.message || 'Unexpected error. Please try again.');
        } finally {
            setControlsDisabled(false);
            updateDeviceUI();
        }
    });

    openBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');
            const targetElement = document.getElementById(targetId);

            if (targetElement && targetElement.dataset.fullLink) {
                window.open(targetElement.dataset.fullLink, '_blank');
            }
        });
    });

    const copyBtns = document.querySelectorAll('.copy-btn');
    copyBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');
            const targetElement = document.getElementById(targetId);

            if (targetElement && targetElement.dataset.fullLink) {
                try {
                    await navigator.clipboard.writeText(targetElement.dataset.fullLink);
                    const originalHTML = btn.innerHTML;
                    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
                    btn.classList.add('copied');
                    setTimeout(() => {
                        btn.innerHTML = originalHTML;
                        btn.classList.remove('copied');
                    }, 2000);
                } catch (err) {
                    // Fallback for older browsers
                    const textArea = document.createElement('textarea');
                    textArea.value = targetElement.dataset.fullLink;
                    textArea.style.position = 'fixed';
                    textArea.style.opacity = '0';
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    btn.textContent = 'Copied!';
                    setTimeout(() => { btn.textContent = 'Copy Link'; }, 2000);
                }
            }
        });
    });

    function renderProfiles(profiles, total, locked) {
        profilesGrid.innerHTML = '';

        const count = (typeof total === 'number' ? total : profiles.length);
        if (count > 0) {
            profileCountBadge.textContent = locked !== undefined && locked !== null
                ? `${count} total · ${locked} PIN`
                : `${count}`;
        } else {
            profileCountBadge.textContent = '';
        }

        if (!profiles || profiles.length === 0) {
            profilesGrid.innerHTML = '<div class="profile-empty">No profiles found.</div>';
            return;
        }

        profiles.forEach(p => {
            const card = document.createElement('div');
            card.className = 'profile-card' + (p.isPinLocked ? ' pin-locked' : '');

            // Avatar
            if (p.avatar) {
                const img = document.createElement('img');
                img.className = 'profile-avatar';
                img.src = p.avatar;
                img.alt = p.name || 'Profile';
                img.loading = 'lazy';
                img.onerror = () => {
                    const ph = makeAvatarPlaceholder(p.name);
                    if (img.parentNode) img.parentNode.replaceChild(ph, img);
                };
                card.appendChild(img);
            } else {
                card.appendChild(makeAvatarPlaceholder(p.name));
            }

            // Meta
            const meta = document.createElement('div');
            meta.className = 'profile-meta';

            const nameEl = document.createElement('div');
            nameEl.className = 'profile-name';
            nameEl.textContent = p.name || 'Unnamed';
            nameEl.title = p.name || 'Unnamed';
            meta.appendChild(nameEl);

            const tags = document.createElement('div');
            tags.className = 'profile-tags';

            tags.appendChild(makeTag(p.isPinLocked ? 'PIN' : 'No PIN', p.isPinLocked ? 'pin' : ''));
            if (p.isAccountOwner) tags.appendChild(makeTag('Owner', 'owner'));
            if (p.isKids) tags.appendChild(makeTag('Kids', 'kids'));
            if (p.isActive) tags.appendChild(makeTag('Active', 'active'));

            meta.appendChild(tags);
            card.appendChild(meta);
            profilesGrid.appendChild(card);
        });
    }

    function makeAvatarPlaceholder(name) {
        const ph = document.createElement('div');
        ph.className = 'profile-avatar placeholder';
        const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
        ph.textContent = initial;
        return ph;
    }

    function makeTag(text, variant) {
        const t = document.createElement('span');
        t.className = 'profile-tag' + (variant ? ' ' + variant : '');
        t.textContent = text;
        return t;
    }

    function showError(msg) {
        errorMessage.textContent = msg;
        errorMessage.style.display = 'block';
    }

    function hideError() {
        errorMessage.style.display = 'none';
    }

    function showAccountNotice(message) {
        accountNotice.textContent = message;
        accountNotice.hidden = false;
    }

    function hideAccountNotice() {
        accountNotice.textContent = '';
        accountNotice.hidden = true;
    }

    updateDeviceUI();
    clearResult();
});

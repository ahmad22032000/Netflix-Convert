document.addEventListener('DOMContentLoaded', () => {
    const cookieInput = document.getElementById('cookieInput');
    const extractBtn = document.getElementById('extractBtn');
    const errorMessage = document.getElementById('errorMessage');
    const resultsSection = document.getElementById('resultsSection');
    
    // Links
    const webLinkText = document.getElementById('webLinkText');
    const mobileLinkText = document.getElementById('mobileLinkText');
    const tvLinkText = document.getElementById('tvLinkText');
    
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
    
    const openBtns = document.querySelectorAll('.open-btn');

    extractBtn.addEventListener('click', async () => {
        const cookieStr = cookieInput.value.trim();
        
        if (!cookieStr) {
            showError("Please paste a cookie string first.");
            return;
        }

        // Show loading state
        extractBtn.disabled = true;
        extractBtn.innerHTML = '<span>Extracting...</span>';
        hideError();
        resultsSection.classList.remove('active');
        
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

        let apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
        let generateEndpoint = '/api/generate';
        let accountEndpoint = '/api/account-info';

        try {
            // Run both API requests concurrently
            const [tokenRes, infoRes] = await Promise.allSettled([
                fetch(apiBase + generateEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cookie: cookieStr })
                }),
                fetch(apiBase + accountEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cookie: cookieStr })
                })
            ]);

            // Handle Token
            if (tokenRes.status === 'fulfilled' && tokenRes.value.ok) {
                const data = await tokenRes.value.json();
                const token = data.token;
                
                const webLink = `https://netflix.com/?nftoken=${token}`;
                const mobileLink = `https://netflix.com/unsupported?nftoken=${token}`;
                const tvLink = `https://netflix.com/tv2?nftoken=${token}`;
                
                webLinkText.textContent = webLink;
                mobileLinkText.textContent = mobileLink;
                tvLinkText.textContent = tvLink;
                
                webLinkText.dataset.fullLink = webLink;
                mobileLinkText.dataset.fullLink = mobileLink;
                tvLinkText.dataset.fullLink = tvLink;
            } else {
                let err = "Failed to generate token.";
                if (tokenRes.status === 'fulfilled') {
                    const data = await tokenRes.value.json().catch(() => ({}));
                    err = data.error || err;
                }
                throw new Error(err);
            }

            // Handle Account Info
            if (infoRes.status === 'fulfilled' && infoRes.value.ok) {
                const infoData = await infoRes.value.json();
                accEmail.textContent = infoData.email || 'Unknown';
                accPhone.textContent = infoData.phone || 'Unknown';
                accPlan.textContent = infoData.plan || 'Unknown';
                accNextPayment.textContent = infoData.nextBillingDate || 'Unknown';
                accMemberSince.textContent = infoData.memberSince || 'Unknown';
                accPayment.textContent = infoData.payment || 'Unknown';
                accRegion.textContent = infoData.region || 'Unknown';
                accTotalProfiles.textContent = infoData.totalProfiles !== undefined ? infoData.totalProfiles : 'Unknown';
                accLockedProfiles.textContent = infoData.lockedProfiles || 'Unknown';
                accUnlockedProfiles.textContent = infoData.unlockedProfiles || 'Unknown';
            } else {
                accEmail.textContent = "Failed";
                accPhone.textContent = "Failed";
                accPlan.textContent = "Failed";
                accNextPayment.textContent = "Failed";
                accMemberSince.textContent = "Failed";
                accPayment.textContent = "Failed";
                accRegion.textContent = "Failed";
                accTotalProfiles.textContent = "Failed";
                accLockedProfiles.textContent = "Failed";
                accUnlockedProfiles.textContent = "Failed";
            }

            resultsSection.classList.add('active');
            setTimeout(() => {
                resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
            
        } catch (error) {
            showError(error.message);
        } finally {
            // Restore button
            extractBtn.disabled = false;
            extractBtn.innerHTML = '<span>Extract Links</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
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

    function showError(msg) {
        errorMessage.textContent = msg;
        errorMessage.style.display = 'block';
    }

    function hideError() {
        errorMessage.style.display = 'none';
    }
});

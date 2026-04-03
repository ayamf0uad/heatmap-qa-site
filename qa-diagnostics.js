/**
 * Convert QA Diagnostics — Script Detection, Network Monitoring, WebSocket Inspection
 * Built for heatmap & signals testing
 * 
 * Detects:
 * - Main Convert tracking script and its source domain (CDN vs custom domain)
 * - Signals script (signals.insights.min.js) and whether it loaded from custom domain
 * - WebSocket connections for heatmap/recording data
 * - Active experiences, sampling status, cookies
 * - All Convert-related network requests (XHR, fetch, beacon, scripts)
 */

(function () {
    'use strict';

    // ========================
    // CONFIGURATION
    // ========================
    const CONFIG = {
        // Known Convert CDN domains
        cdnDomains: [
            'cdn-4.convertexperiments.com',
            'cdn-5.convertexperiments.com',
            'cdn-3.convertexperiments.com',
            'cdn-4.convertapps-cloud.com',
            'cdn-5.convertapps-cloud.com',
            'cdn-5.convertapps-cloud.com.cdn.cloudflare.net',
        ],
        // Patterns that indicate Convert-related requests
        convertPatterns: [
            'convertexperiments', 'convertapps', 'convert.com',
            'signals.insights', 'conv_', '_conv_',
            '/v1/js/', '/metrics/v1/', '/api/v1/project-optional-settings',
        ],
        // Script filename patterns
        mainScriptPattern: /\/v1\/js\/(\d+)-(\d+)\.js/,
        signalsScriptPattern: /signals\.insights\.min\.js/,
        // WebSocket patterns
        wsPatterns: [
            'convertexperiments', 'convertapps', 'signals', 'heatmap', 'recording',
        ],
        // Cookie names
        cookies: {
            visitor: '_conv_v',
            data: '_conv_d',
            spn: '_conv_spn',
        },
    };

    // ========================
    // STATE
    // ========================
    const state = {
        detectedScripts: [],
        networkLog: [],
        wsConnections: [],
        wsFrames: [],
        mainScript: null,
        signalsScript: null,
        customDomain: null,
        experiences: [],
        isInSample: null,
        startTime: Date.now(),
    };

    // ========================
    // HELPERS
    // ========================
    function isConvertRelated(url) {
        return CONFIG.convertPatterns.some(p => url.toLowerCase().includes(p));
    }

    function getDomain(url) {
        try { return new URL(url).hostname; } catch { return url; }
    }

    function isCustomDomain(hostname) {
        return !CONFIG.cdnDomains.includes(hostname) &&
            !hostname.includes('convertexperiments') &&
            !hostname.includes('convertapps') &&
            !hostname.includes('convert.com');
    }

    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function timestamp() {
        return ((Date.now() - state.startTime) / 1000).toFixed(2) + 's';
    }

    // ========================
    // NETWORK MONITORING
    // ========================
    function setupNetworkMonitoring() {
        // Intercept fetch
        const origFetch = window.fetch;
        window.fetch = function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            const method = args[1]?.method || 'GET';
            logNetworkRequest('xhr', method, url);
            return origFetch.apply(this, args);
        };

        // Intercept XMLHttpRequest
        const origXHROpen = XMLHttpRequest.prototype.open;
        const origXHRSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._qaMethod = method;
            this._qaUrl = url;
            return origXHROpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
            if (this._qaUrl) logNetworkRequest('xhr', this._qaMethod, this._qaUrl);
            return origXHRSend.apply(this, arguments);
        };

        // Intercept sendBeacon
        const origBeacon = navigator.sendBeacon;
        if (origBeacon) {
            navigator.sendBeacon = function (url, data) {
                logNetworkRequest('beacon', 'POST', url, data);
                return origBeacon.apply(this, arguments);
            };
        }

        // Intercept WebSocket
        const OrigWS = window.WebSocket;
        window.WebSocket = function (url, protocols) {
            logNetworkRequest('ws', 'CONNECT', url);
            const ws = new OrigWS(url, protocols);
            trackWebSocket(ws, url);
            return ws;
        };
        window.WebSocket.prototype = OrigWS.prototype;
        window.WebSocket.CONNECTING = OrigWS.CONNECTING;
        window.WebSocket.OPEN = OrigWS.OPEN;
        window.WebSocket.CLOSING = OrigWS.CLOSING;
        window.WebSocket.CLOSED = OrigWS.CLOSED;

        // Watch for dynamically added scripts
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.tagName === 'SCRIPT' && node.src) {
                        logNetworkRequest('script', 'GET', node.src);
                        checkScript(node.src);
                    }
                });
            });
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function logNetworkRequest(type, method, url, data) {
        const entry = {
            time: timestamp(),
            type,
            method,
            url,
            domain: getDomain(url),
            isConvert: isConvertRelated(url),
            isCustomDomain: isCustomDomain(getDomain(url)),
            data: data ? String(data).substring(0, 200) : undefined,
        };
        state.networkLog.push(entry);
        renderNetworkEntry(entry);
        updateNetworkCounts();
    }

    function trackWebSocket(ws, url) {
        const conn = {
            url,
            domain: getDomain(url),
            isConvert: isConvertRelated(url),
            isCustomDomain: isCustomDomain(getDomain(url)),
            status: 'connecting',
            openedAt: null,
            closedAt: null,
            frameCount: 0,
        };
        state.wsConnections.push(conn);

        ws.addEventListener('open', () => {
            conn.status = 'open';
            conn.openedAt = new Date().toISOString();
            updateWSStatus(conn);
        });

        ws.addEventListener('message', (e) => {
            conn.frameCount++;
            const frame = {
                time: timestamp(),
                direction: 'incoming',
                url: conn.url,
                data: typeof e.data === 'string' ? e.data.substring(0, 500) : '[binary]',
                size: typeof e.data === 'string' ? e.data.length : e.data?.byteLength || 0,
            };
            state.wsFrames.push(frame);
            renderWSFrame(frame);
        });

        const origSend = ws.send.bind(ws);
        ws.send = function (data) {
            conn.frameCount++;
            const frame = {
                time: timestamp(),
                direction: 'outgoing',
                url: conn.url,
                data: typeof data === 'string' ? data.substring(0, 500) : '[binary]',
                size: typeof data === 'string' ? data.length : data?.byteLength || 0,
            };
            state.wsFrames.push(frame);
            renderWSFrame(frame);
            return origSend(data);
        };

        ws.addEventListener('close', (e) => {
            conn.status = 'closed';
            conn.closedAt = new Date().toISOString();
            conn.closeCode = e.code;
            conn.closeReason = e.reason;
            updateWSStatus(conn);
        });

        ws.addEventListener('error', () => {
            conn.status = 'error';
            updateWSStatus(conn);
        });
    }

    // ========================
    // SCRIPT DETECTION
    // ========================
    function scanExistingScripts() {
        document.querySelectorAll('script[src]').forEach(s => checkScript(s.src));
    }

    function checkScript(src) {
        // Main tracking script
        const mainMatch = src.match(CONFIG.mainScriptPattern);
        if (mainMatch) {
            state.mainScript = {
                url: src,
                domain: getDomain(src),
                accountId: mainMatch[1],
                projectId: mainMatch[2],
                isCustomDomain: isCustomDomain(getDomain(src)),
            };
            updateDetectionUI();
        }

        // Signals script
        if (CONFIG.signalsScriptPattern.test(src)) {
            state.signalsScript = {
                url: src,
                domain: getDomain(src),
                isCustomDomain: isCustomDomain(getDomain(src)),
            };
            updateDetectionUI();
        }

        if (isConvertRelated(src)) {
            state.detectedScripts.push({ url: src, domain: getDomain(src) });
        }
    }

    function checkConvertState() {
        // Check for convert global object
        if (typeof window.convert !== 'undefined') {
            try {
                if (window.convert.currentData) {
                    const data = window.convert.currentData;
                    if (data.experiences) {
                        state.experiences = Object.keys(data.experiences).map(k => ({
                            id: k,
                            data: data.experiences[k],
                        }));
                    }
                }
            } catch (e) { /* silently fail */ }
        }

        // Check cookies
        const convD = getCookie('_conv_d');
        const convV = getCookie('_conv_v');
        if (convD) {
            // Parse _conv_d for experience data
            try {
                const parts = convD.split('.');
                // experience IDs are often encoded in this cookie
                state.cookieData = { _conv_d: convD.substring(0, 100) + '...' };
            } catch (e) { /* */ }
        }

        // Check console for sampling info
        // We intercept console.log to detect Convert's sampling messages
        state.isInSample = checkSamplingFromConsole();

        updateDetectionUI();
    }

    function checkSamplingFromConsole() {
        // If signals script loaded, user is in sample
        if (state.signalsScript) return true;
        // Check if convert object mentions signals
        try {
            if (window.convert && window.convert.currentData && window.convert.currentData.signals) {
                return true;
            }
        } catch (e) { /* */ }
        return null; // unknown
    }

    // ========================
    // UI RENDERING
    // ========================
    function updateDetectionUI() {
        // Main script
        const mainEl = document.getElementById('status-main-script');
        const mainDetail = document.getElementById('detail-main-script');
        if (state.mainScript) {
            setStatus(mainEl, 'success');
            mainDetail.textContent = `Loaded from: ${state.mainScript.domain}\nAccount: ${state.mainScript.accountId} | Project: ${state.mainScript.projectId}`;
        } else {
            setStatus(mainEl, 'error');
            mainDetail.textContent = 'No Convert tracking script detected on page';
        }

        // Signals script
        const sigEl = document.getElementById('status-signals-script');
        const sigDetail = document.getElementById('detail-signals-script');
        if (state.signalsScript) {
            setStatus(sigEl, 'success');
            sigDetail.textContent = `Loaded from: ${state.signalsScript.domain}`;
        } else {
            setStatus(sigEl, 'warning');
            sigDetail.textContent = 'Not loaded — visitor may not be in 5% sample, or no experience running';
        }

        // Domain source
        const domEl = document.getElementById('status-domain');
        const domDetail = document.getElementById('detail-domain');
        if (state.mainScript) {
            if (state.mainScript.isCustomDomain) {
                setStatus(domEl, 'success');
                domDetail.textContent = `✅ Custom domain: ${state.mainScript.domain}`;
                state.customDomain = state.mainScript.domain;
            } else {
                setStatus(domEl, 'warning');
                domDetail.textContent = `⚠️ CDN domain: ${state.mainScript.domain} (not custom domain)`;
            }
        } else {
            setStatus(domEl, 'pending');
            domDetail.textContent = 'Waiting for script detection...';
        }

        // Custom domain check
        const cdEl = document.getElementById('status-custom-domain');
        const cdDetail = document.getElementById('detail-custom-domain');
        if (state.customDomain) {
            setStatus(cdEl, 'success');
            cdDetail.textContent = `Custom domain active: ${state.customDomain}`;
        } else if (state.mainScript && !state.mainScript.isCustomDomain) {
            setStatus(cdEl, 'warning');
            cdDetail.textContent = 'No custom domain configured — scripts served from Convert CDN';
        } else {
            setStatus(cdEl, 'pending');
            cdDetail.textContent = 'Checking...';
        }

        // Signals also check custom domain
        if (state.signalsScript && !state.signalsScript.isCustomDomain) {
            const sigNote = document.getElementById('detail-signals-script');
            sigNote.textContent += '\n⚠️ Signals loading from CDN, not custom domain!';
            setStatus(sigEl, 'warning');
        }

        // Sampling
        const samEl = document.getElementById('status-sampling');
        const samDetail = document.getElementById('detail-sampling');
        if (state.isInSample === true) {
            setStatus(samEl, 'success');
            samDetail.textContent = 'Visitor IS in signals sample (signals script loaded)';
        } else if (state.isInSample === false) {
            setStatus(samEl, 'error');
            samDetail.textContent = 'Visitor NOT in sample';
        } else {
            setStatus(samEl, 'pending');
            samDetail.textContent = 'Unknown — checking...';
        }

        // Experiences
        const expEl = document.getElementById('status-experience');
        const expDetail = document.getElementById('detail-experience');
        if (state.experiences.length > 0) {
            setStatus(expEl, 'success');
            expDetail.textContent = `${state.experiences.length} active experience(s): ${state.experiences.map(e => e.id).join(', ')}`;
        } else {
            setStatus(expEl, 'pending');
            expDetail.textContent = 'No experiences detected (check _conv_d cookie or convert.currentData)';
        }
    }

    function setStatus(card, status) {
        const indicator = card.querySelector('.qa-status-indicator');
        indicator.className = 'qa-status-indicator ' + status;
    }

    function renderNetworkEntry(entry) {
        const log = document.getElementById('network-log');
        if (!log) return;

        const filterScripts = document.getElementById('filter-scripts')?.checked;
        const filterXhr = document.getElementById('filter-xhr')?.checked;
        const filterBeacon = document.getElementById('filter-beacon')?.checked;
        const filterWs = document.getElementById('filter-ws')?.checked;

        if (entry.type === 'script' && !filterScripts) return;
        if (entry.type === 'xhr' && !filterXhr) return;
        if (entry.type === 'beacon' && !filterBeacon) return;
        if (entry.type === 'ws' && !filterWs) return;

        const div = document.createElement('div');
        div.className = `log-entry ${entry.type} ${entry.isConvert ? 'convert' : ''}`;
        const badge = entry.isConvert ? ' [CONVERT]' : '';
        const cdBadge = entry.isCustomDomain && entry.isConvert ? ' [CUSTOM-DOMAIN]' : '';
        div.textContent = `[${entry.time}] ${entry.type.toUpperCase()} ${entry.method} ${entry.domain}${badge}${cdBadge} → ${entry.url.substring(0, 120)}`;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }

    function updateNetworkCounts() {
        const countEl = document.getElementById('network-count');
        const convertCountEl = document.getElementById('network-convert-count');
        if (countEl) countEl.textContent = `${state.networkLog.length} requests`;
        if (convertCountEl) {
            const convertCount = state.networkLog.filter(e => e.isConvert).length;
            convertCountEl.textContent = `${convertCount} Convert-related`;
        }
    }

    function renderWSFrame(frame) {
        const log = document.getElementById('ws-log');
        if (!log) return;
        const div = document.createElement('div');
        const dir = frame.direction === 'incoming' ? '⬇' : '⬆';
        div.className = `log-entry ws`;
        div.textContent = `[${frame.time}] ${dir} ${frame.direction} (${frame.size}b) ${frame.data.substring(0, 150)}`;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }

    function updateWSStatus(conn) {
        const statusMap = {
            connecting: 'pending',
            open: 'success',
            closed: 'warning',
            error: 'error',
        };

        // Determine if this is heatmap or signals WS
        const isHeatmap = conn.url.includes('heatmap') || conn.url.includes('heat');
        const isSignals = conn.url.includes('signals') || conn.url.includes('record') || conn.url.includes('session');

        if (isHeatmap || (!isSignals && conn.isConvert)) {
            const el = document.getElementById('status-ws-heatmap');
            const detail = document.getElementById('detail-ws-heatmap');
            if (el) setStatus(el, statusMap[conn.status] || 'pending');
            if (detail) detail.textContent = `${conn.status.toUpperCase()} → ${conn.url}\nDomain: ${conn.domain} | Custom: ${conn.isCustomDomain ? 'YES' : 'NO'} | Frames: ${conn.frameCount}`;
        }

        if (isSignals) {
            const el = document.getElementById('status-ws-signals');
            const detail = document.getElementById('detail-ws-signals');
            if (el) setStatus(el, statusMap[conn.status] || 'pending');
            if (detail) detail.textContent = `${conn.status.toUpperCase()} → ${conn.url}\nDomain: ${conn.domain} | Custom: ${conn.isCustomDomain ? 'YES' : 'NO'} | Frames: ${conn.frameCount}`;
        }

        // Update details panel
        const detailsPre = document.getElementById('ws-details');
        if (detailsPre) {
            detailsPre.textContent = JSON.stringify(state.wsConnections, null, 2);
        }
    }

    // ========================
    // EXPORT
    // ========================
    function exportReport() {
        const report = {
            timestamp: new Date().toISOString(),
            pageUrl: window.location.href,
            userAgent: navigator.userAgent,
            mainScript: state.mainScript,
            signalsScript: state.signalsScript,
            customDomain: state.customDomain,
            isInSample: state.isInSample,
            experiences: state.experiences,
            detectedScripts: state.detectedScripts,
            networkLog: state.networkLog,
            wsConnections: state.wsConnections,
            wsFrames: state.wsFrames,
            cookies: {
                _conv_v: getCookie('_conv_v'),
                _conv_d: getCookie('_conv_d') ? getCookie('_conv_d').substring(0, 200) + '...' : null,
                _conv_spn: getCookie('_conv_spn'),
            },
        };

        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `convert-qa-report-${Date.now()}.json`;
        a.click();
    }

    // ========================
    // PANEL LOGIC
    // ========================
    function initPanel() {
        // Toggle panel
        const toggle = document.getElementById('qa-toggle');
        const panel = document.getElementById('qa-panel');
        const closeBtn = document.getElementById('qa-close');

        if (toggle) toggle.addEventListener('click', () => panel.classList.toggle('hidden'));
        if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

        // Keyboard shortcut: Ctrl+Shift+Q
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'Q') {
                e.preventDefault();
                panel.classList.toggle('hidden');
            }
        });

        // Tab switching
        document.querySelectorAll('.qa-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.qa-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.qa-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            });
        });

        // Re-check button
        document.getElementById('btn-recheck')?.addEventListener('click', () => {
            scanExistingScripts();
            checkConvertState();
        });

        // Export button
        document.getElementById('btn-export-detection')?.addEventListener('click', exportReport);

        // Clear network log
        document.getElementById('btn-clear-network')?.addEventListener('click', () => {
            state.networkLog = [];
            const log = document.getElementById('network-log');
            if (log) log.innerHTML = '';
            updateNetworkCounts();
        });

        // Network filters
        ['filter-scripts', 'filter-xhr', 'filter-beacon', 'filter-ws'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                // Re-render filtered log
                const log = document.getElementById('network-log');
                if (log) log.innerHTML = '';
                state.networkLog.forEach(entry => renderNetworkEntry(entry));
            });
        });
    }

    // ========================
    // INTERCEPT CONSOLE FOR CONVERT MESSAGES
    // ========================
    function interceptConsole() {
        const origLog = console.log;
        console.log = function (...args) {
            const msg = args.join(' ');
            if (msg.includes('Convert') || msg.includes('convert') || msg.includes('Workflow.setSignals')) {
                // Check for sampling messages
                if (msg.includes('Not running tracking signals') || msg.includes('not included in the sample')) {
                    state.isInSample = false;
                    updateDetectionUI();
                }
                if (msg.includes('Workflow.setSignals()') && !msg.includes('Not running')) {
                    state.isInSample = true;
                    updateDetectionUI();
                }
            }
            return origLog.apply(console, args);
        };
    }

    // ========================
    // INIT
    // ========================
    function init() {
        interceptConsole();
        setupNetworkMonitoring();
        initPanel();

        // Initial scan (with delay to let scripts load)
        setTimeout(() => {
            scanExistingScripts();
            checkConvertState();
        }, 2000);

        // Re-check periodically
        setInterval(() => {
            scanExistingScripts();
            checkConvertState();
        }, 10000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for external use
    window.__convertQA = {
        getState: () => state,
        exportReport,
        recheck: () => { scanExistingScripts(); checkConvertState(); },
    };

})();

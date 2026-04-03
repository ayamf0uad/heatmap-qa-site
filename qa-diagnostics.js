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
        function setText(id, text) {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        }

        // Main script
        const mainEl = document.getElementById('status-main-script');
        if (state.mainScript) {
            setStatus(mainEl, 'success');
            setText('detail-main-script', `Loaded from: ${state.mainScript.domain}\nAccount: ${state.mainScript.accountId} | Project: ${state.mainScript.projectId}`);
        } else {
            setStatus(mainEl, 'error');
            setText('detail-main-script', 'No Convert tracking script detected on page');
        }

        // Signals script
        const sigEl = document.getElementById('status-signals-script');
        if (state.signalsScript) {
            setStatus(sigEl, 'success');
            let sigText = `Loaded from: ${state.signalsScript.domain}`;
            if (!state.signalsScript.isCustomDomain) {
                sigText += '\n⚠️ Signals loading from CDN, not custom domain!';
                setStatus(sigEl, 'warning');
            }
            setText('detail-signals-script', sigText);
        } else {
            setStatus(sigEl, 'warning');
            setText('detail-signals-script', 'Not loaded — visitor may not be in 5% sample, or no experience running');
        }

        // Domain source
        const domEl = document.getElementById('status-domain');
        if (state.mainScript) {
            if (state.mainScript.isCustomDomain) {
                setStatus(domEl, 'success');
                setText('detail-domain', `✅ Custom domain: ${state.mainScript.domain}`);
                state.customDomain = state.mainScript.domain;
            } else {
                setStatus(domEl, 'warning');
                setText('detail-domain', `⚠️ CDN domain: ${state.mainScript.domain} (not custom domain)`);
            }
        } else {
            setStatus(domEl, 'pending');
            setText('detail-domain', 'Waiting for script detection...');
        }

        // Custom domain check
        const cdEl = document.getElementById('status-custom-domain');
        if (state.customDomain) {
            setStatus(cdEl, 'success');
            setText('detail-custom-domain', `Custom domain active: ${state.customDomain}`);
        } else if (state.mainScript && !state.mainScript.isCustomDomain) {
            setStatus(cdEl, 'warning');
            setText('detail-custom-domain', 'No custom domain configured — scripts served from Convert CDN');
        } else {
            setStatus(cdEl, 'pending');
            setText('detail-custom-domain', 'Checking...');
        }

        // Sampling
        const samEl = document.getElementById('status-sampling');
        if (state.isInSample === true) {
            setStatus(samEl, 'success');
            setText('detail-sampling', 'Visitor IS in signals sample (signals script loaded)');
        } else if (state.isInSample === false) {
            setStatus(samEl, 'error');
            setText('detail-sampling', 'Visitor NOT in sample');
        } else {
            setStatus(samEl, 'pending');
            setText('detail-sampling', 'Unknown — checking...');
        }

        // Experiences
        const expEl = document.getElementById('status-experience');
        if (state.experiences.length > 0) {
            setStatus(expEl, 'success');
            setText('detail-experience', `${state.experiences.length} active experience(s): ${state.experiences.map(e => e.id).join(', ')}`);
        } else {
            setStatus(expEl, 'pending');
            setText('detail-experience', 'No experiences detected (check _conv_d cookie or convert.currentData)');
        }
    }

    function setStatus(card, status) {
        if (!card) return;
        const indicator = card.querySelector('.qa-status-indicator');
        if (indicator) indicator.className = 'qa-status-indicator ' + status;
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
    // INJECT PANEL HTML
    // ========================
    function injectPanelHTML() {
        // Remove any empty placeholder
        const existing = document.getElementById('qa-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'qa-panel';
        panel.className = 'qa-panel hidden';
        panel.innerHTML = `
        <div class="qa-panel-header">
            <h3>🔬 Convert QA Diagnostics</h3>
            <button id="qa-close" class="qa-close">&times;</button>
        </div>
        <div class="qa-panel-body">
            <div class="qa-tabs">
                <button class="qa-tab active" data-tab="detection">Script Detection</button>
                <button class="qa-tab" data-tab="network">Network Monitor</button>
                <button class="qa-tab" data-tab="websocket">WebSocket</button>
                <button class="qa-tab" data-tab="simulation">Traffic Sim</button>
            </div>
            <div class="qa-tab-content active" id="tab-detection">
                <div class="qa-status-grid">
                    <div class="qa-status-card" id="status-main-script">
                        <div class="qa-status-indicator pending"></div>
                        <div><strong>Main Tracking Script</strong><p class="qa-detail" id="detail-main-script">Checking...</p></div>
                    </div>
                    <div class="qa-status-card" id="status-signals-script">
                        <div class="qa-status-indicator pending"></div>
                        <div><strong>Signals Script</strong><p class="qa-detail" id="detail-signals-script">Checking...</p></div>
                    </div>
                    <div class="qa-status-card" id="status-domain">
                        <div class="qa-status-indicator pending"></div>
                        <div><strong>Script Source Domain</strong><p class="qa-detail" id="detail-domain">Checking...</p></div>
                    </div>
                    <div class="qa-status-card" id="status-custom-domain">
                        <div class="qa-status-indicator pending"></div>
                        <div><strong>Custom Domain</strong><p class="qa-detail" id="detail-custom-domain">Checking...</p></div>
                    </div>
                    <div class="qa-status-card" id="status-sampling">
                        <div class="qa-status-indicator pending"></div>
                        <div><strong>Signals Sampling</strong><p class="qa-detail" id="detail-sampling">Checking...</p></div>
                    </div>
                    <div class="qa-status-card" id="status-experience">
                        <div class="qa-status-indicator pending"></div>
                        <div><strong>Active Experiences</strong><p class="qa-detail" id="detail-experience">Checking...</p></div>
                    </div>
                </div>
                <button id="btn-recheck" class="qa-btn">Re-check All</button>
                <button id="btn-export-detection" class="qa-btn secondary">Export Report</button>
            </div>
            <div class="qa-tab-content" id="tab-network">
                <div class="qa-filter-bar">
                    <label><input type="checkbox" id="filter-scripts" checked> Scripts</label>
                    <label><input type="checkbox" id="filter-xhr" checked> XHR/Fetch</label>
                    <label><input type="checkbox" id="filter-beacon" checked> Beacons</label>
                    <label><input type="checkbox" id="filter-ws" checked> WebSocket</label>
                    <button id="btn-clear-network" class="qa-btn small">Clear</button>
                </div>
                <div id="network-log" class="qa-log"></div>
                <div class="qa-summary-bar">
                    <span id="network-count">0 requests</span>
                    <span id="network-convert-count">0 Convert-related</span>
                </div>
            </div>
            <div class="qa-tab-content" id="tab-websocket">
                <div class="qa-status-card" id="status-ws-heatmap">
                    <div class="qa-status-indicator pending"></div>
                    <div><strong>Heatmap WebSocket</strong><p class="qa-detail" id="detail-ws-heatmap">Not detected</p></div>
                </div>
                <div class="qa-status-card" id="status-ws-signals">
                    <div class="qa-status-indicator pending"></div>
                    <div><strong>Signals/Recording WebSocket</strong><p class="qa-detail" id="detail-ws-signals">Not detected</p></div>
                </div>
                <div class="qa-ws-details">
                    <h4>WebSocket Frames Log</h4>
                    <div id="ws-log" class="qa-log"></div>
                </div>
                <div class="qa-ws-details">
                    <h4>Connection Details</h4>
                    <pre id="ws-details" class="qa-pre">No active WebSocket connections detected.</pre>
                </div>
            </div>
            <div class="qa-tab-content" id="tab-simulation">
                <div class="qa-sim-controls">
                    <h4>Built-in Traffic Simulator</h4>
                    <p class="qa-hint">Simulates real user interactions on this page. Runs in-browser — no Selenium needed.</p>
                    <div class="qa-sim-options">
                        <label><input type="checkbox" id="sim-clicks" checked> Clicks <span class="qa-hint">(random elements, CTAs, nav)</span></label>
                        <label><input type="checkbox" id="sim-scrolls" checked> Scrolls <span class="qa-hint">(smooth, fast, stick scrolling)</span></label>
                        <label><input type="checkbox" id="sim-mouse" checked> Mouse Movement <span class="qa-hint">(hover, hesitation patterns)</span></label>
                        <label><input type="checkbox" id="sim-rage" checked> Rage Clicks <span class="qa-hint">(rapid clicks same spot)</span></label>
                        <label><input type="checkbox" id="sim-dead" checked> Dead Clicks <span class="qa-hint">(clicks on non-interactive elements)</span></label>
                        <label><input type="checkbox" id="sim-tabs" checked> Tab Switching <span class="qa-hint">(visibility changes, blur/focus)</span></label>
                        <label><input type="checkbox" id="sim-forms" checked> Form Interactions <span class="qa-hint">(typing, field focus, hesitation)</span></label>
                        <label><input type="checkbox" id="sim-resize" checked> Viewport Resize <span class="qa-hint">(desktop/mobile switching)</span></label>
                    </div>
                    <div class="qa-sim-speed">
                        <label>Speed: </label>
                        <select id="sim-speed">
                            <option value="slow">Slow (human-like)</option>
                            <option value="medium" selected>Medium</option>
                            <option value="fast">Fast (stress test)</option>
                        </select>
                        <label style="margin-left:12px">Duration: </label>
                        <select id="sim-duration">
                            <option value="30">30 seconds</option>
                            <option value="60" selected>1 minute</option>
                            <option value="180">3 minutes</option>
                            <option value="300">5 minutes</option>
                            <option value="0">Until stopped</option>
                        </select>
                    </div>
                    <div class="qa-sim-buttons">
                        <button id="btn-start-sim" class="qa-btn">▶ Start Simulation</button>
                        <button id="btn-stop-sim" class="qa-btn danger" disabled>■ Stop</button>
                    </div>
                    <div id="sim-stats" class="qa-sim-stats hidden">
                        <div class="qa-stat"><span id="stat-clicks">0</span> clicks</div>
                        <div class="qa-stat"><span id="stat-scrolls">0</span> scrolls</div>
                        <div class="qa-stat"><span id="stat-moves">0</span> mouse moves</div>
                        <div class="qa-stat"><span id="stat-rage">0</span> rage clicks</div>
                        <div class="qa-stat"><span id="stat-dead">0</span> dead clicks</div>
                        <div class="qa-stat"><span id="stat-tabs">0</span> tab switches</div>
                        <div class="qa-stat"><span id="stat-forms">0</span> form interactions</div>
                        <div class="qa-stat"><span id="stat-elapsed">0s</span> elapsed</div>
                    </div>
                    <div id="sim-log" class="qa-log hidden"></div>
                </div>
            </div>
        </div>`;
        document.body.appendChild(panel);

        // Also ensure toggle button exists
        if (!document.getElementById('qa-toggle')) {
            const toggle = document.createElement('button');
            toggle.id = 'qa-toggle';
            toggle.className = 'qa-toggle';
            toggle.title = 'Open QA Panel (Ctrl+Shift+Q)';
            toggle.textContent = '🔬';
            document.body.appendChild(toggle);
        }
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
        injectPanelHTML();
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

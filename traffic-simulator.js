/**
 * Built-in Traffic Simulator
 * Simulates realistic user behavior for heatmap & recording testing
 * No external dependencies — runs entirely in-browser
 * 
 * Supported behaviors:
 * - Random clicks on interactive elements
 * - Scroll patterns (smooth, fast, stick scrolling)
 * - Mouse movement with hover and hesitation
 * - Rage clicks (rapid clicks on same spot)
 * - Dead clicks (clicks on non-interactive elements)
 * - Tab switching (visibility API triggers)
 * - Form interactions (typing, field focus, hesitation)
 * - Viewport resize events
 */

(function () {
    'use strict';

    const SIM = {
        running: false,
        timer: null,
        startTime: null,
        stats: {
            clicks: 0,
            scrolls: 0,
            moves: 0,
            rageClicks: 0,
            deadClicks: 0,
            tabSwitches: 0,
            formInteractions: 0,
        },
        speed: 'medium',
        duration: 60,
        options: {},
        actionQueue: [],
        logEntries: [],
    };

    // Speed presets (delays in ms)
    const SPEEDS = {
        slow: { minDelay: 1500, maxDelay: 4000, moveSteps: 30 },
        medium: { minDelay: 500, maxDelay: 2000, moveSteps: 15 },
        fast: { minDelay: 100, maxDelay: 600, moveSteps: 5 },
    };

    // ========================
    // HELPERS
    // ========================
    function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
    function randFloat(min, max) { return Math.random() * (max - min) + min; }
    function pick(arr) { return arr[rand(0, arr.length - 1)]; }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function log(msg, type = 'sim') {
        SIM.logEntries.push({ time: ((Date.now() - SIM.startTime) / 1000).toFixed(1) + 's', msg });
        const logEl = document.getElementById('sim-log');
        if (logEl) {
            const div = document.createElement('div');
            div.className = `log-entry ${type}`;
            div.textContent = `[${SIM.logEntries.at(-1).time}] ${msg}`;
            logEl.appendChild(div);
            logEl.scrollTop = logEl.scrollHeight;
        }
    }

    function updateStat(key, inc = 1) {
        SIM.stats[key] = (SIM.stats[key] || 0) + inc;
        const el = document.getElementById('stat-' + key);
        if (el) el.textContent = SIM.stats[key];
    }

    function updateElapsed() {
        if (!SIM.running) return;
        const el = document.getElementById('stat-elapsed');
        if (el) el.textContent = Math.round((Date.now() - SIM.startTime) / 1000) + 's';
    }

    // ========================
    // DISPATCH REALISTIC EVENTS
    // ========================
    function dispatchMouse(type, x, y, target) {
        const evt = new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window,
            clientX: x, clientY: y, screenX: x, screenY: y,
            button: 0, buttons: type === 'mousedown' ? 1 : 0,
        });
        (target || document.elementFromPoint(x, y) || document.body).dispatchEvent(evt);
    }

    function dispatchClick(x, y) {
        const target = document.elementFromPoint(x, y) || document.body;
        dispatchMouse('mousemove', x, y, target);
        dispatchMouse('mousedown', x, y, target);
        dispatchMouse('mouseup', x, y, target);
        dispatchMouse('click', x, y, target);
        return target;
    }

    function dispatchScroll(deltaY) {
        window.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true, deltaY, deltaMode: 0,
        }));
    }

    function dispatchKey(target, key) {
        ['keydown', 'keypress', 'keyup'].forEach(type => {
            target.dispatchEvent(new KeyboardEvent(type, {
                bubbles: true, key, code: 'Key' + key.toUpperCase(),
            }));
        });
    }

    // ========================
    // BEHAVIOR ACTIONS
    // ========================
    async function doRandomClick() {
        const interactiveEls = document.querySelectorAll(
            'a, button, [data-clickable], input[type="submit"], .feature-card, .testimonial-card, .price-card, .faq-question, .nav-links a, .btn-primary, .btn-ghost'
        );
        if (interactiveEls.length === 0) return;

        const el = pick([...interactiveEls]);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const x = rect.left + rand(5, rect.width - 5);
        const y = rect.top + rand(5, rect.height - 5);

        // Move to element first
        await doMouseMoveTo(x, y);
        dispatchClick(x, y);
        updateStat('clicks');
        log(`Click on <${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().substring(0, 30)}"`);
    }

    async function doScroll() {
        const scrollType = pick(['smooth', 'fast', 'stick', 'upDown']);
        const speed = SPEEDS[SIM.speed];

        switch (scrollType) {
            case 'smooth': {
                const distance = rand(200, 800);
                const steps = speed.moveSteps;
                for (let i = 0; i < steps && SIM.running; i++) {
                    window.scrollBy({ top: distance / steps, behavior: 'auto' });
                    dispatchScroll(distance / steps);
                    await sleep(30);
                }
                log(`Smooth scroll down ${distance}px`);
                break;
            }
            case 'fast': {
                const distance = rand(500, 2000);
                window.scrollBy({ top: distance, behavior: 'auto' });
                dispatchScroll(distance);
                log(`Fast scroll down ${distance}px`);
                break;
            }
            case 'stick': {
                // Stick scrolling: small increments staying in same area
                for (let i = 0; i < rand(5, 15) && SIM.running; i++) {
                    const tiny = rand(10, 40);
                    window.scrollBy({ top: tiny, behavior: 'auto' });
                    dispatchScroll(tiny);
                    await sleep(rand(200, 600));
                }
                log('Stick scrolling pattern (small increments)');
                break;
            }
            case 'upDown': {
                // Scroll down then back up
                const d = rand(300, 600);
                window.scrollBy({ top: d, behavior: 'smooth' });
                dispatchScroll(d);
                await sleep(rand(500, 1500));
                window.scrollBy({ top: -d * 0.7, behavior: 'smooth' });
                dispatchScroll(-d * 0.7);
                log('Up-down scroll pattern');
                break;
            }
        }
        updateStat('scrolls');
    }

    async function doMouseMoveTo(targetX, targetY) {
        const speed = SPEEDS[SIM.speed];
        const startX = rand(0, window.innerWidth);
        const startY = rand(0, window.innerHeight);
        const steps = speed.moveSteps;

        for (let i = 0; i <= steps && SIM.running; i++) {
            const t = i / steps;
            // Bezier-like curve for natural movement
            const x = startX + (targetX - startX) * (t * t * (3 - 2 * t));
            const y = startY + (targetY - startY) * (t * t * (3 - 2 * t));
            dispatchMouse('mousemove', x, y);
            await sleep(rand(10, 30));
        }
        updateStat('moves');
    }

    async function doMouseHover() {
        // Find an element and hover over it with hesitation
        const els = document.querySelectorAll('.feature-card, .testimonial-card, .price-card, a, button');
        if (els.length === 0) return;

        const el = pick([...els]);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return;

        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        await doMouseMoveTo(x, y);

        // Hesitation: stay near element, slight jitter
        for (let i = 0; i < rand(3, 8) && SIM.running; i++) {
            dispatchMouse('mousemove', x + rand(-5, 5), y + rand(-5, 5));
            await sleep(rand(100, 400));
        }

        dispatchMouse('mouseenter', x, y, el);
        dispatchMouse('mouseover', x, y, el);
        await sleep(rand(500, 2000)); // dwell time
        dispatchMouse('mouseleave', x, y, el);
        dispatchMouse('mouseout', x, y, el);

        log(`Mouse hover + hesitation on <${el.tagName.toLowerCase()}>`);
    }

    async function doRageClick() {
        // Rapid clicks on the same spot
        const x = rand(100, window.innerWidth - 100);
        const y = rand(100, window.innerHeight - 100);
        const target = document.elementFromPoint(x, y);
        const clickCount = rand(5, 12);

        for (let i = 0; i < clickCount && SIM.running; i++) {
            dispatchClick(x + rand(-3, 3), y + rand(-3, 3));
            await sleep(rand(40, 120));
        }

        updateStat('rageClicks');
        updateStat('clicks', clickCount);
        log(`Rage click: ${clickCount} rapid clicks at (${x}, ${y}) on <${target?.tagName || 'unknown'}>`);
    }

    async function doDeadClick() {
        // Click on non-interactive elements (text, backgrounds, images)
        const nonInteractive = document.querySelectorAll(
            'p, h1, h2, h3, span, .hero-sub, .logos-label, .logo-fake, .section-header, .footer-bottom, .hero-badge'
        );
        if (nonInteractive.length === 0) return;

        const el = pick([...nonInteractive]);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return;

        const x = rect.left + rand(5, Math.min(rect.width - 5, 100));
        const y = rect.top + rand(2, Math.min(rect.height - 2, 30));

        dispatchClick(x, y);
        updateStat('deadClicks');
        updateStat('clicks');
        log(`Dead click on <${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().substring(0, 30)}"`);
    }

    async function doTabSwitch() {
        // Simulate visibility change (tab switch)
        log('Simulating tab switch (hidden → visible)');

        // Create and dispatch visibilitychange event
        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('blur'));

        await sleep(rand(1000, 5000)); // Time "away"

        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));

        updateStat('tabSwitches');
        log('Tab returned to visible');
    }

    async function doFormInteraction() {
        const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input, textarea');
        if (inputs.length === 0) return;

        const input = pick([...inputs]);
        input.focus();
        input.dispatchEvent(new Event('focus', { bubbles: true }));

        // Simulate typing with hesitation
        const chars = 'test@example.com'.split('');
        for (let i = 0; i < rand(3, chars.length) && SIM.running; i++) {
            dispatchKey(input, chars[i]);
            input.value = (input.value || '') + chars[i];
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(rand(50, 300)); // typing speed variation

            // Occasional hesitation
            if (Math.random() < 0.2) {
                await sleep(rand(500, 2000));
                log('Form hesitation (paused typing)');
            }
        }

        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
        input.dispatchEvent(new Event('blur', { bubbles: true }));

        updateStat('formInteractions');
        log(`Form interaction on <input> id="${input.id || '?'}" type="${input.type}"`);
    }

    async function doViewportResize() {
        // Dispatch resize event with different dimensions
        const sizes = [
            { w: 375, h: 812, name: 'iPhone' },
            { w: 768, h: 1024, name: 'iPad' },
            { w: 1280, h: 720, name: 'Laptop' },
            { w: 1920, h: 1080, name: 'Desktop' },
        ];
        const size = pick(sizes);

        window.dispatchEvent(new Event('resize'));
        log(`Viewport resize event dispatched (simulating ${size.name}: ${size.w}x${size.h})`);
    }

    // ========================
    // SIMULATION LOOP
    // ========================
    async function runSimulation() {
        SIM.running = true;
        SIM.startTime = Date.now();
        SIM.stats = { clicks: 0, scrolls: 0, moves: 0, rageClicks: 0, deadClicks: 0, tabSwitches: 0, formInteractions: 0 };
        SIM.logEntries = [];

        // Update UI
        document.getElementById('btn-start-sim').disabled = true;
        document.getElementById('btn-stop-sim').disabled = false;
        document.getElementById('sim-stats').classList.remove('hidden');
        document.getElementById('sim-log').classList.remove('hidden');
        document.getElementById('sim-log').innerHTML = '';
        Object.keys(SIM.stats).forEach(k => {
            const el = document.getElementById('stat-' + k);
            if (el) el.textContent = '0';
        });

        log('Simulation started');

        // Read options
        SIM.speed = document.getElementById('sim-speed')?.value || 'medium';
        SIM.duration = parseInt(document.getElementById('sim-duration')?.value || '60', 10);
        const opts = {
            clicks: document.getElementById('sim-clicks')?.checked,
            scrolls: document.getElementById('sim-scrolls')?.checked,
            mouse: document.getElementById('sim-mouse')?.checked,
            rage: document.getElementById('sim-rage')?.checked,
            dead: document.getElementById('sim-dead')?.checked,
            tabs: document.getElementById('sim-tabs')?.checked,
            forms: document.getElementById('sim-forms')?.checked,
            resize: document.getElementById('sim-resize')?.checked,
        };

        // Build weighted action list
        const actions = [];
        if (opts.clicks) actions.push(...Array(5).fill(doRandomClick));
        if (opts.scrolls) actions.push(...Array(4).fill(doScroll));
        if (opts.mouse) actions.push(...Array(3).fill(doMouseHover));
        if (opts.rage) actions.push(doRageClick);
        if (opts.dead) actions.push(...Array(2).fill(doDeadClick));
        if (opts.tabs) actions.push(doTabSwitch);
        if (opts.forms) actions.push(...Array(2).fill(doFormInteraction));
        if (opts.resize) actions.push(doViewportResize);

        if (actions.length === 0) {
            log('No actions enabled!', 'warn');
            stopSimulation();
            return;
        }

        const speed = SPEEDS[SIM.speed];
        const elapsedInterval = setInterval(updateElapsed, 1000);

        while (SIM.running) {
            // Check duration
            if (SIM.duration > 0 && (Date.now() - SIM.startTime) / 1000 >= SIM.duration) {
                log('Duration reached — stopping');
                break;
            }

            const action = pick(actions);
            try {
                await action();
            } catch (e) {
                log(`Action error: ${e.message}`, 'err');
            }

            await sleep(rand(speed.minDelay, speed.maxDelay));
        }

        clearInterval(elapsedInterval);
        stopSimulation();
    }

    function stopSimulation() {
        SIM.running = false;
        document.getElementById('btn-start-sim').disabled = false;
        document.getElementById('btn-stop-sim').disabled = true;
        log('Simulation stopped');
        updateElapsed();
    }

    // ========================
    // INIT
    // ========================
    function init() {
        document.getElementById('btn-start-sim')?.addEventListener('click', runSimulation);
        document.getElementById('btn-stop-sim')?.addEventListener('click', () => {
            SIM.running = false;
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.__trafficSim = {
        start: runSimulation,
        stop: () => { SIM.running = false; },
        getStats: () => SIM.stats,
    };

})();

# Meridian — Heatmap & Signals QA Testing Site

A realistic multi-page SaaS site built specifically for testing Convert.com heatmaps, recordings (signals), and A/B testing features. Includes a built-in QA diagnostics panel and traffic simulator.

## What's Inside

### Site Pages (looks like a real SaaS product)
- **index.html** — Homepage with hero, features grid, testimonials, pricing preview, CTA, FAQ
- **features.html** — Detailed feature pages with clickable cards
- **pricing.html** — 3-tier pricing with monthly/annual toggle
- **blog.html** — Blog listing with article cards
- **contact.html** — Contact form with multiple input types

### QA Diagnostics Panel (Ctrl+Shift+Q or 🔬 button)

**Tab 1: Script Detection**
- Detects if Convert main tracking script is loaded
- Detects if `signals.insights.min.js` is loaded
- Shows whether scripts are served from **Convert CDN** or **custom domain**
- Checks if visitor is in the 5% signals sample
- Lists active experiences from `convert.currentData`
- Reads `_conv_v`, `_conv_d`, `_conv_spn` cookies
- Export full detection report as JSON

**Tab 2: Network Monitor**
- Intercepts all `fetch`, `XMLHttpRequest`, `sendBeacon` requests
- Monitors dynamically loaded `<script>` tags via MutationObserver
- Flags all Convert-related requests with `[CONVERT]` badge
- Flags custom domain requests with `[CUSTOM-DOMAIN]` badge
- Filterable by type: Scripts, XHR/Fetch, Beacons, WebSocket

**Tab 3: WebSocket**
- Intercepts `new WebSocket()` calls
- Tracks heatmap and signals/recording WebSocket connections
- Shows connection status (connecting → open → closed)
- Logs incoming/outgoing WebSocket frames with size
- Shows whether WebSocket endpoints use custom domain or Convert CDN

**Tab 4: Traffic Simulator**
- Runs entirely in-browser — no Selenium/Playwright needed
- Simulates real DOM events (MouseEvent, WheelEvent, KeyboardEvent, etc.)

Supported behaviors:
| Behavior | What it does |
|---|---|
| Clicks | Random clicks on CTAs, nav links, cards, buttons |
| Scrolls | Smooth scroll, fast scroll, stick scrolling, up-down patterns |
| Mouse Movement | Realistic bezier-curve movement, hover + hesitation |
| Rage Clicks | 5-12 rapid clicks on the same spot |
| Dead Clicks | Clicks on non-interactive elements (text, headings) |
| Tab Switching | Fires visibilitychange, blur/focus events |
| Form Interactions | Field focus, typing with hesitation, input/change events |
| Viewport Resize | Dispatches resize events simulating device switching |

Speed modes: Slow (human-like), Medium, Fast (stress test)
Duration: 30s, 1m, 3m, 5m, or unlimited

## Setup

### 1. Add Convert Tracking Script

Edit `index.html` (and other pages) — uncomment and update the tracking script in `<head>`:

```html
<script src="https://cdn-4.convertexperiments.com/v1/js/ACCOUNT_ID-PROJECT_ID.js"></script>
```

Or if using a custom domain:
```html
<script src="https://YOUR-CUSTOM-DOMAIN/v1/js/ACCOUNT_ID-PROJECT_ID.js"></script>
```

For your wanderlustt.win setup:
```html
<!-- CDN version -->
<script src="https://cdn-4.convertexperiments.com/v1/js/10049520-100417322.js?environment=production"></script>

<!-- Custom domain version -->
<script src="https://tracking.wanderlustt.win/v1/js/10049520-100417322.js?environment=production"></script>
```

### 2. Deploy to Cloudflare Pages

This is a static site — no backend needed.

**Via GitHub (recommended):**
1. Push this repo to GitHub
2. Go to Cloudflare Dashboard → Pages → Create a project
3. Connect your GitHub repo
4. Build settings:
   - Framework preset: None
   - Build command: (leave empty)
   - Build output directory: `/` (root)
5. Deploy

**Via direct upload:**
1. Go to Cloudflare Pages → Create a project → Upload assets
2. Drag all files from this folder
3. Deploy

**Custom subdomain:**
After deploy, go to Custom domains and add e.g. `heatmap.wanderlustt.win`

### 3. Railway Considerations

This site is **purely static** — you don't need Railway for it. Cloudflare Pages (free) is the better choice.

If you still want Railway (e.g. to add a backend later for automated Playwright traffic simulation):
- The $5 Hobby plan gives you $5 of usage credits/month
- A static site on Railway uses almost nothing
- But Cloudflare Pages is free and faster for static hosting

**If you do want to add server-side traffic simulation later**, I can create a separate Node.js service for Railway that runs headless Playwright sessions against this site.

## File Structure

```
├── index.html          # Homepage
├── features.html       # Features page
├── pricing.html        # Pricing page
├── blog.html           # Blog listing
├── contact.html        # Contact form
├── styles.css          # All styles (site + QA panel)
├── qa-diagnostics.js   # Script detection, network monitoring, WebSocket tracking
├── traffic-simulator.js # Built-in behavior simulation
├── site.js             # Site interactivity (FAQ, scroll animations)
└── README.md           # This file
```

## Usage Tips

### Testing Heatmaps
1. Deploy site and add Convert tracking script
2. Create heatmaps in Convert for each page URL
3. Open QA panel (Ctrl+Shift+Q) → Traffic Sim tab
4. Run simulation with clicks + scrolls enabled
5. Check Convert dashboard for heatmap data

### Testing Signals/Recordings
1. Make sure an experience is running on the project
2. Since signals loads for only 5% of visitors, either:
   - Run the traffic sim on "Fast" for many simulated sessions, or
   - Use the built-in QA panel to check if you're in sample
3. If in sample: run simulation with rage clicks, dead clicks, and hesitation enabled
4. Check QA panel → WebSocket tab for recording data transmission

### Testing Custom Domain
1. Open QA panel → Script Detection tab
2. Check "Script Source Domain" and "Custom Domain" status cards
3. Green = loading from custom domain
4. Yellow = loading from Convert CDN (custom domain not active or not configured)
5. Check Network Monitor tab for all Convert requests and their domains

### Programmatic Access
```javascript
// From browser console:
window.__convertQA.getState()       // Full diagnostic state
window.__convertQA.exportReport()   // Download JSON report
window.__convertQA.recheck()        // Re-run detection

window.__trafficSim.start()         // Start simulation
window.__trafficSim.stop()          // Stop simulation
window.__trafficSim.getStats()      // Get current stats
```

## Convert-Specific Detection Logic

The QA panel checks for these Convert artifacts:

| What | How it's detected |
|---|---|
| Main tracking script | `<script>` with URL matching `/v1/js/ACCOUNT-PROJECT.js` |
| Signals script | `<script>` with `signals.insights.min.js` in URL |
| Custom domain | Script domain ≠ any known Convert CDN domain |
| Sampling status | Presence of signals script = in sample; console intercept for `Workflow.setSignals()` messages |
| Active experiences | `convert.currentData.experiences` object |
| Cookies | `_conv_v` (visitor), `_conv_d` (data), `_conv_spn` (SPN) |
| Metrics endpoint | Network requests to `/metrics/v1/track/` |
| WebSocket | Any `new WebSocket()` to Convert-related domains |

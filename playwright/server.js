const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = 3000; // matches what n8n's playwright node already calls (127.0.0.1:3000)

app.use(express.json({ limit: "2mb" }));

// Single shared browser instance, reused across requests (browser reuse
// pattern — launching a fresh browser per request is the most expensive
// possible way to run this service).
let browserPromise = null;
function getBrowser() {
    if (!browserPromise) {
        browserPromise = chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
    }
    return browserPromise;
}

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
    });
});

/**
 * POST /fetch
 * Body: { "url": "https://example.com/job-posting" }
 * Response: { "data": "<html>...</html>" }
 *
 * Renders the given URL with a real browser (handles JS-heavy pages,
 * client-side rendering) and returns the fully-rendered HTML.
 * Never throws uncaught — always responds with a clear error shape
 * on failure so the calling n8n node can branch on it cleanly.
 */
app.post("/fetch", async (req, res) => {
    const { url } = req.body || {};

    if (!url || typeof url !== "string" || url.trim().length === 0) {
        return res.status(400).json({
            success: false,
            error: {
                code: "INVALID_REQUEST",
                message: "url must be a non-empty string",
            },
        });
    }

    let context;
    let page;

    try {
        const browser = await getBrowser();
        context = await browser.newContext({
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport: { width: 1280, height: 800 },
        });
        page = await context.newPage();

        // 30s navigation timeout; wait for network to go mostly idle so
        // client-side-rendered content has a chance to load.
        await page.goto(url, {
            waitUntil: "networkidle",
            timeout: 30000,
        });

        const html = await page.content();

        return res.json({
            success: true,
            data: html,
        });
    } catch (err) {
        console.error(`[playwright] fetch failed for ${url}:`, err.message);
        return res.status(502).json({
            success: false,
            error: {
                code: "FETCH_FAILED",
                message: err && err.message ? err.message : "Unknown render error",
            },
        });
    } finally {
        // Always clean up the page/context, even on failure, so we don't
        // leak resources across requests. The shared browser itself stays open.
        if (page) await page.close().catch(() => { });
        if (context) await context.close().catch(() => { });
    }
});

app.listen(PORT, () => {
    console.log(`Playwright API running on http://localhost:${PORT}`);
});
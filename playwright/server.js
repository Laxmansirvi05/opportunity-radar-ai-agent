const express = require("express");
const { chromium } = require("playwright");

const app = express();

app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => {
    res.json({
        status: "ok"
    });
});

app.listen(3005, () => {
    console.log("Playwright API running on http://localhost:3005");
});
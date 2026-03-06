const express = require('express');
const app = express();
const fetch = require('node-fetch');
const path = require('path');
const path = require('path');
const PORT = process.env.PORT || 8081;

// Global Middleware
app.use(express.json()); // Parse JSON bodies
app.use((req, res, next) => {
    // CORS Headers
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Serve Frontend Static Files
// This replaces the old server.js enabling single-port deployment
app.use(express.static(path.join(__dirname, '.')));

// Default Route for Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'monitor.html'));
});

// Proxy Endpoint
// This handles any streaming or snapshot URL by piping the response directly
app.get('/camera', (req, res) => {
    // 1. Get Target URL from Query or Request Body
    const cameraUrl = req.query.url;

    if (!cameraUrl) {
        return res.status(400).send('<h1>Proxy Error</h1><p>Missing "url" query parameter. <br>Example: /camera?url=http://192.168.1.100:8080/video</p>');
    }

    // console.log(`Proxying: ${cameraUrl}`);

    try {
        // 2. Stream Request to Target
        const stream = request({
            url: cameraUrl,
            timeout: 10000 // 10s timeout
        });

        // 3. Handle Errors
        stream.on('error', (err) => {
            console.error(`Proxy Connection Error (${cameraUrl}):`, err.code);
            if (!res.headersSent) {
                res.status(502).send(`Bad Gateway: Unable to connect to camera (${err.code})`);
            }
        });

        // 4. Pipe Response
        // This pipes the camera stream/image back to the browser seamlessly
        stream.pipe(res);

    } catch (err) {
        console.error("Critical Proxy Error:", err);
        if (!res.headersSent) {
            res.status(500).send("Internal Server Error");
        }
    }
});

// Telegram Proxy Endpoint
// Bypasses browser ERR_CONNECTION_RESET by sending from Node
app.post('/telegram', (req, res) => {
    const { token, chatId, text, proxyUrl } = req.body;

    if (!token || !chatId || !text) {
        return res.status(400).json({ error: 'Missing token, chatId, or text' });
    }

    const payload = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
    });

    // Default to api.telegram.org if no custom proxy is provided
    let finalUrl = `https://api.telegram.org/bot${token}/sendMessage`;

    if (proxyUrl && proxyUrl.trim() !== '') {
        try {
            const customUrl = new URL(proxyUrl);
            const baseProxyUrl = customUrl.origin + customUrl.pathname.replace(/\/$/, '');
            finalUrl = `${baseProxyUrl}/bot${token}/sendMessage`;
            console.log(`[Telegram Proxy] Routing via custom Proxy URL: ${customUrl.origin}`);
        } catch (e) {
            console.log("[Telegram Proxy] Invalid custom proxy URL, falling back to api.telegram.org");
        }
    }

    fetch(finalUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown'
        })
    })
        .then(response => response.json())
        .then(data => {
            if (!data.ok) {
                console.error('[Telegram Proxy] API Error Response:', data);
                return res.status(500).json({ error: 'Telegram API rejected the message', details: data });
            }
            res.status(200).json(data);
        })
        .catch(error => {
            console.error('[Telegram Proxy] Fetch Error:', error);
            res.status(500).json({ error: `Failed to reach Telegram API: ${error.message || error.toString()}` });
        });
});

app.listen(PORT, () => {
    console.log(`\n🚀 MedGuard AI System is running!`);
    console.log(`   Dashboard URL: http://localhost:${PORT}/monitor.html`);
    console.log(`   Camera Proxy:  http://localhost:${PORT}/camera?url=[YOUR_IP_CAMERA_URL]`);
});
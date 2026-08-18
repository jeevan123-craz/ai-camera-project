// ── Fix: Override GOOGLE_API_KEY before any SDK loads ──────────────────────
require('dotenv').config();
if (process.env.GEMINI_API_KEY) {
    process.env.GOOGLE_API_KEY = process.env.GEMINI_API_KEY;
}

// ── Crash Protection: never let a puppeteer error kill the process ──────────
process.on('uncaughtException', (err) => {
    console.error('⚠️  Uncaught Exception (server kept alive):', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('⚠️  Unhandled Rejection (server kept alive):', reason?.message || reason);
});

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EdgeTTS } = require('node-edge-tts');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const ai = require('./ai');
const calendar = require('./calendar');
const sheets = require('./sheets');
const gmail = require('./gmail');
const cronJobs = require('./cronJobs');
const twilio = require('twilio');

// Setup Twilio Client
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('📞 Twilio Client Initialized');
}

// Setup Prescriptions file
const PRESCRIPTIONS_FILE = path.join(__dirname, 'prescriptions.json');
if (!fs.existsSync(PRESCRIPTIONS_FILE)) {
    fs.writeFileSync(PRESCRIPTIONS_FILE, JSON.stringify([]));
}

// WhatsApp is disabled as requested by the user
const whatsapp = {
    isReady: false,
    qrCode: null,
    on: () => {},
    sendDirectMessage: async () => false,
    start: () => { console.log('📱 WhatsApp integration disabled.'); }
};

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.set('trust proxy', 1);

// ── Rate Limiting for Chat ──
const chatLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Limit each IP to 10 requests per minute
    message: { error: 'Too many requests from this IP, please try again after a minute' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ── Cookie Auth for Admin ──
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'medguard123';
const AUTH_TOKEN = 'admin_secure_token_123'; // In prod, use JWT or proper sessions

const adminAuth = (req, res, next) => {
    if (req.cookies && req.cookies.admin_token === AUTH_TOKEN) {
        next();
    } else {
        // If it's an API request, return 401
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        // Otherwise redirect to login
        res.redirect('/login.html');
    }
};

// Protect admin.html specifically before serving static files
app.get('/admin.html', adminAuth, (req, res, next) => {
    next();
});

// Login Endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === ADMIN_PASSWORD) {
        res.cookie('admin_token', AUTH_TOKEN, { 
            httpOnly: true, 
            maxAge: 24 * 60 * 60 * 1000 // 1 day 
        });
        return res.json({ success: true });
    }
    res.status(401).json({ error: 'Invalid username or password' });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.json({ success: true });
});

// ── Google OAuth Re-authentication (from the admin page, no restart needed) ──
const googleAuth = require('./googleAuth');
const crypto = require('crypto');
let pendingAuthState = null; // CSRF guard for the OAuth round-trip

// Health check: does the current token still work? (Testing-mode refresh tokens
// die every ~7 days — this is what the admin card polls.)
app.get('/api/auth/status', adminAuth, async (req, res) => {
    const status = { healthy: false, authorizedAt: null, daysLeft: null, error: null };
    try {
        const stat = fs.statSync(googleAuth.TOKEN_PATH);
        status.authorizedAt = stat.mtime.toISOString();
        // Testing-mode refresh tokens last 7 days from issue; mtime ≈ issue time.
        const ageDays = (Date.now() - stat.mtime.getTime()) / 86400000;
        status.daysLeft = Math.max(0, +(7 - ageDays).toFixed(1));
    } catch (_) {
        status.error = 'token.json missing';
        return res.json(status);
    }
    try {
        // Live probe — returns cached access token if valid, else refreshes.
        // A dead refresh token surfaces here as invalid_grant.
        await googleAuth.getAuthClient().getAccessToken();
        status.healthy = true;
    } catch (err) {
        status.error = err.message || String(err);
    }
    res.json(status);
});

// Kicks off the consent flow: admin clicks the button → this redirects to Google.
app.get('/api/auth/start', adminAuth, (req, res) => {
    pendingAuthState = crypto.randomBytes(16).toString('hex');
    const url = googleAuth.getAuthClient().generateAuthUrl({
        access_type: 'offline',
        scope: googleAuth.SCOPES,
        prompt: 'consent', // force a brand-new refresh token every time
        state: pendingAuthState,
    });
    res.redirect(url);
});

// Google redirects back here after consent (same path auth.js used, so the
// redirect URI registered in credentials.json keeps working unchanged).
app.get('/oauth2callback', async (req, res) => {
    const { code, state, error } = req.query;
    const page = (title, body, ok) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
        <style>body{font-family:system-ui,sans-serif;background:#0a0910;color:#e7e4ee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
        .card{max-width:420px;text-align:center;padding:2.5rem;border:1px solid ${ok ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)'};border-radius:16px;background:rgba(255,255,255,0.03)}
        h1{font-size:1.3rem;margin:0 0 0.75rem}p{color:#9a95ab;font-size:0.9rem;line-height:1.6;margin:0}</style></head>
        <body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;

    if (error) {
        return res.send(page('❌ Authentication failed', `Google returned: ${error}. Close this tab and try again from the admin page.`, false));
    }
    if (!code || !state || state !== pendingAuthState) {
        return res.status(403).send(page('❌ Invalid request', 'This authentication link is stale or invalid. Close this tab and click Re-authenticate on the admin page again.', false));
    }
    pendingAuthState = null; // single-use

    try {
        const { tokens } = await googleAuth.getAuthClient().getToken(code);
        googleAuth.saveToken(tokens);
        res.send(page('✅ Google re-authenticated!', 'Calendar, Sheets, and Gmail are live again — no restart needed. You can close this tab and return to the admin dashboard.', true));
    } catch (err) {
        console.error('OAuth code exchange failed:', err.message || err);
        res.status(500).send(page('❌ Token exchange failed', `${err.message || 'Unknown error'}. Close this tab and try again from the admin page.`, false));
    }
});

// ── Analytics: aggregate the Google Sheets booking log for the admin charts ──
app.get('/api/analytics', adminAuth, async (req, res) => {
    try {
        const rows = await sheets.getAllAppointmentRows();

        // Booking trend — last 14 days by log timestamp (IST calendar days)
        const dayKey = d => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
        const trendDays = [];
        for (let i = 13; i >= 0; i--) {
            trendDays.push(dayKey(new Date(Date.now() - i * 86400000)));
        }
        const trendCounts = Object.fromEntries(trendDays.map(k => [k, 0]));

        const byDoctor = {};
        const byMode = { WhatsApp: 0, Browser: 0 };
        const byHour = {}; // appointment hour of day (IST)
        const byReason = {};

        for (const r of rows) {
            const logged = new Date(r.timestamp);
            if (!isNaN(logged.getTime())) {
                const k = dayKey(logged);
                if (k in trendCounts) trendCounts[k]++;
            }

            const doc = (r.doctor && r.doctor !== 'Any') ? r.doctor : 'Unassigned';
            byDoctor[doc] = (byDoctor[doc] || 0) + 1;

            if ((r.mode || '').startsWith('WhatsApp')) byMode.WhatsApp++;
            else byMode.Browser++;

            const appt = new Date(r.apptTime);
            if (!isNaN(appt.getTime())) {
                const hour = parseInt(appt.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }), 10);
                byHour[hour] = (byHour[hour] || 0) + 1;
            }

            const reason = (r.reason || '').trim();
            if (reason) {
                // Collapse triage summaries to their first clause so variants group together
                const short = reason.split(/[,.;–—-]/)[0].trim().toLowerCase();
                if (short) byReason[short] = (byReason[short] || 0) + 1;
            }
        }

        const topDoctors = Object.entries(byDoctor)
            .sort((a, b) => b[1] - a[1]).slice(0, 8)
            .map(([doctor, count]) => ({ doctor, count }));

        const topReasons = Object.entries(byReason)
            .sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([reason, count]) => ({ reason, count }));

        // Clinic hours 9→18 IST for the peak-hours chart
        const peakHours = [];
        for (let h = 9; h <= 18; h++) {
            peakHours.push({ hour: `${h > 12 ? h - 12 : h}${h >= 12 ? 'PM' : 'AM'}`, count: byHour[h] || 0 });
        }

        res.json({
            totalBookings: rows.length,
            trend: trendDays.map(day => ({ day, count: trendCounts[day] })),
            topDoctors,
            byMode,
            peakHours,
            topReasons,
        });
    } catch (err) {
        console.error('Analytics error:', err.message || err);
        res.status(500).json({ error: 'Failed to compute analytics' });
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ── Live Logs Array ──
const callLogs = [];

function addLog(source, role, text, sessionId, extra = {}) {
    callLogs.unshift({ source, role, text, sessionId, timestamp: new Date().toISOString(), extra });
    if (callLogs.length > 100) callLogs.pop();
    broadcastDashboardUpdate();
}

// ── Broadcast function for dashboard ──
async function broadcastDashboardUpdate() {
    const data = JSON.stringify({
        appointments: await calendar.getAllAppointments(),
        availableSlots: await calendar.getAvailableSlots(),
        logs: callLogs,
        whatsappStatus: {
            ready: whatsapp.isReady,
            qr: whatsapp.qrCode
        }
    });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

wss.on('connection', async (ws) => {
    console.log('Dashboard client connected');
    const data = JSON.stringify({
        appointments: await calendar.getAllAppointments(),
        availableSlots: await calendar.getAvailableSlots(),
        logs: callLogs,
        whatsappStatus: {
            ready: whatsapp.isReady,
            qr: whatsapp.qrCode
        }
    });
    ws.send(data);
});

// ── WhatsApp Listeners ──
whatsapp.on('log', (data) => {
    addLog(data.source, data.role, data.text, data.phone);
});
whatsapp.on('qr_received', () => { broadcastDashboardUpdate(); });
whatsapp.on('ready', () => { broadcastDashboardUpdate(); });
whatsapp.on('booking_updated', () => { broadcastDashboardUpdate(); });

// ── REST API: WhatsApp Status ──
app.get('/api/whatsapp-status', (req, res) => {
    res.json({ ready: whatsapp.isReady, qr: whatsapp.qrCode });
});

// ── REST API: Tunnel URL (for Android app cross-network connectivity) ──
app.get('/api/tunnel-url', (req, res) => {
    const tunnelFile = path.join(__dirname, '.tunnel-url');
    try {
        if (fs.existsSync(tunnelFile)) {
            const url = fs.readFileSync(tunnelFile, 'utf8').trim();
            res.json({ url, active: true });
        } else {
            res.json({ url: null, active: false });
        }
    } catch {
        res.json({ url: null, active: false });
    }
});


// ── Browser Call Endpoint ──────────────────────────────────────────────────
app.post('/chat', chatLimiter, async (req, res) => {
    const { sessionId, message, language } = req.body;

    if (!sessionId || !message || !message.trim()) {
        return res.status(400).json({ error: 'sessionId and message are required.' });
    }

    const ip = req.ip || req.connection?.remoteAddress || 'Unknown IP';
    const userAgent = req.headers['user-agent'] || 'Unknown Device';

    addLog('Browser', 'user', message.trim(), sessionId, { ip, userAgent });

    try {
        let aiResponse = await ai.processUserInput(sessionId, message.trim(), language, null);

        const bookRegex = /\[BOOK:\s*([^\]]+)\]/i;
        const match = aiResponse.match(bookRegex);
        let booked = false;

        if (match) {
            const [time, patientName, reason, doctorNameRaw, email] = match[1].split('|').map(s => (s || '').trim());
            const doctorName = doctorNameRaw || 'Any';
            const result = await calendar.bookAppointment(patientName, time, reason, doctorName, email);
            if (result.success) {
                await sheets.logAppointment(patientName, "Browser", time, "Browser Chat", doctorName, reason, email);
                booked = true;
                if (email) {
                    const tokenNumber = gmail.tokenFromEventId(result.eventId);
                    gmail.sendAppointmentConfirmation(email, { patientName, time, doctorName, reason, tokenNumber })
                        .catch(err => console.error('Confirmation email failed:', err.message || err));
                }
            }
            aiResponse = aiResponse.replace(bookRegex, '').trim();
        }

        const cancelRegex = /\[CANCEL:\s*(.*?)\]/i;
        const cancelMatch = aiResponse.match(cancelRegex);
        if (cancelMatch) {
            const patientName = cancelMatch[1].trim();
            const cancelResult = await calendar.cancelAppointment(patientName);
            aiResponse = aiResponse.replace(cancelRegex, '').trim();
            if (cancelResult.success) {
                booked = true;
            } else {
                console.error(`Cancel failed for "${patientName}": ${cancelResult.message}`);
                aiResponse += ` (Note: I couldn't find an appointment under that name to cancel — please double check the name or contact the clinic.)`;
            }
        }

        const rescheduleRegex = /\[RESCHEDULE:\s*(.*?)\|(.*?)\|(.*?)\|(.*?)(?:\|(.*?))?\]/i;
        const rescheduleMatch = aiResponse.match(rescheduleRegex);
        if (rescheduleMatch) {
            const oldTime     = rescheduleMatch[1].trim();
            const newTime     = rescheduleMatch[2].trim();
            const patientName = rescheduleMatch[3].trim();
            const reason      = rescheduleMatch[4].trim();
            const doctorName  = rescheduleMatch[5] ? rescheduleMatch[5].trim() : 'Any';
            const result = await calendar.rescheduleAppointment(oldTime, newTime, patientName, reason, doctorName);
            if (result.success) {
                await sheets.logAppointment(patientName, "Browser", newTime, "Browser Chat Reschedule", doctorName, reason);
                booked = true;
            }
            aiResponse = aiResponse.replace(rescheduleRegex, '').trim();
        }

        const waRegex = /\[SEND_WHATSAPP:\s*([^\]]+)\]/i;
        const waMatch = aiResponse.match(waRegex);
        if (waMatch) {
            const phoneNumber = waMatch[1].trim();
            const messageToSend = `Hello from MedGuard Clinic! Here is the information you requested:\n\n📍 *Location:* 123 Health Ave, Medical District, NY 10001\n🚨 *Emergency Hotline:* 911 or +1-800-MED-HELP\n🕒 *Hours:* Mon-Fri, 9am - 6pm\n\nThank you for choosing MedGuard!`;
            whatsapp.sendDirectMessage(phoneNumber, messageToSend);
            aiResponse = aiResponse.replace(waRegex, '').trim();
            console.log(`[INFO] Sent WhatsApp clinic details to ${phoneNumber}`);
        }

        addLog('Browser', 'ai', aiResponse, sessionId);
        broadcastDashboardUpdate();
        res.json({ reply: aiResponse, booked });

    } catch (err) {
        console.error('Error in /chat:', err);
        res.status(500).json({ error: 'AI processing failed. Please try again.' });
    }
});

// ── Free Neural TTS Endpoint ───────────────────────────────────────────────
app.post('/api/tts', async (req, res) => {
    try {
        const { text, lang } = req.body;
        if (!text) return res.status(400).json({ error: 'Text is required' });

        const voice = lang === 'ta-IN' ? 'ta-IN-PallaviNeural' : 'en-US-JennyNeural';
        const tts = new EdgeTTS({
            voice: voice,
            lang: lang || 'en-US',
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
        });

        const tmpFilePath = path.join(os.tmpdir(), `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
        
        await tts.ttsPromise(text, tmpFilePath);
        
        const stat = fs.statSync(tmpFilePath);
        res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': stat.size
        });
        
        const readStream = fs.createReadStream(tmpFilePath);
        readStream.pipe(res);
        readStream.on('end', () => {
            fs.unlinkSync(tmpFilePath); // cleanup
        });
    } catch (err) {
        console.error('TTS Error:', err);
        res.status(500).json({ error: 'TTS generation failed' });
    }
});

// ── ElevenLabs Browser TTS Endpoint ────────────────────────────────────────
app.post('/api/tts-elevenlabs', async (req, res) => {
    try {
        const { text, lang } = req.body;
        if (!text) return res.status(400).json({ error: 'Text is required' });

        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'ElevenLabs API key not configured' });

        const voiceId = process.env.ELEVENLABS_VOICE_ID || 'hpp4J3VqNfWAUOO0d1Us';
        const modelId = lang === 'ta-IN' ? 'eleven_multilingual_v2' : 'eleven_flash_v2_5';

        const elResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'audio/mpeg',
            },
            body: JSON.stringify({
                text,
                model_id: modelId,
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    style: 0.3,
                }
            })
        });

        if (!elResponse.ok) {
            const errText = await elResponse.text();
            console.error('ElevenLabs browser TTS error:', errText);
            return res.status(502).json({ error: 'ElevenLabs TTS failed' });
        }

        const audioBuffer = Buffer.from(await elResponse.arrayBuffer());
        res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioBuffer.length
        });
        res.end(audioBuffer);
    } catch (err) {
        console.error('ElevenLabs TTS Error:', err);
        res.status(500).json({ error: 'ElevenLabs TTS generation failed' });
    }
});

// ── Twilio Call Endpoints ───────────────────────────────────────────────

// Sanitize AI response for phone TTS: strip tags and convert ISO dates to spoken form
function sanitizeForSpeech(text) {
    text = text.replace(/\[TABLE:\s*[^\]]*\]/gi, '');
    text = text.replace(/\[DOCTORS_CHART:\s*[^\]]*\]/gi, '');
    text = text.replace(/\[SEND_WHATSAPP:\s*[^\]]*\]/gi, '');

    text = text.replace(/\b(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:\d{2})?(\.\d+)?Z?\b/g, (match) => {
        try {
            const d = new Date(match);
            if (isNaN(d.getTime())) return match;
            const now = new Date();
            const today = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
            const target = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
            const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const targetDate = new Date(target.getFullYear(), target.getMonth(), target.getDate());
            const dayDiff = Math.round((targetDate - todayDate) / 86400000);
            let dayStr;
            if (dayDiff === 0) dayStr = 'today';
            else if (dayDiff === 1) dayStr = 'tomorrow';
            else if (dayDiff === 2) dayStr = 'day after tomorrow';
            else dayStr = d.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long', month: 'long', day: 'numeric' });
            const hour = parseInt(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }), 10);
            const timeStr = d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
            let period = '';
            if (hour < 12) period = ' morning';
            else if (hour < 17) period = ' afternoon';
            else period = ' evening';
            return `${dayStr}${period} at ${timeStr}`;
        } catch (e) { return match; }
    });

    // Strip markdown formatting that TTS would read literally
    text = text.replace(/\*\*(.*?)\*\*/g, '$1'); // bold
    text = text.replace(/\*(.*?)\*/g, '$1');     // italic
    text = text.replace(/#{1,6}\s*/g, '');       // headers
    text = text.replace(/[-*]\s+/g, ', ');       // bullet points
    text = text.replace(/\s{2,}/g, ' ').trim();
    return text;
}

// ── ElevenLabs TTS ─────────────────────────────────────────────────────
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'hpp4J3VqNfWAUOO0d1Us'; // Bella (Professional, Bright, Warm)

// Serve generated audio files
const TTS_AUDIO_DIR = path.join(os.tmpdir(), 'medguard-tts');
if (!fs.existsSync(TTS_AUDIO_DIR)) fs.mkdirSync(TTS_AUDIO_DIR, { recursive: true });
app.use('/tts-audio', express.static(TTS_AUDIO_DIR));

// Cleanup old TTS files every 5 minutes
setInterval(() => {
    try {
        const files = fs.readdirSync(TTS_AUDIO_DIR);
        const now = Date.now();
        for (const file of files) {
            const filePath = path.join(TTS_AUDIO_DIR, file);
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > 5 * 60 * 1000) fs.unlinkSync(filePath);
        }
    } catch (e) { /* ignore cleanup errors */ }
}, 5 * 60 * 1000);

async function generateElevenLabsAudio(text, language = 'en-US') {
    const voiceId = ELEVENLABS_VOICE_ID;
    // Use multilingual model for Tamil, flash for English (lower latency)
    const modelId = language === 'ta-IN' ? 'eleven_multilingual_v2' : 'eleven_flash_v2_5';

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.3,
            }
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`ElevenLabs API error (${response.status}): ${errText}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const filename = `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`;
    const filePath = path.join(TTS_AUDIO_DIR, filename);
    fs.writeFileSync(filePath, audioBuffer);
    return filename;
}

// Helper: build TwiML that either plays ElevenLabs audio or falls back to Polly
async function speakWithTwiml(twiml, text, baseUrl, language = 'en-US') {
    if (ELEVENLABS_API_KEY) {
        try {
            const filename = await generateElevenLabsAudio(text, language);
            const audioUrl = `${baseUrl}/tts-audio/${filename}`;
            twiml.play(audioUrl);
            console.log(`[ElevenLabs] Generated audio: ${filename}`);
            return;
        } catch (err) {
            console.error('[ElevenLabs] TTS failed, falling back to Polly:', err.message);
        }
    }
    // Fallback to Twilio's built-in Polly voice
    twiml.say({ voice: 'Polly.Joanna' }, text);
}

// Get the base URL for this server (ngrok or localhost)
function getBaseUrl(req) {
    const tunnelFile = path.join(__dirname, '.tunnel-url');
    if (fs.existsSync(tunnelFile)) {
        return fs.readFileSync(tunnelFile, 'utf8').trim();
    }
    return process.env.APP_BASE_URL || `${req.protocol}://${req.headers.host}`;
}

app.post('/api/call-patient', adminAuth, async (req, res) => {
    const { patientName, phone } = req.body;
    if (!patientName || !phone) return res.status(400).json({ error: 'Patient name and phone are required.' });

    if (!twilioClient) {
        return res.status(500).json({ error: 'Twilio is not configured on the server.' });
    }

    try {
        const baseUrl = getBaseUrl(req);
        const callUrl = `${baseUrl}/api/voice?patientName=${encodeURIComponent(patientName)}`;
        
        const call = await twilioClient.calls.create({
            url: callUrl,
            to: phone,
            from: process.env.TWILIO_PHONE_NUMBER
        });

        addLog('Admin', 'system', `Initiated outbound call to ${patientName} at ${phone}`, 'System');
        res.json({ success: true, callSid: call.sid });
    } catch (err) {
        console.error('Error initiating call:', err);
        res.status(500).json({ error: 'Failed to initiate call: ' + err.message });
    }
});

app.post('/api/voice', async (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const patientName = req.query.patientName || 'there';
    const callSid = req.body.CallSid;
    const baseUrl = getBaseUrl(req);
    
    addLog('Twilio', 'system', `Call connected for ${patientName}`, callSid);
    
    await speakWithTwiml(twiml, `Hello ${patientName}! This is Alex from MedGuard Clinic. How can I help you today?`, baseUrl);
    twiml.gather({
        input: 'speech',
        action: '/api/voice/process',
        speechTimeout: 'auto',
        language: 'en-US'
    });
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/api/voice/process', async (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const userSpeech = req.body.SpeechResult;
    const callSid = req.body.CallSid;
    const baseUrl = getBaseUrl(req);

    if (!userSpeech) {
        await speakWithTwiml(twiml, "I didn't quite catch that. Could you please repeat?", baseUrl);
        twiml.gather({
            input: 'speech',
            action: '/api/voice/process',
            speechTimeout: 'auto',
            language: 'en-US'
        });
        res.type('text/xml');
        return res.send(twiml.toString());
    }

    addLog('Twilio', 'user', userSpeech, callSid);

    try {
        // Pass channel='phone' so AI uses spoken-friendly language
        let aiResponse = await ai.processUserInput(callSid, userSpeech, 'en-US', null, 'phone');

        // Process MedGuard action tags (side effects only — tags are stripped before speech)
        const bookRegex = /\[BOOK:\s*([^\]]+)\]/i;
        const match = aiResponse.match(bookRegex);
        if (match) {
            const [time, patientName, reason, doctorNameRaw, email] = match[1].split('|').map(s => (s || '').trim());
            const doctorName = doctorNameRaw || 'Any';
            const result = await calendar.bookAppointment(patientName, time, reason, doctorName, email);
            if (result.success) {
                await sheets.logAppointment(patientName, "Phone Call", time, "Twilio Outbound", doctorName, reason, email);
            }
            aiResponse = aiResponse.replace(bookRegex, '').trim();
        }

        const cancelRegex = /\[CANCEL:\s*(.*?)\]/i;
        const cancelMatch = aiResponse.match(cancelRegex);
        if (cancelMatch) {
            const patientName = cancelMatch[1].trim();
            await calendar.cancelAppointment(patientName);
            aiResponse = aiResponse.replace(cancelRegex, '').trim();
        }

        const rescheduleRegex = /\[RESCHEDULE:\s*(.*?)\|(.*?)\|(.*?)\|(.*?)(?:\|(.*?))?\]/i;
        const rescheduleMatch = aiResponse.match(rescheduleRegex);
        if (rescheduleMatch) {
            const oldTime     = rescheduleMatch[1].trim();
            const newTime     = rescheduleMatch[2].trim();
            const patientName = rescheduleMatch[3].trim();
            const reason      = rescheduleMatch[4].trim();
            const doctorName  = rescheduleMatch[5] ? rescheduleMatch[5].trim() : 'Any';
            const result = await calendar.rescheduleAppointment(oldTime, newTime, patientName, reason, doctorName);
            if (result.success) {
                await sheets.logAppointment(patientName, "Phone Call", newTime, "Twilio Reschedule", doctorName, reason);
            }
            aiResponse = aiResponse.replace(rescheduleRegex, '').trim();
        }

        // Sanitize for TTS: convert any remaining ISO dates, strip UI tags
        aiResponse = sanitizeForSpeech(aiResponse);

        addLog('Twilio', 'ai', aiResponse, callSid);
        broadcastDashboardUpdate();

        await speakWithTwiml(twiml, aiResponse, baseUrl);
        twiml.gather({
            input: 'speech',
            action: '/api/voice/process',
            speechTimeout: 'auto',
            language: 'en-US'
        });
    } catch (err) {
        console.error('Error in voice/process:', err);
        await speakWithTwiml(twiml, "I'm sorry, I ran into a small issue. Could you say that again?", baseUrl);
        twiml.gather({
            input: 'speech',
            action: '/api/voice/process',
            speechTimeout: 'auto',
            language: 'en-US'
        });
    }

    res.type('text/xml');
    res.send(twiml.toString());
});

// ── Admin Dashboard Endpoint ───────────────────────────────────────────────
app.get('/api/appointments', adminAuth, async (req, res) => {
    try {
        const appointments = await calendar.getAllAppointments();
        res.json(appointments);
    } catch (err) {
        console.error('Error fetching appointments:', err);
        res.status(500).json({ error: 'Failed to fetch appointments' });
    }
});

// ════════════════════════════════════════════════
// ── DOCTOR PRESCRIPTION PUBLISH ENDPOINT (ADMIN)
// POST /api/doctor/prescription
// Saves a real prescription written by the doctor
// ════════════════════════════════════════════════
app.post('/api/doctor/prescription', adminAuth, async (req, res) => {
    try {
        const newPrescription = req.body;
        newPrescription.prescribedAt = new Date().toISOString();

        let prescriptions = [];
        if (fs.existsSync(PRESCRIPTIONS_FILE)) {
            prescriptions = JSON.parse(fs.readFileSync(PRESCRIPTIONS_FILE, 'utf-8'));
        }

        // Remove older prescription for this patient/date if it exists to overwrite
        prescriptions = prescriptions.filter(p => !(p.patientName.toLowerCase() === newPrescription.patientName.toLowerCase() && p.appointmentDate === newPrescription.appointmentDate));

        prescriptions.push(newPrescription);
        fs.writeFileSync(PRESCRIPTIONS_FILE, JSON.stringify(prescriptions, null, 2));

        // Log to dashboard
        addLog('Admin', 'doctor', `Published prescription for ${newPrescription.patientName}`, 'Dashboard', { type: 'prescription_published', patientName: newPrescription.patientName });

        // Optionally email the prescription to the patient
        let emailed = false;
        if (newPrescription.patientEmail) {
            emailed = await gmail.sendPrescriptionEmail(newPrescription.patientEmail, {
                patientName: newPrescription.patientName,
                doctorName: newPrescription.doctorName,
                diagnosis: newPrescription.diagnosis,
                medicines: newPrescription.medicines,
                doctorNotes: newPrescription.doctorNotes,
            }).catch(err => { console.error('Prescription email failed:', err.message || err); return false; });
        }

        res.json({ success: true, message: 'Prescription saved successfully.', emailed });
    } catch (err) {
        console.error('Error saving prescription:', err);
        res.status(500).json({ error: 'Failed to save prescription.' });
    }
});

// ════════════════════════════════════════════════
// ── PRESCRIPTION RETRIEVAL ENDPOINT (PATIENT)
// GET /api/prescription/:patientName
// Retrieves a real prescription written by the doctor.
// ════════════════════════════════════════════════
app.get('/api/prescription/:patientName', async (req, res) => {
    const rawName = req.params.patientName.trim();

    if (!rawName) {
        return res.status(400).json({ error: 'Patient name is required.' });
    }

    try {
        const patientName = rawName.toLowerCase();
        let prescriptions = [];
        if (fs.existsSync(PRESCRIPTIONS_FILE)) {
            prescriptions = JSON.parse(fs.readFileSync(PRESCRIPTIONS_FILE, 'utf-8'));
        }

        // Find the most recent prescription for this patient
        const match = prescriptions
            .filter(p => (p.patientName || '').toLowerCase().includes(patientName))
            .sort((a, b) => new Date(b.prescribedAt) - new Date(a.prescribedAt))[0];

        if (!match) {
            // Patient has an appointment but doctor hasn't written a prescription yet
            return res.status(404).json({
                error: `Your doctor has not published a prescription for "${rawName}" yet. Please check back later or contact the clinic.`
            });
        }

        console.log(`[Prescription] Retrieved real prescription for: ${match.patientName}`);
        res.json(match);

    } catch (err) {
        console.error('Error in /api/prescription:', err);
        res.status(500).json({ error: 'Failed to fetch prescription. Please try again.' });
    }
});

// ════════════════════════════════════════════════
// ── BLINKIT ORDER ENDPOINT ────────────────────
// POST /api/blinkit-order
// Simulates the MCP / Blinkit integration.
// Logs the order to the admin Live Logs dashboard.
// ════════════════════════════════════════════════
app.post('/api/blinkit-order', async (req, res) => {
    const { patientName, medicines, address, phone, doctorName, diagnosis } = req.body;

    // Validate required fields
    if (!patientName || !address || !phone) {
        return res.status(400).json({ error: 'patientName, address, and phone are required.' });
    }
    if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
        return res.status(400).json({ error: 'No medicines to order.' });
    }

    const medNames = medicines.map(m => m.name).join(', ');
    const logText  = `🛒 Blinkit Order — Patient: ${patientName} | Medicines: ${medNames} | Address: ${address} | Phone: ${phone}`;

    // Log to admin dashboard live logs
    addLog('Blinkit', 'blinkit', logText, patientName, {
        patientName,
        medicines,
        address,
        phone,
        doctorName: doctorName || '—',
        diagnosis:  diagnosis  || '—',
        orderedAt:  new Date().toISOString(),
    });

    console.log(`[Blinkit Order] ${patientName} | ${medNames} | → ${address} | 📞 ${phone}`);

    // ── Simulate MCP Blinkit API call ──
    // In production, you'd call Blinkit's real API here with auth credentials.
    // For now we simulate a ~1.5s processing delay and always succeed.
    await new Promise(resolve => setTimeout(resolve, 1500));

    res.json({
        success:   true,
        orderId:   'BLK-' + Date.now(),
        message:   `Order placed! Medicines will be delivered to ${address} within 10–15 minutes.`,
        estimatedDelivery: '10–15 minutes',
    });
});

// ── Start WhatsApp and Server ──────────────────────────────────────────────
whatsapp.start();
cronJobs.startCronJobs();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`AI Receptionist Server running on port ${PORT}`);
});

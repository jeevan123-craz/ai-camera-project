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
const cronJobs = require('./cronJobs');

// Setup Prescriptions file
const PRESCRIPTIONS_FILE = path.join(__dirname, 'prescriptions.json');
if (!fs.existsSync(PRESCRIPTIONS_FILE)) {
    fs.writeFileSync(PRESCRIPTIONS_FILE, JSON.stringify([]));
}

// WhatsApp is disabled on Render to prevent Out Of Memory crashes on the free tier.
const whatsapp = {
    isReady: false,
    qrCode: null,
    on: () => {},
    sendDirectMessage: async () => false,
    start: () => { console.log('WhatsApp disabled to save memory.'); }
};
// const whatsapp = require('./whatsapp');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.set('trust proxy', true);

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

        const bookRegex = /\[BOOK:\s*(.*?)\|(.*?)\|(.*?)(?:\|(.*?))?\]/i;
        const match = aiResponse.match(bookRegex);
        let booked = false;

        if (match) {
            const time        = match[1].trim();
            const patientName = match[2].trim();
            const reason      = match[3].trim();
            const doctorName  = match[4] ? match[4].trim() : 'Any';
            const result = await calendar.bookAppointment(patientName, time, reason, doctorName);
            if (result.success) {
                await sheets.logAppointment(patientName, "Browser", time, "Browser Chat", doctorName, reason);
                booked = true;
            }
            aiResponse = aiResponse.replace(bookRegex, '').trim();
        }

        const cancelRegex = /\[CANCEL:\s*(.*?)\]/i;
        const cancelMatch = aiResponse.match(cancelRegex);
        if (cancelMatch) {
            const patientName = cancelMatch[1].trim();
            await calendar.cancelAppointment(patientName);
            aiResponse = aiResponse.replace(cancelRegex, '').trim();
            booked = true;
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

        const codeRedRegex = /\[CODE_RED:\s*(.*?)\]/i;
        const codeRedMatch = aiResponse.match(codeRedRegex);
        if (codeRedMatch) {
            const reason = codeRedMatch[1].trim();
            aiResponse = aiResponse.replace(codeRedRegex, '').trim();
            addLog('System', 'emergency', `CODE RED INITIATED: ${reason}`, sessionId, { type: 'code_red', reason });
            console.log(`[EMERGENCY] Code Red triggered for reason: ${reason}`);
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
app.post('/api/doctor/prescription', adminAuth, (req, res) => {
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
        
        res.json({ success: true, message: 'Prescription saved successfully.' });
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

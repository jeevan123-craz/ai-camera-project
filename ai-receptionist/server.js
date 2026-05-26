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
const ai = require('./ai');
const calendar = require('./calendar');
const sheets = require('./sheets');
const whatsapp = require('./whatsapp');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Live Logs Array ──
const callLogs = [];

function addLog(source, role, text, sessionId) {
    callLogs.unshift({ source, role, text, sessionId, timestamp: new Date().toISOString() });
    if (callLogs.length > 100) callLogs.pop(); // Keep last 100 logs
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

whatsapp.on('qr_received', () => {
    broadcastDashboardUpdate();
});

whatsapp.on('ready', () => {
    broadcastDashboardUpdate();
});

whatsapp.on('booking_updated', () => {
    broadcastDashboardUpdate();
});

// ── REST API: WhatsApp Status ──
app.get('/api/whatsapp-status', (req, res) => {
    res.json({
        ready: whatsapp.isReady,
        qr: whatsapp.qrCode
    });
});

// ── Browser Call Endpoint ──────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
    const { sessionId, message } = req.body;

    if (!sessionId || !message || !message.trim()) {
        return res.status(400).json({ error: 'sessionId and message are required.' });
    }

    addLog('Browser', 'user', message.trim(), sessionId);

    try {
        let aiResponse = await ai.processUserInput(sessionId, message.trim());

        // Handle booking tag  [BOOK: YYYY-MM-DDTHH:MM:SS|PatientName|Reason]
        const bookRegex = /\[BOOK:\s*(.*?)\|(.*?)\|(.*?)\]/i;
        const match = aiResponse.match(bookRegex);
        let booked = false;

        if (match) {
            const time        = match[1].trim();
            const patientName = match[2].trim();
            const reason      = match[3].trim();
            const result = await calendar.bookAppointment(patientName, time, reason);
            if (result.success) {
                await sheets.logAppointment(patientName, time, "Browser Chat", reason);
                booked = true;
            }
            // Strip the tag from the spoken response
            aiResponse = aiResponse.replace(bookRegex, '').trim();
        }
        // Handle WhatsApp direct message tag [SEND_WHATSAPP: +Number]
        const waRegex = /\[SEND_WHATSAPP:\s*([^\]]+)\]/i;
        const waMatch = aiResponse.match(waRegex);

        if (waMatch) {
            const phoneNumber = waMatch[1].trim();
            const messageToSend = `Hello from MedGuard Clinic! Here is the information you requested:\n\n📍 *Location:* 123 Health Ave, Medical District, NY 10001\n🚨 *Emergency Hotline:* 911 or +1-800-MED-HELP\n🕒 *Hours:* Mon-Fri, 9am - 6pm\n\nThank you for choosing MedGuard!`;
            
            // Send the actual message via WhatsApp Web JS
            whatsapp.sendDirectMessage(phoneNumber, messageToSend);
            
            // Strip the tag from the spoken response
            aiResponse = aiResponse.replace(waRegex, '').trim();
            console.log(`[INFO] Sent WhatsApp clinic details to ${phoneNumber}`);
        }

        addLog('Browser', 'ai', aiResponse, sessionId);
        // We broadcast update regardless because we want the new logs to show up instantly!
        broadcastDashboardUpdate();
        res.json({ reply: aiResponse, booked });

    } catch (err) {
        console.error('Error in /chat:', err);
        res.status(500).json({ error: 'AI processing failed. Please try again.' });
    }
});

// ── Admin Dashboard Endpoint ───────────────────────────────────────────────
app.get('/api/appointments', async (req, res) => {
    try {
        const appointments = await calendar.getAllAppointments();
        res.json(appointments);
    } catch (err) {
        console.error('Error fetching appointments:', err);
        res.status(500).json({ error: 'Failed to fetch appointments' });
    }
});



// Start WhatsApp and Server
whatsapp.start();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`AI Receptionist Server running on port ${PORT}`);
});

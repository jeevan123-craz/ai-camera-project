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
const cronJobs = require('./cronJobs');

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
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.set('trust proxy', true);

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
app.post('/chat', async (req, res) => {
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

        addLog('Browser', 'ai', aiResponse, sessionId);
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

// ════════════════════════════════════════════════
// ── PRESCRIPTION ENDPOINT ─────────────────────
// GET /api/prescription/:patientName
// Looks up the patient's most recent appointment and
// returns a mocked prescription generated by the doctor.
// ════════════════════════════════════════════════
app.get('/api/prescription/:patientName', async (req, res) => {
    const rawName = req.params.patientName.trim();

    if (!rawName) {
        return res.status(400).json({ error: 'Patient name is required.' });
    }

    try {
        // Look up appointments for this patient
        const allAppointments = await calendar.getAllAppointments();
        const patientName = rawName.toLowerCase();

        // Find the most recent appointment for this patient
        const match = allAppointments
            .filter(a => (a.patientName || '').toLowerCase().includes(patientName))
            .sort((a, b) => new Date(b.time) - new Date(a.time))[0];

        if (!match) {
            return res.status(404).json({
                error: `No appointment found for "${rawName}". Please check your name matches the one used when booking.`
            });
        }

        // ── Mocked Prescription ──
        // In a real system, a doctor would fill this in after the consultation.
        // Here we generate a realistic mock based on the appointment reason.
        const prescription = generateMockedPrescription(match);
        console.log(`[Prescription] Retrieved for: ${match.patientName}`);
        res.json(prescription);

    } catch (err) {
        console.error('Error in /api/prescription:', err);
        res.status(500).json({ error: 'Failed to fetch prescription. Please try again.' });
    }
});

// ── Helper: Generate a realistic mocked prescription ──
function generateMockedPrescription(appointment) {
    const reason = (appointment.reason || '').toLowerCase();

    // Pick medicines based on appointment reason keywords
    let medicines = [];
    let diagnosis = 'General Consultation';
    let doctorNotes = 'Please complete the full course of prescribed medicines. Stay hydrated and get adequate rest. Follow up in 7 days if symptoms persist.';

    if (reason.includes('fever') || reason.includes('cold') || reason.includes('flu')) {
        diagnosis = 'Viral Fever / Upper Respiratory Tract Infection';
        medicines = [
            { name: 'Paracetamol 500mg',      dosage: '1 tab',   duration: '5 days',  instructions: 'After meals, 3 times/day' },
            { name: 'Cetirizine 10mg',         dosage: '1 tab',   duration: '3 days',  instructions: 'At bedtime' },
            { name: 'Vitamin C 500mg',         dosage: '1 tab',   duration: '7 days',  instructions: 'After breakfast' },
            { name: 'Azithromycin 500mg',      dosage: '1 tab',   duration: '3 days',  instructions: 'Once daily, after food' },
        ];
        doctorNotes = 'Drink 2–3 litres of water daily. Avoid cold beverages and spicy food. Rest for at least 2 days. Visit emergency if temperature exceeds 103°F.';
    } else if (reason.includes('headache') || reason.includes('migraine')) {
        diagnosis = 'Tension Headache / Migraine';
        medicines = [
            { name: 'Ibuprofen 400mg',         dosage: '1 tab',   duration: '3 days',  instructions: 'After meals, twice daily' },
            { name: 'Sumatriptan 50mg',        dosage: '1 tab',   duration: 'As needed', instructions: 'At onset of migraine' },
            { name: 'Magnesium Glycinate',     dosage: '400mg',   duration: '30 days', instructions: 'Before bedtime' },
        ];
        doctorNotes = 'Avoid screen time and bright lights during episodes. Keep a headache diary. Ensure regular sleep schedule. Avoid triggers like caffeine and stress.';
    } else if (reason.includes('cough') || reason.includes('throat')) {
        diagnosis = 'Acute Pharyngitis / Cough';
        medicines = [
            { name: 'Amoxicillin 500mg',       dosage: '1 cap',   duration: '5 days',  instructions: 'Three times daily, after food' },
            { name: 'Bromhexine 8mg',          dosage: '1 tab',   duration: '5 days',  instructions: 'Twice daily, after meals' },
            { name: 'Strepsils Lozenges',      dosage: '1 lozenge', duration: '5 days', instructions: 'Every 3 hours, max 6/day' },
        ];
        doctorNotes = 'Gargle with warm salt water 3 times daily. Avoid cold drinks. Steam inhalation twice daily. Avoid dusty environments.';
    } else if (reason.includes('bp') || reason.includes('blood pressure') || reason.includes('hypertension')) {
        diagnosis = 'Hypertension (High Blood Pressure)';
        medicines = [
            { name: 'Amlodipine 5mg',          dosage: '1 tab',   duration: '30 days', instructions: 'Once daily, morning' },
            { name: 'Telmisartan 40mg',        dosage: '1 tab',   duration: '30 days', instructions: 'Once daily, morning' },
            { name: 'Aspirin 75mg',            dosage: '1 tab',   duration: '30 days', instructions: 'Once daily, after breakfast' },
        ];
        doctorNotes = 'Monitor blood pressure daily and maintain a log. Reduce salt intake. Exercise 30 minutes daily. Avoid stress and smoking. Return in 1 month for review.';
    } else if (reason.includes('diabetes') || reason.includes('sugar')) {
        diagnosis = 'Type 2 Diabetes Mellitus';
        medicines = [
            { name: 'Metformin 500mg',         dosage: '1 tab',   duration: '30 days', instructions: 'Twice daily, after meals' },
            { name: 'Glimepiride 2mg',         dosage: '1 tab',   duration: '30 days', instructions: 'Before breakfast' },
            { name: 'Multivitamin Complex',    dosage: '1 tab',   duration: '30 days', instructions: 'After breakfast' },
        ];
        doctorNotes = 'Monitor fasting and post-meal blood sugar daily. Follow a low-carb diet. Exercise daily. Avoid sweets and refined sugars. Return in 1 month with sugar records.';
    } else if (reason.includes('back') || reason.includes('joint') || reason.includes('knee') || reason.includes('pain')) {
        diagnosis = 'Musculoskeletal Pain';
        medicines = [
            { name: 'Diclofenac 50mg',         dosage: '1 tab',   duration: '5 days',  instructions: 'After meals, twice daily' },
            { name: 'Thiocolchicoside 4mg',    dosage: '1 tab',   duration: '5 days',  instructions: 'Twice daily' },
            { name: 'Calcium + Vit D3',        dosage: '1 tab',   duration: '30 days', instructions: 'After dinner' },
            { name: 'Omeprazole 20mg',         dosage: '1 cap',   duration: '5 days',  instructions: 'Before breakfast (stomach protection)' },
        ];
        doctorNotes = 'Apply warm compress for 15 minutes twice daily. Avoid lifting heavy objects. Physiotherapy recommended. Avoid sitting for prolonged periods.';
    } else {
        // Default general consultation prescription
        diagnosis = 'General Health Checkup';
        medicines = [
            { name: 'Multivitamin B-Complex',  dosage: '1 tab',   duration: '30 days', instructions: 'After breakfast' },
            { name: 'Vitamin D3 60000 IU',     dosage: '1 cap',   duration: 'Weekly ×4', instructions: 'Once a week, after meal' },
            { name: 'Omega-3 Fatty Acids',     dosage: '1 cap',   duration: '30 days', instructions: 'After dinner' },
        ];
        doctorNotes = 'Maintain a balanced diet with adequate protein, fruits, and vegetables. Exercise regularly. Drink 2–3 litres of water daily. Follow up if any new symptoms arise.';
    }

    return {
        patientName:     appointment.patientName,
        appointmentDate: appointment.time,
        doctorName:      appointment.doctorName || 'Dr. Sarah Jenkins',
        diagnosis,
        medicines,
        doctorNotes,
        prescribedAt:    new Date().toISOString(),
    };
}

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

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const ai = require('./ai');
const calendar = require('./calendar');
const sheets = require('./sheets');
const gmail = require('./gmail');
const EventEmitter = require('events');

class WhatsAppBot extends EventEmitter {
    constructor() {
        super();
        this.qrCode = null;
        this.isReady = false;
        this.retryTimer = null;
        this.retryAttempt = 0;

        // ── Try to locate the user's installed Chrome/Chromium for better compatibility ──
        const possibleChromePaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            process.env.PUPPETEER_EXECUTABLE_PATH,
        ].filter(Boolean);
        const { existsSync } = require('fs');
        const systemChrome = possibleChromePaths.find(p => existsSync(p));

        this.client = new Client({
            authStrategy: new LocalAuth(),
            // ── Fix "Couldn't connect" after scanning ──────────────────────────
            // Fetches the correct WhatsApp Web version from a maintained cache
            // instead of letting the library auto-detect (which often gets it wrong).
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/niccolosottile/niccolosottile.github.io/refs/heads/main/niccolosottile/niccolosottile.json',
            },
            // whatsapp-web.js's own default User-Agent is hardcoded to "Chrome/101" (a ~4-year-old
            // version) — WhatsApp's anti-automation checks reset connections claiming to be that
            // stale, so we override it with a current, realistic desktop Chrome UA.
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            puppeteer: {
                headless: false,          // ← visible window avoids ERR_CONNECTION_RESET on Windows
                protocolTimeout: 120000,
                executablePath: systemChrome || undefined,  // prefer system Chrome over bundled Chromium
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-blink-features=AutomationControlled',
                    '--no-first-run',
                    '--no-service-autorun',
                    '--password-store=basic',
                    '--disable-web-security',
                    '--ignore-certificate-errors',
                    '--allow-running-insecure-content',
                    // ── Optional proxy: set WHATSAPP_PROXY=socks5://127.0.0.1:1080 in .env ──
                    ...(process.env.WHATSAPP_PROXY ? [`--proxy-server=${process.env.WHATSAPP_PROXY}`] : []),
                ]
            }
        });

        // ── Handle auth failure (stale session) → auto-clear and retry ──
        this.client.on('auth_failure', (msg) => {
            console.error('❌ WhatsApp auth failed:', msg);
            console.log('🗑️  Clearing stale session and retrying...');
            const authPath = require('path').join(__dirname, '.wwebjs_auth');
            try { require('fs').rmSync(authPath, { recursive: true, force: true }); } catch (_) {}
            this.scheduleRetry();
        });

        this.client.on('qr', (qr) => {
            this.qrCode = qr;
            this.isReady = false;
            console.log('\n=========================================');
            console.log('📱 SCAN THIS QR CODE WITH WHATSAPP 📱');
            console.log('=========================================');
            qrcode.generate(qr, { small: true });
            this.emit('qr_received');
        });

        this.client.on('ready', () => {
            this.qrCode = null;
            this.isReady = true;
            this.retryAttempt = 0;
            console.log('✅ WhatsApp Client is ready!');
            this.emit('ready');
        });

        this.client.on('disconnected', () => {
            this.qrCode = null;
            this.isReady = false;
            console.log('❌ WhatsApp Client disconnected!');
            this.scheduleRetry();
        });

        // Handle incoming messages
        const handleMessage = async (msg) => {
            try {
                // Ignore status broadcasts
                if (msg.isStatus) return;
                // Ignore group messages
                if (msg.from && msg.from.endsWith('@g.us')) return;
                // Ignore protocol/notification messages with empty body
                if (!msg.body || typeof msg.body !== 'string' || !msg.body.trim()) return;

                const text = msg.body.trim();

                // Prevent infinite self-loops (bot replying to its own replies)
                if (msg.fromMe && text.startsWith('💬') || text.startsWith('🤖') || text.startsWith('I\'m sorry')) return;

                console.log(`📨 Message event: from=${msg.from} fromMe=${msg.fromMe} type=${msg.type} body="${text.substring(0,50)}"`);

                let phoneNumber = (msg.from || '').split('@')[0];
                if (phoneNumber && !phoneNumber.startsWith('+')) {
                    phoneNumber = '+' + phoneNumber;
                }

                console.log(`✅ Processing WhatsApp message from ${phoneNumber}: "${text}"`);

                // Log user message
                this.emit('log', { source: 'WhatsApp', role: 'user', text: text, phone: phoneNumber });

                // Fetch patient history safely
                let patientHistory = null;
                try {
                    patientHistory = await sheets.getPatientHistory(phoneNumber);
                } catch (sheetErr) {
                    console.warn('Sheets history read skipped:', sheetErr.message || sheetErr);
                }

                // Send to Gemini AI
                let aiResponse = await ai.processUserInput(phoneNumber, text, 'en-US', patientHistory);

                // Check for booking tag [BOOK: YYYY-MM-DDTHH:MM:SS|PatientName|Reason|DoctorName|Email]
                const bookRegex = /\[BOOK:\s*([^\]]+)\]/i;
                const match = aiResponse.match(bookRegex);

                if (match) {
                    const [time, patientName, reason, doctorNameRaw, email] = match[1].split('|').map(s => (s || '').trim());
                    const doctorName = doctorNameRaw || 'Any';

                    try {
                        const result = await calendar.bookAppointment(patientName, time, reason, doctorName, email);
                        if (result.success) {
                            try { await sheets.logAppointment(patientName, phoneNumber, time, "WhatsApp", doctorName, reason, email); } catch (_) {}
                            this.emit('booking_updated');
                            if (email) {
                                const tokenNumber = gmail.tokenFromEventId(result.eventId);
                                gmail.sendAppointmentConfirmation(email, { patientName, time, doctorName, reason, tokenNumber })
                                    .catch(err => console.error('Confirmation email failed:', err.message || err));
                            }
                        }
                    } catch (calErr) {
                        console.error('Calendar booking skipped due to auth/error:', calErr.message || calErr);
                    }
                    aiResponse = aiResponse.replace(bookRegex, '').trim();
                }

                // Handle cancel tag
                const cancelRegex = /\[CANCEL:\s*(.*?)\]/i;
                const cancelMatch = aiResponse.match(cancelRegex);
                if (cancelMatch) {
                    const patientName = cancelMatch[1].trim();
                    try {
                        const cancelResult = await calendar.cancelAppointment(patientName);
                        aiResponse = aiResponse.replace(cancelRegex, '').trim();
                        if (cancelResult.success) {
                            this.emit('booking_updated');
                        }
                    } catch (_) {
                        aiResponse = aiResponse.replace(cancelRegex, '').trim();
                    }
                }

                // Handle reschedule tag
                const rescheduleRegex = /\[RESCHEDULE:\s*(.*?)\|(.*?)\|(.*?)\|(.*?)(?:\|(.*?))?\]/i;
                const rescheduleMatch = aiResponse.match(rescheduleRegex);
                if (rescheduleMatch) {
                    aiResponse = aiResponse.replace(rescheduleRegex, '').trim();
                }

                // Clean up any residual custom tags before replying
                aiResponse = aiResponse
                    .replace(/\[SEND_WHATSAPP:[^\]]*\]/gi, '')
                    .replace(/\[DOCTORS_CHART[^\]]*\]/gi, '')
                    .replace(/\[TABLE:[^\]]*\]/gi, '')
                    .trim();

                if (!aiResponse) {
                    aiResponse = "Hello! I am MedGuard's AI Receptionist. How can I assist you today?";
                }

                // Reply on WhatsApp
                await msg.reply(aiResponse);
                console.log(`💬 Replied: "${aiResponse.substring(0, 80)}"`);

                // Log AI message
                this.emit('log', { source: 'WhatsApp', role: 'ai', text: aiResponse, phone: phoneNumber });

            } catch (err) {
                console.error("WhatsApp Message Error:", err);
                try { await msg.reply("I'm sorry, I'm having trouble processing your request right now. Please try again shortly."); } catch(e) {}
            }
        };

        this.client.on('message', handleMessage);
        this.client.on('message_create', (msg) => {
            // If message was sent to self for testing
            if (msg.fromMe && msg.to === msg.from) {
                handleMessage(msg);
            }
        });
    }

    async sendDirectMessage(phoneNumber, message) {
        if (!this.isReady) return false;
        try {
            // Ensure number has country code and ends with @c.us
            let formattedNumber = phoneNumber.replace(/[^0-9+]/g, '');
            if (!formattedNumber.startsWith('+')) {
                // Default to India or US country code if none provided (basic fallback)
                // Assuming US +1 for now, or just send as-is without + 
                // whatsapp-web.js requires country code. We'll strip the + and append @c.us
            }
            
            // Format for whatsapp-web.js (e.g. 1234567890@c.us)
            const chatId = formattedNumber.replace('+', '') + '@c.us';
            await this.client.sendMessage(chatId, message);
            return true;
        } catch (err) {
            console.error('Failed to send direct WhatsApp message:', err);
            return false;
        }
    }

    start() {
        console.log('🚀 Initializing WhatsApp Web Client...');
        this.client.initialize().catch(async (err) => {
            console.error('WhatsApp initialize failed:', err.message || err);
            try { await this.client.destroy(); } catch (destroyErr) { console.error('Cleanup after failed init also failed:', destroyErr.message || destroyErr); }
            this.scheduleRetry();
        });
    }

    // The connection to web.whatsapp.com has been observed to fail intermittently
    // (network-level filtering / anti-automation resets) rather than permanently, so
    // retry with backoff instead of giving up after the first failed attempt.
    scheduleRetry() {
        if (this.retryTimer) return; // already scheduled
        this.retryAttempt++;
        const delayMs = Math.min(30000 * this.retryAttempt, 5 * 60000); // 30s, 60s, 90s... capped at 5min
        console.log(`🔄 Retrying WhatsApp connection in ${delayMs / 1000}s (attempt ${this.retryAttempt})...`);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.start();
        }, delayMs);
    }
}

module.exports = new WhatsAppBot();

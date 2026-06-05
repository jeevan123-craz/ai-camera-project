const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const ai = require('./ai');
const calendar = require('./calendar');
const sheets = require('./sheets');
const EventEmitter = require('events');

class WhatsAppBot extends EventEmitter {
    constructor() {
        super();
        this.qrCode = null;
        this.isReady = false;

        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--js-flags="--max-old-space-size=256"'
                ]
            }
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
            console.log('✅ WhatsApp Client is ready!');
            this.emit('ready');
        });

        this.client.on('disconnected', () => {
            this.qrCode = null;
            this.isReady = false;
            console.log('❌ WhatsApp Client disconnected!');
        });

        // Handle incoming messages (message = received, message_create = all including sent)
        const handleMessage = async (msg) => {
            try {
                console.log(`📨 Message event: from=${msg.from} fromMe=${msg.fromMe} type=${msg.type} body="${msg.body?.substring(0,50)}"`);

                // Ignore messages sent BY the bot itself
                if (msg.fromMe) return;
                // Ignore status broadcasts
                if (msg.isStatus) return;
                // Ignore group messages
                if (msg.from.endsWith('@g.us')) return;

                const text = msg.body?.trim();
                if (!text) return;

                let phoneNumber = msg.from.split('@')[0];
                if (!phoneNumber.startsWith('+')) {
                    phoneNumber = '+' + phoneNumber;
                }

                console.log(`✅ Processing message from ${phoneNumber}: "${text}"`);

                // Log user message
                this.emit('log', { source: 'WhatsApp', role: 'user', text: text, phone: phoneNumber });

                // Fetch patient history before processing
                const patientHistory = await sheets.getPatientHistory(phoneNumber);

                // Send to Gemini
                let aiResponse = await ai.processUserInput(phoneNumber, text, 'en-US', patientHistory);

                // Check for booking tag [BOOK: YYYY-MM-DDTHH:MM:SS|PatientName|Reason|DoctorName]
                const bookRegex = /\[BOOK:\s*(.*?)\|(.*?)\|(.*?)(?:\|(.*?))?\]/i;
                const match = aiResponse.match(bookRegex);

                if (match) {
                    const time = match[1].trim();
                    const patientName = match[2].trim();
                    const reason = match[3].trim();
                    const doctorName = match[4] ? match[4].trim() : 'Any';

                    const result = await calendar.bookAppointment(patientName, time, reason, doctorName);
                    if (result.success) {
                        await sheets.logAppointment(patientName, phoneNumber, time, "WhatsApp", doctorName, reason);
                        this.emit('booking_updated');
                    }
                    aiResponse = aiResponse.replace(bookRegex, '').trim();
                }

                // Handle cancel tag
                const cancelRegex = /\[CANCEL:\s*(.*?)\]/i;
                const cancelMatch = aiResponse.match(cancelRegex);
                if (cancelMatch) {
                    const patientName = cancelMatch[1].trim();
                    await calendar.cancelAppointment(patientName);
                    aiResponse = aiResponse.replace(cancelRegex, '').trim();
                    this.emit('booking_updated');
                }

                // Handle reschedule tag [RESCHEDULE: OldTimeISO|NewTimeISO|PatientName|Reason|DoctorName]
                const rescheduleRegex = /\[RESCHEDULE:\s*(.*?)\|(.*?)\|(.*?)\|(.*?)(?:\|(.*?))?\]/i;
                const rescheduleMatch = aiResponse.match(rescheduleRegex);
                if (rescheduleMatch) {
                    const oldTime = rescheduleMatch[1].trim();
                    const newTime = rescheduleMatch[2].trim();
                    const patientName = rescheduleMatch[3].trim();
                    const reason = rescheduleMatch[4].trim();
                    const doctorName = rescheduleMatch[5] ? rescheduleMatch[5].trim() : 'Any';
                    
                    const result = await calendar.rescheduleAppointment(oldTime, newTime, patientName, reason, doctorName);
                    if (result.success) {
                        await sheets.logAppointment(patientName, phoneNumber, newTime, "WhatsApp Reschedule", doctorName, reason);
                        this.emit('booking_updated');
                    }
                    aiResponse = aiResponse.replace(rescheduleRegex, '').trim();
                }

                // Handle WhatsApp direct message tag [SEND_WHATSAPP: +Number]
                const waRegex = /\[SEND_WHATSAPP:\s*([^\]]+)\]/i;
                const waMatch = aiResponse.match(waRegex);
                if (waMatch) {
                    // If they are on WhatsApp, we can just append the nice info to the response
                    // and strip the weird tag.
                    const infoBlock = `\n\n📍 *Location:* 123 Health Ave, Medical District, NY 10001\n🚨 *Emergency Hotline:* 911 or +1-800-MED-HELP\n🕒 *Hours:* Mon-Fri, 9am - 6pm`;
                    aiResponse = aiResponse.replace(waRegex, '').trim();
                    aiResponse += infoBlock;
                }

                // Reply on WhatsApp
                await msg.reply(aiResponse);
                console.log(`💬 Replied: "${aiResponse.substring(0, 80)}"`);

                // Log AI message
                this.emit('log', { source: 'WhatsApp', role: 'ai', text: aiResponse, phone: phoneNumber });

            } catch (err) {
                console.error("WhatsApp Message Error:", err);
                try { await msg.reply("I'm sorry, I'm having trouble processing your request right now."); } catch(e) {}
            }
        };

        this.client.on('message', handleMessage);
        this.client.on('message_create', handleMessage);
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
        this.client.initialize();
    }
}

module.exports = new WhatsAppBot();

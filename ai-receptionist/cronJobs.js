const cron = require('node-cron');
const calendar = require('./calendar');
const sheets = require('./sheets');
const whatsapp = require('./whatsapp');

function startCronJobs() {
    console.log('🕒 Initializing Background Cron Jobs...');

    // Run every hour to check for 24-hour reminders and 48-hour follow-ups
    cron.schedule('0 * * * *', async () => {
        console.log('🔄 Running hourly cron job for reminders and follow-ups...');
        
        if (!whatsapp.isReady) {
            console.log('⚠️ WhatsApp is not ready, skipping reminders.');
            return;
        }

        try {
            // Fetch upcoming events in exactly 24 hours (23 to 25 hour window to catch it)
            const upcomingEvents = await calendar.getEventsInWindow(23, 25);
            for (const event of upcomingEvents) {
                const patientName = event.summary ? event.summary.split(': ').pop() : 'Patient';
                
                // Note: To send a WhatsApp reminder, we need the phone number. 
                // A robust system would attach the phone number to the event description or search Google Sheets by name/time.
                // For demonstration, we'll assume we can't reliably get the phone unless stored.
                // If this were connected to the full sheets DB, we'd look it up:
                // const phone = await sheets.getPhoneByName(patientName);
                // await whatsapp.sendDirectMessage(phone, `Reminder: You have an appointment tomorrow at ${event.start.dateTime}.`);
                console.log(`[CRON] Would send 24h reminder to: ${patientName}`);
            }

            // Fetch past events from exactly 48 hours ago (-49 to -47 hour window)
            const pastEvents = await calendar.getEventsInWindow(-49, -47);
            for (const event of pastEvents) {
                const patientName = event.summary ? event.summary.split(': ').pop() : 'Patient';
                console.log(`[CRON] Would send 48h follow-up to: ${patientName}`);
                // await whatsapp.sendDirectMessage(phone, `Hi ${patientName}, how are you feeling after your appointment? Reply to this chat if you need to book a follow-up.`);
            }

        } catch (err) {
            console.error('Error running cron job:', err);
        }
    });
}

module.exports = { startCronJobs };

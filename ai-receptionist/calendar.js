const { google } = require('googleapis');
const { getAuthClient } = require('./googleAuth');

const auth = getAuthClient();
const calendar = google.calendar({ version: 'v3', auth });

const CALENDAR_ID = 'primary'; // Use the user's primary calendar

// bookAppointment() writes summaries as "Appointment with <Doctor>: <PatientName>"
// (or "Appointment with Doctor: <PatientName>" when no doctor is given). Extract just the name.
function extractPatientName(summary) {
    if (!summary) return 'Unknown';
    const match = summary.match(/^Appointment(?:\s+with\s+.+?)?:\s*(.+)$/i);
    return match ? match[1].trim() : summary;
}

async function getAvailableSlots() {
    // Generate some mock slots for the next 2 days starting from tomorrow at 9 AM, 11 AM, 2 PM, 4 PM
    // In a real production system, you'd query calendar.freebusy to find exact gaps.
    // To keep the demo fast and reliable, we'll return fixed slots and filter out booked ones.
    const slots = [];
    const now = new Date();
    
    for (let i = 1; i <= 2; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        
        const hours = [9, 11, 14, 16];
        for (const h of hours) {
            d.setHours(h, 0, 0, 0);
            slots.push(d.toISOString());
        }
    }

    // Get all events in this range to see what's booked
    const timeMin = new Date();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 3);

    try {
        const res = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const bookedTimes = res.data.items.map(event => {
            if (event.start.dateTime) return new Date(event.start.dateTime).getTime();
            return null;
        }).filter(t => t !== null);

        // Filter out slots that are already booked
        return slots.filter(slotStr => {
            const slotTime = new Date(slotStr).getTime();
            // Allow 1 hour gap
            return !bookedTimes.some(b => Math.abs(b - slotTime) < 3600000);
        });
    } catch (err) {
        console.error('Error fetching from Google Calendar:', err);
        return slots; // fallback to all slots
    }
}

async function getAllAppointments() {
    try {
        const timeMin = new Date();
        const timeMax = new Date();
        timeMax.setDate(timeMax.getDate() + 7); // Next 7 days

        const res = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        return res.data.items.map(event => ({
            id: event.id,
            patientName: extractPatientName(event.summary),
            time: event.start.dateTime || event.start.date,
            reason: event.description || 'Consultation',
            email: event.extendedProperties?.private?.patientEmail || null,
        }));
    } catch (err) {
        console.error('Error fetching appointments:', err);
        return [];
    }
}

async function bookAppointment(patientName, time, reason, doctorName, email) {
    try {
        const startTime = new Date(time);
        const endTime = new Date(startTime);
        endTime.setHours(endTime.getHours() + 1); // 1 hour appointment

        const event = {
            summary: `Appointment with ${doctorName || 'Doctor'}: ${patientName}`,
            description: reason || 'Consultation',
            start: {
                dateTime: startTime.toISOString(),
                timeZone: 'Asia/Kolkata', // Local timezone
            },
            end: {
                dateTime: endTime.toISOString(),
                timeZone: 'Asia/Kolkata',
            },
            // Stored privately (not shown on the visible invite) so the admin dashboard
            // and prescription-email flow can look it up later via getAllAppointments().
            extendedProperties: email ? { private: { patientEmail: email } } : undefined,
        };

        const res = await calendar.events.insert({
            calendarId: CALENDAR_ID,
            resource: event,
        });

        console.log(`✅ Booked in Google Calendar: ${res.data.htmlLink}`);
        return { success: true, appointment: event, eventId: res.data.id };
    } catch (err) {
        console.error('Error creating calendar event:', err);
        return { success: false, message: 'Google Calendar API error.' };
    }
}

async function cancelAppointment(patientName) {
    try {
        const events = await getAllAppointments();
        const eventToCancel = events.find(e => e.patientName.toLowerCase() === patientName.toLowerCase());
        if (!eventToCancel) return { success: false, message: 'Appointment not found.' };

        await calendar.events.delete({
            calendarId: CALENDAR_ID,
            eventId: eventToCancel.id,
        });
        console.log(`✅ Cancelled appointment for ${patientName}`);
        return { success: true };
    } catch (err) {
        console.error('Error cancelling appointment:', err);
        return { success: false, message: 'Google Calendar API error.' };
    }
}

async function rescheduleAppointment(oldTime, newTime, patientName, reason, doctorName) {
    const cancelRes = await cancelAppointment(patientName);
    if (!cancelRes.success) return cancelRes;
    return await bookAppointment(patientName, newTime, reason, doctorName);
}

async function getEventsInWindow(hoursFromNowStart, hoursFromNowEnd) {
    try {
        const timeMin = new Date();
        timeMin.setHours(timeMin.getHours() + hoursFromNowStart);
        const timeMax = new Date();
        timeMax.setHours(timeMax.getHours() + hoursFromNowEnd);

        const res = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        return res.data.items;
    } catch (err) {
        console.error('Error fetching window events:', err);
        return [];
    }
}

module.exports = {
    getAvailableSlots,
    getAllAppointments,
    bookAppointment,
    cancelAppointment,
    rescheduleAppointment,
    getEventsInWindow
};

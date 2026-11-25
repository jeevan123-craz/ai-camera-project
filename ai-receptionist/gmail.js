const { google } = require('googleapis');
const { getAuthClient } = require('./googleAuth');

const auth = getAuthClient();
const gmail = google.gmail({ version: 'v1', auth });

const CLINIC_FOOTER = `
    <div style="margin-top:24px; padding-top:20px; border-top:1px solid #e2e8f0; font-size:12px; color:#94a3b8; line-height:1.7;">
        📍 123 Health Ave, Medical District, NY 10001<br>
        🚨 Emergency Hotline: 911 or +1-800-MED-HELP<br>
        🕒 Hours: Mon-Fri, 9am - 6pm &nbsp;·&nbsp; Sat, 10am - 2pm
    </div>
`;

function wrapEmailShell(bannerTitle, bannerSubtitle, bodyHtml) {
    return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; background:#ffffff;">
        <div style="background: linear-gradient(135deg, #6366f1, #4338ca); border-radius: 12px 12px 0 0; padding: 32px 28px; text-align: center; color: #ffffff;">
            <div style="font-size: 32px; margin-bottom: 8px;">🏥</div>
            <div style="font-size: 20px; font-weight: 700;">MedGuard Clinic</div>
            <div style="font-size: 14px; opacity: 0.85; margin-top: 4px;">${bannerTitle}</div>
        </div>
        <div style="border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; padding: 28px; color: #1e293b;">
            ${bannerSubtitle ? `<p style="font-size:15px; margin: 0 0 20px;">${bannerSubtitle}</p>` : ''}
            ${bodyHtml}
            ${CLINIC_FOOTER}
        </div>
    </div>`;
}

function base64url(input) {
    return Buffer.from(input, 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function buildRawEmail({ to, subject, html }) {
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
    const message = [
        `To: ${to}`,
        `Subject: ${encodedSubject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        html,
    ].join('\r\n');
    return base64url(message);
}

async function sendRaw(to, subject, html) {
    try {
        await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: buildRawEmail({ to, subject, html }) },
        });
        console.log(`✅ Email sent to ${to}: "${subject}"`);
        return true;
    } catch (err) {
        console.error(`Error sending email to ${to}:`, err.message || err);
        return false;
    }
}

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Derives a short, human-friendly reference code from the (already-unique) Calendar event ID
// instead of inventing and storing new state just for a "token number".
function tokenFromEventId(eventId) {
    return 'MG-' + (eventId || '').slice(0, 8).toUpperCase();
}

async function sendAppointmentConfirmation(toEmail, { patientName, time, doctorName, reason, tokenNumber }) {
    if (!isValidEmail(toEmail)) return false;

    const d = new Date(time);
    const readableTime = isNaN(d.getTime())
        ? time
        : d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: true });

    const body = `
        <p style="margin:0 0 18px;">Hi ${patientName}, your appointment is confirmed. Please save this email for your records.</p>
        <div style="background:#f8fafc; border:1px dashed #6366f1; border-radius:10px; padding:16px; text-align:center; margin-bottom:20px;">
            <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#64748b;">Your Token Number</div>
            <div style="font-size:22px; font-weight:700; font-family: monospace; color:#4338ca; margin-top:4px;">${tokenNumber}</div>
        </div>
        <table style="width:100%; font-size:14px; border-collapse:collapse;">
            <tr><td style="padding:6px 0; color:#64748b; width:120px;">📅 Date &amp; Time</td><td style="padding:6px 0; font-weight:600;">${readableTime}</td></tr>
            <tr><td style="padding:6px 0; color:#64748b;">👨‍⚕️ Doctor</td><td style="padding:6px 0; font-weight:600;">${doctorName || 'To be assigned'}</td></tr>
            <tr><td style="padding:6px 0; color:#64748b;">📝 Reason</td><td style="padding:6px 0; font-weight:600;">${reason || 'Consultation'}</td></tr>
        </table>
    `;

    return sendRaw(toEmail, '✅ Appointment Confirmed — MedGuard Clinic', wrapEmailShell('Appointment Confirmed', '', body));
}

async function sendPrescriptionEmail(toEmail, { patientName, doctorName, diagnosis, medicines, doctorNotes }) {
    if (!isValidEmail(toEmail)) return false;

    const medRows = (medicines || []).map(m => `
        <tr>
            <td style="padding:8px; border-bottom:1px solid #e2e8f0;">${m.name || '—'}</td>
            <td style="padding:8px; border-bottom:1px solid #e2e8f0;">${m.dosage || '—'}</td>
            <td style="padding:8px; border-bottom:1px solid #e2e8f0;">${m.duration || '—'}</td>
            <td style="padding:8px; border-bottom:1px solid #e2e8f0;">${m.instructions || '—'}</td>
        </tr>
    `).join('');

    const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const prescriptionUrl = `${baseUrl}/prescription.html?patient=${encodeURIComponent(patientName)}`;

    const body = `
        <p style="margin:0 0 18px;">Hi ${patientName}, ${doctorName || 'your doctor'} has published your prescription.</p>
        <p style="margin:0 0 6px; font-size:13px; color:#64748b;">DIAGNOSIS</p>
        <p style="margin:0 0 20px; font-weight:600;">${diagnosis || '—'}</p>
        <table style="width:100%; border-collapse:collapse; font-size:13px; margin-bottom:20px;">
            <thead>
                <tr style="background:#f8fafc; text-align:left;">
                    <th style="padding:8px;">Medicine</th>
                    <th style="padding:8px;">Dosage</th>
                    <th style="padding:8px;">Duration</th>
                    <th style="padding:8px;">Instructions</th>
                </tr>
            </thead>
            <tbody>${medRows || '<tr><td colspan="4" style="padding:8px; color:#94a3b8;">No medicines listed.</td></tr>'}</tbody>
        </table>
        <div style="text-align:center; margin-bottom:20px;">
            <a href="${prescriptionUrl}" style="display:inline-block; background:linear-gradient(135deg,#ec4899,#db2777); color:#ffffff; text-decoration:none; font-weight:700; font-size:14px; padding:12px 28px; border-radius:10px;">📋 View Digital Prescription</a>
        </div>
        <p style="margin:0 0 6px; font-size:13px; color:#64748b;">DOCTOR'S NOTES</p>
        <p style="margin:0; background:#f8fafc; border-left:3px solid #ec4899; padding:10px 14px; border-radius:6px;">${doctorNotes || '—'}</p>
        <p style="margin-top:20px; font-size:11px; color:#94a3b8;">⚠️ This is a digital copy for your convenience. Always consult your healthcare provider directly before taking any medications.</p>
    `;

    return sendRaw(toEmail, '📋 Your Prescription — MedGuard Clinic', wrapEmailShell('Prescription Ready', '', body));
}

async function sendLocationEmail(toEmail, patientName = 'Valued Patient') {
    if (!isValidEmail(toEmail)) return false;
    const body = `
        <p style="margin:0 0 16px;">Hello ${patientName},</p>
        <p style="margin:0 0 16px;">Here are the location and visiting details you requested for <strong>MedGuard Clinic</strong>:</p>
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px; margin-bottom:20px;">
            <p style="margin:0 0 8px;">📍 <strong>Address:</strong> 123 Health Ave, Medical District, NY 10001</p>
            <p style="margin:0 0 8px;">🕒 <strong>Clinic Hours:</strong> Monday – Friday, 9:00 AM – 6:00 PM | Saturday, 10:00 AM – 2:00 PM</p>
            <p style="margin:0 0 8px;">📞 <strong>Emergency Hotline:</strong> 911 or +1-800-MED-HELP</p>
            <p style="margin:0;">🚗 <strong>Parking:</strong> Free patient parking available in the clinic lot.</p>
        </div>
        <p style="margin:0 0 16px;">If you have an appointment, please arrive 10 minutes before your scheduled slot. We look forward to seeing you!</p>
    `;
    return sendRaw(toEmail, '📍 MedGuard Clinic Location & Visiting Information', wrapEmailShell('Clinic Location & Directions', '', body));
}

module.exports = { sendAppointmentConfirmation, sendPrescriptionEmail, sendLocationEmail, tokenFromEventId, isValidEmail };

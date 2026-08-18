const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { getAuthClient } = require('./googleAuth');

const ENV_PATH = path.join(__dirname, '.env');
let spreadsheetId = process.env.SPREADSHEET_ID;

const auth = getAuthClient();
const sheets = google.sheets({ version: 'v4', auth });

const HEADER_ROW = ['Timestamp', 'Patient Name', 'Phone Number', 'Appointment Time', 'Mode', 'Doctor Name', 'Reason/Symptoms', 'Patient Email'];

async function initSheet() {
    if (spreadsheetId) {
        console.log(`Using existing Google Sheet ID: ${spreadsheetId}`);
        await ensureEmailColumn();
        return;
    }

    try {
        console.log('Creating a new Google Sheet for appointments...');
        const response = await sheets.spreadsheets.create({
            resource: {
                properties: {
                    title: 'MedGuard AI Appointments'
                },
                sheets: [
                    {
                        properties: {
                            title: 'Appointments',
                            gridProperties: {
                                frozenRowCount: 1
                            }
                        }
                    }
                ]
            }
        });

        spreadsheetId = response.data.spreadsheetId;
        console.log(`✅ Created new Google Sheet! ID: ${spreadsheetId}`);
        console.log(`View it at: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);

        // Add header row
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Appointments!A1:H1',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [HEADER_ROW] }
        });

        // Save to .env so we don't create it again
        fs.appendFileSync(ENV_PATH, `\nSPREADSHEET_ID=${spreadsheetId}\n`);
    } catch (err) {
        console.error('Error creating Google Sheet:', err);
    }
}

// One-time (but safe to re-run every startup) migration: older sheets predate the
// "Patient Email" column, so make sure column H's header is present.
async function ensureEmailColumn() {
    try {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Appointments!A1:H1',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [HEADER_ROW] }
        });
    } catch (err) {
        console.error('Error ensuring Patient Email column exists:', err.message || err);
    }
}

async function logAppointment(patientName, phoneNumber, time, mode, doctorName, reason, email) {
    if (!spreadsheetId) {
        console.error('Spreadsheet not initialized!');
        return false;
    }

    try {
        const timestamp = new Date().toISOString();
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Appointments!A:H',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [[timestamp, patientName, phoneNumber || 'N/A', time, mode, doctorName || 'Any', reason, email || 'N/A']]
            }
        });
        console.log(`✅ Logged appointment to Google Sheets for ${patientName}`);
        return true;
    } catch (err) {
        console.error('Error logging to Google Sheets:', err);
        return false;
    }
}

async function getPatientHistory(phoneNumber) {
    if (!spreadsheetId || !phoneNumber) return null;
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Appointments!A:G',
        });
        const rows = res.data.values;
        if (!rows || rows.length === 0) return null;
        
        // Find the most recent appointment matching the phone number (Column C / index 2)
        for (let i = rows.length - 1; i >= 1; i--) {
            const row = rows[i];
            if (row[2] === phoneNumber) {
                return {
                    lastVisitDate: row[3],
                    reason: row[6],
                    doctor: row[5]
                };
            }
        }
        return null;
    } catch (err) {
        console.error('Error fetching patient history:', err);
        return null;
    }
}

// Full booking log as objects — powers the admin analytics dashboard.
async function getAllAppointmentRows() {
    if (!spreadsheetId) return [];
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Appointments!A:H',
        });
        const rows = res.data.values;
        if (!rows || rows.length < 2) return [];
        return rows.slice(1).map(r => ({
            timestamp: r[0] || '',
            patient:   r[1] || '',
            phone:     r[2] || '',
            apptTime:  r[3] || '',
            mode:      r[4] || '',
            doctor:    r[5] || '',
            reason:    r[6] || '',
            email:     r[7] || '',
        }));
    } catch (err) {
        console.error('Error fetching all appointment rows:', err.message || err);
        return [];
    }
}

// Auto-initialize on startup
initSheet();

module.exports = { logAppointment, getPatientHistory, getAllAppointmentRows };

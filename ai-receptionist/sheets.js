const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { getAuthClient } = require('./googleAuth');

const ENV_PATH = path.join(__dirname, '.env');
let spreadsheetId = process.env.SPREADSHEET_ID;

const auth = getAuthClient();
const sheets = google.sheets({ version: 'v4', auth });

async function initSheet() {
    if (spreadsheetId) {
        console.log(`Using existing Google Sheet ID: ${spreadsheetId}`);
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
            range: 'Appointments!A1:E1',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [['Timestamp', 'Patient Name', 'Appointment Time', 'Mode', 'Reason/Symptoms']]
            }
        });

        // Save to .env so we don't create it again
        fs.appendFileSync(ENV_PATH, `\nSPREADSHEET_ID=${spreadsheetId}\n`);
    } catch (err) {
        console.error('Error creating Google Sheet:', err);
    }
}

async function logAppointment(patientName, time, mode, reason) {
    if (!spreadsheetId) {
        console.error('Spreadsheet not initialized!');
        return false;
    }

    try {
        const timestamp = new Date().toISOString();
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Appointments!A:E',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [[timestamp, patientName, time, mode, reason]]
            }
        });
        console.log(`✅ Logged appointment to Google Sheets for ${patientName}`);
        return true;
    } catch (err) {
        console.error('Error logging to Google Sheets:', err);
        return false;
    }
}

// Auto-initialize on startup
initSheet();

module.exports = { logAppointment };

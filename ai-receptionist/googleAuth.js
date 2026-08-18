const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

// Scopes for Calendar, Sheets, and sending email (appointment/prescription notifications).
// Must match auth.js — a token minted with fewer scopes breaks gmail/sheets silently.
const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/gmail.send'
];

// Singleton: every module (calendar.js / sheets.js / gmail.js) shares ONE OAuth2
// client instance, so re-authenticating from the admin page can hot-swap the
// credentials on the live server — no restart needed. (Previously each module
// got its own client, which is why a token refresh required a full restart.)
let sharedClient = null;

function getAuthClient() {
    if (sharedClient) return sharedClient;

    const content = fs.readFileSync(CREDENTIALS_PATH); // no credentials.json = unrecoverable, let it throw
    const credentials = JSON.parse(content);
    const { client_secret, client_id, redirect_uris } = credentials.web;
    sharedClient = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    try {
        sharedClient.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH)));
    } catch (err) {
        // Missing/corrupt token is recoverable now (admin page re-auth) — boot anyway.
        console.warn('⚠️  No usable token.json — Google APIs will fail until re-authenticated from the admin page.');
    }
    return sharedClient;
}

// Persist freshly-exchanged tokens and hot-swap them onto the shared client.
function saveToken(tokens) {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    getAuthClient().setCredentials(tokens);
    console.log('✅ Google token saved & hot-reloaded (no restart needed).');
}

module.exports = { getAuthClient, saveToken, SCOPES, TOKEN_PATH };

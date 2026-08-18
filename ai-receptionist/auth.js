const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const { google } = require('googleapis');

// Scopes for Calendar, Sheets, and sending email (appointment/prescription notifications)
const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/gmail.send'
];

const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

async function authenticate() {
    let credentials;
    try {
        const content = fs.readFileSync(CREDENTIALS_PATH);
        credentials = JSON.parse(content);
    } catch (err) {
        console.error('Error loading client secret file:', err);
        console.log('Please ensure credentials.json exists in this folder.');
        process.exit(1);
    }

    const { client_secret, client_id, redirect_uris } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Check if we already have a token
    if (fs.existsSync(TOKEN_PATH)) {
        console.log('token.json already exists! You are already authenticated.');
        process.exit(0);
    }

    // Generate Auth URL
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });

    console.log('\n======================================================');
    console.log('Authorize this app by visiting this url:');
    console.log(authUrl);
    console.log('======================================================\n');
    console.log('Waiting for you to log in in your browser...');

    // Spin up a temporary server to catch the callback
    const server = http.createServer(async (req, res) => {
        if (req.url.startsWith('/oauth2callback')) {
            const q = url.parse(req.url, true).query;
            if (q.error) {
                console.error('Error returned from Google:', q.error);
                res.end('Error authenticating. Check console.');
                return;
            }

            if (q.code) {
                try {
                    const { tokens } = await oAuth2Client.getToken(q.code);
                    oAuth2Client.setCredentials(tokens);
                    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
                    console.log('\n✅ Token stored to', TOKEN_PATH);
                    res.end('<h1>Authentication successful!</h1><p>You can close this window and return to your terminal.</p>');
                    
                    // Shut down server
                    setTimeout(() => {
                        console.log('Authentication complete. You can now start the main server.');
                        process.exit(0);
                    }, 1000);
                } catch (err) {
                    console.error('Error retrieving access token', err);
                    res.end('Error getting token. Check console.');
                }
            }
        }
    }).listen(3000, () => {
        // Listening on 3000 to catch redirect
    });
}

authenticate();

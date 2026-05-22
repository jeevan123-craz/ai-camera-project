const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Path to configuration file
const CONFIG_PATH = path.join(__dirname, 'config.json');

// Memory state
let qrCodeDataURL = null;
let clientStatus = 'initializing'; // initializing, qr_ready, connecting, connected, disconnected
let clientName = null;
let clientNumber = null;
let sseClients = [];
let sentAlertsTracker = {}; // key: "wellId-YYYY-MM-DD" -> true

// Read config from disk
function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      const initialConfig = { wells: [] };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(initialConfig, null, 2));
      return initialConfig;
    }
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading config file:', err);
    return { wells: [] };
  }
}

// Write config to disk
function writeConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    console.error('Error writing config file:', err);
    return false;
  }
}

// Calculate the schedule status of a well for a specific date string (YYYY-MM-DD)
function calculateWellStatus(well, targetDateStr) {
  try {
    const startDate = new Date(well.cycleStartDate + 'T00:00:00');
    const targetDate = new Date(targetDateStr + 'T00:00:00');

    // Calculate absolute day difference by removing time details
    const diffTime = targetDate - startDate;
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (isNaN(diffDays)) {
      return { status: 'UNKNOWN', dayIndex: 0, totalDays: 0 };
    }

    const onDays = parseInt(well.onDays) || 1;
    const offDays = parseInt(well.offDays) || 1;
    const cycleDays = onDays + offDays;

    // Handle negative days correctly using mathematical modulo
    let rawMod = diffDays % cycleDays;
    if (rawMod < 0) {
      rawMod += cycleDays;
    }

    if (rawMod < onDays) {
      return {
        status: 'ON',
        dayIndex: rawMod + 1,
        totalDays: onDays
      };
    } else {
      return {
        status: 'OFF',
        dayIndex: (rawMod - onDays) + 1,
        totalDays: offDays
      };
    }
  } catch (error) {
    console.error('Error calculating well status:', error);
    return { status: 'UNKNOWN', dayIndex: 0, totalDays: 0 };
  }
}

// Format message template by replacing placeholders
function formatMessage(template, well, statusInfo) {
  if (!template) return '';
  
  return template
    .replace(/{well_name}/g, well.name || 'Well')
    .replace(/{status}/g, statusInfo.status)
    .replace(/{day_index}/g, statusInfo.dayIndex)
    .replace(/{total_days}/g, statusInfo.totalDays)
    .replace(/{share_percent}/g, well.sharePercent || 'N/A');
}

// Send WhatsApp message
async function sendWhatsAppMessage(to, message) {
  if (clientStatus !== 'connected') {
    throw new Error('WhatsApp client is not connected');
  }
  
  // Format the number to WhatsApp format (digits only)
  let cleaned = to.replace(/\D/g, '');
  if (!cleaned) {
    throw new Error('Invalid phone number format');
  }
  
  // If it's a 10-digit number, automatically prepend the country code of the logged-in bot
  if (cleaned.length === 10 && clientNumber) {
    if (clientNumber.length > 10) {
      const cc = clientNumber.substring(0, clientNumber.length - 10);
      cleaned = cc + cleaned;
      console.log(`Auto-prepended country code ${cc} to make number ${cleaned}`);
    } else {
      // Default to 91 (India) if bot number is somehow short
      cleaned = '91' + cleaned;
      console.log(`Defaulted country code 91 to make number ${cleaned}`);
    }
  }
  
  const recipientId = `${cleaned}@c.us`;
  console.log(`Sending message to ${recipientId}: \n${message}`);
  
  // Check if recipient is a registered WhatsApp user
  try {
    const isRegistered = await client.isRegisteredUser(recipientId);
    if (!isRegistered) {
      throw new Error(`The phone number ${cleaned} is not registered on WhatsApp. Please verify the country code prefix (e.g. 91 for India).`);
    }
  } catch (err) {
    // If checking registration fails but has a specific error message, bubble it
    if (err.message.includes('not registered')) {
      throw err;
    }
    console.warn('WhatsApp registration check warning:', err.message);
  }
  
  try {
    const response = await client.sendMessage(recipientId, message);
    return response;
  } catch (err) {
    console.error('Puppeteer sendMessage failed:', err.message);
    if (err.message.includes('No LID')) {
      throw new Error(`WhatsApp could not find a user profile for +${cleaned}. Make sure the number is correct and includes the country code.`);
    }
    throw err;
  }
}

// Stream updates to all connected browser SSE clients
function broadcastSSE(data) {
  sseClients.forEach((res) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// Initialize WhatsApp Web client
console.log('Initializing WhatsApp Client (Puppeteer might take a few seconds)...');
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(__dirname, '.wwebjs_auth')
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  }
});

client.on('qr', async (qr) => {
  console.log('WhatsApp QR Code received. Generate image...');
  clientStatus = 'qr_ready';
  try {
    qrCodeDataURL = await qrcode.toDataURL(qr);
    broadcastSSE({ status: clientStatus, qr: qrCodeDataURL });
  } catch (err) {
    console.error('Error generating QR code image:', err);
  }
});

client.on('loading_screen', (percent, message) => {
  console.log(`WhatsApp Loading: ${percent}% - ${message}`);
  clientStatus = 'connecting';
  qrCodeDataURL = null;
  broadcastSSE({ status: clientStatus, loadingPercent: percent });
});

client.on('authenticated', () => {
  console.log('WhatsApp Authenticated successfully.');
  clientStatus = 'connecting';
  qrCodeDataURL = null;
  broadcastSSE({ status: clientStatus });
});

client.on('auth_failure', (msg) => {
  console.error('WhatsApp Authentication failure:', msg);
  clientStatus = 'disconnected';
  qrCodeDataURL = null;
  broadcastSSE({ status: clientStatus, error: msg });
});

client.on('ready', async () => {
  console.log('WhatsApp Client is Ready!');
  clientStatus = 'connected';
  qrCodeDataURL = null;
  
  try {
    const info = client.info;
    clientName = info.pushname || 'User';
    clientNumber = info.wid.user;
  } catch (e) {
    clientName = 'WhatsApp Bot';
    clientNumber = '';
  }

  broadcastSSE({ 
    status: clientStatus, 
    clientName, 
    clientNumber 
  });

  // On successful setup/initial configuration, send welcome notification to all configured wells
  const config = readConfig();
  for (const well of config.wells) {
    if (well.phoneNumber && well.notificationsEnabled) {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        const statusInfo = calculateWellStatus(well, todayStr);
        const welcomeMsg = `✅ *Well Motor Scheduler Activated!*\n\n🤖 Your WhatsApp Bot has been successfully configured and connected for *${well.name}*.\n\n📊 *Today's Status:* ${statusInfo.status}\n🕒 *Alert Time:* Daily at ${well.notificationTime}\n\nYou will receive daily updates here. Thank you!`;
        
        await sendWhatsAppMessage(well.phoneNumber, welcomeMsg);
        console.log(`Welcome message sent successfully to ${well.phoneNumber}`);
      } catch (err) {
        console.error(`Failed to send initial setup message to ${well.phoneNumber}:`, err.message);
      }
    }
  }
});

client.on('disconnected', (reason) => {
  console.log('WhatsApp was disconnected:', reason);
  clientStatus = 'disconnected';
  qrCodeDataURL = null;
  clientName = null;
  clientNumber = null;
  broadcastSSE({ status: clientStatus, reason });
  
  // Reinitialize after disconnect
  console.log('Re-initializing WhatsApp client...');
  client.initialize().catch(err => console.error('Initialization error during restart:', err));
});

// Launch client
client.initialize().catch(err => console.error('Failed to initialize WhatsApp Web Client:', err));

// ==========================================
// EXPRESS ROUTING & API (WITH AUTH)
// ==========================================

const SECURE_TOKEN = "hydroflow-secure-session-token-3743";

// 1. Unprotected Login Endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const config = readConfig();
  
  const auth = config.auth || { username: 'admin', password: '123' };
  
  if (username === auth.username && password === auth.password) {
    res.json({ token: SECURE_TOKEN, username: auth.username });
  } else {
    res.status(400).json({ error: 'Invalid username or password' });
  }
});

// 2. SSE endpoint for live QR Code and Status streaming (Uses query param auth)
app.get('/api/whatsapp-qr', (req, res) => {
  const token = req.query.token;
  if (!token || token !== SECURE_TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // Send current status immediately
  res.write(`data: ${JSON.stringify({ 
    status: clientStatus, 
    qr: qrCodeDataURL, 
    clientName, 
    clientNumber 
  })}\n\n`);
  
  sseClients.push(res);
  
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

// 3. Cascading Authorization Middleware for remaining APIs
app.use('/api', (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${SECURE_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized. Please login.' });
  }
  next();
});

// Get current state
app.get('/api/status', (req, res) => {
  res.json({
    status: clientStatus,
    clientName,
    clientNumber,
    hasQR: !!qrCodeDataURL
  });
});

// Get all wells
app.get('/api/wells', (req, res) => {
  const config = readConfig();
  res.json(config.wells || []);
});

// Get schedule status for a specific well on a specific date
app.get('/api/wells/:id/status', (req, res) => {
  const config = readConfig();
  const well = config.wells.find(w => w.id === req.params.id);
  if (!well) {
    return res.status(404).json({ error: 'Well not found' });
  }
  
  const dateStr = req.query.date || new Date().toISOString().split('T')[0];
  const statusInfo = calculateWellStatus(well, dateStr);
  res.json({
    date: dateStr,
    status: statusInfo.status,
    dayIndex: statusInfo.dayIndex,
    totalDays: statusInfo.totalDays,
    wellName: well.name
  });
});

// Create or update a well
app.post('/api/wells', (req, res) => {
  const config = readConfig();
  const input = req.body;
  
  if (!input.name || !input.onDays || !input.offDays || !input.cycleStartDate) {
    return res.status(400).json({ error: 'Missing required configuration fields' });
  }

  // Calculate share percent
  const onDays = parseFloat(input.onDays);
  const offDays = parseFloat(input.offDays);
  const calculatedShare = ((onDays / (onDays + offDays)) * 100).toFixed(1);

  let well;
  if (input.id) {
    // Update existing
    const idx = config.wells.findIndex(w => w.id === input.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Well not found' });
    }
    well = {
      ...config.wells[idx],
      name: input.name,
      onDays: onDays,
      offDays: offDays,
      sharePercent: parseFloat(calculatedShare),
      cycleStartDate: input.cycleStartDate,
      phoneNumber: input.phoneNumber || '',
      notificationTime: input.notificationTime || '08:00',
      notificationsEnabled: input.notificationsEnabled !== false,
      messageTemplateOn: input.messageTemplateOn || '🔔 *Well Motor Notification*:\n\n💦 *{well_name}* is ON (Day {day_index} of {total_days})',
      messageTemplateOff: input.messageTemplateOff || '🔕 *Well Motor Notification*:\n\n💤 *{well_name}* is OFF (Rest Day)'
    };
    config.wells[idx] = well;
  } else {
    // Create new
    well = {
      id: 'well-' + Date.now(),
      name: input.name,
      onDays: onDays,
      offDays: offDays,
      sharePercent: parseFloat(calculatedShare),
      cycleStartDate: input.cycleStartDate,
      phoneNumber: input.phoneNumber || '',
      notificationTime: input.notificationTime || '08:00',
      notificationsEnabled: input.notificationsEnabled !== false,
      messageTemplateOn: input.messageTemplateOn || '🔔 *Well Motor Notification*:\n\n💦 *{well_name}* is ON (Day {day_index} of {total_days})',
      messageTemplateOff: input.messageTemplateOff || '🔕 *Well Motor Notification*:\n\n💤 *{well_name}* is OFF (Rest Day)'
    };
    config.wells.push(well);
  }

  if (writeConfig(config)) {
    // If the client is connected and a phone number is entered, trigger a config confirmation alert!
    if (clientStatus === 'connected' && well.phoneNumber && well.notificationsEnabled) {
      const todayStr = new Date().toISOString().split('T')[0];
      const statusInfo = calculateWellStatus(well, todayStr);
      const updateMsg = `⚙️ *Well Configured!* \n\nYour well *"${well.name}"* is now setup.\n📈 *Cycle*: ${well.onDays} Days ON / ${well.offDays} Days OFF\n🔋 *Share*: ${well.sharePercent}%\n🕒 *Notification Time*: Daily at ${well.notificationTime}\n\n📊 *Current Status Today:* ${statusInfo.status} (Day ${statusInfo.dayIndex} of ${statusInfo.totalDays === 0 ? 'N/A' : statusInfo.totalDays})`;
      
      sendWhatsAppMessage(well.phoneNumber, updateMsg)
        .then(() => console.log(`Config update alert sent successfully to ${well.phoneNumber}`))
        .catch(err => console.error('Failed to send configuration alert:', err.message));
    }
    
    res.json(well);
  } else {
    res.status(500).json({ error: 'Failed to write config file' });
  }
});

// Delete a well
app.delete('/api/wells/:id', (req, res) => {
  const config = readConfig();
  const filtered = config.wells.filter(w => w.id !== req.params.id);
  
  if (filtered.length === config.wells.length) {
    return res.status(404).json({ error: 'Well not found' });
  }
  
  config.wells = filtered;
  if (writeConfig(config)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to write config file' });
  }
});

// Manually trigger a test message
app.post('/api/wells/:id/test-message', async (req, res) => {
  if (clientStatus !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp client is not authenticated yet. Please scan the QR code first.' });
  }

  const config = readConfig();
  const well = config.wells.find(w => w.id === req.params.id);
  if (!well) {
    return res.status(404).json({ error: 'Well not found' });
  }

  if (!well.phoneNumber) {
    return res.status(400).json({ error: 'No phone number configured for this well.' });
  }

  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const statusInfo = calculateWellStatus(well, todayStr);
    
    // Choose appropriate template
    const template = statusInfo.status === 'ON' ? well.messageTemplateOn : well.messageTemplateOff;
    const message = formatMessage(template, well, statusInfo);
    
    const formattedMessage = `🧪 *[TEST MESSAGE]* \n\n${message}`;
    
    await sendWhatsAppMessage(well.phoneNumber, formattedMessage);
    res.json({ success: true, message: 'Test message sent successfully!' });
  } catch (error) {
    console.error('Failed to send test message:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual disconnect/logout
app.post('/api/whatsapp/disconnect', async (req, res) => {
  try {
    if (clientStatus === 'connected') {
      await client.logout();
      res.json({ success: true, message: 'Logged out successfully.' });
    } else {
      res.status(400).json({ error: 'WhatsApp is not connected.' });
    }
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({ error: error.message });
  }
});


// ==========================================
// DAILY SCHEDULER (CRON)
// ==========================================

// Runs every minute to check if any well needs an alert sent
cron.schedule('* * * * *', async () => {
  if (clientStatus !== 'connected') {
    return; // Cannot send notifications if WhatsApp is offline
  }

  const now = new Date();
  const currentHour = String(now.getHours()).padStart(2, '0');
  const currentMin = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${currentHour}:${currentMin}`;
  
  const todayStr = now.toISOString().split('T')[0]; // Format: YYYY-MM-DD

  const config = readConfig();
  for (const well of config.wells) {
    if (!well.phoneNumber || !well.notificationsEnabled) {
      continue;
    }

    // Check if the scheduled time matches the current time
    if (well.notificationTime === currentTime) {
      const alertKey = `${well.id}-${todayStr}`;
      
      // Ensure we only send one alert per day (protect against firing multiple times within the same minute)
      if (sentAlertsTracker[alertKey]) {
        continue; 
      }

      try {
        const statusInfo = calculateWellStatus(well, todayStr);
        const template = statusInfo.status === 'ON' ? well.messageTemplateOn : well.messageTemplateOff;
        const message = formatMessage(template, well, statusInfo);
        
        await sendWhatsAppMessage(well.phoneNumber, message);
        console.log(`Cron: Daily notification sent to ${well.phoneNumber} for ${well.name}`);
        
        sentAlertsTracker[alertKey] = true;
      } catch (err) {
        console.error(`Cron: Failed to send daily notification for ${well.name}:`, err.message);
      }
    }
  }

  // Housekeeping: Clear old keys in tracker occasionally (once a day)
  if (currentHour === '00' && currentMin === '00') {
    sentAlertsTracker = {};
  }
});

// Start listening
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 Well Motor Scheduler listening on port ${PORT}`);
  console.log(`🔗 Dashboard: http://localhost:${PORT}`);
  console.log(`=================================================`);
});

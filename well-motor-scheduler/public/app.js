// Global State
let wells = [];
let activeWell = null;
let currentMonth = new Date(); // Month displayed on the calendar
let whatsappConnected = false;
let sessionToken = null;
const TOKEN_KEY = 'hydroflow-secure-session-token-3743';

// DOM Elements
const wellsListEl = document.getElementById('wells-list');
const addWellBtn = document.getElementById('add-well-btn');
const activeWellTitleEl = document.getElementById('active-well-title');
const activeWellBadgeEl = document.getElementById('active-well-badge');
const liveTimeEl = document.getElementById('live-time');

// Motor Widget Elements
const statusPillEl = document.getElementById('status-pill');
const motorGlowRingEl = document.getElementById('motor-glow-ring');
const motorPumpBtn = document.getElementById('motor-pump-btn');
const motorStatusTextEl = document.getElementById('motor-status-text');
const motorSubstatusTextEl = document.getElementById('motor-substatus-text');

// Stats Elements
const statSharePercentEl = document.getElementById('stat-share-percent');
const statRatioEl = document.getElementById('stat-ratio');
const statAlertsStatusEl = document.getElementById('stat-alerts-status');
const statAlertsTimeEl = document.getElementById('stat-alerts-time');

// Calendar Elements
const prevMonthBtn = document.getElementById('prev-month-btn');
const nextMonthBtn = document.getElementById('next-month-btn');
const calendarMonthYearEl = document.getElementById('calendar-month-year');
const calendarDaysGridEl = document.getElementById('calendar-days-grid');

// Settings Form Elements
const wellSettingsForm = document.getElementById('well-settings-form');
const wellIdInput = document.getElementById('well-id');
const wellNameInput = document.getElementById('well-name');
const wellOnDaysInput = document.getElementById('well-on-days');
const wellOffDaysInput = document.getElementById('well-off-days');
const wellStartDateInput = document.getElementById('well-start-date');
const wellNotifyTimeInput = document.getElementById('well-notify-time');
const wellPhoneInput = document.getElementById('well-phone');
const wellAlertsEnabledInput = document.getElementById('well-alerts-enabled');
const wellMsgOnInput = document.getElementById('well-msg-on');
const wellMsgOffInput = document.getElementById('well-msg-off');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const sendTestBtn = document.getElementById('send-test-btn');

// WhatsApp Status Elements
const waStatusDot = document.getElementById('wa-status-dot');
const waStateQR = document.getElementById('wa-state-qr');
const waQRImg = document.getElementById('wa-qr-img');
const waStateConnecting = document.getElementById('wa-state-connecting');
const connectingText = document.getElementById('connecting-text');
const waStateConnected = document.getElementById('wa-state-connected');
const waUserName = document.getElementById('wa-user-name');
const waUserNumber = document.getElementById('wa-user-number');
const waStateDisconnected = document.getElementById('wa-state-disconnected');
const waDisconnectBtn = document.getElementById('wa-disconnect-btn');

// Login & Security Elements
const loginOverlayEl = document.getElementById('login-overlay');
const loginFormEl = document.getElementById('login-form');
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const loginErrorEl = document.getElementById('login-error');
const loginErrorTextEl = document.getElementById('login-error-text');
const loginBtnEl = document.getElementById('login-btn');
const appWrapperEl = document.getElementById('app-wrapper');
const logoutBtnEl = document.getElementById('logout-btn');

// ==========================================================================
// SECURITY & AUTHENTICATION WRAPPERS
// ==========================================================================
async function apiFetch(url, options = {}) {
  options.headers = options.headers || {};
  if (sessionToken) {
    options.headers['Authorization'] = `Bearer ${sessionToken}`;
  }
  
  const res = await fetch(url, options);
  
  if (res.status === 401) {
    logout();
    throw new Error('Unauthorized session. Automatically locked.');
  }
  
  return res;
}

function logout() {
  sessionToken = null;
  localStorage.removeItem(TOKEN_KEY);
  
  // Shut down SSE events
  if (window.whatsappEventSource) {
    window.whatsappEventSource.close();
    window.whatsappEventSource = null;
  }
  
  // Clear lists & states
  activeWell = null;
  wells = [];
  
  // Adjust interface visibility
  loginOverlayEl.classList.remove('hidden');
  loginOverlayEl.classList.remove('fade-out');
  appWrapperEl.classList.add('hidden');
  
  // Refocus input
  loginPasswordInput.value = '';
  loginPasswordInput.focus();
}

// Login Submit Form Handler
loginFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = loginUsernameInput.value;
  const password = loginPasswordInput.value;
  
  loginBtnEl.disabled = true;
  loginBtnEl.innerHTML = `<span class="spinner" style="width: 14px; height: 14px; margin: 0; display: inline-block;"></span> Unlocking...`;
  loginErrorEl.classList.add('hidden');
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await res.json();
    
    if (res.ok && data.token) {
      sessionToken = data.token;
      localStorage.setItem(TOKEN_KEY, sessionToken);
      
      // Wipe input password
      loginPasswordInput.value = '';
      
      // Animate overlay unlock transition
      loginOverlayEl.classList.add('fade-out');
      setTimeout(() => {
        loginOverlayEl.classList.add('hidden');
      }, 400);
      
      // Display app layout
      appWrapperEl.classList.remove('hidden');
      
      // Run routines
      fetchWells();
      startWhatsAppSSE();
    } else {
      loginErrorEl.classList.remove('hidden');
      loginErrorTextEl.textContent = data.error || 'Invalid credentials. Please try again.';
      loginPasswordInput.value = '';
      loginPasswordInput.focus();
    }
  } catch (err) {
    console.error('Unlock error:', err);
    loginErrorEl.classList.remove('hidden');
    loginErrorTextEl.textContent = 'Server connection error. Please try again.';
  } finally {
    loginBtnEl.disabled = false;
    loginBtnEl.innerHTML = `<i data-lucide="unlock"></i> Unlock Dashboard`;
    lucide.createIcons();
  }
});

// Logout Event trigger
if (logoutBtnEl) {
  logoutBtnEl.addEventListener('click', () => {
    if (confirm('Lock the dashboard portal?')) {
      logout();
    }
  });
}

// ==========================================================================
// 1. CLOCK & TICKER
// ==========================================================================
function startClock() {
  setInterval(() => {
    const now = new Date();
    liveTimeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, 1000);
}

// ==========================================================================
// 2. CALENDAR CALCULATIONS & RENDERING
// ==========================================================================
function getWellStatusForDate(well, dateStr) {
  if (!well || !well.cycleStartDate) {
    return { status: 'UNKNOWN', dayIndex: 0, totalDays: 0 };
  }
  
  try {
    const startDate = new Date(well.cycleStartDate + 'T00:00:00');
    const targetDate = new Date(dateStr + 'T00:00:00');

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

function renderCalendar() {
  calendarDaysGridEl.innerHTML = '';
  
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  
  // Set Calendar Header Month/Year
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  calendarMonthYearEl.textContent = `${monthNames[month]} ${year}`;
  
  // First day of the month
  const firstDayIndex = new Date(year, month, 1).getDay();
  
  // Last day of the month
  const lastDay = new Date(year, month + 1, 0).getDate();
  
  // Days from previous month (empty padding slots)
  for (let i = 0; i < firstDayIndex; i++) {
    const padDay = document.createElement('div');
    padDay.className = 'calendar-day other-month';
    calendarDaysGridEl.appendChild(padDay);
  }
  
  const todayStr = new Date().toISOString().split('T')[0];
  
  // Render current month days
  for (let day = 1; day <= lastDay; day++) {
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day';
    
    const formattedDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // Day number text
    const dayNumber = document.createElement('span');
    dayNumber.textContent = day;
    dayEl.appendChild(dayNumber);
    
    // Check if this date is "today"
    if (formattedDate === todayStr) {
      dayEl.classList.add('today');
    }
    
    // Add schedule coloration if a well is active
    if (activeWell) {
      const statusInfo = getWellStatusForDate(activeWell, formattedDate);
      
      if (statusInfo.status === 'ON') {
        dayEl.classList.add('status-on');
        
        const badge = document.createElement('span');
        badge.className = 'day-badge';
        badge.textContent = `ON ${statusInfo.dayIndex}/${statusInfo.totalDays}`;
        dayEl.appendChild(badge);
      } else if (statusInfo.status === 'OFF') {
        dayEl.classList.add('status-off');
        
        const badge = document.createElement('span');
        badge.className = 'day-badge';
        badge.textContent = `Rest ${statusInfo.dayIndex}/${statusInfo.totalDays}`;
        dayEl.appendChild(badge);
      }
      
      // Click handler to set this day as new Cycle Start Date
      dayEl.addEventListener('click', () => {
        wellStartDateInput.value = formattedDate;
        // Visual indicator on form
        wellStartDateInput.style.borderColor = 'var(--color-primary)';
        setTimeout(() => {
          wellStartDateInput.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        }, 1500);
        
        // Temporarily adjust active well to preview calendar change
        activeWell.cycleStartDate = formattedDate;
        renderCalendar();
        updateMotorWidget();
      });
    }
    
    calendarDaysGridEl.appendChild(dayEl);
  }
}

// Navigation Controls
prevMonthBtn.addEventListener('click', () => {
  currentMonth.setMonth(currentMonth.getMonth() - 1);
  renderCalendar();
});

nextMonthBtn.addEventListener('click', () => {
  currentMonth.setMonth(currentMonth.getMonth() + 1);
  renderCalendar();
});

// ==========================================================================
// 3. MOTOR WIDGET & STATS RENDERERS
// ==========================================================================
function updateMotorWidget() {
  if (!activeWell) {
    statusPillEl.textContent = 'N/A';
    statusPillEl.className = 'status-pill-badge off-pill';
    motorGlowRingEl.className = 'glow-ring off';
    motorPumpBtn.className = 'motor-pump off';
    motorStatusTextEl.textContent = 'No active well';
    motorSubstatusTextEl.textContent = 'Please configure a well site';
    
    statSharePercentEl.textContent = '0.0';
    statRatioEl.textContent = '- / -';
    statAlertsStatusEl.innerHTML = `<i data-lucide="bell-off" class="text-crimson"></i><span class="stat-text">Inactive</span>`;
    statAlertsTimeEl.textContent = 'Disabled';
    lucide.createIcons();
    return;
  }
  
  const todayStr = new Date().toISOString().split('T')[0];
  const statusInfo = getWellStatusForDate(activeWell, todayStr);
  
  // Update Widget Status
  if (statusInfo.status === 'ON') {
    statusPillEl.textContent = 'ON';
    statusPillEl.className = 'status-pill-badge on-pill';
    motorGlowRingEl.className = 'glow-ring on';
    motorPumpBtn.className = 'motor-pump on';
    motorStatusTextEl.textContent = 'Well Motor Running';
    motorSubstatusTextEl.textContent = `Scheduled ON today (Day ${statusInfo.dayIndex} of ${statusInfo.totalDays})`;
  } else {
    statusPillEl.textContent = 'OFF';
    statusPillEl.className = 'status-pill-badge off-pill';
    motorGlowRingEl.className = 'glow-ring off';
    motorPumpBtn.className = 'motor-pump off';
    motorStatusTextEl.textContent = 'Well Motor Idle';
    motorSubstatusTextEl.textContent = `Scheduled OFF/Rest today (Day ${statusInfo.dayIndex} of ${statusInfo.totalDays})`;
  }
  
  // Update Stats Panel
  const on = parseFloat(activeWell.onDays) || 0;
  const off = parseFloat(activeWell.offDays) || 0;
  const share = ((on / (on + off)) * 100).toFixed(1);
  
  statSharePercentEl.textContent = share;
  statRatioEl.textContent = `${activeWell.onDays} / ${activeWell.offDays}`;
  
  if (activeWell.notificationsEnabled) {
    statAlertsStatusEl.innerHTML = `<i data-lucide="bell" class="text-emerald alert-icon-on"></i><span class="stat-text text-emerald">Enabled</span>`;
    statAlertsTimeEl.textContent = `Daily at ${activeWell.notificationTime}`;
  } else {
    statAlertsStatusEl.innerHTML = `<i data-lucide="bell-off" class="text-crimson"></i><span class="stat-text text-crimson">Disabled</span>`;
    statAlertsTimeEl.textContent = 'Disabled';
  }
  
  lucide.createIcons();
}

// ==========================================================================
// 4. MULTI-WELL SIDEBAR LIST
// ==========================================================================
function renderActiveWell() {
  if (!activeWell) {
    activeWellTitleEl.textContent = 'Create a Well Site';
    activeWellBadgeEl.classList.add('hidden');
    wellSettingsForm.reset();
    wellIdInput.value = '';
    
    // Set default values for new well
    const today = new Date().toISOString().split('T')[0];
    wellStartDateInput.value = today;
    wellNotifyTimeInput.value = '08:00';
    wellOnDaysInput.value = '2';
    wellOffDaysInput.value = '1';
    wellMsgOnInput.value = "🔔 *Well Motor Notification*:\n\n💦 *{well_name}* is scheduled to be *ON* today.\n📈 Status: ON (Day {day_index} of {total_days})\n🔋 Share: {share_percent}%\n\nPlease make sure the motor is running.";
    wellMsgOffInput.value = "🔕 *Well Motor Notification*:\n\n💤 *{well_name}* is scheduled to be *OFF* today.\n📉 Status: OFF (Rest/Interval Day)\n\nPlease keep the motor switched off.";
    
    updateMotorWidget();
    renderCalendar();
    return;
  }
  
  activeWellTitleEl.textContent = activeWell.name;
  activeWellBadgeEl.classList.remove('hidden');
  activeWellBadgeEl.innerHTML = `<i data-lucide="map-pin"></i> ${activeWell.sharePercent}% Share`;
  
  // Fill Settings form fields
  wellIdInput.value = activeWell.id;
  wellNameInput.value = activeWell.name;
  wellOnDaysInput.value = activeWell.onDays;
  wellOffDaysInput.value = activeWell.offDays;
  wellStartDateInput.value = activeWell.cycleStartDate;
  wellNotifyTimeInput.value = activeWell.notificationTime;
  wellPhoneInput.value = activeWell.phoneNumber || '';
  wellAlertsEnabledInput.checked = activeWell.notificationsEnabled !== false;
  
  wellMsgOnInput.value = activeWell.messageTemplateOn || '';
  wellMsgOffInput.value = activeWell.messageTemplateOff || '';
  
  sendTestBtn.disabled = !whatsappConnected || !activeWell.phoneNumber;
  
  updateMotorWidget();
  renderCalendar();
  lucide.createIcons();
}

function selectWell(wellId) {
  activeWell = wells.find(w => w.id === wellId) || null;
  
  // Toggle active class in UI
  document.querySelectorAll('.well-item').forEach(el => {
    if (el.dataset.id === wellId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
  
  renderActiveWell();
}

function renderWellsList() {
  wellsListEl.innerHTML = '';
  
  if (wells.length === 0) {
    wellsListEl.innerHTML = `
      <div class="text-center" style="padding: 20px 0; color: var(--text-dark); font-size: 0.82rem;">
        <i data-lucide="info" style="width: 20px; height: 20px; margin-bottom: 5px; opacity: 0.5;"></i>
        <p>No well sites created.</p>
        <p style="font-size:0.75rem; margin-top:3px;">Click ➕ above to add one.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }
  
  wells.forEach(well => {
    const item = document.createElement('div');
    item.className = `well-item ${activeWell && activeWell.id === well.id ? 'active' : ''}`;
    item.dataset.id = well.id;
    
    const todayStr = new Date().toISOString().split('T')[0];
    const statusInfo = getWellStatusForDate(well, todayStr);
    
    item.innerHTML = `
      <div class="well-item-info">
        <div class="well-icon-container">
          <i data-lucide="droplet"></i>
        </div>
        <div class="well-item-text">
          <h4>${well.name}</h4>
          <p>${well.onDays}d ON / ${well.offDays}d OFF • ${well.sharePercent}%</p>
        </div>
      </div>
      <button class="btn-icon delete-well-btn" title="Delete Well" style="padding: 4px; border:none; background:transparent;">
        <i data-lucide="trash-2" style="width: 14px; height: 14px; color: var(--color-crimson)"></i>
      </button>
    `;
    
    // Add Click Selector
    item.addEventListener('click', (e) => {
      // Prevent selection if delete button clicked
      if (e.target.closest('.delete-well-btn')) return;
      selectWell(well.id);
    });
    
    // Add Delete Action
    const deleteBtn = item.querySelector('.delete-well-btn');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete the site "${well.name}"?`)) {
        try {
          const res = await apiFetch(`/api/wells/${well.id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            wells = wells.filter(w => w.id !== well.id);
            if (activeWell && activeWell.id === well.id) {
              activeWell = wells[0] || null;
            }
            renderWellsList();
            renderActiveWell();
          } else {
            alert('Failed to delete well settings.');
          }
        } catch (err) {
          console.error(err);
          alert('Failed to delete well settings.');
        }
      }
    });
    
    wellsListEl.appendChild(item);
  });
  
  lucide.createIcons();
}

async function fetchWells() {
  try {
    const res = await apiFetch('/api/wells');
    wells = await res.json();
    
    if (wells.length > 0 && !activeWell) {
      activeWell = wells[0];
    }
    
    renderWellsList();
    renderActiveWell();
  } catch (err) {
    console.error('Error fetching wells configurations:', err);
  }
}

// Add New Well Button Event
addWellBtn.addEventListener('click', () => {
  activeWell = null;
  // Deselect items in list
  document.querySelectorAll('.well-item').forEach(el => el.classList.remove('active'));
  renderActiveWell();
});

// ==========================================================================
// 5. FORM SUBMISSION & SETTINGS OPERATIONS
// ==========================================================================
wellSettingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const wellId = wellIdInput.value || null;
  const name = wellNameInput.value;
  const onDays = parseInt(wellOnDaysInput.value);
  const offDays = parseInt(wellOffDaysInput.value);
  const startDate = wellStartDateInput.value;
  const notifyTime = wellNotifyTimeInput.value;
  const phone = wellPhoneInput.value.replace(/\D/g, ''); // strip non-digits
  const alertsEnabled = wellAlertsEnabledInput.checked;
  const msgOn = wellMsgOnInput.value;
  const msgOff = wellMsgOffInput.value;
  
  if (!name || isNaN(onDays) || isNaN(offDays) || !startDate || !notifyTime || !phone) {
    alert('Please enter all required settings correctly.');
    return;
  }
  
  const payload = {
    id: wellId,
    name,
    onDays,
    offDays,
    cycleStartDate: startDate,
    notificationTime: notifyTime,
    phoneNumber: phone,
    notificationsEnabled: alertsEnabled,
    messageTemplateOn: msgOn,
    messageTemplateOff: msgOff
  };
  
  try {
    saveSettingsBtn.disabled = true;
    saveSettingsBtn.innerHTML = `<span class="spinner" style="width: 14px; height: 14px; margin: 0; display: inline-block;"></span> Saving...`;
    
    const res = await apiFetch('/api/wells', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const savedWell = await res.json();
    
    if (res.ok) {
      alert(`Well "${savedWell.name}" configured and saved! Check your WhatsApp if bot is active.`);
      
      // Update local list
      const idx = wells.findIndex(w => w.id === savedWell.id);
      if (idx !== -1) {
        wells[idx] = savedWell;
      } else {
        wells.push(savedWell);
      }
      
      activeWell = savedWell;
      renderWellsList();
      renderActiveWell();
    } else {
      alert('Error saving configuration: ' + savedWell.error);
    }
  } catch (error) {
    console.error('Error submitting well config:', error);
    alert('Network error saving configuration.');
  } finally {
    saveSettingsBtn.disabled = false;
    saveSettingsBtn.innerHTML = `<i data-lucide="save"></i> Save Configuration`;
    lucide.createIcons();
  }
});

// Manual Test Message Event
sendTestBtn.addEventListener('click', async () => {
  if (!activeWell || !activeWell.id) {
    alert('Please select a saved well first.');
    return;
  }
  
  if (!activeWell.phoneNumber) {
    alert('Please enter a phone number in the form and click save first.');
    return;
  }
  
  try {
    sendTestBtn.disabled = true;
    sendTestBtn.innerHTML = `<span class="spinner" style="width: 14px; height: 14px; margin: 0; display: inline-block;"></span> Sending...`;
    
    const res = await apiFetch(`/api/wells/${activeWell.id}/test-message`, { method: 'POST' });
    const data = await res.json();
    
    if (data.success) {
      alert('Test message triggered successfully! Check WhatsApp.');
    } else {
      alert('Failed to send test message: ' + data.error);
    }
  } catch (err) {
    console.error(err);
    alert('Network error sending test message.');
  } finally {
    sendTestBtn.disabled = false;
    sendTestBtn.innerHTML = `<i data-lucide="send"></i> Send Test Message`;
    lucide.createIcons();
  }
});

// ==========================================================================
// 6. WHATSAPP CONNECTION (SSE REALTIME EVENTS)
// ==========================================================================
function startWhatsAppSSE() {
  if (window.whatsappEventSource) {
    window.whatsappEventSource.close();
  }
  
  const source = new EventSource(`/api/whatsapp-qr?token=${encodeURIComponent(sessionToken)}`);
  window.whatsappEventSource = source;
  
  source.onmessage = (event) => {
    const data = JSON.parse(event.data);
    updateWhatsAppStatus(data);
  };
  
  source.onerror = (err) => {
    console.error('SSE connection error:', err);
    waStatusDot.className = 'status-dot disconnected';
    waStateQR.classList.add('hidden');
    waStateConnecting.classList.add('hidden');
    waStateConnected.classList.add('hidden');
    waStateDisconnected.classList.remove('hidden');
  };
}

function updateWhatsAppStatus(data) {
  const status = data.status;
  
  // Set class on dot status indicator
  waStatusDot.className = `status-dot ${status}`;
  
  // Reset all states
  waStateQR.classList.add('hidden');
  waStateConnecting.classList.add('hidden');
  waStateConnected.classList.add('hidden');
  waStateDisconnected.classList.add('hidden');
  
  switch (status) {
    case 'initializing':
      waStateConnecting.classList.remove('hidden');
      connectingText.textContent = 'Initializing engine...';
      whatsappConnected = false;
      break;
      
    case 'connecting':
      waStateConnecting.classList.remove('hidden');
      connectingText.textContent = data.loadingPercent 
        ? `Connecting: Loading ${data.loadingPercent}%` 
        : 'Logging in to WhatsApp...';
      whatsappConnected = false;
      break;
      
    case 'qr_ready':
      if (data.qr) {
        waStateQR.classList.remove('hidden');
        waQRImg.src = data.qr;
      } else {
        waStateConnecting.classList.remove('hidden');
        connectingText.textContent = 'Generating QR Code...';
      }
      whatsappConnected = false;
      break;
      
    case 'connected':
      waStateConnected.classList.remove('hidden');
      waUserName.textContent = data.clientName || 'WhatsApp Connected';
      waUserNumber.textContent = data.clientNumber ? `+${data.clientNumber}` : 'Online';
      whatsappConnected = true;
      break;
      
    case 'disconnected':
    default:
      waStateDisconnected.classList.remove('hidden');
      whatsappConnected = false;
      break;
  }
  
  // Sync the test button accessibility
  if (activeWell && activeWell.phoneNumber) {
    sendTestBtn.disabled = !whatsappConnected;
  } else {
    sendTestBtn.disabled = true;
  }
}

// Disconnect Bot Event
waDisconnectBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to disconnect and log out the WhatsApp bot? You will need to scan the QR code again next time.')) {
    try {
      const res = await apiFetch('/api/whatsapp/disconnect', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('Bot logged out. Wait for new QR code to initialize...');
      } else {
        alert('Failed: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('Error communicating with logout endpoint.');
    }
  }
});

// ==========================================================================
// 7. APPLICATION INITIALIZATION
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Protocol Guard: Intercept local file launches (file://) and show warning
  if (window.location.protocol === 'file:') {
    const protocolGuardEl = document.getElementById('protocol-guard');
    if (protocolGuardEl) {
      protocolGuardEl.classList.remove('hidden');
    }
    if (loginOverlayEl) loginOverlayEl.classList.add('hidden');
    if (appWrapperEl) appWrapperEl.classList.add('hidden');
    return; // Halt app initialization
  }

  startClock();
  
  // Password Visibility Toggle Handler
  const togglePasswordBtn = document.getElementById('toggle-password-btn');
  const togglePasswordIcon = document.getElementById('toggle-password-icon');
  if (togglePasswordBtn && togglePasswordIcon) {
    togglePasswordBtn.addEventListener('click', () => {
      const type = loginPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      loginPasswordInput.setAttribute('type', type);
      
      // Update Lucide icon
      if (type === 'text') {
        togglePasswordIcon.setAttribute('data-lucide', 'eye-off');
      } else {
        togglePasswordIcon.setAttribute('data-lucide', 'eye');
      }
      lucide.createIcons();
    });
  }
  
  // Check active session token
  const savedToken = localStorage.getItem(TOKEN_KEY);
  if (savedToken) {
    sessionToken = savedToken;
    loginOverlayEl.classList.add('fade-out');
    setTimeout(() => {
      loginOverlayEl.classList.add('hidden');
    }, 400);
    appWrapperEl.classList.remove('hidden');
    
    fetchWells();
    startWhatsAppSSE();
  } else {
    loginOverlayEl.classList.remove('hidden');
    loginOverlayEl.classList.remove('fade-out');
    appWrapperEl.classList.add('hidden');
    loginUsernameInput.focus();
  }
});

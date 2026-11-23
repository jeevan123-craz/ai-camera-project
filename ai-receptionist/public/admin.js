/* ════════════════════════════════════════════════
   MedGuard Admin Dashboard — admin.js
   Now with WebSocket live logs + Blinkit order rendering
   ════════════════════════════════════════════════ */

'use strict';

let allLogs = [];
let currentFilter = 'all';
let blinkitOrderCount = 0;
let lastSeenLogKey = null;

// ════════════════════════════════════════════════
// Notification sound (synthesized, no audio files — same approach as public/app.js)
// ════════════════════════════════════════════════
const adminAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playAdminNotifySound() {
    try {
        if (adminAudioCtx.state === 'suspended') adminAudioCtx.resume();
        const freqs = [659.25, 987.77];
        const durs  = [0.09, 0.14];
        let time = adminAudioCtx.currentTime;
        freqs.forEach((freq, i) => {
            const osc = adminAudioCtx.createOscillator();
            const gain = adminAudioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, time);
            gain.gain.setValueAtTime(0.14, time);
            gain.gain.exponentialRampToValueAtTime(0.004, time + durs[i]);
            osc.connect(gain);
            gain.connect(adminAudioCtx.destination);
            osc.start(time);
            osc.stop(time + durs[i]);
            time += durs[i] * 0.85;
        });
    } catch (e) { console.error('Notify sound failed:', e); }
}

// ════════════════════════════════════════════════
// Toast notifications (replaces blocking alert() popups)
// ════════════════════════════════════════════════
function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = 'position:fixed; top:1.5rem; right:1.5rem; z-index:2000; display:flex; flex-direction:column; gap:0.6rem;';
        document.body.appendChild(container);
    }

    const colors = {
        success: { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.4)', text: '#34d399' },
        error:   { bg: 'rgba(244,63,94,0.15)',   border: 'rgba(244,63,94,0.4)',  text: '#fda4af' },
        info:    { bg: 'rgba(99,102,241,0.15)',  border: 'rgba(99,102,241,0.4)', text: '#a5b4fc' },
    };
    const c = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.style.cssText = `background:${c.bg}; border:1px solid ${c.border}; color:${c.text}; padding:0.85rem 1.25rem; border-radius:10px; font-size:0.88rem; font-weight:500; box-shadow:0 8px 24px rgba(0,0,0,0.35); backdrop-filter:blur(10px); max-width:340px; animation:toast-in 0.25s ease forwards;`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.transition = 'opacity 0.25s, transform 0.25s';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 250);
    }, 3800);
}

// ════════════════════════════════════════════════
// Animated count-up for stat cards
// ════════════════════════════════════════════════
function animateCount(el, target) {
    if (!el) return;
    const from = parseInt(el.textContent, 10) || 0;
    if (from === target) return;
    const duration = 450;
    const start = performance.now();
    function step(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(from + (target - from) * eased);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ════════════════════════════════════════════════
// Our Doctors (static roster — mirrors CLINIC DOCTORS & SPECIALTIES in ai.js;
// photos sourced from kmchhospitals.com/all-doctors/, same as public/app.js)
// ════════════════════════════════════════════════
const DOCTORS = [
    { name: 'Dr. K.I. Joseph', specialty: 'General Physician', photo: 'https://kmchhospitals.com/wp-content/uploads/2025/01/Dr.-K.I.-Joseph.png' },
    { name: 'Dr. Thomas Alexander', specialty: 'Cardiologist', photo: 'https://kmchhospitals.com/wp-content/uploads/2024/04/Dr.-Thomas-Alexander-kmch.png' },
    { name: 'Dr. S. Pavithra', specialty: 'Dermatologist', photo: 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr-Pavitra-Derma.png' },
    { name: 'Dr. K. Baskaran', specialty: 'Orthopedic Surgeon', photo: 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr-Baskaran-ortho.png' },
    { name: 'Dr. D. Ashwath', specialty: 'Pediatrician', photo: 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr.-D.-Ashwath-.png' },
    { name: 'Dr. S. Aravindh', specialty: 'Gastroenterologist', photo: 'https://kmchhospitals.com/wp-content/uploads/2025/01/Dr.-S.-Aravindh-Gastro.webp' },
    { name: 'Dr. P. Baskar', specialty: 'Neurologist', photo: 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr-Baskar.png' },
    { name: 'Dr. A.N. Murugan', specialty: 'ENT Specialist', photo: 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr.A.N.-Murgan.png' },
    { name: 'Dr. Jayanthi Veerappan', specialty: 'Gynecologist', photo: 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr.Jayanthi-Veerappan.png' },
    { name: 'Dr. P.B. Barani Kumar', specialty: 'Urologist', photo: 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr.Baranikumar.png' },
    { name: 'Dr. T.R. Sivagnanam', specialty: 'Diabetologist', photo: 'https://kmchhospitals.com/wp-content/uploads/2025/01/Dr-Sivagnanam-diabetology.png' },
    { name: 'Dr. J. Venugopal', specialty: 'Pulmonologist', photo: 'https://kmchhospitals.com/wp-content/uploads/2025/07/Dr.Venugopal.png' },
];
const DOCTOR_PHOTO_FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" rx="36" fill="#6366f1"/><text x="50%" y="58%" font-size="30" text-anchor="middle" fill="white" font-family="sans-serif">🩺</text></svg>`
);

function renderDoctors() {
    const grid = document.getElementById('doctorsGrid');
    const badge = document.getElementById('doctorsCountBadge');
    if (!grid) return;
    if (badge) badge.textContent = DOCTORS.length;

    grid.innerHTML = DOCTORS.map(d => `
        <div class="doctor-card glow-card">
            <img class="doctor-photo" src="${esc(d.photo)}" alt="${esc(d.name)}" onerror="this.onerror=null;this.src='${DOCTOR_PHOTO_FALLBACK}';">
            <div class="doctor-name">${esc(d.name)}</div>
            <div class="doctor-specialty">${esc(d.specialty)}</div>
        </div>
    `).join('');
}

// ════════════════════════════════════════════════
// REST: Appointments
// ════════════════════════════════════════════════
async function fetchAppointments() {
    try {
        const tbody = document.getElementById('appointments-body');
        tbody.innerHTML = '<tr><td colspan="4" class="loading-state">Syncing with Google Calendar...</td></tr>';

        const response = await fetch('/api/appointments');
        if (response.status === 401) {
            window.location.href = '/login.html';
            return;
        }
        const appointments = await response.json();
        fetchRecordings();

        // Stats
        animateCount(document.getElementById('total-bookings'), appointments.length);
        const today = new Date().toDateString();
        const todayCount = appointments.filter(a => new Date(a.time).toDateString() === today).length;
        animateCount(document.getElementById('today-bookings'), todayCount);
        animateCount(document.getElementById('upcoming-bookings'), appointments.length - todayCount);

        // Table
        if (appointments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="loading-state">No appointments found.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        appointments.forEach(apt => {
            const tr = document.createElement('tr');
            const dateObj = new Date(apt.time);
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            tr.innerHTML = `
                <td><strong>${esc(apt.patientName)}</strong></td>
                <td>${dateStr} <br><span style="color:#94a3b8;font-size:0.85rem">${timeStr}</span></td>
                <td>${esc(apt.reason)}</td>
                <td>
                    <span class="status-badge">Confirmed</span>
                    <button class="btn-rx" style="color: #db2777; border-color: rgba(219,39,119,0.3); background: rgba(219,39,119,0.1); margin-right: 0.5rem;" onclick="callPatient('${esc(apt.patientName)}', '${esc(apt.phone || '')}')">📞 Call</button>
                    <button class="btn-rx" onclick="openRxModal('${esc(apt.patientName)}', '${esc(apt.time)}', '${esc(apt.email || '')}')">Write Rx</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Failed to load appointments', err);
        document.getElementById('appointments-body').innerHTML =
            '<tr><td colspan="4" class="loading-state" style="color:#ef4444">Error loading data.</td></tr>';
    }
}

// ════════════════════════════════════════════════
// WebSocket — Live Updates
// ════════════════════════════════════════════════
function initWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws    = new WebSocket(`${proto}//${location.host}`);

    const dot   = document.getElementById('wsDot');
    const label = document.getElementById('wsStatusLabel');

    ws.onopen = () => {
        if (dot)   { dot.classList.add('online'); }
        if (label) { label.textContent = 'Online & Auto-Calling'; }
    };
    ws.onclose = () => {
        if (dot)   { dot.classList.remove('online'); }
        if (label) { label.textContent = 'Reconnecting…'; }
        setTimeout(initWebSocket, 5000);
    };
    ws.onerror = () => {
        if (dot)   { dot.classList.remove('online'); }
        if (label) { label.textContent = 'Connection Error'; }
    };

    ws.onmessage = ({ data }) => {
        try {
            const { appointments = [], availableSlots = [], logs = [], recordings = [], whatsappStatus } = JSON.parse(data);

            // Update appointments silently
            updateAppointmentsFromWS(appointments);

            // Update voice recordings
            updateRecordings(recordings);

            // Play a notification sound + toast when a genuinely new log entry arrives
            // (not on every periodic WS push — only when the newest entry actually changed).
            if (logs.length > 0) {
                const newestKey = logs[0].timestamp + logs[0].text;
                if (lastSeenLogKey !== null && newestKey !== lastSeenLogKey) {
                    playAdminNotifySound();
                    const src = logs[0].source === 'Blinkit' ? '🛒 New Blinkit order' : `📨 New activity from ${logs[0].source || 'patient'}`;
                    showToast(src, logs[0].source === 'Blinkit' ? 'info' : 'success');
                }
                lastSeenLogKey = newestKey;
            }

            // Update logs
            allLogs = logs;
            renderLogs();

            // Update Blinkit count
            const blinkitLogs = logs.filter(l => l.source === 'Blinkit');
            blinkitOrderCount = blinkitLogs.length;
            const bc = document.getElementById('blinkit-count');
            if (bc) animateCount(bc, blinkitOrderCount);

            const lc = document.getElementById('logsCountBadge');
            if (lc) lc.textContent = logs.length;

            // Update WhatsApp Status
            if (whatsappStatus) {
                const waCard = document.getElementById('whatsapp-card');
                const waContent = document.getElementById('whatsapp-status-content');
                if (waCard && waContent) {
                    waCard.style.display = 'block';
                    if (whatsappStatus.ready) {
                        waContent.innerHTML = '<span style="color:#10b981;">✅ Connected & Ready</span>';
                    } else if (whatsappStatus.qr) {
                        waContent.innerHTML = `
                            <p style="margin-bottom:0.5rem; color:#fb923c;">Scan QR to connect:</p>
                            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(whatsappStatus.qr)}" style="width: 100%; border-radius: 8px; background: white; padding: 4px;" alt="WhatsApp QR" />
                        `;
                    } else {
                        waContent.innerHTML = '<span>⏳ Starting WhatsApp...</span>';
                    }
                }
            }

        } catch (e) {
            console.error('WebSocket parse error:', e);
        }
    };
}

// ════════════════════════════════════════════════
// Voice Call Recordings Rendering
// ════════════════════════════════════════════════
function updateRecordings(recordings = []) {
    const tbody = document.getElementById('recordings-body');
    const badge = document.getElementById('recordingsCountBadge');
    if (badge) badge.textContent = `${recordings.length} Call${recordings.length === 1 ? '' : 's'}`;
    if (!tbody) return;

    if (!recordings || !recordings.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="loading-state">No call recordings yet. Automated confirmation calls placed to patients will appear here!</td></tr>`;
        return;
    }

    tbody.innerHTML = recordings.map(r => `
        <tr>
            <td style="font-weight:600; color:#1e293b;">
                <span style="font-size:1.1rem; margin-right:4px;">👤</span>${escapeHtml(r.patientName || 'Patient')}
            </td>
            <td style="color:#ec4899; font-weight:600; font-family:monospace;">
                +91 ${escapeHtml(r.phone || 'N/A')}
            </td>
            <td>
                <span class="recording-tag" style="background:#fdf2f8; color:#be185d; border:1px solid #fbcfe8; padding:3px 8px; border-radius:99px; font-size:0.75rem; font-weight:600;">
                    📱 SIM · ElevenLabs
                </span>
            </td>
            <td style="font-size:0.8rem; color:#64748b;">
                ${escapeHtml(r.time || new Date(r.timestamp).toLocaleTimeString())}
            </td>
            <td>
                <span class="status-badge" style="background:${(r.status || '').includes('Fail') ? '#ffe4e6' : '#dcfce7'}; color:${(r.status || '').includes('Fail') ? '#e11d48' : '#15803d'}; border-radius:99px; padding:3px 8px; font-size:0.75rem; font-weight:600;">
                    ${escapeHtml(r.status || 'Active')}
                </span>
            </td>
            <td>
                ${r.audioUrl ? `
                    <div style="display:flex; align-items:center; gap:8px;">
                        <audio controls preload="none" style="height:32px; width:220px; outline:none; border-radius:16px;">
                            <source src="${r.audioUrl}" type="${r.audioUrl.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'}">
                            Your browser does not support audio playback.
                        </audio>
                        <a href="${r.audioUrl}" download target="_blank" style="color:#ec4899; text-decoration:none; font-size:1.1rem;" title="Download recording">⬇️</a>
                    </div>
                ` : '<span style="color:#94a3b8; font-size:0.8rem;">No audio</span>'}
            </td>
        </tr>
    `).join('');
}

async function fetchRecordings() {
    try {
        const res = await fetch('/api/recordings');
        if (res.ok) {
            const data = await res.json();
            updateRecordings(data);
        }
    } catch (e) {
        console.warn('Failed to fetch recordings:', e);
    }
}

// ════════════════════════════════════════════════
// Twilio Calling
// ════════════════════════════════════════════════
async function callPatient(patientName, defaultPhone = '') {
    if (!patientName) {
        patientName = prompt('Enter patient name:');
        if (!patientName) return;
    }
    const phone = prompt(`Enter phone number to call ${patientName} via Nothing Phone 2a (JIO 4G SIM):`, defaultPhone || '9442922888');
    if (!phone) return;

    try {
        showToast(`Initiating call to ${patientName}...`, 'info');
        const res = await fetch('/api/call-patient', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patientName, phone })
        });
        
        if (res.status === 401) {
            window.location.href = '/login.html';
            return;
        }

        const data = await res.json();
        if (data.success) {
            showToast(`Call initiated to ${patientName}!`, 'success');
        } else {
            showToast(data.error || 'Failed to initiate call.', 'error');
        }
    } catch (err) {
        console.error('Call failed:', err);
        showToast('Failed to connect to server.', 'error');
    }
}

function updateAppointmentsFromWS(appointments) {
    const total = appointments.length;
    const today = new Date().toDateString();
    const todayCount = appointments.filter(a => new Date(a.time).toDateString() === today).length;

    animateCount(document.getElementById('total-bookings'), total);
    animateCount(document.getElementById('today-bookings'), todayCount);
    animateCount(document.getElementById('upcoming-bookings'), total - todayCount);
}

// ════════════════════════════════════════════════
// Log Filter
// ════════════════════════════════════════════════
function setLogFilter(filter, btn) {
    currentFilter = filter;
    document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderLogs();
}

// ════════════════════════════════════════════════
// Render Logs
// ════════════════════════════════════════════════
function renderLogs() {
    const box = document.getElementById('logsBox');
    if (!box) return;

    let filtered = allLogs;

    if (currentFilter === 'blinkit') {
        filtered = allLogs.filter(l => l.source === 'Blinkit');
    } else if (currentFilter === 'user') {
        filtered = allLogs.filter(l => l.role === 'user');
    } else if (currentFilter === 'ai') {
        filtered = allLogs.filter(l => l.role === 'ai');
    } else if (currentFilter === 'whatsapp') {
        filtered = allLogs.filter(l => l.source === 'WhatsApp');
    }

    if (!filtered.length) {
        box.innerHTML = `<div style="text-align:center;color:#4b5563;font-size:0.85rem;padding:2rem;">${currentFilter === 'blinkit' ? '🛒 No Blinkit orders yet.' : 'No activity yet.'}</div>`;
        return;
    }

    box.innerHTML = filtered.map(log => buildLogEntry(log)).join('');
}

function buildLogEntry(log) {
    const time = new Date(log.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const isBlinkit = log.source === 'Blinkit';
    const isCodeRed = log.extra?.type === 'code_red';

    // Source badge
    let srcClass = 'system-src';
    let srcLabel = log.source || 'System';
    if (isCodeRed)                        { srcClass = 'code-red-src'; srcLabel = '🚨 EMERGENCY'; }
    else if (isBlinkit)                   { srcClass = 'blinkit-src'; srcLabel = '🛒 Blinkit'; }
    else if (log.role === 'user')         { srcClass = 'user-src';    srcLabel = '👤 ' + (log.source || 'Patient'); }
    else if (log.role === 'ai')           { srcClass = 'ai-src';      srcLabel = '🤖 AI'; }
    else if (log.source === 'WhatsApp')   { srcClass = 'user-src';    srcLabel = '💬 WhatsApp'; }

    // Role icon
    const icon = log.role === 'emergency' ? '🚨' : log.role === 'user' ? '👤' : log.role === 'ai' ? '🤖' : isBlinkit ? '🛒' : '⚙️';

    // Blinkit detail panel
    let blinkitDetail = '';
    if (isBlinkit && log.extra) {
        const meds = (log.extra.medicines || []).map(m => `${m.name} (${m.dosage})`).join(', ');
        blinkitDetail = `
            <div class="blinkit-detail">
                📦 <span>Medicines:</span> ${esc(meds || '—')}<br>
                📍 <span>Address:</span> ${esc(log.extra.address || '—')}<br>
                📞 <span>Phone:</span> ${esc(log.extra.phone || '—')}<br>
                👨‍⚕️ <span>Doctor:</span> ${esc(log.extra.doctorName || '—')} &nbsp;·&nbsp; <span>Diagnosis:</span> ${esc(log.extra.diagnosis || '—')}
            </div>`;
    }

    // IP info
    const ipInfo = (!isBlinkit && log.extra?.ip)
        ? `<div style="font-size:0.65rem;color:#4b5563;margin-top:0.25rem;">IP: ${esc(log.extra.ip)}</div>`
        : '';

    const entryClass = isCodeRed ? 'log-entry code-red'
        : isBlinkit ? 'log-entry blinkit'
        : log.role === 'user'    ? 'log-entry user'
        : log.role === 'ai'      ? 'log-entry ai'
        : 'log-entry system';

    return `<div class="${entryClass}">
        <div class="log-meta">
            <span class="log-source ${srcClass}">${srcLabel}</span>
            ${isBlinkit ? '<span class="blinkit-badge">⚡ New Order</span>' : ''}
            <span class="log-time">${time}</span>
        </div>
        <div class="log-text">${icon} ${esc(log.text)}</div>
        ${blinkitDetail}
        ${ipInfo}
    </div>`;
}

// ════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════
function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ════════════════════════════════════════════════
// Prescription Modal Logic
// ════════════════════════════════════════════════
function openRxModal(patientName, appointmentDate, email) {
    document.getElementById('rxPatientName').value = patientName;
    document.getElementById('rxPatientDisplay').value = patientName;
    document.getElementById('rxAppointmentDate').value = appointmentDate;
    document.getElementById('rxPatientEmail').value = email || '';
    document.getElementById('rxDiagnosis').value = '';
    document.getElementById('rxMedicines').value = '';
    document.getElementById('rxNotes').value = '';
    document.getElementById('rxModal').classList.add('active');
}

function closeRxModal() {
    document.getElementById('rxModal').classList.remove('active');
}

async function submitPrescription(e) {
    e.preventDefault();
    const btn = document.getElementById('rxSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Publishing...';

    const patientName = document.getElementById('rxPatientName').value;
    const appointmentDate = document.getElementById('rxAppointmentDate').value;
    const patientEmail = document.getElementById('rxPatientEmail').value.trim();
    const diagnosis = document.getElementById('rxDiagnosis').value;
    const notes = document.getElementById('rxNotes').value;
    
    // Parse medicines from textarea
    const medLines = document.getElementById('rxMedicines').value.split('\n').filter(l => l.trim());
    const medicines = medLines.map(line => {
        const parts = line.split('|').map(p => p.trim());
        return {
            name: parts[0] || 'Unknown',
            dosage: parts[1] || 'As directed',
            duration: parts[2] || '—',
            instructions: parts[3] || '—'
        };
    });

    const payload = {
        patientName,
        appointmentDate,
        patientEmail: patientEmail || undefined,
        doctorName: 'Dr. Admin', // Dynamic based on login later if needed
        diagnosis,
        medicines,
        doctorNotes: notes
    };

    try {
        const res = await fetch('/api/doctor/prescription', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.status === 401) {
            showToast('Session expired. Please log in again.', 'error');
            window.location.href = '/login.html';
            return;
        }
        if (res.ok) {
            const data = await res.json();
            playAdminNotifySound();
            if (patientEmail && data.emailed) {
                showToast('✅ Prescription published and emailed to patient!', 'success');
            } else if (patientEmail && !data.emailed) {
                showToast('⚠️ Prescription published, but the email could not be sent.', 'error');
            } else {
                showToast('✅ Prescription published successfully!', 'success');
            }
            closeRxModal();
        } else {
            const err = await res.json();
            showToast('Error: ' + (err.error || 'Failed to publish'), 'error');
        }
    } catch (err) {
        showToast('Network error while publishing prescription.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Publish Prescription';
    }
}

// ════════════════════════════════════════════════
// Google Auth Status & Re-authentication
// ════════════════════════════════════════════════
let gauthPollTimer = null;

async function checkGoogleAuth() {
    const dot = document.getElementById('gauthDot');
    const label = document.getElementById('gauthLabel');
    const detail = document.getElementById('gauthDetail');
    if (!dot || !label) return null;

    try {
        const res = await fetch('/api/auth/status');
        if (!res.ok) throw new Error('status ' + res.status);
        const s = await res.json();

        if (s.healthy) {
            const soon = s.daysLeft !== null && s.daysLeft <= 1.5;
            dot.style.background = soon ? '#f59e0b' : '#10b981';
            dot.style.boxShadow = soon ? '0 0 8px rgba(245,158,11,0.5)' : '0 0 8px rgba(16,185,129,0.5)';
            label.textContent = soon ? 'Expiring soon' : 'Connected';
            detail.textContent = s.daysLeft !== null ? `Token expires in ~${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}` : '';
        } else {
            dot.style.background = '#f43f5e';
            dot.style.boxShadow = '0 0 8px rgba(244,63,94,0.5)';
            label.textContent = 'Expired — re-auth needed';
            detail.textContent = 'Calendar, Sheets & email are down until you re-authenticate.';
        }
        return s;
    } catch (err) {
        dot.style.background = '#64748b';
        dot.style.boxShadow = 'none';
        label.textContent = 'Status unavailable';
        detail.textContent = '';
        return null;
    }
}

async function startGoogleReauth() {
    // Snapshot the current token's timestamp first — "success" means a NEW token
    // was written (authorizedAt changed), not just that the old one still works.
    let before = null;
    try {
        const res = await fetch('/api/auth/status');
        if (res.ok) before = (await res.json()).authorizedAt;
    } catch (_) {}

    // Open the consent flow in a new tab, then poll until the token changes
    // (the server hot-swaps credentials — no restart needed).
    window.open('/api/auth/start', '_blank');
    showToast('Complete the Google login in the new tab…', 'info');

    if (gauthPollTimer) clearInterval(gauthPollTimer);
    const startedAt = Date.now();
    gauthPollTimer = setInterval(async () => {
        const s = await checkGoogleAuth();
        if (s && s.healthy && s.authorizedAt !== before) {
            clearInterval(gauthPollTimer);
            gauthPollTimer = null;
            showToast('✅ Google re-authenticated — services are live again!', 'success');
            fetchAppointments(); // calendar works again, refresh the dashboard
        } else if (Date.now() - startedAt > 3 * 60 * 1000) {
            clearInterval(gauthPollTimer); // give up after 3 minutes
            gauthPollTimer = null;
        }
    }, 4000);
}

// ════════════════════════════════════════════════
// Analytics Charts
// ════════════════════════════════════════════════
const charts = {}; // id -> Chart instance, so refreshes update in place

const CHART_COLORS = ['#ec4899', '#f43f5e', '#fb7185', '#f472b6', '#db2777', '#be185d', '#fda4af', '#f43f5e'];

function upsertChart(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === 'undefined') return;
    if (charts[id]) {
        charts[id].data = config.data;
        charts[id].update('none');
    } else {
        charts[id] = new Chart(canvas, config);
    }
}

const AXIS_STYLE = {
    ticks: { color: '#64748b', font: { size: 11 } },
    grid: { color: 'rgba(244, 114, 182, 0.15)' },
};

async function fetchAnalytics() {
    try {
        const res = await fetch('/api/analytics');
        if (!res.ok) return;
        const a = await res.json();

        const badge = document.getElementById('analyticsTotalBadge');
        if (badge) badge.textContent = `${a.totalBookings} total`;

        upsertChart('chartTrend', {
            type: 'line',
            data: {
                labels: a.trend.map(t => t.day),
                datasets: [{
                    data: a.trend.map(t => t.count),
                    borderColor: '#ec4899',
                    backgroundColor: 'rgba(236,72,153,0.12)',
                    fill: true, tension: 0.35,
                    pointRadius: 4, pointBackgroundColor: '#db2777',
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: AXIS_STYLE, y: { ...AXIS_STYLE, beginAtZero: true, ticks: { ...AXIS_STYLE.ticks, precision: 0 } } },
            },
        });

        upsertChart('chartDoctors', {
            type: 'bar',
            data: {
                labels: a.topDoctors.map(d => d.doctor.replace(/^Dr\.\s*/, '')),
                datasets: [{ data: a.topDoctors.map(d => d.count), backgroundColor: CHART_COLORS, borderRadius: 6 }],
            },
            options: {
                indexAxis: 'y',
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { ...AXIS_STYLE, beginAtZero: true, ticks: { ...AXIS_STYLE.ticks, precision: 0 } }, y: AXIS_STYLE },
            },
        });

        upsertChart('chartMode', {
            type: 'doughnut',
            data: {
                labels: ['WhatsApp', 'Browser'],
                datasets: [{
                    data: [a.byMode.WhatsApp, a.byMode.Browser],
                    backgroundColor: ['#34d399', '#818cf8'],
                    borderColor: 'rgba(15,17,26,0.9)', borderWidth: 3,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                cutout: '62%',
                plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } } },
            },
        });

        upsertChart('chartHours', {
            type: 'bar',
            data: {
                labels: a.peakHours.map(h => h.hour),
                datasets: [{ data: a.peakHours.map(h => h.count), backgroundColor: 'rgba(251,191,36,0.75)', borderRadius: 5 }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: AXIS_STYLE, y: { ...AXIS_STYLE, beginAtZero: true, ticks: { ...AXIS_STYLE.ticks, precision: 0 } } },
            },
        });

        upsertChart('chartReasons', {
            type: 'bar',
            data: {
                labels: a.topReasons.map(r => r.reason.length > 22 ? r.reason.slice(0, 22) + '…' : r.reason),
                datasets: [{ data: a.topReasons.map(r => r.count), backgroundColor: CHART_COLORS.slice().reverse(), borderRadius: 6 }],
            },
            options: {
                indexAxis: 'y',
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { ...AXIS_STYLE, beginAtZero: true, ticks: { ...AXIS_STYLE.ticks, precision: 0 } }, y: AXIS_STYLE },
            },
        });
    } catch (err) {
        console.error('Analytics fetch failed:', err);
    }
}

// ════════════════════════════════════════════════
// Boot
// ════════════════════════════════════════════════
async function updateCellularStatus() {
    try {
        const res = await fetch('/api/openline/status');
        if (!res.ok) return;
        const data = await res.json();
        const label = document.getElementById('cellularStatusLabel');
        const details = document.getElementById('cellularDetails');
        const dot = document.getElementById('cellularDot');
        if (data.online && data.device) {
            const h = data.device.health || {};
            if (label) label.textContent = 'SIM Online (Active)';
            if (details) details.textContent = `${data.device.name || 'Android'} · ${h.carrier || 'Cellular'} · ${h.battery ? h.battery + '%' : 'Ready'}`;
            if (dot) {
                dot.style.background = '#10b981';
                dot.style.boxShadow = '0 0 10px #10b981';
            }
        } else {
            if (label) label.textContent = 'SIM Gateway Off';
            if (details) details.textContent = 'Connect phone to OpenLine';
            if (dot) {
                dot.style.background = '#f59e0b';
                dot.style.boxShadow = '0 0 10px #f59e0b';
            }
        }
    } catch (e) {
        // ignore
    }
}

fetchAppointments();
setInterval(fetchAppointments, 30000);
fetchRecordings();
setInterval(fetchRecordings, 15000);
updateCellularStatus();
setInterval(updateCellularStatus, 15000);
initWebSocket();
renderDoctors();
checkGoogleAuth();
setInterval(checkGoogleAuth, 5 * 60 * 1000); // re-check every 5 min
fetchAnalytics();
setInterval(fetchAnalytics, 2 * 60 * 1000); // refresh charts every 2 min

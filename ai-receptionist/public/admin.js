/* ════════════════════════════════════════════════
   MedGuard Admin Dashboard — admin.js
   Now with WebSocket live logs + Blinkit order rendering
   ════════════════════════════════════════════════ */

'use strict';

let allLogs = [];
let currentFilter = 'all';
let blinkitOrderCount = 0;

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

        // Stats
        document.getElementById('total-bookings').innerText = appointments.length;
        const today = new Date().toDateString();
        const todayCount = appointments.filter(a => new Date(a.time).toDateString() === today).length;
        document.getElementById('today-bookings').innerText = todayCount;
        document.getElementById('upcoming-bookings').innerText = appointments.length - todayCount;

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
                    <button class="btn-rx" onclick="openRxModal('${esc(apt.patientName)}', '${esc(apt.time)}')">Write Rx</button>
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
            const { appointments = [], availableSlots = [], logs = [] } = JSON.parse(data);

            // Update appointments silently
            updateAppointmentsFromWS(appointments);

            // Update logs
            allLogs = logs;
            renderLogs();

            // Update Blinkit count
            const blinkitLogs = logs.filter(l => l.source === 'Blinkit');
            blinkitOrderCount = blinkitLogs.length;
            const bc = document.getElementById('blinkit-count');
            if (bc) bc.textContent = blinkitOrderCount;

            const lc = document.getElementById('logsCountBadge');
            if (lc) lc.textContent = logs.length;

        } catch (e) {
            console.error('WebSocket parse error:', e);
        }
    };
}

function updateAppointmentsFromWS(appointments) {
    const total = appointments.length;
    const today = new Date().toDateString();
    const todayCount = appointments.filter(a => new Date(a.time).toDateString() === today).length;

    const totalEl    = document.getElementById('total-bookings');
    const todayEl    = document.getElementById('today-bookings');
    const upcomingEl = document.getElementById('upcoming-bookings');

    if (totalEl)    totalEl.textContent    = total;
    if (todayEl)    todayEl.textContent    = todayCount;
    if (upcomingEl) upcomingEl.textContent = total - todayCount;
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
function openRxModal(patientName, appointmentDate) {
    document.getElementById('rxPatientName').value = patientName;
    document.getElementById('rxPatientDisplay').value = patientName;
    document.getElementById('rxAppointmentDate').value = appointmentDate;
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
            alert('Session expired. Please log in again.');
            window.location.href = '/login.html';
            return;
        }
        if (res.ok) {
            alert('Prescription published successfully!');
            closeRxModal();
        } else {
            const err = await res.json();
            alert('Error: ' + (err.error || 'Failed to publish'));
        }
    } catch (err) {
        alert('Network error while publishing prescription.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Publish Prescription';
    }
}

// ════════════════════════════════════════════════
// Boot
// ════════════════════════════════════════════════
fetchAppointments();
setInterval(fetchAppointments, 30000);
initWebSocket();

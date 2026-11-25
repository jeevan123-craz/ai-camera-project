/* ════════════════════════════════════════════════
   MedGuard AI — prescription.js
   Handles: Prescription Lookup, Download, Blinkit Order
   ════════════════════════════════════════════════ */

'use strict';

// ── State ──
let currentPrescription = null;

// ── DOM helpers ──
const $ = id => document.getElementById(id);

// ════════════════════════════════════════════════
// Deep-link support: /prescription.html?patient=Name&openBlinkit=1
// Lets the "Order Medicines" email button land straight on this
// patient's Blinkit ordering flow instead of making them retype their name.
// ════════════════════════════════════════════════
(function autoLoadFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const patient = params.get('patient');
    if (!patient) return;

    document.addEventListener('DOMContentLoaded', async () => {
        $('patientNameInput').value = patient;
        await fetchPrescription();
    });
})();

// ════════════════════════════════════════════════
// STEP 1: Fetch Prescription
// ════════════════════════════════════════════════
async function fetchPrescription() {
    const name = $('patientNameInput').value.trim();
    if (!name) {
        showError('Please enter your full name to look up your prescription.');
        return;
    }

    // Reset UI
    hideError();
    $('rxCard').style.display = 'none';
    $('rxLoading').style.display = 'flex';
    $('lookupBtn').disabled = true;
    $('lookupBtn').textContent = 'Searching…';

    try {
        const res = await fetch(`/api/prescription/${encodeURIComponent(name)}`);
        const data = await res.json();

        if (!res.ok || data.error) {
            throw new Error(data.error || 'No prescription found for this name.');
        }

        currentPrescription = data;
        renderPrescription(data);

    } catch (err) {
        showError('❌ ' + (err.message || 'Could not fetch prescription. Please check your name and try again.'));
    } finally {
        $('rxLoading').style.display = 'none';
        $('lookupBtn').disabled = false;
        $('lookupBtn').textContent = '🔍 Find Prescription';
    }
}

// ════════════════════════════════════════════════
// STEP 2: Render Prescription Card
// ════════════════════════════════════════════════
function renderPrescription(rx) {
    // Header date
    const now = new Date();
    $('rxDate').textContent = 'Issued: ' + now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    // Meta fields
    $('rxPatientName').textContent = rx.patientName || '—';
    $('rxApptDate').textContent    = rx.appointmentDate
        ? new Date(rx.appointmentDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—';
    $('rxDoctor').textContent    = rx.doctorName  || '—';
    $('rxDiagnosis').textContent = rx.diagnosis   || '—';

    // Medicines
    const medIcons = ['💊', '🔵', '🟡', '🔴', '🟢', '⚪'];
    const medList = $('rxMedicinesList');
    medList.innerHTML = '';

    if (!rx.medicines || !rx.medicines.length) {
        medList.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0;">No medicines listed.</p>';
    } else {
        rx.medicines.forEach((med, i) => {
            const row = document.createElement('div');
            row.className = 'medicine-row';
            row.innerHTML = `
                <div class="med-name"><span class="med-icon">${medIcons[i % medIcons.length]}</span>${escHtml(med.name)}</div>
                <div class="med-dosage">${escHtml(med.dosage || '—')}</div>
                <div class="med-duration">${escHtml(med.duration || '—')}</div>
                <div class="med-instructions">${escHtml(med.instructions || '—')}</div>
            `;
            medList.appendChild(row);
        });
    }

    // Doctor's notes
    $('rxDoctorNotes').textContent = rx.doctorNotes || 'No additional notes from the doctor.';

    // Show card
    $('rxCard').style.display = 'block';
    $('rxCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ════════════════════════════════════════════════
// Download / Print Prescription
// ════════════════════════════════════════════════
function downloadPrescription() {
    window.print();
}

// ════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════
function showError(msg) {
    const el = $('rxError');
    el.textContent = msg;
    el.style.display = 'block';
}
function hideError() { $('rxError').style.display = 'none'; }

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
